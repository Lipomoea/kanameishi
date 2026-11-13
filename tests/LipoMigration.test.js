import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import { markRaw } from 'vue'
import * as dataSources from '../src/utils/DataSources.js'
import * as settingsRestore from '../src/utils/SettingsRestore.js'
import * as usgsData from '../src/utils/UsgsData.js'
import { decodeKmaPewsMessage } from '../src/utils/KmaPews.js'
import { createPewsFrame } from './fixtures/KmaPews.js'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const evaluateStore = (path, name, dependencies, result = `${name}()`) => {
    const source = read(path)
        .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
        .replace(/^export \{[^\n]+\}\s*$/gm, '')
        .replaceAll('export const ', 'const ')
    return new Function(...Object.keys(dependencies), source + `\nreturn ${result};`)(...Object.values(dependencies))
}
const timeToStamp = (value, zone) => value ? Date.parse(value.replace(' ', 'T') + 'Z') - zone * 3600000 : 0
const stampToTime = (value, zone) => new Date(value + zone * 3600000).toISOString().slice(0, 19).replace('T', ' ')
const setup = () => {
    setActivePinia(createPinia())
    const messages = [], sounds = [], calls = [], warnings = [], intensityCalculations = []
    const settings = {
        mainSettings: { apiKeys: { lipoApiKey: 'test-key' }, onReport: { sound: true, focus: false, notification: false } },
    }
    const http = {
        getResponse: async (...args) => { calls.push(args); return http.response },
        get: async () => http.feed,
    }
    const { store, sourceTypes, getProviderLabel } = evaluateStore('src/stores/status.js', 'useStatusStore', {
        ...dataSources, ...usgsData, defineStore, Http: http,
        eqUrls: {
            cencIr_http: 'https://example.test/cenc-ir', usgsEqlist_http: 'https://example.test/feed',
            jmaEqlist_http: 'https://example.test/quake',
        },
        tsunamiUrls: { jmaTsunami_http: 'https://example.test/tsunami' },
        iconUrls: {}, isTauri: () => false, useSettingsStore: () => settings,
        systemTimeZone: 8, timeToStamp, stampToTime,
        convertTimeString: (value, zone) => stampToTime(timeToStamp(value, zone), 8),
        calcTimeDiff: (a, az, b, bz) => timeToStamp(a, az) - timeToStamp(b, bz),
        getFEName: () => '', setClassName: (value, shindo, canceled) => canceled ? 'gray' : 'white',
        formatShindo: value => value?.replace('級', '').replace('弱', '-').replace('強', '+'),
        getShindoRank: value => ['0', '1', '2', '3', '4', '5弱', '5強', '6弱', '6強', '7'].indexOf(value),
        calcCsisLevel: (magnitude, depth, distance) => {
            intensityCalculations.push([magnitude, depth, distance])
            return Number.isFinite(magnitude) && magnitude >= 0 ? '3' : '?'
        },
        ElMessage: message => messages.push(message), playSound: sound => sounds.push(sound),
        focusWindow() {}, sendMyNotification() {},
        console: { log(error) { throw error }, warn(...args) { warnings.push(args) } },
    }, '({ store: useStatusStore(), sourceTypes, getProviderLabel })')
    store.configureDataSources(Object.fromEntries(Object.keys(dataSources.lipoSourceTypes).map(source => [source, { lipo: true }])))
    store.sourceRoutes.usgsEqlist.usgs = true
    return { store, settings, messages, sounds, http, calls, warnings, intensityCalculations, sourceTypes, getProviderLabel }
}
const event = (overrides = {}) => ({
    eventId: 'event-1', reportNum: 2, originTime: '2026-11-04 01:02:03', reportTime: '2026-11-04 01:02:10',
    originTimeStamp: Date.parse('2026-11-04T01:02:03Z'), reportTimeStamp: Date.parse('2026-11-04T01:02:10Z'),
    epicenter: 'test', latitude: 35, longitude: 140, depth: 0, magnitude: 4.2, maxIntensity: 0,
    ...overrides,
})
const cencIrRow = (overrides = {}) => ({
    City: '那曲市', County: '巴青县', Date: '2026-11-04 01:02:03', Dist: 12.34,
    INT: 1.5, IPGA: -0.5, IPGV: null, Mag: 4.2, PGA: 2.3, PGV: 0,
    Province: '西藏', Town: null, evName: '西藏那曲市巴青县', evdp: 10, evla: 31.93, evlo: 94.12,
    network: 'XZ', stID: '0001', stName: ' 测试站 ', stla: 31.8, stlo: 94.2, tag: 0,
    ...overrides,
})

const setupHttpPolling = t => {
    let now = 0, clockOffset = 0, nextTimerId = 0
    const timers = new Map(), requests = []
    t.mock.method(Date, 'now', () => now + clockOffset)
    t.mock.method(globalThis, 'setInterval', (callback, delay) => {
        const id = ++nextTimerId
        timers.set(id, { callback, delay, at: now + delay })
        return id
    })
    t.mock.method(globalThis, 'clearInterval', id => timers.delete(id))
    const { store, http } = setup()
    store.configureDataSources({
        jmaEqlist: { p2pquake: true }, jmaTsunami: { p2pquake: true }, usgsEqlist: { usgs: true },
    })
    http.get = async url => { requests.push({ path: new URL(url).pathname, at: Date.now() }) }
    t.after(() => store.disconnect())
    const advance = async ms => {
        const until = now + ms
        while (true) {
            const timer = [...timers.values()].sort((a, b) => a.at - b.at)[0]
            if (!timer || timer.at > until) break
            now = timer.at
            timer.at += timer.delay
            await timer.callback()
        }
        now = until
    }
    const times = path => requests.filter(request => request.path === path).map(request => request.at)
    return { store, advance, times, setClockOffset: offset => { clockOffset = offset } }
}

test('P2PQuake HTTP intervals follow the connection at request time, independently of cached message IDs', async t => {
    const { store, advance, times } = setupHttpPolling(t)
    store.eqMessage.jmaEqlist.id = 'cached-quake'
    store.tsunamiMessage.jmaTsunami.id = 'cached-tsunami'
    store.webSocketStatus.p2pquake.readyState = 0
    store.connect('http')
    await advance(4000)
    assert.deepEqual(times('/quake'), [1000, 3000])
    assert.deepEqual(times('/tsunami'), [2000, 4000])

    store.webSocketStatus.p2pquake.readyState = 1
    store.eqMessage.jmaEqlist.id = ''
    store.tsunamiMessage.jmaTsunami.id = ''
    await advance(2000)
    store.webSocketStatus.p2pquake.readyState = 3
    await advance(28000)
    assert.deepEqual(times('/quake'), [1000, 3000, 5000])
    assert.deepEqual(times('/tsunami'), [2000, 4000, 6000])
    await advance(4000)
    assert.deepEqual(times('/quake'), [1000, 3000, 5000, 35000, 37000])
    assert.deepEqual(times('/tsunami'), [2000, 4000, 6000, 36000, 38000])
})

test('USGS HTTP uses 30 ticks only when Lipo is connected and authenticated at request time', async t => {
    const { store, advance, times } = setupHttpPolling(t)
    store.webSocketStatus.lipo.readyState = 1
    store.lipoAuthStatus = -1
    store.connect('http')
    await advance(6000)
    assert.deepEqual(times('/feed'), [1000, 6000])

    store.lipoAuthStatus = 1
    await advance(5000)
    store.lipoAuthStatus = 0
    await advance(29000)
    assert.deepEqual(times('/feed'), [1000, 6000, 11000])
    await advance(1000)
    store.webSocketStatus.lipo.readyState = 3
    store.lipoAuthStatus = 1
    await advance(5000)
    store.webSocketStatus.lipo.readyState = 1
    await advance(5000)
    assert.deepEqual(times('/feed'), [1000, 6000, 11000, 41000, 46000, 51000])
    await advance(30000)
    assert.deepEqual(times('/feed'), [1000, 6000, 11000, 41000, 46000, 51000, 81000])
})

test('HTTP polling counts callbacks without waiting an extra tick when clock readings are 1 ms early', async t => {
    const { store, advance, times, setClockOffset } = setupHttpPolling(t)
    store.connect('http')
    await advance(1000)
    setClockOffset(-1)
    await advance(5000)
    assert.deepEqual(times('/quake'), [1000, 2999, 4999])
    assert.deepEqual(times('/tsunami'), [1999, 3999, 5999])
    assert.deepEqual(times('/feed'), [1000, 5999])

    store.webSocketStatus.p2pquake.readyState = 1
    store.webSocketStatus.lipo.readyState = 1
    store.lipoAuthStatus = 1
    await advance(5000)
    setClockOffset(-2)
    await advance(30000)
    assert.deepEqual(times('/quake'), [1000, 2999, 4999, 6999, 36998])
    assert.deepEqual(times('/tsunami'), [1999, 3999, 5999, 7999, 37998])
    assert.deepEqual(times('/feed'), [1000, 5999, 10999, 40998])
})

test('HTTP polling respects provider switches and replaces or stops its schedule on reconnect or disconnect', async t => {
    const { store, advance, times } = setupHttpPolling(t)
    store.configureDataSources({ jmaEqlist: { p2pquake: false, lipo: true }, usgsEqlist: { usgs: false, lipo: true } })
    store.connect('http')
    await advance(3000)
    assert.deepEqual(times('/quake'), [])
    assert.deepEqual(times('/tsunami'), [])
    assert.deepEqual(times('/feed'), [])

    store.configureDataSources({ jmaEqlist: { p2pquake: true }, jmaTsunami: { p2pquake: true }, usgsEqlist: { usgs: true } })
    store.connect('http')
    store.connect('http')
    await advance(2000)
    assert.deepEqual(times('/quake'), [4000])
    assert.deepEqual(times('/tsunami'), [5000])
    assert.deepEqual(times('/feed'), [4000])
    store.disconnect()
    await advance(60000)
    assert.deepEqual(times('/quake'), [4000])
    assert.deepEqual(times('/tsunami'), [5000])
    assert.deepEqual(times('/feed'), [4000])
})

test('Lipo applies source-specific zero fallbacks while preserving report depths and time zones', () => {
    const { store, intensityCalculations } = setup()
    for(const [source, depth, intensity, depthText] of [
        ['ceaEew', 0, '3', '深度: 0km'],
        ['iclEew', 10, '3', '深度: 不明'],
        ['kmaEew', 10, '0', '깊이: 불명'],
        ['kmaEqlist', 0, '0', '깊이: 0km'],
    ]) {
        store.setEqMessage(source, event(), 'lipo')
        assert.equal(store.eqMessage[source].depth, depth, source)
        assert.equal(store.eqMessage[source].maxIntensity, intensity, source)
        assert.equal(store.eqMessage[source].depthText, depthText, source)
    }
    assert.deepEqual(intensityCalculations, [[4.2, 0, 0], [4.2, 10, 0]])
    assert.equal(store.eqMessage.ceaEew.reportTime, '2026-11-04 01:02:03')
    assert.equal(store.eqMessage.iclEew.reportTime, '2026-11-04 01:02:10')
    assert.equal(store.eqMessage.kmaEew.timeZone, 9)
    assert.equal(store.eqMessage.kmaEqlist.timeZone, 9)
    store.setEqMessage('usgsEqlist', event({ depth: -1.5, maxIntensity: undefined }), 'lipo')
    assert.equal(store.eqMessage.usgsEqlist.originTime, '2026-11-04 09:02:03')
    assert.equal(store.eqMessage.usgsEqlist.reportTime, '2026-11-04 09:02:10')
    assert.equal(store.eqMessage.usgsEqlist.timeZone, 8)
    assert.equal(store.eqMessage.usgsEqlist.depth, -1.5)
})

test('CEA and ICL estimate missing intensity while KMA leaves it empty and keeps supplied values', () => {
    const { store, intensityCalculations } = setup()
    for(const missing of [null, undefined]) {
        intensityCalculations.length = 0
        for(const source of ['ceaEew', 'iclEew', 'kmaEew', 'kmaEqlist']) {
            store.setEqMessage(source, event({ depth: missing, maxIntensity: missing }), 'lipo')
            assert.equal(store.eqMessage[source].depth, 10, source)
            assert.equal(store.eqMessage[source].maxIntensity, source.startsWith('kma') ? '' : '3', source)
            assert.equal(store.eqMessage[source].isWarn, false, source)
        }
        assert.deepEqual(intensityCalculations, [[4.2, 10, 0], [4.2, 10, 0]])
        store.setHistory('kmaEqlist', [event({ maxIntensity: missing, depth: 0 })], 'lipo')
        assert.equal(store.history.kmaEqlist[0].maxIntensity, '')
        assert.equal(store.history.kmaEqlist[0].depth, 0)
    }
    intensityCalculations.length = 0
    for(const source of ['ceaEew', 'iclEew', 'kmaEew', 'kmaEqlist']) {
        store.setEqMessage(source, event({ depth: 25, maxIntensity: 7 }), 'lipo')
        assert.equal(store.eqMessage[source].depth, 25, source)
        assert.equal(store.eqMessage[source].maxIntensity, '7', source)
        if(source.endsWith('Eew')) assert.equal(store.eqMessage[source].isWarn, true, source)
    }
    assert.deepEqual(intensityCalculations, [])
})

test('CWA reports use the supplied report time or the unchanged origin time', () => {
    const { store } = setup()
    for(const reportTime of [event().reportTime, undefined, null, '']) {
        store.setEqMessage('cwaEqlist', event({ reportTime, maxIntensity: '3級' }), 'lipo')
        assert.equal(store.eqMessage.cwaEqlist.reportTime, reportTime || event().originTime)
    }
})

test('Lipo JMA translates cancellation and final/training flags without changing provider priority', () => {
    const { store } = setup()
    store.setEqMessage('jmaEew', event({ maxIntensity: '5弱', isWarn: true, isFinal: true, isTraining: true, isCanceled: true }), 'lipo')
    const message = store.eqMessage.jmaEew
    assert.equal(message.type, 1)
    assert.equal(message.isCanceled, true)
    assert.equal(message.isFinal, true)
    assert.equal(message.reportNum, 2)
    assert.equal(message.timeZone, 9)
    assert.match(message.titleText, /訓練.*取消/)
    store.setEqMessage('jmaEew', event({ maxIntensity: undefined, depth: null, epicenter: undefined, magnitude: undefined }), 'lipo')
    assert.equal(message.isCanceled, false)
    assert.equal(message.isFinal, false)
    assert.equal(message.maxIntensity, '不明')
    assert.equal(message.magnitude, -1)
    assert.equal(message.magnitudeText, 'マグニチュード: 不明')
})

test('provider routing follows sourceTypes after reordering, including single-provider sources', () => {
    const { store, sourceTypes, getProviderLabel } = setup()
    sourceTypes.jmaEew = { 0: 'lipo', 1: 'wolfx' }
    store.receiveLipoMessage({ type: 'jma_eew', data: event({ maxIntensity: '4' }) })
    assert.equal(store.eqMessage.jmaEew.type, 0)
    assert.equal(store.eqMessage.jmaEew.id, 'event-1')
    assert.equal(getProviderLabel(store.eqMessage.jmaEew), 'Lipo')
    store.setEqMessage('jmaEew', {
        EventID: 'wolfx-event', Serial: 3, AnnouncedTime: '2026/11/04 01:02:10',
        OriginTime: '2026/11/04 01:02:03', Title: 'test', Hypocenter: 'Wolfx event',
        Latitude: 35, Longitude: 140, Depth: 10, Magunitude: 4.2, MaxIntensity: '4',
        WarnArea: [], isCancel: false,
    }, 'wolfx')
    assert.equal(store.eqMessage.jmaEew.type, 1)
    assert.equal(store.eqMessage.jmaEew.id, 'wolfx-event')
    assert.equal(store.eqMessage.jmaEew.reportNum, 3)
    assert.equal(getProviderLabel(store.eqMessage.jmaEew), 'Wolfx')

    // The same provider has an independent rank for each source.
    store.setEqMessage('ceaEew', event(), 'lipo')
    assert.equal(store.eqMessage.ceaEew.type, 0)
    sourceTypes.ceaEew = { 0: 'wolfx', 1: 'lipo' }
    store.setEqMessage('ceaEew', event({ depth: 0 }), 'lipo')
    assert.equal(store.eqMessage.ceaEew.type, 1)
    assert.equal(store.eqMessage.ceaEew.depth, 0)
    store.setEqMessage('ceaEew', {
        EventID: 'cea-wolfx', ReportNum: 3, ReportTime: event().reportTime,
        OriginTime: event().originTime, HypoCenter: 'CEA event', Latitude: 30,
        Longitude: 105, Depth: 8, Magnitude: 5, MaxIntensity: 4,
    }, 'wolfx')
    assert.equal(store.eqMessage.ceaEew.type, 0)
    assert.equal(store.eqMessage.ceaEew.id, 'cea-wolfx')
    assert.equal(store.eqMessage.ceaEew.depth, 8)

    sourceTypes.cwaEew = { 2: 'wolfx' }
    store.setEqMessage('cwaEew', {
        ID: 'cwa-event', ReportNum: 1, ReportTime: event().reportTime, OriginTime: event().originTime,
        HypoCenter: 'CWA event', Latitude: 24, Longitude: 121, Depth: 10, Magunitude: 5, MaxIntensity: '4',
    }, 'wolfx')
    assert.equal(store.eqMessage.cwaEew.type, 2)
    assert.equal(store.eqMessage.cwaEew.id, 'cwa-event')
    for(const source of ['iclEew', 'kmaEew', 'cwaEqlist', 'kmaEqlist']) {
        sourceTypes[source] = { 0: 'lipo' }
        store.setEqMessage(source, event({ maxIntensity: undefined, epicenter: undefined }), 'lipo')
        assert.equal(store.eqMessage[source].type, 0, source)
        assert.equal(store.eqMessage[source].id, 'event-1', source)
    }
})

test('unknown providers and failed parsing leave messages unchanged; mock payloads cannot override routing', () => {
    const { store, sourceTypes, warnings, getProviderLabel } = setup()
    store.setEqMessage('jmaEew', event({ maxIntensity: '4' }), 'lipo')
    const previous = { ...store.eqMessage.jmaEew }
    for(const provider of [undefined, 0, 1, 'unknown', 'usgs']) {
        store.setEqMessage('jmaEew', {}, provider)
    }
    store.setEqMessage('unknown', {}, 'lipo')
    assert.equal(warnings.length, 6)
    assert.deepEqual(store.eqMessage.jmaEew, previous)
    assert.throws(() => store.setEqMessage('jmaEew', { EventID: 'incomplete', Serial: 99 }, 'wolfx'))
    assert.deepEqual(store.eqMessage.jmaEew, previous)
    sourceTypes.mockEew = { 2: 'mock' }
    store.setEqMessage('mockEew', { source: 'jmaEew', type: 0, id: 'mock-event', isEew: true }, 'mock')
    assert.equal(store.eqMessage.mockEew.source, 'mockEew')
    assert.equal(store.eqMessage.mockEew.type, 2)
    assert.equal(getProviderLabel(store.eqMessage.mockEew), 'MOCK')
})

test('GQ stores quality separately, preserves it on cancellation, and resets it for a different event', () => {
    const { store, getProviderLabel } = setup()
    const report = {
        Id: 'gq-event', RevisionId: 1, OriginTime: '2026-11-04T01:02:03Z',
        LastUpdatedTime: '2026-11-04T01:02:10Z', Latitude: 30, Longitude: 105,
        Depth: 10, Magnitude: 5, Region: 'GQ event', Quality: { QualityLevel: 0 },
    }
    store.setEqMessage('gqEew', report, 'globalquake')
    assert.equal(store.eqMessage.gqEew.type, 0)
    assert.equal(store.eqMessage.gqEew.quality, 0)
    assert.equal(getProviderLabel(store.eqMessage.gqEew), 'GQ')
    store.setEqMessage('gqEew', { ...report, RevisionId: 2, Quality: { QualityLevel: 4 } }, 'globalquake')
    assert.equal(store.eqMessage.gqEew.type, 0)
    assert.equal(store.eqMessage.gqEew.quality, 4)
    store.setEqMessage('gqEew', { Id: report.Id, RevisionId: -1 }, 'globalquake')
    assert.equal(store.eqMessage.gqEew.isCanceled, true)
    assert.equal(store.eqMessage.gqEew.reportNum, 2)
    assert.equal(store.eqMessage.gqEew.quality, 4)
    store.setEqMessage('gqEew', { ...report, Id: 'gq-next', Quality: undefined }, 'globalquake')
    assert.equal(store.eqMessage.gqEew.quality, 9)
    assert.equal(store.eqMessage.gqEew.isCanceled, false)
})

test('CENC provider reordering preserves the time filter and does not relabel rejected reports', () => {
    const { store, sourceTypes } = setup()
    sourceTypes.cencEqlist = { 0: 'lipo', 1: 'wolfx' }
    store.setEqMessage('cencEqlist', event(), 'lipo')
    const previous = { ...store.eqMessage.cencEqlist }
    const wolfx = { No1: {
        EventID: 'cenc-wolfx', ReportTime: event().reportTime, time: event().originTime,
        type: 'reviewed', placeName: 'CENC event', latitude: '35', longitude: '140', depth: '10', magnitude: '5',
    } }
    store.setEqMessage('cencEqlist', wolfx, 'wolfx')
    assert.deepEqual(store.eqMessage.cencEqlist, previous)
    wolfx.No1.ReportTime = '2026-11-04 01:02:40'
    store.setEqMessage('cencEqlist', wolfx, 'wolfx')
    assert.equal(store.eqMessage.cencEqlist.type, 1)
    assert.equal(store.eqMessage.cencEqlist.id, 'cenc-wolfx')
})

test('CENC and CWA lists use new IDs/fields, preserve Wolfx merge, and replace empty snapshots', () => {
    const { store } = setup()
    store.setHistory('cencEqlist', [event({ eventId: 'cenc:123', reviewType: 'reviewed' })], 'lipo')
    store.setHistory('cencEqlist', { No1: {
        EventID: 'wolfx:123', time: '2026-11-04 01:02:03', type: 'reviewed', placeName: 'test',
        latitude: '35', longitude: '140', depth: '0', magnitude: '4.2',
    } }, 'wolfx')
    assert.equal(store.history.cencEqlist.length, 1)
    assert.equal(store.history.cencEqlist[0].id, 'cenc:123')
    store.setHistory('cwaEqlist', [event({ eventId: 'cwa:123', maxIntensity: '5弱', url: 'https://example.test/event' })], 'lipo')
    assert.equal(store.history.cwaEqlist[0].id, 'cwa:123')
    assert.equal(store.history.cwaEqlist[0].maxIntensity, '5-')
    assert.equal(store.history.cwaEqlist[0].url, 'https://example.test/event')
    store.setHistory('cwaEqlist', [], 'lipo')
    assert.equal(store.history.cwaEqlist.length, 0)
    store.setHistory('cencEqlist', [], 'lipo')
    assert.equal(store.history.cencEqlist[0].id, 'wolfx:123')
})

test('CENC IR uses ID differences after an empty baseline, ignores title/order changes, and updates history links', () => {
    const { store, messages, sounds } = setup()
    const id = 20261104010203
    store.setHistory('cencEqlist', [event({ eventId: 'cenc:123', reviewType: 'reviewed' })], 'lipo')
    store.receiveLipoMessage({ type: 'cenc_ir', data: [] })
    store.receiveLipoMessage({ type: 'cenc_ir', data: [{ id, title: 'new report' }] })
    assert.equal(messages.length, 1)
    assert.match(messages[0].message, /new report/)
    assert.equal(sounds.length, 1)
    assert.equal(store.history.cencEqlist[0].intReportId, String(id))
    store.receiveLipoMessage({ type: 'cenc_ir', data: [{ id, title: 'revised title' }] })
    store.receiveLipoMessage({ type: 'cenc_ir', data: [{ id, title: 'revised title' }] })
    assert.equal(messages.length, 1, 'Repeated query/reconnect snapshots do not notify again')
    store.receiveLipoMessage({ type: 'cenc_ir', data: [] })
    assert.equal(store.history.cencEqlist[0].intReportId, null)
    assert.equal(messages.length, 1)
    const cold = setup()
    cold.store.setIntReports([{ id, title: 'existing report' }])
    assert.equal(cold.messages.length, 0)
})

test('Lipo routes the new lists only while their sources are enabled', () => {
    const { store } = setup()
    store.receiveLipoMessage({ type: 'usgs_report_list', data: [event()] })
    store.receiveLipoMessage({ type: 'kma_report_list', data: [event()] })
    assert.equal(store.history.usgsEqlist.length, 1)
    assert.equal(store.history.kmaEqlist.length, 1)
    assert.equal(store.usgsRealtimeCache.size, 0, 'List responses do not seed realtime hashes')
    assert.equal(store.eqMessage.usgsEqlist.id, '')
    assert.equal(store.eqMessage.kmaEqlist.id, '')
    store.configureDataSources({ jmaEew: { wolfx: true, lipo: false } })
    store.receiveLipoMessage({ type: 'jma_eew', data: event() })
    assert.equal(store.eqMessage.jmaEew.id, '')
    store.receiveLipoMessage({ type: 'jma_eew', data: null })
    store.receiveLipoMessage({ type: 'kma_report_list', data: [event({ eventId: 'disabled' })] })
    store.receiveLipoMessage({ type: 'usgs_report_list', data: [event({ eventId: 'disabled' })] })
    assert.equal(store.history.kmaEqlist[0].id, 'event-1')
    assert.equal(store.history.usgsEqlist.length, 0)
})

const usgsPair = (overrides = {}) => {
    const lipo = event({ eventId: 'us-example', reviewType: 'reviewed', magnitudeType: 'mb',
        depth: -1.5, url: 'https://example.test/event', ...overrides })
    const geojson = {
        id: lipo.eventId, geometry: { coordinates: [lipo.longitude, lipo.latitude, lipo.depth] },
        properties: {
            code: 'example', type: 'earthquake', time: lipo.originTimeStamp, updated: lipo.reportTimeStamp,
            mag: lipo.magnitude, magType: lipo.magnitudeType, place: lipo.epicenter,
            status: lipo.reviewType, url: lipo.url,
        },
    }
    return { lipo, geojson }
}

test('USGS provider reordering preserves realtime version rejection and official history ties', () => {
    const { store, sourceTypes, getProviderLabel } = setup()
    sourceTypes.usgsEqlist = { 0: 'lipo', 1: 'usgs' }
    const first = usgsPair()
    store.setEqMessage('usgsEqlist', first.geojson, 'usgs')
    assert.equal(store.eqMessage.usgsEqlist.type, 1)
    assert.equal(getProviderLabel(store.eqMessage.usgsEqlist), 'USGS')
    const previous = { ...store.eqMessage.usgsEqlist }
    store.setEqMessage('usgsEqlist', usgsPair({ magnitude: 6 }).lipo, 'lipo')
    assert.deepEqual(store.eqMessage.usgsEqlist, previous, 'A lower type does not bypass equal-version rejection')
    assert.equal(store.history.usgsEqlist[0].magnitude, first.lipo.magnitude, 'Official history still wins a tie')
    store.setEqMessage('usgsEqlist', usgsPair({ reportTimeStamp: first.lipo.reportTimeStamp + 1, magnitude: 6 }).lipo, 'lipo')
    assert.equal(store.eqMessage.usgsEqlist.type, 0)
    assert.equal(store.eqMessage.usgsEqlist.magnitude, 6)
    store.setEqMessage('usgsEqlist', usgsPair({ reportTimeStamp: first.lipo.reportTimeStamp + 2, magnitude: 5 }).geojson, 'usgs')
    assert.equal(store.eqMessage.usgsEqlist.type, 1)
    assert.equal(store.eqMessage.usgsEqlist.magnitude, 5, 'Newer reports update regardless of type')
})

test('CENC and USGS preserve reviewType in live/history events and choose sounds independently of titles', () => {
    const classSource = read('src/classes/EewEqlistClasses.js')
    const start = classSource.indexOf('    handleActions(){', classSource.indexOf('export class EqlistEvent'))
    const end = classSource.indexOf('    handleClick()', start)
    for(const [source, provider] of [
        ['cencEqlist', 'wolfx'], ['cencEqlist', 'lipo'], ['usgsEqlist', 'usgs'], ['usgsEqlist', 'lipo'],
    ]) {
        for(const reviewType of ['automatic', 'reviewed']) {
            const { store, settings, sounds } = setup()
            let data
            if(source === 'cencEqlist') {
                const report = event({ reviewType })
                data = provider === 'lipo' ? report : { No1: {
                    EventID: report.eventId, type: reviewType, time: report.originTime, ReportTime: report.reportTime,
                    placeName: report.epicenter, latitude: String(report.latitude), longitude: String(report.longitude),
                    depth: String(report.depth), magnitude: String(report.magnitude),
                } }
            } else {
                const pair = usgsPair({ reviewType })
                data = provider === 'lipo' ? pair.lipo : pair.geojson
            }
            store.setEqMessage(source, data, provider)
            store.setHistory(source, provider === 'wolfx' ? data : [data], provider)
            assert.equal(store.eqMessage[source].reviewType, reviewType, `${source}/${provider} live`)
            assert.equal(store.history[source][0].reviewType, reviewType, `${source}/${provider} history`)

            const handleActions = new Function('settingsStore', 'playSound',
                'return ({' + classSource.slice(start, end) + '}).handleActions')(settings, sound => sounds.push(sound))
            const message = { ...store.eqMessage[source] }
            // Deliberately contradict the type with the old exact title to catch title-based branching.
            message.title = (source === 'cencEqlist' ? '中国地震台网' : 'USGS')
                + (reviewType === 'automatic' ? '正式' : '自动') + '测定'
            handleActions.call({ eqMessage: message, handleTempEqlists() {} })
            assert.deepEqual(sounds, [reviewType === 'automatic' ? 'hypocenter' : 'detail'], `${source}/${provider}`)
        }
    }
})

test('USGS accepts non-earthquake GeoJSON records in realtime and history', () => {
    const { store } = setup()
    const { geojson } = usgsPair()
    geojson.properties.type = 'quarry blast'
    store.setEqMessage('usgsEqlist', geojson, 'usgs')
    store.setHistory('usgsEqlist', [geojson], 'usgs')
    assert.equal(store.eqMessage.usgsEqlist.id, geojson.id)
    assert.equal(store.history.usgsEqlist.length, 1)
    assert.equal(store.history.usgsEqlist[0].id, geojson.id)
})

test('USGS fingerprints normalize both providers and exclude timestamps and ancillary metadata', () => {
    const pair = usgsPair({ magnitude: 0, depth: 0 })
    const fromLipo = usgsData.normalizeUsgsEvent(pair.lipo, 'lipo')
    const fromGeojson = usgsData.normalizeUsgsEvent(pair.geojson, 'usgs')
    assert.deepEqual(fromGeojson, fromLipo)
    const hash = usgsData.hashUsgsContent(fromLipo)
    pair.geojson.properties.updated += 123
    pair.geojson.properties.felt = 50
    pair.geojson.properties.cdi = 4
    pair.geojson.properties.mmi = 5
    pair.geojson.properties.url = 'https://example.test/changed-url'
    assert.equal(usgsData.hashUsgsContent(usgsData.normalizeUsgsEvent(pair.geojson, 'usgs')), hash)
    for(const [field, value] of Object.entries({ originTimeStamp: fromLipo.originTimeStamp + 1,
        latitude: 36, longitude: 141, depth: 1, magnitude: 1, magnitudeType: 'mw',
        epicenter: 'changed', reviewType: 'automatic' })) {
        assert.notEqual(usgsData.hashUsgsContent({ ...fromLipo, [field]: value }), hash, field)
    }
})

test('USGS A -> B -> A metadata changes and stale/equal revisions cannot retrigger actions; newer content keeps millisecond precision', () => {
    const { store } = setup()
    const classSource = read('src/classes/EewEqlistClasses.js')
    const start = classSource.indexOf('    update(eqMessage, time, isFirst = false){', classSource.indexOf('export class EqlistEvent'))
    const end = classSource.indexOf('    setMark(){', start)
    const update = new Function('timeToStamp', 'setTimeout', 'clearTimeout',
        'return ({' + classSource.slice(start, end) + '}).update')(timeToStamp, () => 0, () => {})
    const actions = []
    const view = { eqMessage: {}, setMark() {}, smartSetView() {},
        handleActions() { actions.push({ ...this.eqMessage }) } }
    const deliver = (data, provider) => {
        store.setEqMessage('usgsEqlist', data, provider)
        update.call(view, { ...store.eqMessage.usgsEqlist }, 60000, actions.length === 0)
    }
    const a = usgsPair(), stamp = a.lipo.reportTimeStamp
    deliver(a.geojson, 'usgs')
    deliver(usgsPair({ eventId: 'us-older-b', originTimeStamp: a.lipo.originTimeStamp - 3600000,
        reportTimeStamp: stamp + 1000, magnitude: 5 }).lipo, 'lipo')
    const displayedB = { ...store.eqMessage.usgsEqlist }
    const metadata = usgsPair({ reportTimeStamp: stamp + 2000 }).geojson
    metadata.properties.felt = 99
    deliver(metadata, 'usgs')
    assert.deepEqual(store.eqMessage.usgsEqlist, displayedB, 'Do not mutate provider or report time on a duplicate')
    assert.equal(store.usgsRealtimeCache.get(a.lipo.eventId).timestamp, stamp + 2000)
    deliver(usgsPair({ reportTimeStamp: stamp + 1500, magnitude: 6 }).lipo, 'lipo')
    deliver(usgsPair({ reportTimeStamp: stamp + 2000, magnitude: 6 }).geojson, 'usgs')
    assert.equal(actions.length, 2)
    deliver(usgsPair({ reportTimeStamp: stamp + 2001, magnitude: 5.1 }).lipo, 'lipo')
    deliver(usgsPair({ reportTimeStamp: stamp + 2002, magnitude: 5.2 }).geojson, 'usgs')
    assert.equal(actions.length, 4)
    assert.equal(actions[2].reportTime, actions[3].reportTime)
    assert.equal(actions[3].reportTimeStamp, stamp + 2002)
    deliver(usgsPair({ reportTimeStamp: stamp + 3000 }).lipo, 'lipo')
    assert.equal(actions.length, 5, 'A real return to an earlier content value is a valid revision')
    assert.equal(store.eqMessage.usgsEqlist.id, a.geojson.id)
})

test('USGS history unions complete feature IDs, selects newer whole records, prefers official ties, and sorts by origin time', () => {
    const { store } = setup()
    const a = usgsPair(), stamp = a.lipo.reportTimeStamp
    const older = usgsPair({ eventId: 'ci-example', originTimeStamp: a.lipo.originTimeStamp - 3600000,
        reportTimeStamp: stamp + 9999 })
    const lipoNewer = usgsPair({ reportTimeStamp: stamp + 1, magnitude: 5 })
    store.setHistory('usgsEqlist', [lipoNewer.lipo, older.lipo], 'lipo')
    store.setHistory('usgsEqlist', [a.geojson], 'usgs')
    assert.deepEqual(store.history.usgsEqlist.map(item => item.id), ['us-example', 'ci-example'])
    assert.equal(store.history.usgsEqlist[0].magnitude, 5)
    const officialTie = usgsPair({ reportTimeStamp: stamp + 1, magnitude: 6, url: 'https://example.test/official' })
    store.setHistory('usgsEqlist', [officialTie.geojson], 'usgs')
    assert.equal(store.history.usgsEqlist[0].magnitude, 6)
    assert.equal(store.history.usgsEqlist[0].url, officialTie.lipo.url)
    assert.equal(store.history.usgsEqlist[0].depth, -1.5)
    assert.equal(store.history.usgsEqlist[0].originTime, '2026-11-04 09:02:03')
    store.setHistory('usgsEqlist', [lipoNewer.lipo, older.lipo], 'lipo')
    assert.equal(store.history.usgsEqlist[0].magnitude, 6, 'Arrival order does not override the tie rule')
    assert.equal(store.usgsRealtimeCache.size, 0)
    assert.equal(store.eqMessage.usgsEqlist.id, '')
    store.setEqMessage('usgsEqlist', officialTie.geojson, 'usgs')
    assert.equal(store.eqMessage.usgsEqlist.magnitude, 6, 'History arriving first does not swallow realtime updates')
    const next = usgsPair({ reportTimeStamp: stamp + 2, magnitude: 7 })
    store.setHistory('usgsEqlist', [next.lipo], 'lipo')
    assert.equal(store.usgsRealtimeCache.get(a.lipo.eventId).timestamp, stamp + 1)
    store.setEqMessage('usgsEqlist', next.lipo, 'lipo')
    assert.equal(store.eqMessage.usgsEqlist.magnitude, 7)
})

test('USGS realtime hashes survive hidden rows and one-provider removal, and are reclaimed only outside the full union', () => {
    const { store } = setup()
    const events = Array.from({ length: 120 }, (_, index) => usgsPair({ eventId: `us-${index}`,
        originTimeStamp: event().originTimeStamp - index * 1000 }))
    store.setHistory('usgsEqlist', events.map(item => item.lipo), 'lipo')
    const hidden = events.at(-1)
    store.setEqMessage('usgsEqlist', hidden.lipo, 'lipo')
    store.setHistory('usgsEqlist', [hidden.geojson], 'usgs')
    assert.equal(store.history.usgsEqlist.length, 120)
    assert.ok(store.usgsRealtimeCache.has(hidden.lipo.eventId))
    store.receiveLipoMessage({ type: 'usgs_report', data: events[0].lipo })
    assert.ok(store.usgsRealtimeCache.has(hidden.lipo.eventId), 'A latest-event snapshot is not a deletion snapshot')
    store.setHistory('usgsEqlist', [], 'lipo')
    assert.deepEqual(store.history.usgsEqlist.map(item => item.id), [hidden.lipo.eventId])
    assert.ok(store.usgsRealtimeCache.has(hidden.lipo.eventId))
    store.setHistory('usgsEqlist', null, 'usgs')
    assert.ok(store.usgsRealtimeCache.has(hidden.lipo.eventId))
    store.setHistory('usgsEqlist', [], 'usgs')
    assert.equal(store.history.usgsEqlist.length, 0)
    assert.equal(store.usgsRealtimeCache.size, 0)
    const live = usgsPair({ eventId: 'us-live' })
    store.setEqMessage('usgsEqlist', live.lipo, 'lipo')
    store.setHistory('usgsEqlist', [], 'usgs')
    assert.ok(store.usgsRealtimeCache.has('us-live'), 'Live pushes protect membership until that provider sends a full list')
    store.configureDataSources({ usgsEqlist: { lipo: false, usgs: true } })
    assert.equal(store.history.usgsEqlist.length, 0)
    assert.equal(store.usgsRealtimeCache.size, 0)
})

test('USGS HTTP failures preserve snapshots, empty feeds clear only their own route, and late requests cannot restore stale data', async () => {
    const { store, http } = setup()
    const pending = []
    http.get = () => new Promise(resolve => pending.push(resolve))
    const first = store.fetchUsgsReports(), second = store.fetchUsgsReports()
    const a = usgsPair(), newer = usgsPair({ reportTimeStamp: a.lipo.reportTimeStamp + 1, magnitude: 6 })
    pending[1]({ features: [newer.geojson] })
    await second
    pending[0]({ features: [a.geojson] })
    await first
    assert.equal(store.history.usgsEqlist[0].magnitude, 6)
    assert.equal(store.eqMessage.usgsEqlist.magnitude, 6)
    http.get = async () => null
    await store.fetchUsgsReports()
    assert.equal(store.history.usgsEqlist[0].magnitude, 6)
    store.setHistory('usgsEqlist', [a.lipo], 'lipo')
    http.get = async () => ({ features: [] })
    await store.fetchUsgsReports()
    assert.equal(store.history.usgsEqlist[0].magnitude, a.lipo.magnitude)
    assert.equal(store.eqMessage.usgsEqlist.magnitude, 6)
    http.get = () => new Promise(resolve => pending.push(resolve))
    const last = store.fetchUsgsReports()
    store.disconnect()
    pending.at(-1)({ features: [newer.geojson] })
    await last
    assert.equal(store.usgsHistoryCache.usgs.size, 0)
})

test('KMA history keeps UTC+9, raw I-XII intensity, zeros and missing optional fields', () => {
    const { store } = setup()
    store.receiveLipoMessage({ type: 'kma_report_list', data: [
        event({ eventId: '3_20261104010203', maxIntensity: 12, magnitude: 0, depth: 0 }),
        event({ eventId: '3_20261104000000', maxIntensity: 11, depth: null, magnitude: undefined,
            latitude: undefined, longitude: undefined }),
    ] })
    const [first, second] = store.history.kmaEqlist
    assert.equal(first.source, 'KMA')
    assert.equal(first.timeZone, 9)
    assert.equal(first.originTime, '2026-11-04 01:02:03')
    assert.equal(first.maxIntensity, '12')
    assert.equal(second.maxIntensity, '11')
    assert.equal(first.depth, 0)
    assert.equal(first.magnitude, 0)
    assert.equal(second.depth, null)
    assert.equal(second.magnitude, null)
    assert.equal(second.lat, null)
    assert.equal(second.url, '')
    store.receiveLipoMessage({ type: 'kma_report_list', data: [] })
    assert.equal(store.history.kmaEqlist.length, 0)
})

test('history map display tolerates missing magnitude/depth and rejects missing coordinates', () => {
    const tooltips = [], historyList = []
    const statusStore = { map: {}, getIrDetail() {} }
    const L = { marker: () => ({
        bindTooltip(text) { tooltips.push(text) }, addTo() {},
    }) }
    class EqlistEvent {
        constructor(map, eqMessage, unused, smartSetView) {
            Object.assign(this, { map, eqMessage, smartSetView })
        }
        removeMark() {}
    }
    const historySource = read('src/classes/EewEqlistClasses.js').split('export class HistoryEvent ')[1]
    const HistoryEvent = new Function('EqlistEvent', 'statusStore', 'L', 'markRaw', 'formatTimeZone',
        'const cancelCrossIcon = {}, eqlistCrossIcon = {}; return class HistoryEvent ' + historySource)(
        EqlistEvent, statusStore, L, markRaw, zone => `UTC+${zone}`)
    const component = read('src/components/components/EqlistHistory.vue')
    const helpers = component.slice(component.indexOf('const formatHistoryValue'), component.indexOf('const maxHistoryNumber'))
    const display = component.slice(component.indexOf('const displayOnMap'), component.indexOf('const createMockEew'))
    const dependencies = {
        statusStore, historyList, defaultEqMessage: {}, reactive: value => value, HistoryEvent,
        timeStore: { getTimeStamp: () => Date.parse('2026-11-04T02:00:00Z') }, stampToTime, smartSetView() {},
    }
    const { displayOnMap, formatHistoryValue } = new Function(...Object.keys(dependencies),
        helpers + display + '\nreturn { displayOnMap, formatHistoryValue };')(...Object.values(dependencies))
    const missing = { id: 'kma-test', source: 'KMA', timeZone: 9, originTime: '2026-11-04 10:00:00',
        magnitude: null, depth: null, lat: null, lng: 128, hypocenter: 'test', maxIntensityText: '최대진도: ?' }
    displayOnMap(missing)
    assert.equal(historyList.length, 0)
    displayOnMap({ ...missing, lat: 36 })
    assert.equal(historyList.length, 1)
    assert.match(tooltips[0], /M不明/)
    assert.match(tooltips[0], /深度: 不明/)
    assert.equal(formatHistoryValue(0, 1), '0.0')
    assert.equal(formatHistoryValue(-1.5, 1, 'km'), '-1.5km')
})

test('KMA consumes decoded binary station envelopes and preserves JSON frame acceptance and gap filling', () => {
    const component = read('src/components/components/KmaNet.vue')
    const intensityStart = component.indexOf('const handleStationIntensity =')
    const intensityEnd = component.indexOf('let kmaSocket =', intensityStart)
    const start = component.indexOf('kmaSocket.setMessageHandler(')
    const end = component.indexOf("    document.addEventListener('visibilitychange'", start)
    assert.ok(start >= 0 && end > start)
    let receive
    const stationList = { value: [] }
    const stations = Array.from({ length: 2 }, () => ({ recentLevel: [], recentSeconds: 60 }))
    const kmaUpdateTime = { value: '2026-11-04 10:00:00' }
    const updates = []
    const dependencies = {
        kmaSocket: { setMessageHandler: handler => { receive = handler } },
        stopped: false, stationList, stations, kmaUpdateTime, map: {}, pendingStationIntensity: null,
        calcTimeDiff: (a, az, b, bz) => timeToStamp(a, az) - timeToStamp(b, bz),
        update: mmi => updates.push(mmi),
    }
    const source = component.slice(intensityStart, intensityEnd) + component.slice(start, end)
    new Function(...Object.keys(dependencies), source)(...Object.values(dependencies))
    const coordinates = [{ latitude: 36.41, longitude: 128.94 }, { latitude: 36.57, longitude: 128.7 }]
    const baselineSecond = timeToStamp('2026-11-04 10:00:00', 9) / 1000
    receive(decodeKmaPewsMessage(createPewsFrame(1, [641 * 1024 + 894, 657 * 1024 + 870], baselineSecond - 3600)))
    assert.deepEqual(stationList.value, coordinates)
    receive(decodeKmaPewsMessage(createPewsFrame(1, [657 * 1024 + 870, 641 * 1024 + 894], baselineSecond)))
    assert.deepEqual(stationList.value, [...coordinates].reverse())
    const frame = (second, codes) => receive(decodeKmaPewsMessage(createPewsFrame(2, codes, baselineSecond + second)))
    frame(1, [13, 2])
    frame(2, [8, 0])
    frame(2, [8])
    frame(0, [9, 9])
    assert.deepEqual(updates, [[0, 2]])
    assert.equal(kmaUpdateTime.value, '2026-11-04 10:00:01')
    frame(2, [8, 9])
    assert.equal(kmaUpdateTime.value, '2026-11-04 10:00:02')
    frame(2, [10, 11])
    frame(1, [10, 11])
    frame(5, [1, 14])
    assert.deepEqual(updates, [[0, 2], [8, 9], [-2, 1]])
    assert.equal(kmaUpdateTime.value, '2026-11-04 10:00:05')
    assert.deepEqual(stations[0].recentLevel, [-1, -1])
    frame(100, [2, 3])
    assert.equal(stations[0].recentLevel.length, 60)
    assert.ok(stations[0].recentLevel.every(level => level === -1))
})

test('tsunami ordering uses issueTime and tolerates a missing issueTime', () => {
    const { store } = setup()
    const data = {
        reportId: 'report-1', warningInfo: { level: '黄色' }, forecasts: [],
        timeInfo: { issueTime: '2026-11-04 10:00:00', updateDate: '2026-11-04 12:00:00' },
    }
    store.setTsunamiMessage('nmefcTsunami', data)
    assert.equal(store.tsunamiMessage.nmefcTsunami.reportTime, '2026-11-04 10:00:00')
    assert.equal(store.tsunamiMessage.nmefcTsunami.status, 1)
    store.setTsunamiMessage('nmefcTsunami', { ...data, timeInfo: { ...data.timeInfo, issueTime: null } })
    assert.equal(store.tsunamiMessage.nmefcTsunami.reportTime, '2026-11-04 10:00:00')
})

test('CENC details reuse ETag/304, clear 404s, and ignore a response after the history event closes', async () => {
    const { store, http, calls } = setup()
    const id = '20261104010203', drawn = []
    const detail = [cencIrRow()]
    let cleared = 0
    store.historyList = [{ eqMessage: { intReportId: id }, createStations: data => drawn.push(data), terminateStations: () => cleared++ }]
    http.response = { status: 200, data: { type: 'cenc_ir', data: detail }, headers: { etag: '"etag-1"' } }
    await store.getIrDetail(id)
    assert.equal(drawn.length, 1)
    assert.deepEqual(drawn[0], detail)
    assert.deepEqual(calls[0][1].params, { id, key: 'test-key' })
    http.response = { status: 304, headers: {} }
    await store.getIrDetail(id)
    assert.equal(calls[1][1].headers['If-None-Match'], '"etag-1"')
    assert.equal(drawn.length, 2)
    assert.deepEqual(drawn[1], detail)
    http.response = { status: 404, headers: {} }
    await store.getIrDetail(id)
    assert.equal(cleared, 1)
    let resolve
    http.getResponse = () => new Promise(done => { resolve = done })
    const pending = store.getIrDetail(id)
    store.historyList = []
    resolve({ status: 200, data: { data: detail }, headers: {} })
    await pending
    assert.equal(drawn.length, 2)
})

test('CENC raw Excel rows render station coordinates, intensity and optional values with confirmed units', async () => {
    const { store, http, messages } = setup()
    const layers = new Set(), listeners = new Map(), intensityInputs = []
    const map = {
        getZoom: () => 8,
        hasLayer: layer => layers.has(layer), removeLayer: layer => layers.delete(layer),
        on: (name, handler) => listeners.set(name, handler), off: name => listeners.delete(name),
    }
    const L = { marker: (latLng, options) => ({
        latLng, options,
        bindTooltip(text) { this.tooltip = text }, addTo() { layers.add(this) }, setIcon() {},
    }) }
    const stationSource = read('src/classes/StationClasses.js').split('export class intReportStation ')[1]
    const intReportStation = new Function('L', 'markRaw', 'intIcons', 'getCsisLevelFromCsis',
        'let settingsStore = {}; return class intReportStation ' + stationSource)(L, markRaw, { 8: {} }, value => {
        intensityInputs.push(value)
        return { 1.5: '2', 0: '0' }[value]
    })
    const historySource = read('src/classes/EewEqlistClasses.js').split('export class HistoryEvent ')[1]
    const HistoryEvent = new Function('EqlistEvent', 'intReportStation', 'markRaw',
        'return class HistoryEvent ' + historySource)(class {}, intReportStation, markRaw)
    const history = Object.assign(Object.create(HistoryEvent.prototype), {
        map, eqMessage: { intReportId: '20261104010203' }, smartSetView() {},
    })
    history.renderAllStations = history.renderAllStations.bind(history)
    store.historyList = [markRaw(history)]
    const detail = [Object.freeze(cencIrRow({ extraColumn: ' 001 ' })), Object.freeze(cencIrRow({
        stID: '0002', stName: null, stla: 0, stlo: 94, INT: 0, IPGA: undefined, IPGV: -1.2,
        Province: null, City: null, County: null, Dist: null, PGA: null, PGV: undefined,
    }))]
    http.response = { status: 200, data: { type: 'cenc_ir', data: detail }, headers: {} }
    await store.getIrDetail(history.eqMessage.intReportId)
    assert.equal(messages.length, 0)
    assert.deepEqual(intensityInputs, [1.5, 0])
    assert.equal(layers.size, 2, 'tag=0 and a single zero coordinate do not discard valid rows')
    const [first, second] = history.stations
    assert.equal(first.id, '0001')
    assert.deepEqual(first.latLng, [31.8, 94.2])
    assert.deepEqual(second.latLng, [0, 94])
    assert.equal(first.detail, detail[0], 'Keep raw values, extra columns and column order')
    assert.equal(first.marker.options.pane, 'intReportStationPane2')
    assert.match(first.marker.tooltip, / 测试站  \(0001\)/)
    assert.match(first.marker.tooltip, /地点: 西藏那曲市巴青县/)
    assert.match(first.marker.tooltip, /震中距: 12\.34 km/)
    assert.match(first.marker.tooltip, /仪器烈度: 1\.5 \(I_PGA: -0\.5, I_PGV: 不明\)/)
    assert.match(first.marker.tooltip, /PGA: 2\.3 gal/)
    assert.match(first.marker.tooltip, /PGV: 0\.0 kine/)
    assert.equal(second.marker.options.pane, 'intReportStationPane0')
    assert.match(second.marker.tooltip, /不明 \(0002\)/)
    assert.match(second.marker.tooltip, /地点: 不明/)
    assert.match(second.marker.tooltip, /震中距: 不明 km/)
    assert.match(second.marker.tooltip, /I_PGA: 不明, I_PGV: -1\.2/)
    assert.match(second.marker.tooltip, /PGA: 不明 gal/)
    assert.match(second.marker.tooltip, /PGV: 不明 kine/)
    assert.equal(listeners.size, 1)
    http.response = { status: 404, headers: {} }
    await store.getIrDetail(history.eqMessage.intReportId)
    assert.equal(layers.size, 0)
    assert.equal(listeners.size, 0)
})

test('saved routes migrate to Lipo without migrating a FAN credential or bypassing ICL local authorization', () => {
    setActivePinia(createPinia())
    const store = evaluateStore('src/stores/settings.js', 'useSettingsStore', {
        ...dataSources, ...settingsRestore, defineStore, useAccessStore: () => ({ canUse: () => false }),
    })
    store.setMainSettings(JSON.stringify({
        dataSources: { jmaEew: { wolfx: true, fan: false }, cwaEew: { wolfx: false, fan: true },
            ceaEew: { wolfx: false, fan: true }, iclEew: { fan: true } },
        apiKeys: { fanApiKey: 'old-key' }, apiAuthAutoReconnect: true,
    }))
    assert.deepEqual(store.mainSettings.dataSources.jmaEew, { wolfx: true, lipo: false })
    assert.deepEqual(store.mainSettings.dataSources.cwaEew, { wolfx: false })
    assert.deepEqual(store.mainSettings.dataSources.ceaEew, { wolfx: false, lipo: true })
    assert.deepEqual(store.mainSettings.apiKeys, { lipoApiKey: '' })
    assert.equal(store.mainSettings.apiAuthAutoReconnect, true)
    assert.equal(store.effectiveDataSources.iclEew.lipo, false)
    store.setMainSettings(JSON.stringify({ dataSources: { ceaEew: { fan: true, lipo: false } }, apiKeys: { lipoApiKey: 'new-key' } }))
    assert.equal(store.mainSettings.dataSources.ceaEew.lipo, false)
    assert.equal(store.mainSettings.apiKeys.lipoApiKey, 'new-key')
})

test('KMA history can be selected and restored without adding it to an existing user selection', () => {
    setActivePinia(createPinia())
    const store = evaluateStore('src/stores/settings.js', 'useSettingsStore', {
        ...dataSources, ...settingsRestore, defineStore, useAccessStore: () => ({ canUse: () => false }),
    })
    assert.ok(store.mainSettings.historySources.includes('KMA'))
    store.setMainSettings(JSON.stringify({ historySources: ['CENC', 'USGS'] }))
    assert.deepEqual(store.mainSettings.historySources, ['CENC', 'USGS'])
    store.setMainSettings(JSON.stringify({ historySources: ['KMA', 'USGS', 'UNKNOWN'] }))
    assert.deepEqual(store.mainSettings.historySources, ['KMA', 'USGS'])
    store.setMainSettings(JSON.stringify({ historySources: [] }))
    assert.deepEqual(store.mainSettings.historySources, [])
})
