import assert from 'node:assert/strict'
import test from 'node:test'
import { computed, effectScope, markRaw, nextTick, reactive, watch } from 'vue'
import { jmaDetail, shindoUtils, read, report, quake } from './fixtures/JmaEarthquakeDetail.js'

const { selectJmaIntensityReport, normalizeJmaIntensityEvent, JmaEarthquakeDetailCache } = jmaDetail

test('JMA chooses exact titles, then issuedAt, then the later array entry', () => {
    const bulletin = report({ title: '震度速報', product: 'VXSE51', issuedAt: '2026-11-22T13:00:00Z' })
    const first = report(), tie = report({ id: 'tie' })
    const older = report({ id: 'older', issuedAt: '2026-11-22T11:00:00Z' })
    const other = report({ title: '遠地地震に関する情報', issuedAt: '2026-11-22T14:00:00Z' })
    assert.equal(selectJmaIntensityReport(quake('a', [first, bulletin, tie, older, other])), tie)
    const newest = report({ id: 'newest', issuedAt: '2026-11-22T12:01:00Z' })
    assert.equal(selectJmaIntensityReport(quake('a', [newest, first, tie])), newest)
    assert.equal(selectJmaIntensityReport(quake('a', [other])), null)
    const bulletinTie = { ...bulletin, id: 'bulletin-tie' }
    assert.equal(selectJmaIntensityReport(quake('a', [bulletin, bulletinTie, other])), bulletinTie)
    const changedProduct = report({ product: 'future-product' })
    assert.equal(selectJmaIntensityReport(quake('a', [changedProduct])), changedProduct, 'Product is not the selection whitelist')
    const noTime = report({ issuedAt: null }), badTime = report({ issuedAt: 'invalid' })
    assert.equal(selectJmaIntensityReport(quake('a', [noTime, badTime])), badTime)
    assert.equal(selectJmaIntensityReport(quake('a', [first, badTime])), first)
})

test('JMA skips cancelled reports without excluding other reports of the same product', () => {
    const detail = report(), bulletin = report({ title: '震度速報', product: 'VXSE51' })
    const cancelled = report({ status: 'cancelled', issuedAt: '2026-11-22T12:01:00Z' })
    assert.equal(selectJmaIntensityReport(quake('a', [detail, bulletin, cancelled])), detail)
    assert.equal(selectJmaIntensityReport(quake('a', [detail, cancelled])), detail)
    assert.equal(selectJmaIntensityReport(quake('a', [detail, { ...cancelled, title: '取消' }])), detail)
    assert.equal(selectJmaIntensityReport(quake('a', [detail, { ...cancelled, issuedAt: detail.issuedAt }])), detail)
    assert.equal(selectJmaIntensityReport(quake('a', [bulletin, cancelled])), bulletin)
    assert.equal(selectJmaIntensityReport(quake('a', [cancelled])), null)
    const cancelledBulletin = { ...bulletin, status: 'cancelled', issuedAt: cancelled.issuedAt }
    assert.equal(selectJmaIntensityReport(quake('a', [bulletin, cancelledBulletin])), bulletin)
    assert.equal(selectJmaIntensityReport(quake('a', [cancelled, cancelledBulletin])), null)
    assert.equal(selectJmaIntensityReport({ ...quake('a'), status: 'cancelled' }), null)
    const corrected = report({ status: 'corrected', issuedAt: '2026-11-22T12:02:00Z' })
    assert.equal(selectJmaIntensityReport(quake('a', [detail, cancelled, corrected])), corrected)
})

test('compact JMA details preserve index zero, leading zero codes and kanji without retaining raw reports', () => {
    const selected = report()
    selected.observation.areas[0].stations = [{ code: '0012345', name: '測站＊', int: '6+' }]
    const detail = normalizeJmaIntensityEvent(quake('a', [selected, report({ title: '長周期地震動に関する観測情報' })]))
    assert.deepEqual(detail.areas, [{ code: '743', name: '熊本県天草・芦北', intensity: '5弱' }])
    assert.deepEqual(detail.stations, [
        { code: '0012345', name: '測站＊', intensity: '6強', areaCode: '743' },
        { code: '4348201', name: '芦北町芦北', intensity: '5弱', areaCode: '743' },
    ])
    selected.observation.areas[0].int = '1'
    assert.equal(detail.areas[0].intensity, '5弱')
    assert.equal(detail.reports, undefined)
    assert.equal(detail.observation, undefined)
    const empty = normalizeJmaIntensityEvent(quake('b', [report({ observation: {} })]))
    assert.deepEqual(empty.stations, [])
    assert.deepEqual(empty.areas, [])
    const bulletin = normalizeJmaIntensityEvent(quake('b', [report({ title: '震度速報', observation: { areas: [{ code: '001', int: null }] } })]))
    assert.equal(bulletin.areas[0].intensity, '不明')
    assert.deepEqual(bulletin.stations, [])
})

test('one lazy JMA request fills all compact event caches; detail TTL is exactly five minutes', async () => {
    let now = 1000
    const requests = []
    const cache = new JmaEarthquakeDetailCache(time => new Promise(resolve => requests.push({ time, resolve })), () => now)
    assert.equal(requests.length, 0)
    const a = cache.get('a'), b = cache.get('b'), duplicate = cache.get('a')
    assert.equal(requests.length, 1)
    assert.equal(requests[0].time, 1000)
    now = 2000
    requests[0].resolve({ events: [quake('a'), quake('b')] })
    const [first, second, same] = await Promise.all([a, b, duplicate])
    assert.equal(first, same)
    assert.equal(second.eventId, 'b')
    now += 299999
    assert.equal(await cache.get('a'), first)
    assert.equal(requests.length, 1)
    now++
    const refresh = cache.get('a')
    assert.equal(requests.length, 2)
    assert.equal(requests[1].time, now)
    requests[1].resolve({ events: [quake('a', [report({ id: 'updated' })])] })
    assert.equal((await refresh).reportId, 'updated')
    assert.equal(cache.events.size, 1, 'Snapshot replacement bounds memory')
    assert.equal(second.eventId, 'b', 'Previously displayed compact data remains usable')
})

test('bulletins and absent events request immediately; failed or invalid requests do not renew cached data', async () => {
    let now = 0, calls = 0
    let response = { events: [quake('a', [report({ title: '震度速報' })])] }
    const cache = new JmaEarthquakeDetailCache(async () => {
        calls++
        if(response instanceof Error) throw response
        return response
    }, () => now)
    await cache.get('a')
    await cache.get('a')
    assert.equal(calls, 2)
    await cache.get('missing')
    await cache.get('missing')
    assert.equal(calls, 4)
    response = { events: [quake('a')] }
    const detail = await cache.get('a')
    now = 300000
    response = new Error('offline')
    await assert.rejects(cache.get('a'), /offline/)
    assert.equal(cache.events.get('a').fetchedAt, 0)
    assert.equal(cache.events.get('a').detail, detail)
    response = {}
    await assert.rejects(cache.get('a'), /INVALID_JMA_DETAIL/)
    response = { events: [] }
    assert.equal(await cache.get('a'), null)
    assert.equal(cache.events.size, 0)
})

const createHistoryEnvironment = () => {
    const layers = new Set(), listeners = new Set(), views = []
    const settings = reactive({ mainSettings: { displayHistoryStations: true } })
    let zoom = 8
    const map = {
        getZoom: () => zoom, hasLayer: layer => layers.has(layer), removeLayer: layer => layers.delete(layer),
        on: (name, handler) => listeners.add(handler), off: (name, handler) => listeners.delete(handler),
    }
    const L = { marker: (latLng, options) => ({
        latLng, options, bindTooltip(text) { this.tooltip = text }, addTo() { layers.add(this) }, setIcon(icon) { this.options.icon = icon },
    }) }
    const icons = Object.fromEntries([6, 7, 8, 9, 10].map(level => [level, Object.fromEntries(shindoUtils.shindoScale.map(value => [value, `${level}:${value}`]))]))
    const stationSource = read('src/classes/StationClasses.js').split('export class JmaReportStation ')[1].split('export class intReportStation ')[0]
    const JmaReportStation = new Function('L', 'markRaw', 'shindoIcons', 'formatShindo', 'getShindoRank', 'return class JmaReportStation ' + stationSource)(
        L, markRaw, icons, shindoUtils.formatShindo, shindoUtils.getShindoRank)
    const source = read('src/classes/EewEqlistClasses.js').split('export class HistoryEvent ')[1]
    const HistoryEvent = new Function('EqlistEvent', 'statusStore', 'markRaw', 'jmaSeisIntLoc', 'JmaReportStation', 'getShindoRank', 'settingsStore',
        'return class HistoryEvent ' + source)(class {
        constructor(map, eqMessage, unused, smartSetView) { Object.assign(this, { map, eqMessage, smartSetView }) }
        removeMark() {}
    }, {}, markRaw, { '芦北町芦北': { location: [32.3, 130.5] } }, JmaReportStation, shindoUtils.getShindoRank, settings)
    const history = reactive([])
    const create = id => {
        const event = reactive(new HistoryEvent(map, { jmaEventId: id, originTime: '2026-11-22 12:00:00', hypocenter: 'test' }, () => views.push(id), history))
        history.push(event)
        return event
    }
    return { create, layers, listeners, views, history, settings, zoom: value => { zoom = value; for(const listener of listeners) listener() } }
}

test('JMA stations follow CENC history lifecycle: zoom, stacked markers, replacement and event-local cleanup', () => {
    const { create, layers, listeners, views, history, zoom } = createHistoryEnvironment()
    const first = create('a'), second = create('b')
    const detail = normalizeJmaIntensityEvent(quake('a'))
    detail.stations[0].name += '＊'
    detail.stations.push({ code: 'missing', name: '未知測站', intensity: '7' })
    first.setJmaDetail(detail)
    second.setJmaDetail(normalizeJmaIntensityEvent(quake('b')))
    assert.equal(layers.size, 2, 'Each event owns its marker even at the same station')
    assert.equal(listeners.size, 2)
    assert.equal(first.stations.length, 1, 'Missing coordinates do not prevent other stations from rendering')
    const marker = first.stations[0].marker
    assert.equal(marker.options.pane, 'intReportStationPane5')
    assert.equal(marker.options.icon, '8:5-')
    assert.match(marker.tooltip, /観測震度: 5弱/)
    assert.match(marker.tooltip, /芦北町芦北＊/)
    assert.match(marker.tooltip, /地域: 熊本県天草・芦北/)
    zoom(12)
    assert.equal(marker.options.icon, '10:5-')
    first.setJmaDetail(detail)
    assert.equal(first.stations[0].marker, marker)
    assert.equal(views.length, 2, 'Reapplying the same cache entry does not redraw or refit')
    first.setJmaDetail(normalizeJmaIntensityEvent(quake('a', [report({ title: '震度速報', observation: { areas: detail.areas.map(a => ({ ...a, int: '4' })) } })])))
    assert.equal(layers.size, 1, 'Area-only reports remove old station markers')
    second.deactivate()
    assert.equal(layers.size, 0)
    assert.equal(history.length, 1)
    first.deactivate()
    assert.equal(listeners.size, 0)
    assert.equal(history.length, 0)
})

test('history station setting immediately clears markers and restores JMA from detail without changing regions', async t => {
    const { create, layers, listeners, history, settings } = createHistoryEnvironment()
    const event = create('a'), requested = []
    let cencCleared = 0
    history.push({ eqMessage: { intReportId: 'cenc' }, terminateStations: () => cencCleared++ })
    const component = read('src/components/MainMapComponent.vue')
    const start = component.indexOf('watch(() => settingsStore.mainSettings.displayHistoryStations,')
    const end = component.indexOf('watch([', start)
    assert.ok(start >= 0 && end > start)
    const scope = effectScope()
    t.after(() => scope.stop())
    scope.run(() => new Function('watch', 'settingsStore', 'historyList', 'statusStore', 'smartSetView', component.slice(start, end))(
        watch, settings, history, { getIrDetail: id => requested.push(id) }, () => {}))

    settings.mainSettings.displayHistoryStations = false
    await nextTick()
    const detail = normalizeJmaIntensityEvent(quake('a'))
    event.setJmaDetail(detail)
    assert.equal(layers.size, 0)
    assert.equal(listeners.size, 0)
    assert.equal(event.jmaDetail, detail, 'An arriving detail still supplies regional intensities')
    assert.equal(jmaDetail.mergeJmaHistoryAreas(history)['743'].intensity, '5弱')

    settings.mainSettings.displayHistoryStations = true
    await nextTick()
    assert.equal(layers.size, 1)
    assert.equal(listeners.size, 1)
    assert.deepEqual(requested, ['cenc'], 'Only CENC needs a detail request when re-enabling')
    settings.mainSettings.displayHistoryStations = false
    await nextTick()
    assert.equal(layers.size, 0)
    assert.equal(listeners.size, 0)
    assert.equal(cencCleared, 2)
    const updated = normalizeJmaIntensityEvent(quake('a'))
    updated.stations[0].intensity = '6強'
    event.setJmaDetail(updated)
    assert.equal(layers.size, 0, 'A later JMA response does not restore hidden markers')
    settings.mainSettings.displayHistoryStations = true
    await nextTick()
    assert.equal(layers.size, 1)
    assert.equal(event.stations[0].marker.options.icon, '8:6+')
    assert.equal(jmaDetail.mergeJmaHistoryAreas(history)['743'].intensity, '5弱')
    event.deactivate()
})

test('history region colors and labels merge all events by code and recompute on removal', () => {
    const component = read('src/components/MainMapComponent.vue')
    const start = component.indexOf('const jmaWarnArea ='), end = component.indexOf('const jpEewInfoList =', start)
    const historyList = reactive([])
    const dependencies = { ...shindoUtils, ...jmaDetail, computed, ref: value => ({ value }), historyList, menuId: { value: 'eqlists' } }
    const { jmaWarnArea, shindoList } = new Function(...Object.keys(dependencies), component.slice(start, end) + '\nreturn { jmaWarnArea, shindoList };')(...Object.values(dependencies))
    const one = normalizeJmaIntensityEvent(quake('a')), two = normalizeJmaIntensityEvent(quake('b'))
    two.areas[0].intensity = '6強'
    historyList.push({ jmaDetail: markRaw(one) }, { jmaDetail: markRaw(two) }, { eqMessage: { source: 'history' } })
    assert.equal(jmaWarnArea.value['743'].intensity, '6強')
    assert.equal(jmaWarnArea.value['743'].className, shindoUtils.setClassName('6強', true))
    assert.deepEqual(shindoList.value, [{ name: '熊本県天草・芦北', intensity: '6+' }])
    historyList.splice(1, 1)
    assert.equal(jmaWarnArea.value['743'].intensity, '5弱')
    historyList.splice(0, 1)
    assert.deepEqual(jmaWarnArea.value, {})
})
