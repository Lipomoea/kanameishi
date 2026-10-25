// node etc/stations/test/trem_net.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { computed, effectScope, markRaw, nextTick, reactive, ref, watch } from 'vue'
import { parse } from 'vue/compiler-sfc'
import { StationFrameQueue } from '../../../src/features/stations/StationFrameQueue.js'
import { tremConfig, setTremConfig, selectTremStationSource } from '../../../src/features/stations/TremConfig.js'
import { parseTremStationList, readTremFrame, connectTremRts, decodeTremRtsPayload } from '../../../src/features/stations/TremRtsClient.js'

const config = {
    seisNetUrls: { trem: {
        stationList: 'https://config.example/stations?key=test',
        stationReplay: 'https://archive.example/rts/?key=test',
        stationSources: [
            { id: 'first', name: '第一个', url: 'https://first.example/sse?topics=trem.rts.v1&mode=live' },
            { id: 'second', name: '第二个', url: 'https://second.example/sse?topics=trem.rts.v1&mode=live' }
        ]
    } }
}
setTremConfig(config)
const sources = tremConfig.value.stationSources
assert.equal(selectTremStationSource(sources, '').id, 'first')
assert.equal(selectTremStationSource(sources, 'lb-1').id, 'first')
assert.equal(selectTremStationSource(sources, 'second').id, 'second')
assert.equal(selectTremStationSource([...sources].reverse(), 'second').id, 'second')
assert.equal(selectTremStationSource([], 'old'), undefined)

const csv = 'loc_code,id,lat,lon,floor,code,net,time,work\r\n1,1A50B18,23.9,121.5,2,962,3,2026-02-16,1\r\n2,0012345,0,0,1,100,3,2026-02-16,0\r\n'
const roster = parseTremStationList(csv)
assert.deepEqual(Object.keys(roster), ['1A50B18', '0012345'])
assert.deepEqual(roster['0012345'].info, [{ lat: 0, lon: 0 }])
assert.deepEqual(parseTremStationList('id,lat,lon\nbad,,121\nbad2,91,0\nbad3,0,NaN\n'), {})
assert.deepEqual(parseTremStationList('<html>unavailable</html>'), {})
assert.deepEqual(parseTremStationList(undefined), {})
const base = 6_000_000
const frame = (ts, stations) => ({ source: 'test', ts, stations, eq: [] })
const encode = payload => gzipSync(JSON.stringify(payload)).toString('base64')
// Numeric alert:1 and no uppercase I, as in the 2026-10-24 04:48 earthquake archive.
const earthquake = frame(base, { '1A50B18': { i: 2.6, pga: 5.27, alert: 1 } })
assert.deepEqual(decodeTremRtsPayload(encode(earthquake)), earthquake)
assert.deepEqual(readTremFrame(earthquake), { timestamp: base, data: earthquake.stations })
for(const invalid of [null, {}, { ts: '1', stations: {} }, { ts: 1, stations: [] }, { time: 1, station: {} }]) {
    assert.equal(readTremFrame(invalid), null)
}
console.log('PASS server-defined source selection, CSV station IDs and rts.v1 decoding')

const connections = []
class FakeEventSource {
    constructor(url) {
        this.url = url
        this.closed = false
        this.listeners = new Map()
        connections.push(this)
    }
    addEventListener(type, fn) { this.listeners.set(type, fn) }
    removeEventListener(type, fn) { if(this.listeners.get(type) === fn) this.listeners.delete(type) }
    close() { this.closed = true }
    emit(payload) { this.listeners.get('trem.rts.v1')?.({ data: encode(payload) }) }
}
const originalEventSource = globalThis.EventSource
globalThis.EventSource = FakeEventSource
const read = file => readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8')
const utilsSource = read('src/utils/Utils.js')
const intensityMath = new Function(utilsSource.slice(
    utilsSource.indexOf('export const getShindoFromLevel'), utilsSource.indexOf('export const getCsisLevelFromCsis')
).replaceAll('export ', '') + '\nreturn { getShindoFromLevel, getShindoFromInstShindo, getLevelFromInstShindo };')()
const settings = reactive({
    advancedSettings: { fallbackSvgStationRender: false },
    mainSettings: {
        displaySeisNet: { tremApi: 'lb-1', httpDataPriority: 'realtime' },
        onShake: { sound: false, notification: false, focus: false }
    }
})
// Use the real station update/level code; the canvas itself is outside this transport test.
const stationSource = read('src/classes/StationClasses.js')
const TremStation = new Function('markRaw', 'useSettingsStore', ...Object.keys(intensityMath),
    'let settingsStore;\n' + stationSource.slice(stationSource.indexOf('export class TremStation'),
        stationSource.indexOf('export class NiedStation')).replace('export ', '') + '\nreturn TremStation;'
)(markRaw, () => settings, ...Object.values(intensityMath))
const map = markRaw({ on() {}, off() {} })
const status = reactive({ map, seisNetReplayDelay: 0, isActive: { tremNet: false } })
let clock = base
const requests = []
const Http = { get(url, options) {
    let resolve
    const result = new Promise(done => { resolve = done })
    requests.push({ url, options, resolve })
    return result
} }
const intervals = new Map(), timeouts = new Map()
let timerId = 0, redraws = 0, unregistered = false
const document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
const provided = {
    tremMaxShindo: ref('?'), tremUpdateTime: ref(null), tremPeriodMaxShindo: ref('?'), tremPeriodBarClass: ref('gray'),
    handleTempEqlists() {},
    taiwanSeisNetLayers: {
        registerSource() { return () => { unregistered = true } },
        redrawStations() { redraws++ }
    }
}
const mounted = [], unmounted = []
const imports = {
    reactive, computed, watch, Http, StationFrameQueue, tremConfig, selectTremStationSource,
    parseTremStationList, readTremFrame, connectTremRts, TremStation,
    ...intensityMath,
    useStatusStore: () => status, useSettingsStore: () => settings, useTimeStore: () => ({ getTimeStamp: () => clock }),
    onMounted: fn => mounted.push(fn), onBeforeUnmount: fn => unmounted.push(fn), inject: key => provided[key],
    simpleIcon: ref(false), TaiwanGridCanvasLayer: { getGridColorByLevel: () => 'test-color' },
    isNetworkPeriodActive: (key, active) => active[key], stampToTime: stamp => stamp,
    iconUrls: {}, playSound() {}, sendMyNotification() {}, focusWindow() {}, document,
    setInterval: (fn, ms) => { const id = ++timerId; intervals.set(id, { fn, ms }); return id },
    clearInterval: id => intervals.delete(id),
    setTimeout: (fn, ms) => { const id = ++timerId; timeouts.set(id, { fn, ms }); return id },
    clearTimeout: id => timeouts.delete(id)
}
const script = parse(read('src/components/components/TremNet.vue')).descriptor.scriptSetup.content
const setup = new Function(...Object.keys(imports), script.replace(/^import .*$/gm, '') +
    '\nreturn { stations, stationList, fetchStationList, handleVisibilityChange };')
const scope = effectScope()
const settle = async () => { await Promise.resolve(); await nextTick(); await Promise.resolve(); await nextTick() }
const poll = () => { assert.equal(intervals.size, 1); [...intervals.values()][0].fn(); return requests.at(-1) }
let app
try {
    app = scope.run(() => setup(...Object.values(imports)))
    mounted.forEach(fn => fn())
    const first = connections[0]
    assert.equal(first.url, sources[0].url, 'Old lb-1 selection uses the first supplied source')
    assert.equal(intervals.size, 0, 'Realtime does not HTTP-poll')
    assert.equal(requests[0].options.responseType, 'text')
    assert.equal(new URL(requests[0].url).searchParams.get('key'), 'test')
    first.emit(earthquake)
    requests[0].resolve(csv)
    await settle()
    assert.equal(app.stations['1A50B18'].intensity, 2.6, 'A frame arriving before metadata is applied after it loads')
    assert.equal(app.stations['1A50B18'].isActive, true)
    assert.equal(app.stations['1A50B18'].shindo, '3')
    assert.equal(app.stations['0012345'].intensity, -3.1)
    assert.equal(status.isActive.tremNet, true)
    assert.equal(provided.tremMaxShindo.value, '3')
    for(const ts of [base, base - 1000]) first.emit(frame(ts, { '1A50B18': { i: 6, alert: 1 } }))
    assert.equal(app.stations['1A50B18'].intensity, 2.6, 'Duplicate and older frames cannot overwrite the map')
    first.emit(frame(base + 1000, { '1A50B18': { i: 0.1 }, '0012345': { i: null, alert: 1 } }))
    await settle()
    assert.equal(status.isActive.tremNet, false, 'Missing alert is inactive')
    assert.equal(app.stations['0012345'].isActive, false, 'Invalid intensity cannot activate a station')

    document.visibilityState = 'hidden'
    const beforeHidden = redraws
    first.emit(frame(base + 2000, { '1A50B18': { i: 3, alert: 1 }, NEW: { i: 1.2, alert: 1 } }))
    await settle()
    assert.equal(status.isActive.tremNet, true)
    assert.equal(redraws, beforeHidden)
    document.visibilityState = 'visible'
    app.handleVisibilityChange()
    assert(redraws > beforeHidden)
    const refresh = app.fetchStationList()
    requests.at(-1).resolve(csv + '3,NEW,24,121,1,100,3,2026-02-16,1\n')
    await refresh
    await settle()
    assert.equal(connections.length, 1, 'Roster refresh retains the SSE connection')
    assert.equal(app.stations.NEW.intensity, 1.2)
    first.emit(frame(base + 3000, { NEW: { i: 2.2, alert: 1 } }))
    await settle()
    assert.equal(app.stations.NEW.intensity, 2.2, 'Roster refresh does not invalidate the connection generation')
    const badList = app.fetchStationList()
    requests.at(-1).resolve('<html>upstream unavailable</html>')
    await badList
    assert.equal(Object.keys(app.stations).length, 3, 'Failed list parsing retains the roster')
    console.log('PASS early frames, numeric alerts, missing data, visibility and roster refresh')

    const staleListener = first.listeners.get('trem.rts.v1')
    settings.mainSettings.displaySeisNet.tremApi = 'second'
    assert.equal(first.closed, true)
    const second = connections.at(-1)
    assert.equal(second.url, sources[1].url)
    staleListener({ data: encode(frame(base + 99_000, { NEW: { i: 7, alert: 1 } })) })
    second.emit(frame(base + 4000, { NEW: { i: 1.4, alert: 1 } }))
    assert.equal(app.stations.NEW.intensity, 1.4, 'A closed source cannot advance the timestamp')
    settings.mainSettings.displaySeisNet.httpDataPriority = 'complete'
    assert.equal(connections.at(-1), second, 'HTTP ordering changes do not restart realtime')
    status.seisNetReplayDelay = 1
    assert.equal(second.closed, true)
    assert.equal(intervals.size, 1)
    assert.equal(requests.at(-1).url, 'https://archive.example/rts/5940?key=test')
    requests.at(-1).resolve(frame(base - 60_000, { NEW: { i: 0.8, alert: 1 } }))
    await settle()
    assert.equal(provided.tremUpdateTime.value, base - 60_000, 'Replay can start before the last live frame')
    clock += 1000
    const earlier = poll()
    clock += 1000
    const later = poll()
    later.resolve(frame(base - 58_000, { NEW: { i: 2 } }))
    await settle()
    assert.equal(provided.tremUpdateTime.value, base - 60_000, 'Complete mode waits for the preceding frame')
    earlier.resolve(frame(base - 59_000, { NEW: { i: 1 } }))
    await settle()
    assert.equal(provided.tremUpdateTime.value, base - 58_000)
    clock += 1000
    const staleReplay = poll()
    status.seisNetReplayDelay = 2
    assert.equal(staleReplay.options.signal.aborted, true)
    const olderTimeline = requests.at(-1)
    staleReplay.resolve(frame(base + 99_000, { NEW: { i: 7 } }))
    olderTimeline.resolve(frame(base - 117_000, { NEW: { i: 0.5 } }))
    await settle()
    assert.equal(provided.tremUpdateTime.value, base - 117_000)
    clock += 1000
    const leavingReplay = poll()
    status.seisNetReplayDelay = 0
    assert.equal(leavingReplay.options.signal.aborted, true)
    assert.equal(intervals.size, 0)
    leavingReplay.resolve(frame(base + 99_000, { NEW: { i: 7 } }))
    const resumed = connections.at(-1)
    resumed.emit(frame(base + 5000, { NEW: { i: 1.5, alert: 1 } }))
    await settle()
    assert.equal(provided.tremUpdateTime.value, base + 5000)
    console.log('PASS node switching, replay ordering, backward seeks and late-response isolation')

    const pendingList = app.fetchStationList()
    const listRequest = requests.at(-1)
    unmounted.forEach(fn => fn())
    scope.stop()
    assert.equal(resumed.closed, true)
    assert.equal(listRequest.options.signal.aborted, true)
    listRequest.resolve(csv)
    await pendingList
    assert.equal(unregistered, true)
    assert.equal(status.isActive.tremNet, false)
    assert.deepEqual(Object.keys(app.stations), [])
    assert.equal(intervals.size, 0)
    console.log('PASS teardown closes SSE, aborts requests and releases station layers')
}
finally {
    scope.stop()
    globalThis.EventSource = originalEventSource
}
