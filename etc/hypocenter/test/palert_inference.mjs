// node --experimental-vm-modules etc/hypocenter/test/palert_inference.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { originalPalertActivity } from './fixtures/palert_activity_before.mjs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { SourceTextModule } from 'node:vm'
import { createRequire } from 'node:module'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const read = name => readFileSync(path.join(root, name), 'utf8')
const section = (source, start, end) => {
    const from = source.indexOf(start)
    const to = source.indexOf(end, from)
    assert(from >= 0 && to > from)
    return source.slice(from, to)
}
const utils = read('src/utils/Utils.js')
const require = createRequire(import.meta.url)
globalThis.__palertTestDayjs = require('dayjs')
globalThis.__palertTestDayjs.extend(require('dayjs/plugin/utc'))
const math = ['const dayjs = globalThis.__palertTestDayjs;',
    section(utils, 'const EARTH_RADIUS_KM', 'export const formatNumber'),
    section(utils, 'export const timeToStamp', 'export const convertCompactTimeString'),
    section(utils, 'export const calcWaveDistance', 'export const extractNumbers'),
    section(utils, 'export const exactRound', 'export const getCoordByDistanceBearing'),
    section(utils, 'const palertPgaThresholds', 'export const getShindoFromInstShindo')].join('\n')
const modules = new Map()
const moduleFor = (filename, source) => {
    if(!modules.has(filename)) modules.set(filename, new SourceTextModule(source ?? readFileSync(filename, 'utf8'), { identifier: filename }))
    return modules.get(filename)
}
const linker = (specifier, parent) => {
    let filename = specifier.startsWith('@/') ? path.join(root, 'src', specifier.slice(2)) : path.resolve(path.dirname(parent.identifier), specifier)
    if(!path.extname(filename)) filename += '.js'
    return moduleFor(filename, specifier === '@/utils/Utils' ? math : undefined)
}
const load = async (name, source) => {
    const module = moduleFor(path.join(root, name), source)
    if(module.status === 'unlinked') await module.link(linker)
    if(module.status === 'linked') await module.evaluate()
    return module.namespace
}
const { createPalertHypocenterUpdate, mergePalertHypocenterUpdates } = await load('src/utils/PalertHypocenterUpdates.js')
const { FindPalertHypocenter } = await load('src/classes/PalertHypoInf.js')
const { FindNiedHypocenter } = await load('src/classes/NiedHypoInf.js')
const { palertHypocenterProfile: profile } = await load('src/classes/PalertHypocenterProfile.js')
const { niedHypocenterProfile: nied } = await load('src/classes/NiedHypocenterProfile.js')
const { calcDistanceKm, calcBearingDeg, calcReachTime, compareFloat, getPalertLevelFromPgaPgv, stampToTime, timeToStamp } = await load('src/utils/Utils.js')
for(const [pga, expectedLevel] of [[24.999, 13], [25, 14], [43.999, 14], [44, 15], [79.999, 15]]) {
    for(const pgv of [null, 0, 15, 30, 50, 80, 140, 300]) {
        assert.equal(getPalertLevelFromPgaPgv(pga, pgv), expectedLevel, `PGA ${pga} must ignore PGV ${pgv} below 80`)
    }
}
for(const pga of [80, 300]) {
    for(const [pgv, expectedLevel] of [
        [null, 15], [NaN, 15], [-1, 15], [Infinity, 15], [0, 15], [14.999, 15],
        [15, 16], [29.999, 16], [30, 17], [49.999, 17], [50, 18], [79.999, 18],
        [80, 19], [139.999, 19], [140, 20]
    ]) {
        assert.equal(getPalertLevelFromPgaPgv(pga, pgv), expectedLevel, `PGA ${pga}, PGV ${pgv}`)
    }
}
for(const pga of [null, NaN, -1, Infinity]) {
    assert.equal(getPalertLevelFromPgaPgv(pga, 140), -1, 'PGV cannot replace invalid PGA')
}
console.log('PASS P-Alert PGA gate, intensity-four boundaries, PGV thresholds and missing-data fallback')
const tables = (await load('src/utils/TravelTimes.js')).default
const componentSource = read('src/components/components/PalertNet.vue')
const niedComponentSource = read('src/components/components/NiedNet.vue')
const tremComponentSource = read('src/components/components/TremNet.vue')
const { StationFrameQueue } = await load('src/utils/StationFrameQueue.js')
const queueProbe = (ordered = true) => {
    const committed = []
    const queue = new StationFrameQueue(frame => committed.push(frame.timestamp), () => ordered)
    return { queue, committed }
}
for(const order of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
    const { queue, committed } = queueProbe()
    const tickets = [queue.begin(), queue.begin(), queue.begin()]
    for(const index of order) queue.finish(tickets[index], { timestamp: index + 1 })
    assert.deepEqual(committed, order.indexOf(0) === 2 ? [2, 3] : [1, 2, 3], 'Only two ready later frames can displace an unresolved first frame')
    assert.equal(queue.entries.length, 0)
}
{
    const { queue, committed } = queueProbe()
    const tickets = Array.from({ length: 4 }, () => queue.begin())
    queue.finish(tickets[1], { timestamp: 2 })
    queue.finish(tickets[2], { timestamp: 2 })
    assert.deepEqual(committed, [], 'Two responses for one second consume only one waiting frame')
    queue.finish(tickets[3], { timestamp: 3 })
    assert.deepEqual(committed, [2, 3])
    queue.finish(tickets[0], { timestamp: 1 })
    assert.deepEqual(committed, [2, 3], 'A discarded request cannot reappear on late success')
}
for(const firstAttemptFails of [false, true]) {
    const { queue, committed } = queueProbe()
    const first = queue.begin('same-second'), retry = queue.begin('same-second'), later = queue.begin('next-second')
    queue.finish(later, { timestamp: 2 })
    if(firstAttemptFails) queue.finish(first)
    assert.deepEqual(committed, [])
    queue.finish(retry, { timestamp: 1 })
    assert.deepEqual(committed, [1, 2], 'A successful same-second attempt satisfies the frame despite other pending/failed attempts')
    queue.finish(first, { timestamp: 1 })
    assert.equal(queue.entries.length, 0)
    assert.equal(queue.groups.size, 0)
}
{
    const { queue, committed } = queueProbe()
    const first = queue.begin('same-second'), retry = queue.begin('same-second'), later = queue.begin()
    queue.finish(later, { timestamp: 2 })
    queue.finish(first)
    assert.deepEqual(committed, [], 'One failed attempt cannot end a frame with another pending attempt')
    queue.finish(retry)
    assert.deepEqual(committed, [2], 'All attempts failing releases the next frame without needing a second ready frame')
    const invalid = queue.begin(), valid = queue.begin()
    queue.finish(valid, { timestamp: 3 })
    queue.finish(invalid, { timestamp: NaN })
    assert.deepEqual(committed, [2, 3])
}
{
    const { queue, committed } = queueProbe()
    const a = queue.begin(), b = queue.begin(), c = queue.begin(), d = queue.begin()
    queue.finish(b, { timestamp: 2 })
    queue.finish(d, { timestamp: 4 })
    assert.deepEqual(committed, [2], 'After displacing A and committing B, D alone must still wait for C')
    queue.finish(c, { timestamp: 3 })
    queue.finish(a, { timestamp: 1 })
    assert.deepEqual(committed, [2, 3, 4])
}
{
    const { queue, committed } = queueProbe(false)
    const a = queue.begin(), b = queue.begin()
    queue.finish(b, { timestamp: 2 })
    assert.deepEqual(committed, [2], 'Realtime priority never waits for an earlier request')
    queue.finish(a, { timestamp: 1 })
    assert.deepEqual(committed, [2])
}
for(const preserveStamp of [false, true]) {
    const { queue, committed } = queueProbe()
    queue.finish(queue.begin(), { timestamp: 10 })
    const a = queue.begin(), b = queue.begin()
    queue.finish(b, { timestamp: 12 })
    queue.reset(preserveStamp ? 10 : null)
    queue.finish(a, { timestamp: 11 })
    queue.finish(queue.begin(), { timestamp: 5 })
    assert.deepEqual(committed, preserveStamp ? [10] : [10, 5], 'Mode/source resets retain the committed time; timeline resets permit an earlier frame')
    assert.equal(queue.entries.length, 0)
}
console.log('PASS frame queue ordering, one-distinct-frame limit, duplicate attempts, failures, late responses, realtime priority and resets')

// Drive the production request callbacks with deferred HTTP responses, without network/rendering.
const requestProbe = name => {
    const source = name === 'Palert' ? componentSource : name === 'Nied' ? niedComponentSource : tremComponentSource
    const pending = []
    const request = (...args) => new Promise((resolve, reject) => pending.push({ args, resolve, reject }))
    const probe = new Function('StationFrameQueue', 'request', 'timeToStamp', 'stampToTime', 'console', `
        const settingsStore = { mainSettings: { displaySeisNet: { httpDataPriority: 'complete' } } };
        const statusStore = { seisNetReplayDelay: 0 };
        let stopped = false, requestGeneration = 0, latestFrameStamp = null, pendingTimelineSwitch = false;
        let now = 1788880000000, poll, interval, requestInterval, modeChanged;
        const committed = [], delay = { value: 0 }, maxDelay = 3000, timeStore = { getTimeStamp: () => now };
        const Palert = { getRealtimeData: request }, Http = { get: request }, axios = { get: request };
        const seisNetUrls = { nied: { stationData: 'test' } }, stationDataUrl = { value: 'test' };
        const siteConfigId = { value: 'test' }, getTimeNumberString = () => stampToTime(now, 9).replace(/[^0-9]/g, '');
        const setInterval = (callback, milliseconds) => { poll = callback; interval = milliseconds; };
        const watch = (source, callback) => { modeChanged = callback; };
        const frameQueue = new StationFrameQueue(frame => commitFrame(frame),
            () => settingsStore.mainSettings.displaySeisNet.httpDataPriority === 'complete');
        const commitFrame = frame => {
            if(stopped || frame.generation !== requestGeneration) return;
            latestFrameStamp = frame.timestamp;
            pendingTimelineSwitch = false;
            committed.push(frame);
        };
        ${name === 'Palert' ? section(source, 'const normalizeMeasurement =', 'const hasValidTriggerStamp =') +
            section(source, 'const fetchRealtimeData =', 'const clearReactiveObject =') :
            (name === 'Nied' ? section(source, 'const getData =', 'const calcBearingDirection =') : '') +
            section(source, '    requestInterval = setInterval(async () => {', "    document.addEventListener('visibilitychange'")}
        ${name === 'Trem' ? section(source, 'watch([() => settingsStore.mainSettings.displaySeisNet.httpDataPriority', 'onBeforeUnmount(') :
            section(source, 'watch(() => settingsStore.mainSettings.displaySeisNet.httpDataPriority', name === 'Palert' ? 'watch(isHypocenterEnabled,' : 'onBeforeUnmount(')}
        return { committed, queue: frameQueue, interval, fetch: ${name === 'Palert' ? 'fetchRealtimeData' : '() => poll()'},
            setTime: value => { now = value; }, delay,
            setMode: value => { settingsStore.mainSettings.displaySeisNet.httpDataPriority = value; modeChanged(); },
            resetTimeline: () => { requestGeneration++; pendingTimelineSwitch = true; frameQueue.reset(); },
            stop: () => { stopped = true; requestGeneration++; frameQueue.reset(); }
        };
    `)(StationFrameQueue, request, timeToStamp, stampToTime, { log() {} })
    const response = (timestamp, pga = 1) => name === 'Palert' ? { timestamp, dataVals: { probe: pga } }
        : name === 'Trem' ? { time: timestamp, station: { probe: { i: pga } } }
        : { status: 200, data: { realTimeData: { siteConfigId: 'test', intensity: '8', dataTime: stampToTime(timestamp, 9) + '+09:00' } } }
    return { ...probe, pending, response }
}
for(const name of ['Palert', 'Nied', 'Trem']) {
    const p = requestProbe(name), base = 1788880000000
    if(name !== 'Palert') assert.equal(p.interval, name === 'Nied' ? 500 : 1000)
    const a = p.fetch(); p.setTime(base + 1000); const b = p.fetch()
    p.pending[1].resolve(p.response(base + 1000)); await b
    assert.equal(p.committed.length, 0, `${name} holds a later frame`)
    p.pending[0].resolve(p.response(base)); await a
    assert.deepEqual(p.committed.map(frame => frame.timestamp), [base, base + 1000])
    p.setTime(base + 2000); const stale = p.fetch()
    p.setTime(base + 3000); const next = p.fetch()
    p.pending[3].resolve(p.response(base + 3000)); await next
    p.setTime(base + 4000); const newest = p.fetch()
    p.pending[4].resolve(p.response(base + 4000)); await newest
    p.pending[2].resolve(p.response(base + 2000)); await stale
    assert.deepEqual(p.committed.map(frame => frame.timestamp), [base, base + 1000, base + 3000, base + 4000])
    p.setTime(base + 5000); const beforeSwitch = p.fetch()
    p.setMode('realtime')
    p.pending[5].resolve(p.response(base + 5000)); await beforeSwitch
    assert.equal(p.committed.length, 4, 'Mode changes discard in-flight results')
    p.setTime(base + 6000); const slow = p.fetch()
    p.setTime(base + 7000); const fast = p.fetch()
    p.pending[7].resolve(p.response(base + 7000)); await fast
    assert.equal(p.committed.at(-1).timestamp, base + 7000, 'Realtime mode submits immediately')
    p.pending[6].resolve(p.response(base + 6000)); await slow
    p.setMode('complete'); p.resetTimeline(); p.setTime(base - 1000)
    const rewind = p.fetch(); p.pending[8].resolve(p.response(base - 1000)); await rewind
    assert.equal(p.committed.at(-1).timestamp, base - 1000, 'Rewinding permits an earlier first frame')
    const stopped = p.fetch(); p.stop(); p.pending[9].resolve(p.response(base)); await stopped
    assert.equal(p.committed.length, 6, 'Stopped requests cannot commit')
}
{
    const p = requestProbe('Nied'), base = 1788880000000
    const first = p.fetch(), duplicate = p.fetch()
    p.pending[1].resolve(p.response(base)); await duplicate
    assert.equal(p.committed.length, 1, 'NIED same-second success does not wait for its duplicate')
    p.pending[0].reject({ code: 'ERR_BAD_REQUEST' }); await first
    assert.equal(p.delay.value, 0, 'A superseded request cannot change the realtime delay')
    const lateDuplicate = p.fetch()
    p.setTime(base + 1000); const next = p.fetch()
    p.pending[3].resolve(p.response(base + 1000)); await next
    assert.equal(p.committed.length, 2, 'A new request for an already committed second cannot block the next second')
    p.pending[2].resolve(p.response(base)); await lateDuplicate
    assert.equal(p.committed.length, 2)
}
for(const name of ['Palert', 'Nied', 'Trem']) {
    for(const reject of [false, true]) {
        const p = requestProbe(name), base = 1788880000000
        const a = p.fetch(); p.setTime(base + 1000); const b = p.fetch()
        p.pending[1].resolve(p.response(base + 1000)); await b
        if(reject) p.pending[0].reject(new Error('timeout'))
        else p.pending[0].resolve({})
        await a
        assert.equal(p.committed.length, 1, `${name} failure/invalid response releases the waiting frame`)
        assert.equal(p.queue.entries.length, 0)
    }
}
for(const pga of [25, 44, 79.999]) {
    const p = requestProbe('Palert'), base = 1788880000000
    const frame = p.fetch()
    p.pending[0].resolve(p.response(base, pga)); await Promise.resolve(); await Promise.resolve()
    assert.equal(p.pending.length, 1, `PGA ${pga} must not request PGV below 80`)
    await frame
    assert.equal(p.committed.length, 1)
    assert.equal(p.committed[0].pgvData, null)
}
{
    const p = requestProbe('Palert'), base = 1788880000000
    const a = p.fetch(); p.setTime(base + 1000); const b = p.fetch()
    p.pending[0].resolve(p.response(base, 80)); await Promise.resolve(); await Promise.resolve()
    assert.deepEqual(p.pending[2].args, [1, base / 1000], 'PGV is requested for the matching PGA second')
    p.pending[1].resolve(p.response(base + 1000)); await b
    assert.equal(p.committed.length, 0, 'PGA plus pending PGV is still an unfinished frame')
    p.pending[2].reject(new Error('PGV timeout')); await a
    assert.deepEqual(p.committed.map(frame => frame.timestamp), [base, base + 1000])
    assert.equal(p.committed[0].pgvData, null, 'PGV failure preserves valid PGA')
}
console.log('PASS actual HTTP callbacks, NIED 500ms same-second attempts, PGA/PGV readiness, failure release, mode changes, rewind and stop')

// Exercise both production station-list pollers with deferred requests and virtual timers.
for(const name of ['Palert', 'Trem']) {
    const isPalert = name === 'Palert'
    const source = isPalert ? componentSource : read('src/components/components/TremNet.vue')
    const stationList = isPalert ? [] : {}
    const timers = new Map()
    const pendingRequests = []
    let timerId = 0
    const request = () => new Promise((resolve, reject) => pendingRequests.push({ resolve, reject }))
    const poller = new Function('stationList', 'Palert', 'Http', 'seisNetUrls', 'setTimeout', 'clearTimeout', 'clearInterval', 'console', `
        let stopped = false, stationVersion = '', requestGeneration = 0;
        const frameQueue = { reset() {} };
        const terminateHypocenterWorker = () => {};
        const destroyInferredHypocenterLayers = () => {};
        const clearReactiveObject = obj => { for(const key of Object.keys(obj)) delete obj[key]; };
        ${section(source, 'let fetchStationTimer, requestInterval', isPalert ? 'const renderAll = ' : 'onMounted(')}
        return { fetch: fetchStationList, stop: () => {
            ${section(source, '    stopped = true', "    document.removeEventListener('visibilitychange'")}
        } };
    `)(stationList, { getStationList: request }, { get: request }, { trem: { stationList: 'test-stations' } },
        (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id },
        id => timers.delete(id), () => {}, { log: () => {} })
    const validInfo = isPalert ? { station: 'valid', lat: 24, lon: 121 } : { info: [{ lat: 24, lon: 121 }] }
    const invalidInfo = isPalert ? { station: 'invalid', lat: 100, lon: 121 } : { info: [{ lat: 24, lon: 121 }, { lat: null, lon: 121 }] }
    const invalidResponse = isPalert ? { staInfos: [null, invalidInfo] } : { broken: null, invalid: invalidInfo }
    const validResponse = isPalert ? { version: 'one', staInfos: [validInfo, invalidInfo] } : { valid: validInfo, invalid: invalidInfo }
    const beginNext = () => {
        assert.equal(timers.size, 1)
        const timer = [...timers.values()][0]
        timers.clear()
        const task = timer.callback()
        assert.equal(timers.size, 0, 'No next poll is scheduled while a request is pending')
        assert.equal(pendingRequests.length, 1)
        return task
    }
    const expectDelay = delay => {
        assert.equal(timers.size, 1)
        assert.equal([...timers.values()][0].delay, delay, `${name} station-list delay`)
    }
    let task = poller.fetch()
    assert.equal(timers.size, 0)
    pendingRequests.shift().reject(new Error('Initial request failed'))
    await task
    expectDelay(isPalert ? 20000 : 10000)
    for(const response of [undefined, {}, invalidResponse, isPalert ? { staInfos: [] } : []]) {
        task = beginNext()
        pendingRequests.shift().resolve(response)
        await task
        expectDelay(isPalert ? 20000 : 10000)
        assert.equal(Object.keys(stationList).length, 0)
    }
    task = beginNext()
    pendingRequests.shift().resolve(validResponse)
    await task
    expectDelay(600000)
    assert.equal(Object.keys(stationList).length, 1, 'Only usable station metadata is accepted')
    const accepted = JSON.stringify(stationList)
    for(const response of [validResponse, invalidResponse, new Error('Refresh failed')]) {
        task = beginNext()
        const pending = pendingRequests.shift()
        if(response instanceof Error) pending.reject(response)
        else pending.resolve(response)
        await task
        expectDelay(600000)
        assert.equal(JSON.stringify(stationList), accepted, 'Failed or invalid refreshes preserve usable cached metadata')
    }
    const canceledCallback = [...timers.values()][0].callback
    poller.stop()
    assert.equal(timers.size, 0, 'Unmount cancels the next station-list poll')
    await canceledCallback()
    assert.equal(pendingRequests.length, 0, 'A stopped component cannot start another request')

    // Stop a second poller during its initial request to check the production post-await guard.
    const stoppedDuringRequest = new Function('request', 'setTimeout', `
        let stopped = false, stationVersion = '';
        const stationList = ${isPalert ? '[]' : '{}'};
        const Palert = { getStationList: request }, Http = { get: request };
        const seisNetUrls = { trem: { stationList: 'test-stations' } };
        const clearReactiveObject = obj => { for(const key of Object.keys(obj)) delete obj[key]; };
        ${section(source, 'let fetchStationTimer, requestInterval', isPalert ? 'const renderAll = ' : 'onMounted(')}
        return { fetch: fetchStationList, stop: () => { stopped = true }, stationList };
    `)(request, () => { throw new Error('A late response must not reschedule polling') })
    task = stoppedDuringRequest.fetch()
    stoppedDuringRequest.stop()
    pendingRequests.shift().resolve(validResponse)
    await task
    assert.equal(Object.keys(stoppedDuringRequest.stationList).length, 0)
}
console.log('PASS P-Alert/TREM station-list retries at twenty/ten seconds, refreshes at ten minutes, metadata validation, cached data and unmount cleanup')

// Exercise the actual station class without Leaflet/Vue rendering dependencies.
const stationSource = source => `import { compareFloat } from '@/utils/Utils';
let settingsStore = { mainSettings: { displaySeisNet: { palertLevelHold: 1 } } };
const markRaw = value => value;
const getShindoFromLevel = value => value;
${section(source, 'export class PalertStation', 'export class TremStation')}`
const { PalertStation } = await load('src/classes/test-palert-station.js', stationSource(read('src/classes/StationClasses.js')))
const replayPalertHistory = (recentData, isActive = false) => {
    const station = new PalertStation(null, 'probe', [24, 121], true)
    station.isActive = isActive
    for(const sample of [...recentData].reverse()) {
        const missingSeconds = station.updateStamp === null ? 0 : Math.max(0, (sample.timestamp - station.updateStamp) / 1000 - 1)
        station.update(sample, missingSeconds, false)
    }
    return station
}
const pickMetrics = station => ({
    triggerStamp: station.triggerStamp, maxLevel: station.maxLevel, secondMaxLevel: station.secondMaxLevel
})
const findPalertTrigger = (recentData, isActive) => pickMetrics(replayPalertHistory(recentData, isActive))
const stamp = 1788880000000
const levelPgas = [0.05, 0.1, 0.14, 0.18, 0.25, 0.33, 0.44, 0.59, 0.8, 1.4, 2.5, 4.4, 8, 14, 25, 44]
levelPgas.forEach((pga, level) => assert.equal(getPalertLevelFromPgaPgv(pga, 140), level, 'Existing PGA levels below 80 remain unchanged'))
const history = levels => levels.map((level, i) => ({ level, timestamp: stamp + i * 1000, pga: level < 0 ? null : levelPgas[level] ?? 44 })).reverse()
const quiet = Array(8).fill(3)
const trigger = levels => findPalertTrigger(history(levels), true)
const pgaHistory = pgas => pgas.map((pga, i) => ({ pga, level: getPalertLevelFromPgaPgv(pga, null), timestamp: stamp + i * 1000 })).reverse()
const triggerPgas = pgas => findPalertTrigger(pgaHistory(pgas), false)
const replayPgas = pgas => replayPalertHistory(pgaHistory(pgas))
const feedPga = (station, pga, missingSeconds = 0, pgv = null) => {
    station.update({
        timestamp: station.updateStamp + (missingSeconds + 1) * 1000,
        pga, pgv, level: getPalertLevelFromPgaPgv(pga, pgv)
    }, missingSeconds, false)
}
const quietPgas = Array(8).fill(0.1)
assert.equal(trigger([...quiet, 5]).triggerStamp, null)
assert.deepEqual(trigger([...quiet, 6]), { triggerStamp: stamp + 8000, maxLevel: 6, secondMaxLevel: -1 })
assert.deepEqual(trigger([...quiet, 7]), { triggerStamp: stamp + 8000, maxLevel: 7, secondMaxLevel: -1 })
assert.deepEqual(trigger([...quiet, 7, 8]), { triggerStamp: stamp + 8000, maxLevel: 8, secondMaxLevel: 7 })
assert.equal(trigger([...Array(8).fill(7), 8]).triggerStamp, null)
assert.equal(trigger([...quiet.slice(1), 7]).triggerStamp, null)
assert.deepEqual(findPalertTrigger(history([...quiet, 10, 12]), false), trigger([...quiet, 10, 12]), 'Trigger calculation does not require activation')
assert.equal(triggerPgas([...Array(8).fill(0.5), 0.59]).triggerStamp, null)
assert.equal(triggerPgas([...Array(8).fill(0.5), 0.999]).triggerStamp, null)
assert.equal(triggerPgas([...Array(8).fill(0.5), 1]).triggerStamp, stamp + 8000, 'The exact two-times boundary is accepted')
assert.equal(triggerPgas([...quietPgas, 0.59]).triggerStamp, stamp + 8000)
assert.equal(triggerPgas([...quietPgas, 0.44]).triggerStamp, stamp + 8000, 'The level-six boundary can trigger')
assert.equal(triggerPgas([...quietPgas, 0.439999]).triggerStamp, null, 'A rise below level six cannot trigger')
const levelSixOnset = replayPgas([...quietPgas, 0.44])
assert.equal(levelSixOnset.activity, 0.2)
assert.equal(createPalertHypocenterUpdate([levelSixOnset]).pickCandidates.length, 0, 'A level-six pick still requires activation before submission')
levelSixOnset.isActive = true
const levelSixPick = createPalertHypocenterUpdate([levelSixOnset]).pickCandidates[0]
assert.equal(levelSixPick.triggerStamp, stamp + 8000)
assert.equal(levelSixPick.maxLevel, 6)
assert.equal(profile.getPickBaseWeight(levelSixPick), 0.1, 'Submitted level-six picks have a nonzero inference weight')
const zeroBackgroundOnset = replayPgas([...Array(8).fill(0), 0.59])
assert.equal(zeroBackgroundOnset.triggerStamp, stamp + 8000, 'A zero preceding sample cannot be an onset; a positive current sample can still trigger directly')
assert.deepEqual([zeroBackgroundOnset.maxLevel, zeroBackgroundOnset.secondMaxLevel, zeroBackgroundOnset.triggerMaxPga,
    zeroBackgroundOnset.triggerSecondMaxPga], [7, -1, 0.59, null], 'The rejected zero onset is excluded from the new pick metrics')
const positiveMotionOverZeroBackground = replayPgas([...Array(7).fill(0), 0.001, 0.59])
assert.equal(positiveMotionOverZeroBackground.triggerStamp, stamp + 7000, 'Any positive preceding PGA can backdate over a valid zero background')
assert.deepEqual([positiveMotionOverZeroBackground.triggerMaxPga, positiveMotionOverZeroBackground.triggerSecondMaxPga], [0.59, 0.001])
const zeroPgaAnchor = pgaHistory(Array(9).fill(0))
zeroPgaAnchor[0].level = 7
assert.equal(findPalertTrigger(zeroPgaAnchor, false).triggerStamp, null, 'A zero-PGA onset is invalid even if its supplied level reaches seven')
assert.equal(triggerPgas([0.5, ...Array(7).fill(0.1), 0.8]).triggerStamp, null, 'Background includes t-8')
assert.equal(triggerPgas([...Array(8).fill(0.59), 1.18]).triggerStamp, stamp + 8000)
assert.deepEqual(triggerPgas([...Array(7).fill(0.1), 0.4, 0.8]),
    { triggerStamp: stamp + 7000, maxLevel: 8, secondMaxLevel: 5 }, 'Backdating wins when both onset branches qualify and includes both levels')
assert.deepEqual(triggerPgas([...Array(7).fill(0.21), 0.4, 0.6]),
    { triggerStamp: stamp + 7000, maxLevel: 7, secondMaxLevel: 5 }, 'A weak initial motion no longer contaminates its own background')
for(const pga of [null, undefined, NaN, Infinity, -1]) {
    for(const index of [0, 1, 3, 8]) {
        const samples = pgaHistory([...quietPgas, 0.8])
        samples[index].pga = pga
        assert.equal(findPalertTrigger(samples, false).triggerStamp, null, 'The onset and all eight background PGAs must be valid')
    }
}
for(let missingIndex = 0; missingIndex < quiet.length; missingIndex++) {
    assert.equal(trigger([...quiet.map((level, index) => index === missingIndex ? -1 : level), 10]).triggerStamp, null)
}
const gap = history([...quiet, 10]); gap[3].timestamp -= 1000
assert.equal(findPalertTrigger(gap, true).triggerStamp, null, 'Background timestamps must be consecutive')
const repeated = history([...quiet, 12]); repeated.unshift({ ...repeated[0] })
assert.equal(findPalertTrigger(repeated, true).secondMaxLevel, -1, 'Repeated timestamps are not another observation')
console.log('PASS level-six/two-times onset gates, low-level pick submission, complete eight-sample backgrounds, independent activation and timestamp deduplication')

for(const [previous, current, expected] of [
    [0.6, 0.6, stamp + 8000],
    [0.5999999999, 0.6, null], [0.6, 0.5999999999, null],
    [0.6000000001, 0.6, stamp + 8000], [0.6, 0.6000000001, stamp + 8000],
]) {
    assert.equal(triggerPgas([...Array(8).fill(0.4), previous, current]).triggerStamp, expected,
        'Both backdating samples use the default ten-decimal comparison at 0.4 * 1.5')
}
assert.equal(triggerPgas([...Array(8).fill(0.4), 0.8]).triggerStamp, stamp + 8000)
assert.equal(triggerPgas([...Array(8).fill(0.4), 0.7999999999]).triggerStamp, null)
assert.equal(triggerPgas(Array(9).fill(Number.MAX_VALUE)).triggerStamp, null,
    'An overflowed ratio threshold cannot create a trigger')
console.log('PASS rounded PGA ratio boundaries, values on both sides and overflow rejection')

// Either sample may reach level six when backdating, including to the previous pick's closing sample.
const initialMotion = replayPgas([...Array(7).fill(0.21), 0.4, 0.6])
assert.deepEqual([initialMotion.triggerMaxPga, initialMotion.triggerSecondMaxPga, initialMotion.noNewPeakCount], [0.6, 0.4, 0])
assert.equal(createPalertHypocenterUpdate([initialMotion]).pickCandidates.length, 0)
initialMotion.isActive = true
const initialMotionPick = createPalertHypocenterUpdate([initialMotion]).pickCandidates[0]
assert.equal(initialMotionPick.triggerStamp, stamp + 7000)
assert.deepEqual([initialMotionPick.maxLevel, initialMotionPick.secondMaxLevel], [7, 5])
feedPga(initialMotion, 0.8)
assert.equal(initialMotion.triggerStamp, stamp + 7000, 'Later qualifying samples cannot rewrite an existing pick onset')
assert.deepEqual([initialMotion.triggerMaxPga, initialMotion.triggerSecondMaxPga], [0.8, 0.6])
assert.equal(triggerPgas([...Array(7).fill(0.1), 0.4, 0.43]).triggerStamp, null, 'At least one sample in the pair must reach level six')
for(const pair of [[0.44, 0.43], [0.43, 0.44]]) {
    const station = replayPgas([...Array(8).fill(0.28), pair[0]])
    assert.equal(station.triggerStamp, null)
    feedPga(station, pair[1])
    assert.deepEqual(pickMetrics(station), { triggerStamp: stamp + 8000, maxLevel: 6, secondMaxLevel: 5 },
        'Either a preceding or current level-six sample permits backdating')
    assert.equal(station.activity, 0.2)
}
for(const pair of [[0.65, 0.58], [0.58, 0.65]]) {
    const station = replayPgas([...Array(8).fill(0.35), pair[0]])
    assert.equal(station.triggerStamp, null, 'The first sample alone cannot trigger over this background')
    feedPga(station, pair[1])
    assert.equal(station.triggerStamp, stamp + 8000, 'Either ordering confirms the earlier sample as onset')
    assert.deepEqual([station.maxLevel, station.secondMaxLevel, station.triggerMaxPga,
        station.triggerSecondMaxPga, station.noNewPeakCount], [7, 6, 0.65, 0.58, 0], 'Both samples initialize the same pick metrics in either ordering')
}
assert.equal(triggerPgas([...Array(8).fill(0.3), 0.43, 0.43]).triggerStamp, null, 'Two samples below level six cannot start a pick')
assert.equal(triggerPgas([...Array(8).fill(0.28), 0.44, 0.42]).triggerStamp, stamp + 8000, 'A preceding level-six sample and a current sample at 1.5 times background are accepted')
assert.equal(triggerPgas([...Array(8).fill(0.28), 0.44, 0.419]).triggerStamp, null, 'A preceding level-six sample cannot bypass the current PGA ratio requirement')
assert.equal(triggerPgas([...Array(7).fill(0.5), 0.749, 0.8]).triggerStamp, null)
const equalInitialMotion = replayPgas([...Array(7).fill(0.5), 0.75, 0.75])
assert.equal(equalInitialMotion.triggerStamp, stamp + 7000, 'The exact 1.5-times boundary and equal consecutive PGAs are accepted')
assert.deepEqual([equalInitialMotion.maxLevel, equalInitialMotion.secondMaxLevel, equalInitialMotion.triggerMaxPga,
    equalInitialMotion.triggerSecondMaxPga, equalInitialMotion.noNewPeakCount], [7, 7, 0.75, 0.75, 0])
for(let i = 1; i <= 8; i++) {
    feedPga(equalInitialMotion, 0.75)
    assert.equal(equalInitialMotion.triggerStamp, i < 8 ? stamp + 7000 : null, 'Both backdated samples are counted once before the eight-frame timeout')
}
assert.equal(triggerPgas([...Array(7).fill(0.5), 1.5, 1.4]).triggerStamp, stamp + 7000, 'A decreasing pair above the shared background threshold can backdate')
const fallingInitialMotion = replayPgas([...Array(8).fill(0.5), 0.875])
assert.equal(fallingInitialMotion.triggerStamp, null, 'The preceding sample alone does not reach the direct two-times threshold')
feedPga(fallingInitialMotion, 0.75)
assert.equal(fallingInitialMotion.triggerStamp, stamp + 8000, 'A lower current PGA at the exact 1.5-times boundary confirms the preceding onset')
assert.deepEqual([fallingInitialMotion.maxLevel, fallingInitialMotion.secondMaxLevel, fallingInitialMotion.triggerMaxPga,
    fallingInitialMotion.triggerSecondMaxPga, fallingInitialMotion.noNewPeakCount], [8, 7, 0.875, 0.75, 0])
assert.equal(triggerPgas([...Array(8).fill(0.5), 0.875, 0.749]).triggerStamp, null, 'The current sample must independently reach 1.5 times the background')
assert.equal(triggerPgas([0.5, ...Array(6).fill(0.1), 0.4, 0.6]).triggerStamp, null, 'The seven-point background still includes t-8')
assert.equal(triggerPgas([4, ...Array(7).fill(0.1), 0.4, 0.6]).triggerStamp, stamp + 8000, 't-9 is outside the requested background')
for(const invalidIndex of [0, 1, 2, 8]) {
    const samples = pgaHistory([...Array(7).fill(0.21), 0.4, 0.6])
    samples[invalidIndex].pga = null
    assert.equal(findPalertTrigger(samples, false).triggerStamp, null, 'Backdating cannot cross a missing onset, anchor or background sample')
}
const brokenMotionTime = pgaHistory([...Array(7).fill(0.21), 0.4, 0.6])
brokenMotionTime[1].timestamp -= 1000
assert.equal(findPalertTrigger(brokenMotionTime, false).triggerStamp, null)
const pgvMotion = replayPgas(Array(7).fill(0.1))
feedPga(pgvMotion, 80, 0, 140)
assert.equal(pgvMotion.triggerStamp, null, 'The early sample alone has insufficient background')
feedPga(pgvMotion, 100)
assert.equal(pgvMotion.triggerStamp, stamp + 7000)
assert.deepEqual([pgvMotion.maxLevel, pgvMotion.secondMaxLevel, pgvMotion.triggerMaxPga, pgvMotion.triggerSecondMaxPga],
    [20, 15, 100, 80], 'Level and PGA ranks both include the backdated sample, even when their ordering differs')

const closeOnRise = (closingPga = 0.8) => replayPgas([...quietPgas, 2.5, 2.5, ...Array(7).fill(0.1), closingPga])
const fallingOverlapStation = closeOnRise()
feedPga(fallingOverlapStation, 0.7)
assert.equal(fallingOverlapStation.triggerStamp, stamp + 17000, 'A decreasing pair can backdate to the previous pick closing sample')
assert.deepEqual([fallingOverlapStation.maxLevel, fallingOverlapStation.secondMaxLevel, fallingOverlapStation.triggerMaxPga,
    fallingOverlapStation.triggerSecondMaxPga], [8, 7, 0.8, 0.7])
const overlapStation = closeOnRise()
const oldFinalPick = overlapStation.completedPick
assert.equal(oldFinalPick.updateStamp, stamp + 17000)
overlapStation.isActive = true
const closingUpdate = createPalertHypocenterUpdate([overlapStation])
feedPga(overlapStation, 1.25)
assert.equal(overlapStation.triggerStamp, oldFinalPick.updateStamp, 'The previous pick final frame can also start a new pick')
assert.equal(overlapStation.completedPick, null)
assert.deepEqual([overlapStation.maxLevel, overlapStation.secondMaxLevel, overlapStation.triggerMaxPga,
    overlapStation.triggerSecondMaxPga, overlapStation.noNewPeakCount], [8, 8, 1.25, 0.8, 0])
const sharedBoundaryUpdate = mergePalertHypocenterUpdates(closingUpdate, createPalertHypocenterUpdate([overlapStation]))
assert.equal(sharedBoundaryUpdate.pickCandidates.length, 2, 'Picks sharing a boundary sample retain separate identities')
feedPga(overlapStation, 1.25)
assert.equal(overlapStation.triggerStamp, stamp + 17000, 'Later samples update the new pick without moving its onset')
assert.deepEqual([overlapStation.maxLevel, overlapStation.secondMaxLevel, overlapStation.triggerMaxPga,
    overlapStation.triggerSecondMaxPga], [8, 8, 1.25, 1.25])
assert.deepEqual(oldFinalPick, { triggerStamp: stamp + 8000, updateStamp: stamp + 17000, level: 8, maxLevel: 10, secondMaxLevel: 10 })
const laterBoundaryUpdate = mergePalertHypocenterUpdates(sharedBoundaryUpdate, createPalertHypocenterUpdate([overlapStation]))
assert.deepEqual(laterBoundaryUpdate.pickCandidates.find(pick => pick.pickId === closingUpdate.pickCandidates[0].pickId),
    closingUpdate.pickCandidates[0], 'Subsequent worker updates preserve the frozen old pick metrics')
const preferredAfterClose = closeOnRise()
feedPga(preferredAfterClose, 1.6)
assert.equal(preferredAfterClose.triggerStamp, stamp + 17000, 'Backdating has priority at a shared boundary even when direct pickup qualifies')
const directAfterClose = closeOnRise(0.1)
feedPga(directAfterClose, 1.6)
assert.equal(directAfterClose.triggerStamp, stamp + 18000, 'Direct pickup still applies when the preceding sample fails the background threshold')
assert.deepEqual([directAfterClose.maxLevel, directAfterClose.secondMaxLevel, directAfterClose.triggerMaxPga,
    directAfterClose.triggerSecondMaxPga], [9, -1, 1.6, null], 'The previous final frame is excluded from the new direct pick metrics')
for(const resetMethod of ['clearRecentData', 'clearHistory']) {
    const station = closeOnRise()
    station[resetMethod](false)
    assert.equal(station.triggerStamp, null)
    assert.equal(station.completedPick, null)
    for(const sample of [...pgaHistory([...Array(7).fill(0.21), 0.4, 0.6])].reverse()) station.update(sample, 0, false)
    assert.equal(station.triggerStamp, stamp + 7000, 'A reset timeline initializes a fresh pick from its own history')
}
console.log('PASS preferred one-frame backdating, seven-point 1.5-times backgrounds, shared boundary samples, independent picks, frozen old metrics, direct fallback and timeline reset')

// Either of the top two PGA values can renew a pick, including filling the second observation.
const tracking = replayPgas([...quietPgas, 2.5])
assert.equal(tracking.triggerSecondMaxPga, null)
assert.equal(tracking.noNewPeakCount, 0)
feedPga(tracking, 1)
assert.deepEqual([tracking.triggerMaxPga, tracking.triggerSecondMaxPga, tracking.noNewPeakCount], [2.5, 1, 0])
for(let i = 0; i < 7; i++) feedPga(tracking, 0.8)
assert.equal(tracking.noNewPeakCount, 7)
feedPga(tracking, 1.8)
assert.deepEqual([tracking.triggerMaxPga, tracking.triggerSecondMaxPga, tracking.noNewPeakCount], [2.5, 1.8, 0], 'A higher second PGA renews without requiring a new maximum or doubling')
assert.equal(tracking.triggerStamp, stamp + 8000)
assert.deepEqual([tracking.maxLevel, tracking.secondMaxLevel], [10, 9])
feedPga(tracking, 2.5)
assert.deepEqual([tracking.triggerMaxPga, tracking.triggerSecondMaxPga, tracking.noNewPeakCount], [2.5, 2.5, 0])
const equalSample = { ...tracking.recentData[0] }
tracking.update(equalSample, 0, false)
assert.equal(tracking.noNewPeakCount, 0, 'A repeated frame does not advance the timeout')
tracking.update({ ...equalSample, timestamp: equalSample.timestamp - 1000, pga: 100, level: 15 }, 0, false)
assert.equal(tracking.maxLevel, 10, 'An out-of-order frame cannot alter the pick')
for(let i = 1; i <= 7; i++) {
    feedPga(tracking, 2.5)
    assert.equal(tracking.noNewPeakCount, i, 'Equal top-two values cannot renew indefinitely')
    assert.equal(tracking.triggerStamp, stamp + 8000)
}
tracking.isActive = true
feedPga(tracking, 2.5)
assert.equal(tracking.triggerStamp, null, 'The eighth unchanged sample immediately closes the pick')
assert.equal(tracking.activity, 2, 'Closing the pick does not reset twelve-second activity')
assert.equal(tracking.isActive, true, 'Closing the pick does not bypass the activation timer')
assert.deepEqual([tracking.maxLevel, tracking.secondMaxLevel, tracking.triggerMaxPga, tracking.triggerSecondMaxPga, tracking.noNewPeakCount],
    [-1, -1, null, null, 0])
assert.equal(tracking.completedPick.triggerStamp, stamp + 8000)
assert.deepEqual([tracking.completedPick.maxLevel, tracking.completedPick.secondMaxLevel], [10, 10])
for(let i = 0; i < 65; i++) {
    feedPga(tracking, 2.5)
    assert.equal(tracking.triggerStamp, null, 'An unchanged plateau cannot recover or periodically recreate a trigger')
    assert.equal(tracking.completedPick, null, 'The final snapshot is only offered on its closing frame')
}
feedPga(tracking, 5)
assert.equal(tracking.triggerStamp, tracking.updateStamp)
assert.deepEqual([tracking.maxLevel, tracking.secondMaxLevel, tracking.triggerMaxPga, tracking.triggerSecondMaxPga], [11, -1, 5, null])

const twoRises = [...quietPgas, 0.8, 0.8, 0.8, 1.6]
assert.deepEqual(triggerPgas(twoRises), { triggerStamp: stamp + 8000, maxLevel: 9, secondMaxLevel: 8 })
for(const unchangedCount of [7, 8]) {
    const station = replayPgas([...quietPgas, 0.8, 0.8, ...Array(unchangedCount).fill(0.8)])
    assert.equal(station.triggerStamp, unchangedCount === 7 ? stamp + 8000 : null)
    const nextStamp = station.updateStamp + 1000
    feedPga(station, 1.6)
    assert.equal(station.triggerStamp, unchangedCount === 7 ? stamp + 8000 : nextStamp, 'Renewal at the eighth sample is accepted; an already closed pick cannot be renewed')
}
const longRise = replayPgas([...quietPgas, ...Array.from({ length: 90 }, (_, i) => 0.8 + i * 0.02)])
assert.equal(longRise.triggerStamp, stamp + 8000)
assert.equal(longRise.recentData.length, 60)
assert(!longRise.recentData.some(sample => sample.timestamp === longRise.triggerStamp))
assert.equal(longRise.completedPick, null, 'A continuously updated pick survives the history window')
assert.deepEqual([longRise.maxLevel, longRise.secondMaxLevel], [10, 10])

// Activity is independent even when a low but rising second PGA outlasts the twelve-second level peak.
const quietRise = replayPgas([...quietPgas, 0.8])
for(let i = 1; i <= 20; i++) feedPga(quietRise, 0.1 + i * 0.01)
assert.equal(quietRise.activity, 0)
assert.equal(quietRise.triggerStamp, stamp + 8000, 'Only the PGA top-two timeout ends a pick')
for(let i = 0; i < 8; i++) feedPga(quietRise, 0.1)
assert.equal(quietRise.triggerStamp, null)
console.log('PASS cumulative top-two PGA/level tracking, numeric renewal, exact eight-frame closure, plateau rejection and history-window independence')

// Missing seconds are processed before the returning frame, not filled with measurements.
for(const missingSeconds of [7, 8, 12, 60, 120]) {
    const station = replayPgas([...quietPgas, 2.5])
    const firstStamp = station.triggerStamp
    feedPga(station, 8, missingSeconds)
    assert.equal(station.triggerStamp, missingSeconds < 8 ? firstStamp : null)
    if(missingSeconds >= 8) {
        assert.equal(station.completedPick.triggerStamp, firstStamp)
        assert.equal(station.completedPick.updateStamp, firstStamp + 8000)
        assert.deepEqual([station.completedPick.maxLevel, station.completedPick.secondMaxLevel], [10, -1])
        assert.equal(station.activity, 2)
    }
}
const missingStation = replayPgas([...quietPgas, 2.5, ...Array(8).fill(null)])
assert.equal(missingStation.triggerStamp, null)
assert.equal(missingStation.completedPick.updateStamp, stamp + 16000)
for(let i = 0; i < 8; i++) feedPga(missingStation, 0.5)
feedPga(missingStation, 0.6)
assert.equal(missingStation.triggerStamp, null, 'Weak data after expiry cannot recover an old timestamp')
feedPga(missingStation, 1.2)
assert.equal(missingStation.triggerStamp, missingStation.updateStamp)
assert.equal(missingStation.secondMaxLevel, -1)
const delayed = replayPgas([...quietPgas, 8, 2.5, 1.4])
assert.equal(delayed.isActive, false)
assert.deepEqual([delayed.maxLevel, delayed.secondMaxLevel], [12, 10])
assert.equal(createPalertHypocenterUpdate([delayed]).pickCandidates.length, 0)
delayed.isActive = true
assert.equal(createPalertHypocenterUpdate([delayed]).pickCandidates[0].triggerStamp, stamp + 8000)
delayed.clearRecentData()
assert.deepEqual([delayed.triggerStamp, delayed.maxLevel, delayed.secondMaxLevel, delayed.triggerMaxPga,
    delayed.triggerSecondMaxPga, delayed.noNewPeakCount, delayed.completedPick, delayed.recentMaxLevel],
    [null, -1, -1, null, null, 0, null, -1])
assert(!delayed.isPenaltyStation())
console.log('PASS short/long data gaps, closing timestamps, no stale-trigger recovery, active-only submission and history reset')

// PGV can change level without changing PGA: the eighth unchanged PGA must still update the final pick.
for(const initialPgv of [0, 140]) {
    const station = replayPgas(quietPgas)
    feedPga(station, 80, 0, initialPgv)
    feedPga(station, 80, 0, 0)
    station.isActive = true
    const before = createPalertHypocenterUpdate([station])
    const firstPickId = before.pickCandidates[0].pickId
    const lifecycleFinder = new FindPalertHypocenter([], {})
    lifecycleFinder.update(before.pickCandidates, before.inactiveStations, before.activeStations)
    for(let i = 0; i < 7; i++) feedPga(station, 0.1)
    feedPga(station, 80, 0, initialPgv === 0 ? 140 : 80)
    const closedAt = station.updateStamp
    const finalUpdate = createPalertHypocenterUpdate([station])
    const expectedPeaks = initialPgv === 0 ? [20, 15] : [20, 19]
    assert.equal(station.triggerStamp, null)
    assert.equal(station.activity, 2)
    assert.equal(finalUpdate.activeStations[0].triggerStamp, null)
    assert.equal(finalUpdate.pickCandidates.length, 1)
    assert.equal(finalUpdate.pickCandidates[0].pickId, firstPickId)
    assert.deepEqual([finalUpdate.pickCandidates[0].maxLevel, finalUpdate.pickCandidates[0].secondMaxLevel], expectedPeaks)
    assert.deepEqual(createPalertHypocenterUpdate([station]), finalUpdate, 'Repeated snapshot reads do not consume final evidence')
    station.isActive = false
    assert.equal(createPalertHypocenterUpdate([station]).pickCandidates.length, 0, 'An inactive station cannot submit even a completed pick')
    station.isActive = true
    const pending = mergePalertHypocenterUpdates(before, finalUpdate)
    lifecycleFinder.update(pending.pickCandidates, pending.inactiveStations, pending.activeStations)
    const oldPick = lifecycleFinder.picks.get(firstPickId)
    assert.deepEqual([oldPick.maxLevel, oldPick.secondMaxLevel], expectedPeaks)
    assert.equal(oldPick.updateStamp, closedAt)
    const frozen = structuredClone(oldPick)
    for(let i = 0; i < 8; i++) {
        feedPga(station, 0.1)
        const update = createPalertHypocenterUpdate([station])
        assert.equal(update.pickCandidates.length, 0)
        lifecycleFinder.update(update.pickCandidates, update.inactiveStations, update.activeStations)
        assert.deepEqual(oldPick, frozen, 'Later active frames cannot update a completed pick')
    }
    feedPga(station, 0.6)
    assert.equal(station.activity, 2, 'Detection retains the previous high level within its twelve-second window')
    assert.deepEqual([station.maxLevel, station.secondMaxLevel, station.triggerMaxPga, station.triggerSecondMaxPga], [7, -1, 0.6, null])
    const next = createPalertHypocenterUpdate([station])
    assert.notEqual(next.pickCandidates[0].pickId, firstPickId)
    assert.equal(profile.getPickBaseWeight(next.pickCandidates[0]), 0.4)
    const coalesced = mergePalertHypocenterUpdates(pending, next)
    assert.equal(coalesced.pickCandidates.length, 2)
    assert.equal(coalesced.activeStations[0].maxLevel, 7, 'A new pick never inherits old pick metrics')
    lifecycleFinder.update(coalesced.pickCandidates, coalesced.inactiveStations, coalesced.activeStations)
    assert.equal(lifecycleFinder.picks.get(next.pickCandidates[0].pickId).maxLevel, 7)
    assert.deepEqual(oldPick, frozen)
    for(let i = 0; i < 9; i++) feedPga(station, 0.1)
    assert(station.completedPick)
    station.clearHistory(false)
    assert.equal(station.completedPick, null, 'Timeline/history resets discard unsent completed snapshots')
}
console.log('PASS final-frame PGA/PGV metrics, null active triggers, pending merge, frozen old picks and independent subsequent picks')

for(const [level, activity] of [[-1, 0], [0, 0], [5, 0], [6, 0.2], [7, 0.5], [8, 1], [9, 1.5], [10, 2], [11, 2], [20, 2]]) {
    const station = new PalertStation(null, 'W001', [24, 121], true)
    station.update({ timestamp: stamp, pga: null, pgv: null, level }, 0, false)
    assert.equal(station.activity, activity)
    for(let second = 1; second <= 12; second++) {
        station.update({ timestamp: stamp + second * 1000, pga: null, pgv: null, level: -1 }, 0, false)
        assert.equal(station.activity, second < 12 ? activity : 0, 'Activity retains the trailing twelve-second maximum')
    }
}
const ratioStation = new PalertStation(null, 'W002', [24, 121], true)
for(let second = 0; second <= 60; second++) {
    const pga = second === 60 ? 0.5 : 0.05
    ratioStation.update({ timestamp: stamp + second * 1000, pga, pgv: null, level: getPalertLevelFromPgaPgv(pga, null) }, 0, false)
}
assert.equal(originalPalertActivity(ratioStation.recentData), 1, 'This fixture previously gained activity from the PGA ratio')
assert.equal(ratioStation.level, 6)
assert.equal(ratioStation.activity, 0.2, 'Level six grants only its level-based activity despite the high PGA ratio')
assert(!ratioStation.isPenaltyStation(), 'Level six excludes a penalty candidate')
for(let second = 61; second <= 120; second++) {
    ratioStation.update({ timestamp: stamp + second * 1000, pga: 0.05, pgv: null, level: 0 }, 0, false)
    assert.equal(ratioStation.isPenaltyStation(), second >= 70, 'Ten seconds after the boundary restores base eligibility')
}
ratioStation.update({ timestamp: stamp + 121000, pga: 0.4, pgv: null, level: 5 }, 0, false)
assert.equal(originalPalertActivity(ratioStation.recentData), 1)
assert.equal(ratioStation.activity, 0)
assert(ratioStation.isPenaltyStation(), 'The PGA ratio does not affect a quiet boundary')
assert.equal(ratioStation.nonQuietBoundaryStamp, stamp + 60000, 'A high value is remembered after it leaves recentData')
const ratioSnapshot = createPalertHypocenterUpdate([ratioStation]).inactiveStations[0]
assert.equal(ratioSnapshot.id, 'W002')
assert.equal(ratioSnapshot.nonQuietBoundaryStamp, stamp + 60000)
ratioStation.update({ timestamp: stamp + 123000, pga: 0.05, pgv: null, level: 0 }, 1, false)
assert(ratioStation.isPenaltyStation(), 'One missing second in a long quiet interval is allowed')
console.log('PASS level-only activity, twelve-second peak retention and independent penalty boundaries')

const penaltyState = station => [station.nonQuietBoundaryStamp, station.missingCountSinceBoundary,
    station.consecutiveMissingCount, station.isPenaltyStation()]
for(const length of [0, 1, 9, 10, 11, 30, 60]) {
    const station = replayPgas(Array(length).fill(0.1))
    assert.equal(station.nonQuietBoundaryStamp, length ? stamp - 1000 : null)
    assert.equal(station.isPenaltyStation(), length >= 10, 'The tenth sample is ready with the preceding-frame initial boundary')
}
for(const level of [0, 5, 6, 7, 20]) {
    const station = replayPgas(Array(20).fill(0.1))
    station.update({ timestamp: stamp + 20000, level, pga: levelPgas[level] ?? 200 }, 0, false)
    assert.equal(station.nonQuietBoundaryStamp, level > 5 ? stamp + 20000 : stamp - 1000)
    assert.equal(station.isPenaltyStation(), level <= 5)
}
for(const level of [-1, null, undefined, NaN, Infinity]) {
    const station = replayPgas(Array(19).fill(0.1))
    station.update({ timestamp: stamp + 19000, level, pga: null }, 0, false)
    assert.deepEqual(penaltyState(station), [stamp - 1000, 1, 1, true], 'Exactly five percent missing is allowed, including a missing current frame')
    const update = createPalertHypocenterUpdate([station])
    assert.equal(update.inactiveStations[0].nonQuietBoundaryStamp, stamp - 1000)
    station.update({ timestamp: stamp + 19000, level: 10, pga: 8 }, 0, false)
    station.update({ timestamp: stamp + 18000, level: 10, pga: 8 }, 0, false)
    assert.deepEqual(penaltyState(station), [stamp - 1000, 1, 1, true], 'Duplicate/out-of-order frames cannot change penalty evidence')
    feedPga(station, 0.1)
    assert.deepEqual(penaltyState(station), [stamp - 1000, 1, 0, true], 'Valid low data clears only the consecutive counter')
}
const earlyMissing = replayPgas(Array(18).fill(0.1))
feedPga(earlyMissing, null)
assert.deepEqual(penaltyState(earlyMissing), [stamp + 18000, 0, 1, false], 'One missing frame out of nineteen exceeds five percent')
for(let i = 1; i <= 10; i++) {
    feedPga(earlyMissing, 0.1)
    assert.equal(earlyMissing.isPenaltyStation(), i === 10)
}
const cumulativeMissing = replayPgas(Array(59).fill(0.1))
for(let i = 1; i <= 4; i++) {
    feedPga(cumulativeMissing, null)
    assert.equal(cumulativeMissing.missingCountSinceBoundary, i < 4 ? i : 0)
    assert.equal(cumulativeMissing.isPenaltyStation(), i < 4, 'Separated missing frames still contribute to the cumulative ratio')
    if(i < 4) feedPga(cumulativeMissing, 0.1)
}
assert.equal(cumulativeMissing.nonQuietBoundaryStamp, stamp + 65000)
const consecutiveMissing = replayPgas(Array(200).fill(0.1))
for(let i = 1; i <= 4; i++) {
    feedPga(consecutiveMissing, null)
    assert.deepEqual(penaltyState(consecutiveMissing), [i < 3 ? stamp - 1000 : consecutiveMissing.updateStamp,
        i < 3 ? i : 0, i, i < 3], 'The third and every later missing frame advance the boundary despite a low overall ratio')
}
feedPga(consecutiveMissing, 0.6)
assert.deepEqual(penaltyState(consecutiveMissing), [consecutiveMissing.updateStamp, 0, 0, false], 'A valid high value clears both counters')

// Compare omitted timestamps with explicit missing frames, including gaps beyond the history cap.
for(const missingSeconds of [0, 1, 2, 3, 8, 61, 125]) {
    for(const lastPga of [0.1, null, 0.6]) {
        const prefix = [...Array(40).fill(0.1), null]
        const explicit = replayPgas(prefix), batched = replayPgas(prefix)
        for(let i = 0; i < missingSeconds; i++) feedPga(explicit, null)
        feedPga(explicit, lastPga)
        batched.update({ timestamp: batched.updateStamp + (missingSeconds + 1) * 1000,
            pga: lastPga, level: getPalertLevelFromPgaPgv(lastPga, null) }, Math.min(missingSeconds, 60), false)
        assert.deepEqual(penaltyState(batched), penaltyState(explicit), `Gap of ${missingSeconds} seconds must match chronological missing frames`)
    }
}
const longGap = replayPgas(Array(200).fill(0.1))
const returnedStamp = longGap.updateStamp + 100001000
longGap.update({ timestamp: returnedStamp, pga: 0.1, level: 1 }, 60, false)
assert.deepEqual(penaltyState(longGap), [returnedStamp - 1000, 0, 0, false])
for(let i = 1; i <= 9; i++) {
    feedPga(longGap, 0.1)
    assert.equal(longGap.isPenaltyStation(), i === 9, 'Recovery counts the first returning valid sample')
}
for(const reset of ['clearRecentData', 'clearHistory']) {
    longGap[reset](false)
    assert.deepEqual(penaltyState(longGap), [null, 0, 0, false])
    longGap.update({ timestamp: stamp, pga: 0.1, level: 1 }, 60, false)
    assert.deepEqual(penaltyState(longGap), [stamp - 1000, 0, 0, false], 'A new timeline starts its own evidence without claiming earlier history')
}
console.log('PASS penalty initialization, ten-second readiness, five-percent boundary, three-frame gaps, timestamp gaps and resets')

const runDetection = new Function('stations', 'adjStationIds', 'triggerDiffToleranceMatrix', 'settingsStore', 'compareFloat',
    section(componentSource, 'const hasValidTriggerStamp =', 'const updateMaxShindo =') + '\nreturn detectActiveStations()')
const detectStations = (stations, adjacency, tolerances = Object.fromEntries(Object.entries(adjacency)
    .map(([id, neighbors]) => [id, Object.fromEntries(neighbors.map(neighbor => [neighbor, 2000]))])), sensitivity = 1) =>
    runDetection(stations, adjacency, tolerances, { mainSettings: { displaySeisNet: { palertSensitivity: sensitivity } } }, compareFloat)
// Existing replay cases retain their original 3.5 / 0.125 thresholds, now standard sensitivity.
for(const [sensitivity, neighborCount, activities, shouldActivate] of [
    [1, 20, [2, 1], false], [1, 20, [2, 1.5], true],
    [1, 28, [2, 1.5], true], [1, 29, [2, 1.5], false],
    [1, 36, [2, 2, ...Array(2).fill(0.2)], false], [1, 36, [2, 1.5, ...Array(5).fill(0.2)], true],
    [1, 40, [2, 2, 0.5], false], [1, 40, [2, 2, 1], true],
    [2, 20, [2, 0.5, ...Array(2).fill(0.2)], false], [2, 20, [2, 1], true],
    [2, 30, [2, 1], true], [2, 31, [2, 1], false],
    [2, 33, [2, 1, 0.2], false], [2, 33, [2, 0.5, ...Array(4).fill(0.2)], true],
    [2, 35, [2, 1, ...Array(2).fill(0.2)], false], [2, 35, [2, 0.5, ...Array(5).fill(0.2)], true],
    [2, 40, [2, 1.5], false], [2, 40, [2, 2], true],
    [3, 20, [2, ...Array(2).fill(0.2)], false], [3, 20, [2, 0.5], true],
    [3, 31, [2, 0.5], true], [3, 32, [2, 0.5], false],
    [3, 35, [2, 0.5, 0.2], false], [3, 35, [2, ...Array(4).fill(0.2)], true],
    [3, 40, [2, 0.5, ...Array(3).fill(0.2)], false], [3, 40, [2, 1, 0.2], true],
    [3, 45, [2, 1.5], false], [3, 45, [2, 1, ...Array(3).fill(0.2)], true],
    [3, 50, [2, 1.5, ...Array(2).fill(0.2)], false], [3, 50, [2, 2], true]
]) {
    const detectionStations = Object.fromEntries(Array.from({ length: neighborCount }, (_, index) => [String(index), {
        id: String(index), activity: activities[index] ?? 0, isActive: false, triggerStamp: stamp
    }]))
    const neighbors = Object.keys(detectionStations)
    const adjacency = Object.fromEntries(neighbors.map(id => [id, neighbors]))
    assert.equal(detectStations(detectionStations, adjacency, undefined, sensitivity).size,
        shouldActivate ? activities.length : 0, `Sensitivity ${sensitivity}, ${neighborCount} neighbors`)
}
for(const isActive of [false, true]) {
    const stations = { A: { id: 'A', activity: 2, level: 10, isActive, triggerStamp: stamp },
        B: { id: 'B', activity: 2, level: 10, isActive, triggerStamp: stamp } }
    assert.equal(detectStations(stations, { A: ['A', 'B'], B: ['A', 'B'] }, undefined, 0).size, 0,
        'Disabled detection neither starts nor renews an active chain')
}
{
    const stations = { A: { id: 'A', activity: 2, triggerStamp: stamp },
        B: { id: 'B', activity: 1, triggerStamp: stamp } }
    const adjacency = { A: ['A', 'B'], B: ['A', 'B'] }
    const tolerances = { A: { A: 2000, B: 2000 }, B: { A: 2000, B: 2000 } }
    const settingsStore = { mainSettings: { displaySeisNet: { palertSensitivity: 1 } } }
    for(const [sensitivity, expectedCount] of [[1, 0], [2, 2], [0, 0], [3, 2], [1, 0]]) {
        settingsStore.mainSettings.displaySeisNet.palertSensitivity = sensitivity
        assert.equal(runDetection(stations, adjacency, tolerances, settingsStore, compareFloat).size, expectedCount,
            'The next detection reads the current sensitivity without recreating stations')
    }
}
console.log('PASS all P-Alert sensitivity boundaries, disabled detection and live setting changes')

// Replay the stale-trigger reactivation case through the actual station timers and detector.
{
    let now = stamp - 8000, timerId = 0
    const timers = new Map()
    const TimedStation = new Function('settingsStore', 'markRaw', 'getShindoFromLevel', 'setTimeout', 'clearTimeout', 'compareFloat',
        section(read('src/classes/StationClasses.js'), 'export class PalertStation', 'export class TremStation')
            .replace('export ', '') + '\nreturn PalertStation;')(
        { mainSettings: { displaySeisNet: { palertLevelHold: 1 } } }, value => value, value => value,
        (callback, delay) => { const id = ++timerId; timers.set(id, { callback, due: now + delay }); return id },
        id => timers.delete(id), compareFloat
    )
    const ids = Array.from({ length: 7 }, (_, index) => `noise-${index}`)
    const stationMap = Object.fromEntries(ids.map(id => [id, new TimedStation(null, id, [24, 121], true)]))
    const adjacency = Object.fromEntries(ids.map(id => [id, ids]))
    for(let second = -8; second <= 26; second++) {
        now = stamp + second * 1000
        for(const [id, timer] of [...timers]) if(timer.due <= now) { timers.delete(id); timer.callback() }
        const pga = second === 0 ? 1 : second === 25 ? 0.6 : second === 26 ? 1.2 : 0.5
        const stations = Object.values(stationMap)
        for(const station of stations) station.update({ timestamp: now, pga, level: getPalertLevelFromPgaPgv(pga, null) }, 0, false)
        for(const station of detectStations(stationMap, adjacency)) station.setActive()
        if(second === 0) assert(stations.every(station => station.isActive && station.triggerStamp === stamp))
        if(second === 24) assert(stations.every(station => !station.isActive && station.activity === 0.2 && station.triggerStamp === null))
        if(second === 25) assert(stations.every(station => !station.isActive && station.activity === 0.5 && station.triggerStamp === null),
            'Seven weak fluctuations cannot reuse old compatible timestamps to reactivate the network')
        if(second === 26) assert(stations.every(station => station.isActive && station.triggerStamp === now),
            'Seven fresh two-times rises can activate normally after the quiet interval')
    }
}
console.log('PASS seven-station replay: initial activation, quiet expiry, no stale-trigger reactivation and fresh-trigger recovery')

for(const isActive of [false, true]) {
    for(const level of [-1, 6, 7, 8, 9, 10, 11, 20]) {
        const isolated = { id: 'solo', level, activity: 2, isActive, triggerStamp: stamp }
        const detected = detectStations({ solo: isolated }, { solo: ['solo'] })
        assert.equal(detected.has(isolated), isActive && level >= 10, 'Direct renewal requires current level ten even when activity still retains a previous peak')
        assert.equal(isolated.isActive, isActive, 'Detection leaves activation and expiry to the existing lifecycle')
    }
}
const fadingStation = new PalertStation(null, 'fading', [24, 121], true)
for(let second = -8; second < 0; second++) {
    fadingStation.update({ timestamp: stamp + second * 1000, pga: 0.2, pgv: null, level: 3 }, 0, false)
}
fadingStation.isActive = true
fadingStation.update({ timestamp: stamp, pga: 2.5, pgv: null, level: 10 }, 0, false)
const detectFadingStation = () => detectStations({ fading: fadingStation }, { fading: ['fading'] })
assert(detectFadingStation().has(fadingStation))
for(let second = 1; second <= 12; second++) {
    fadingStation.update({ timestamp: stamp + second * 1000, pga: 0.2, pgv: null, level: 3 }, 0, false)
    assert.equal(fadingStation.activity, second < 12 ? 2 : 0)
    assert(!detectFadingStation().has(fadingStation), 'A lower current frame must stop direct renewal immediately despite retained activity')
}
const renewalStations = {
    weak: { id: 'weak', level: 7, activity: 0.5, isActive: true, triggerStamp: stamp },
    strong: { id: 'strong', level: 10, activity: 2, isActive: true, triggerStamp: stamp },
    quiet: { id: 'quiet', level: 3, activity: 0, isActive: false, triggerStamp: stamp }
}
const renewalAdjacency = Object.fromEntries(Object.keys(renewalStations).map(id => [id, Object.keys(renewalStations)]))
assert.deepEqual([...detectStations(renewalStations, renewalAdjacency)].map(station => station.id).sort(), ['strong', 'weak'], 'A strong active station may still chain-activate a weaker neighbor')
const supportedStations = Object.fromEntries([1.5, 1.5, 1].map((activity, index) => [String(index), {
    id: String(index), level: 8, activity, isActive: index === 0, triggerStamp: stamp
}]))
const supportedAdjacency = Object.fromEntries(Object.keys(supportedStations).map(id => [id, Object.keys(supportedStations)]))
assert.equal(detectStations(supportedStations, supportedAdjacency).size, 3, 'An active station below level ten must still participate when the neighborhood detection threshold is met')
console.log('PASS current-level-ten self-renewal threshold, retained activity without renewal, weak-neighbor chaining and neighborhood-supported renewal')

const pair = {
    A: { id: 'A', level: 10, activity: 2, isActive: true, triggerStamp: stamp },
    B: { id: 'B', level: 7, activity: 0.5, isActive: false, triggerStamp: stamp }
}
const pairAdjacency = { A: ['A', 'B'], B: ['A', 'B'] }
const pairTolerances = { A: { A: 2000, B: 8000 }, B: { A: 8000, B: 2000 } }
for(const difference of [-8001, -8000, 8000, 8001]) {
    pair.B.triggerStamp = stamp + difference
    const detected = detectStations(pair, pairAdjacency, pairTolerances)
    assert(detected.has(pair.A))
    assert.equal(detected.has(pair.B), Math.abs(difference) <= 8000, 'Pairwise compatibility includes the boundary and rejects one millisecond beyond it')
}
pair.B.triggerStamp = stamp
assert.deepEqual([...detectStations(pair, pairAdjacency, {})].map(station => station.id), ['A'], 'A missing distance tolerance cannot propagate activation')
for(const invalid of [null, undefined, 0, -1, NaN, Infinity]) {
    pair.A.triggerStamp = invalid
    pair.B.level = 10
    pair.B.activity = 2
    assert.equal(detectStations(pair, pairAdjacency).size, 0, 'An invalid trigger cannot renew directly, seed a chain or contribute to neighborhood activity')
}
pair.A.triggerStamp = stamp
pair.A.isActive = false
pair.B.triggerStamp = stamp + 2001
assert.equal(detectStations(pair, pairAdjacency).size, 0, 'Incompatible activity cannot meet the neighborhood threshold')
pair.B.triggerStamp = stamp + 2000
assert.equal(detectStations(pair, pairAdjacency).size, 2, 'Compatible inactive stations can activate together')

const chainStations = {
    A: { id: 'A', level: 10, activity: 2, isActive: true, triggerStamp: stamp },
    B: { id: 'B', level: 7, activity: 0.5, isActive: false, triggerStamp: stamp + 2000 },
    C: { id: 'C', level: 7, activity: 0.5, isActive: false, triggerStamp: stamp + 4000 }
}
const chainAdjacency = { A: ['A', 'B'], B: ['A', 'B', 'C'], C: ['B', 'C'] }
assert.equal(detectStations(chainStations, chainAdjacency).size, 3, 'A chain compares each adjacent pair, not every station with the first seed')
chainStations.B.triggerStamp = null
assert.deepEqual([...detectStations(chainStations, chainAdjacency)].map(station => station.id), ['A'], 'An invalid trigger cannot bridge a chain')
chainStations.B.triggerStamp = stamp + 2000
chainStations.B.activity = 0
assert.deepEqual([...detectStations(chainStations, chainAdjacency)].map(station => station.id), ['A'], 'Zero activity cannot bridge a compatible chain')
const largeNeighborhood = Object.fromEntries(Array.from({ length: 50 }, (_, index) => [String(index), {
    id: String(index), level: 10, activity: 2, isActive: false,
    triggerStamp: stamp + Math.floor(index / 2) * 3000
}]))
const largeAdjacency = Object.fromEntries(Object.keys(largeNeighborhood).map(id => [id, Object.keys(largeNeighborhood)]))
assert.equal(detectStations(largeNeighborhood, largeAdjacency).size, 0, 'The 12.5-percent denominator remains the full neighborhood, not just compatible stations')
console.log('PASS activation trigger validity, pairwise tolerance boundaries, compatible-only activity, chain barriers and unchanged threshold denominator')

for(const [maxLevel, weight] of [[-1, 0], [5, 0], [6, 0.1], [7, 0.4], [8, 1.6], [9, 2.4], [10, 2.8], [11, 3.2], [12, 3.6], [13, 4], [20, 4], [NaN, 0]]) {
    assert.equal(profile.getPickBaseWeight({ maxLevel }), weight)
}
assert.notEqual(profile.parameters, nied.parameters)
assert.notEqual(profile.parameters.hypocenterSearchSteps, nied.parameters.hypocenterSearchSteps)
const { defaultWaveCountPenaltyConfig, inheritedOutlierFilterStages, waveCountPenaltySlope, penaltyFullWeight, penaltyReferenceQuantile, ...sharedParameters } = profile.parameters
assert.equal(penaltyFullWeight, 8)
assert.equal(nied.parameters.penaltyFullWeight, 10)
assert.equal(penaltyReferenceQuantile, 0.8)
assert.equal(nied.parameters.penaltyReferenceQuantile, 0.9)
assert.deepEqual(sharedParameters, Object.fromEntries(Object.entries(nied.parameters)
    .filter(([key]) => !['defaultWaveCountPenaltyConfig', 'inheritedOutlierFilterStages', 'penaltyFullWeight', 'penaltyReferenceQuantile'].includes(key))))
const expectedPenaltyConfigs = [
    { thresholdRatio: 8, maxPenalty: 2 },
    { thresholdRatio: 9, maxPenalty: 1.5 },
    { thresholdRatio: 10, maxPenalty: 1 },
    { thresholdRatio: 11, maxPenalty: 0.5 }
]
assert.equal(waveCountPenaltySlope, 0.5)
assert.deepEqual(defaultWaveCountPenaltyConfig, expectedPenaltyConfigs[0])
inheritedOutlierFilterStages.forEach((stage, index) => assert.deepEqual(stage, {
    ...nied.parameters.inheritedOutlierFilterStages[index],
    waveCountPenalty: expectedPenaltyConfigs[stage.level]
}))
const finder = new FindPalertHypocenter([], {})
// Density has a fixed inclusive 30 km radius, independent of directional links
// or a neighbor's current data/activation. Both source classes use the same policy.
for(const Finder of [FindNiedHypocenter, FindPalertHypocenter]) {
    const localNeighbors = [
        { stationId: 0, distance: 0 },
        { stationId: 1, distance: 10, isActive: false, level: -1 },
        { stationId: 2, distance: 29.999 },
        { stationId: 3, distance: 30 }
    ]
    const adjacency = { 0: [...localNeighbors,
        { stationId: 4, distance: 30.001 }, { stationId: 5, distance: 100 }, { stationId: 6, distance: 300 }],
        1: [{ stationId: 1, distance: 0 }], 2: [] }
    const weights = Object.freeze(Finder.calcStationDensityWeights(adjacency))
    assert.deepEqual(weights, { 0: 0.5, 1: 1, 2: 1 })
    assert.deepEqual(Finder.calcStationDensityWeights({ ...adjacency, 0: localNeighbors }), weights,
        'Adding distant directional neighbors cannot change density weights')
    const initialized = new Finder([], adjacency, weights)
    assert.equal(initialized.stationDensityWeights, weights)
    initialized.update([], [], [])
    assert.equal(initialized.stationDensityWeights, weights, 'Frame updates reuse the initialized table')
    const recreated = new Finder([], adjacency, weights)
    assert.equal(recreated.stationDensityWeights, weights, 'A new finder can reuse the same immutable density table')
    assert.equal(recreated.getStationDensityWeight('unknown'), 1)
    assert.deepEqual(new Finder([], adjacency).stationDensityWeights, weights, 'Direct callers retain the same density policy')
    const changed = Finder.calcStationDensityWeights({ ...adjacency, 0: localNeighbors.slice(0, 1) })
    assert.equal(changed[0], 1, 'A new station geometry receives new density weights')
}
console.log('PASS shared 30 km density boundary, self/quiet stations, remote-link independence and initialized-table reuse')
for(const config of [undefined, ...inheritedOutlierFilterStages.map(stage => stage.waveCountPenalty)]) {
    const { thresholdRatio, maxPenalty } = config ?? defaultWaveCountPenaltyConfig
    for(const [pCount, sCount, expected] of [
        [0, 0, 0], [2, 0, 0],
        [2, thresholdRatio * 2 - 1, 0], [2, thresholdRatio * 2, 0],
        [2, thresholdRatio * 2 + 1, 0.25], [2, thresholdRatio * 2 + 2, 0.5],
        [2, (thresholdRatio + maxPenalty * 2) * 2, maxPenalty],
        [2, 100, maxPenalty], [0, 100, maxPenalty]
    ]) {
        const results = [
            ...Array.from({ length: pCount }, () => ({ wave: 'P', weight: 1 })),
            ...Array.from({ length: sCount }, () => ({ wave: 'S', weight: 1 })),
            { wave: 'P', weight: 0 }, { wave: 'S', weight: 0 }, { wave: 'O', weight: 1 }
        ]
        assert.equal(finder.calcWaveCountPenalty(results, config), expected)
    }
}
const expectedPhasePenalty = (results, level = 0) => {
    const pCount = results.filter(result => result.wave === 'P' && result.weight > 0).length || 1
    const sCount = results.filter(result => result.wave === 'S' && result.weight > 0).length
    const { thresholdRatio, maxPenalty } = expectedPenaltyConfigs[level]
    return Math.min(Math.max((sCount / pCount - thresholdRatio) / 2, 0), maxPenalty)
}

// Exercise full greedy/PREV scoring with pure S, S-heavy and pure P evidence.
const phaseCenter = { lat: 24, lng: 121, depth: 30 }
for(const pCount of [0, 1, 4, 100]) {
    const phaseMap = new Map()
    const phasePicks = Array.from({ length: 100 }, (_, index) => {
        const wave = index < pCount ? 'P' : 'S'
        const latLng = [24 + index * 0.001, 121.1]
        const distance = calcDistanceKm([phaseCenter.lat, phaseCenter.lng], latLng)
        const triggerStamp = stamp + calcReachTime(tables.jma2001, wave === 'P', phaseCenter.depth, distance) * 1000 + (index % 2 ? 100 : -100)
        const pickId = `phase-${index}:${triggerStamp}`
        phaseMap.set(pickId, wave)
        return { stationId: `phase-${index}`, pickId, latLng, triggerStamp, maxLevel: 13, secondMaxLevel: 10 }
    }).sort((a, b) => a.triggerStamp - b.triggerStamp)
    for(const firstWave of ['P', 'S']) {
        for(const lastWave of ['P', 'S']) {
            const result = finder.calcScenarioLikelihood(phasePicks, phaseCenter, firstWave, lastWave, new Map())
            assert(Number.isFinite(result.score))
            assert.equal(result.waveCountPenalty, expectedPhasePenalty(result.pickResults))
        }
        const previous = finder.calcPreviousWaveScenarioLikelihoods(phasePicks, phaseCenter, firstWave, new Map(), phaseMap)
        assert.deepEqual(previous.map(result => result.filterStageLevel), [3, 2, 1, 0])
        for(const result of previous) {
            assert.equal(result.effectivePickCount, 100)
            const penalty = expectedPhasePenalty(result.pickResults, result.filterStageLevel)
            assert.equal(result.waveCountPenalty, penalty)
            assert.equal(result.score, result.rmse + penalty, 'Every PREV stage must use its P/S penalty configuration')
        }
    }
}
console.log('PASS P/S penalty thresholds, half-rate slope, caps and greedy/PREV scoring')

assert(finder.hasValidPickCandidate({ stationId: 'W460', triggerStamp: stamp, pickId: `W460:${stamp}` }))
assert(!finder.hasValidPickCandidate({ stationId: 460, triggerStamp: stamp, pickId: `460:${stamp}` }))
assert.equal(finder.getPickWeight({ maxLevel: 13, densityWeight: 0.25 }, 0.5), 0.5)
const pick = { stationId: 'W460', pickId: `W460:${stamp}`, latLng: [24, 121], triggerStamp: stamp, updateStamp: stamp, maxLevel: 12, secondMaxLevel: 8 }
finder.upsertPickCandidate(pick)
const stored = finder.picks.get(pick.pickId)
assert(!finder.isPenaltyReferencePick(stored))
finder.clusters[0].dirty = false
finder.updatePickSnapshot(stored, { ...pick, secondMaxLevel: 9, updateStamp: stamp + 1000 })
assert(finder.clusters[0].dirty, 'Second maximum alone changes reference qualification and must invalidate the fit')
assert(finder.isPenaltyReferencePick(stored))
const quietSnapshot = { id: 'W460', latLng: [24, 121], updateStamp: stamp + 12000, nonQuietBoundaryStamp: stamp + 1000 }
const penaltyContext = [{ stationId: 'other', triggerStamp: stamp + 2000 }]
finder.update([], [quietSnapshot], [{ id: 'W460', triggerStamp: null, updateStamp: stamp + 2000 }])
assert.equal(finder.picks.get(pick.pickId), stored, 'Invalid current trigger preserves accepted evidence')
assert.equal(finder.getPickWeight(stored), 3.6)
assert.deepEqual(finder.getInactivePenaltyCandidates(penaltyContext), [quietSnapshot], 'A retained pick from an older event does not globally exclude a quiet station')
assert.deepEqual(finder.getInactivePenaltyCandidates([pick]), [], 'A station does not penalize its own cluster')
assert.deepEqual(finder.getInactivePenaltyCandidates([]), [], 'No cluster start means no penalty evidence')
finder.update([], [quietSnapshot], [])
assert.equal(finder.picks.size, 0)
assert.deepEqual(finder.getInactivePenaltyCandidates(penaltyContext), [quietSnapshot], 'Old-pick cleanup does not change the boundary-based decision')

const quietSnapshots = [
    { id: 'before', nonQuietBoundaryStamp: stamp - 1000 },
    { id: 'equal', nonQuietBoundaryStamp: stamp },
    { id: 'after', nonQuietBoundaryStamp: stamp + 1000 },
    { id: 'unknown', nonQuietBoundaryStamp: null }
].map(station => ({ ...station, latLng: [24, 121], updateStamp: stamp + 20000 }))
const boundaryFinder = new FindPalertHypocenter(quietSnapshots, {})
const makeBoundaryPick = (stationId, triggerStamp) => ({ ...pick, stationId, triggerStamp, pickId: `${stationId}:${triggerStamp}` })
const earlyCluster = boundaryFinder.createCluster([makeBoundaryPick('early', stamp)])
const lateCluster = boundaryFinder.createCluster([makeBoundaryPick('late', stamp + 2000)])
const penaltyIds = picks => boundaryFinder.getInactivePenaltyCandidates(picks).map(station => station.id)
assert.deepEqual(penaltyIds(earlyCluster.picks), ['before'])
assert.deepEqual(penaltyIds(lateCluster.picks), ['before', 'equal', 'after'])
assert.strictEqual(boundaryFinder.getInactivePenaltyCandidates(earlyCluster.picks),
    boundaryFinder.getInactivePenaltyCandidates(earlyCluster.picks), 'Search points share the candidate list within the same batch')
boundaryFinder.addPickToCluster(makeBoundaryPick('earlier', stamp), lateCluster)
assert.deepEqual(penaltyIds(lateCluster.picks), ['before'], 'Adding an earlier pick invalidates the cache for the same array')
const mergedCluster = boundaryFinder.mergeAdjacentClusters(makeBoundaryPick('bridge', stamp + 500), [earlyCluster, lateCluster])
assert.deepEqual(penaltyIds(mergedCluster.picks), ['before'], 'Merging clusters uses the earliest owned trigger')
mergedCluster.dirty = false
const originalVersion = boundaryFinder.inactiveStationsVersion
const originalUpdates = mergedCluster.updates
const refreshedSnapshots = quietSnapshots.map(station => ({ ...station, updateStamp: station.updateStamp + 1000 }))
boundaryFinder.updateVersion++
boundaryFinder.setInactiveStations(refreshedSnapshots)
assert.equal(boundaryFinder.inactiveStationsVersion, originalVersion)
assert.equal(mergedCluster.dirty, false)
assert.equal(mergedCluster.updates, originalUpdates, 'Advancing only updateStamp does not schedule another fit')
assert.equal(boundaryFinder.getInactivePenaltyCandidates(mergedCluster.picks)[0].updateStamp, stamp + 21000)
boundaryFinder.setInactiveStations(refreshedSnapshots.map(station => station.id === 'before'
    ? { ...station, nonQuietBoundaryStamp: stamp } : station))
assert.equal(boundaryFinder.inactiveStationsVersion, originalVersion + 1)
assert(mergedCluster.dirty, 'A changed boundary with the same station IDs invalidates the fit')
assert.equal(mergedCluster.updates, originalUpdates + 1)
assert.deepEqual(penaltyIds(mergedCluster.picks), [])
boundaryFinder.setInactiveStations(refreshedSnapshots.filter(station => station.id !== 'after'))
assert.deepEqual(penaltyIds(mergedCluster.picks), ['before'], 'Replacing the eligible set refreshes candidate membership')
const snapshotUpdate = { activeStations: [], pickCandidates: [], inactiveStations: quietSnapshots }
assert.deepEqual(mergePalertHypocenterUpdates(snapshotUpdate, { ...snapshotUpdate, inactiveStations: [] }).inactiveStations, [])
assert.deepEqual(mergePalertHypocenterUpdates(snapshotUpdate, { ...snapshotUpdate, inactiveStations: refreshedSnapshots }).inactiveStations, refreshedSnapshots)

// Exercise the actual scenario search and duplicate-pick refit with one shared cluster context.
const contextCenter = { lat: 24, lng: 121, depth: 10 }
const contextPicks = Array.from({ length: 6 }, (_, i) => {
    const latLng = [24 + i * 0.025, 121 + (i % 2) * 0.03]
    const distance = calcDistanceKm([24, 121], latLng)
    const triggerStamp = stamp + calcReachTime(tables.jma2001, true, 10, distance) * 1000
    return { ...makeBoundaryPick(`context-${i}`, triggerStamp), latLng, maxLevel: 12, secondMaxLevel: 10 }
})
const firstContextPick = contextPicks[0]
const earliestContextPick = { ...firstContextPick, triggerStamp: firstContextPick.triggerStamp - 2000, maxLevel: 7, secondMaxLevel: 7 }
earliestContextPick.pickId = `${earliestContextPick.stationId}:${earliestContextPick.triggerStamp}`
const extraContextPick = { ...firstContextPick, triggerStamp: firstContextPick.triggerStamp + 1000 }
extraContextPick.pickId = `${extraContextPick.stationId}:${extraContextPick.triggerStamp}`
contextPicks.unshift(earliestContextPick, extraContextPick)
const contextFinder = new FindPalertHypocenter([
    { id: 'quiet-before', latLng: [26, 121], updateStamp: stamp + 30000, nonQuietBoundaryStamp: earliestContextPick.triggerStamp - 1 },
    { id: 'quiet-between', latLng: [26, 121], updateStamp: stamp + 30000, nonQuietBoundaryStamp: earliestContextPick.triggerStamp + 1 }
], {})
const originalScenarioResult = contextFinder.createScenarioLikelihoodResult
const contexts = new Set(), contextCandidates = new Set(), scenarios = new Set()
contextFinder.createScenarioLikelihoodResult = function(...args) {
    const context = args[8]
    contexts.add(context)
    contextCandidates.add(this.getInactivePenaltyCandidates(context.picks))
    scenarios.add(args[4])
    return originalScenarioResult.apply(this, args)
}
const contextResult = contextFinder.findBestHypocenterWithEffectivePicks(contextPicks, contextCenter, null)
assert.equal(contextResult.inferenceFilterStageLevels.length, 2, 'The scenario must exercise both classification and duplicate refit')
assert(contextResult.pickResults.some(item => item.excludedReason === 'duplicate-phase'))
assert.equal(contexts.size, 1)
assert.strictEqual([...contexts][0].picks, contextPicks)
assert.equal(contextCandidates.size, 1)
assert.deepEqual([...contextCandidates][0].map(station => station.id), ['quiet-before'])
assert.equal(scenarios.size, 4, 'PP, PS, SP and SS use the same candidate evidence')
console.log('PASS cluster-specific boundaries, old-pick independence, merge/cache invalidation, fresh snapshots and shared scenario/refit evidence')

const refs = new FindPalertHypocenter([], {})
refs.getOptionCacheEntry = pick => ({ distance: pick.distance })
const candidates = [10, 20, 30, 40].map((distance, i) => ({ stationId: `W${i}`, distance, maxLevel: 12, secondMaxLevel: 9 }))
assert.equal(refs.getInactivePenaltyReferenceDistance([...candidates, { ...candidates[0] }], {}, new Map()), 30)
const tenReferences = Array.from({ length: 10 }, (_, i) => ({ stationId: `W${i}`, distance: (i + 1) * 10, maxLevel: 12, secondMaxLevel: 9, maxAscend: 3 }))
const niedRefs = new FindNiedHypocenter([], {})
niedRefs.getOptionCacheEntry = refs.getOptionCacheEntry
assert.equal(refs.getInactivePenaltyReferenceDistance([...tenReferences, { ...tenReferences[0] }], {}, new Map()), 80)
assert.equal(niedRefs.getInactivePenaltyReferenceDistance(tenReferences, {}, new Map()), 90)
const weak = candidates.map(pick => ({ ...pick, secondMaxLevel: 8 }))
assert.equal(refs.getInactivePenaltyReferenceDistance(weak, {}, new Map()), 10)
const noDistances = [{ secondMaxLevel: 9, maxLevel: 14 }, { secondMaxLevel: 10, maxLevel: 12 }]
assert.equal(refs.selectFallbackPenaltyReferencePick(noDistances, {}, new Map()), noDistances[1])
const noSeconds = [{ secondMaxLevel: -1, maxLevel: 12 }, { secondMaxLevel: -1, maxLevel: 14 }]
assert.equal(refs.selectFallbackPenaltyReferencePick(noSeconds, {}, new Map()), noSeconds[1])
const noMetrics = [{}, {}]
assert.equal(refs.selectFallbackPenaltyReferencePick(noMetrics, {}, new Map()), noMetrics[0])
assert.equal(refs.getInactivePenaltyReferenceDistance(noDistances, {}, new Map()), null)
assert.equal(refs.calcInactiveStationPenalty({}, noDistances, new Map()).penalty, 0)
assert.equal(refs.selectFallbackPenaltyReferencePick([weak[0], { ...weak[0], maxLevel: 20 }], {}, new Map()), weak[0])
const effective = (maxLevel, residual, pickId) => ({ item: { pick: { maxLevel, pickId } }, residual })
assert(finder.isPreferredEffectivePick(effective(12, 100, 'b'), effective(10, 0, 'a')))
assert(!finder.isPreferredEffectivePick(effective(12, 2000, 'b'), effective(10, 0, 'a')))
console.log('PASS base weights, profile isolation, reference selection, second-peak invalidation and pick lifecycle')

const updateFor = pick => ({ pickCandidates: [pick], activeStations: [{ ...pick, id: pick.stationId }], inactiveStations: [] })
const merged = mergePalertHypocenterUpdates(updateFor(pick), updateFor({ ...pick, updateStamp: stamp + 1000, secondMaxLevel: 10 }))
assert.equal(merged.pickCandidates.length, 1)
assert.equal(merged.pickCandidates[0].secondMaxLevel, 10)
assert.deepEqual(mergePalertHypocenterUpdates(merged, merged), merged, 'Cumulative updates are idempotent')
const invalidUpdate = { pickCandidates: [], activeStations: [{ id: 'W460', triggerStamp: null }], inactiveStations: [] }
const retained = mergePalertHypocenterUpdates(merged, invalidUpdate)
assert.equal(retained.pickCandidates.length, 1)
assert.equal(retained.activeStations[0].triggerStamp, null)
const newPick = { ...pick, triggerStamp: stamp + 20000, pickId: `W460:${stamp + 20000}`, maxLevel: 8, secondMaxLevel: -1 }
const twoPicks = mergePalertHypocenterUpdates(merged, updateFor(newPick))
assert.equal(twoPicks.pickCandidates.length, 2)
assert.equal(twoPicks.activeStations[0].maxLevel, 8)
const workers = []
const received = []
let clearCount = 0
// Exercise the scheduling functions now owned by PalertNet.vue, with only the Worker boundary mocked.
globalThis.__palertClientDeps = {
    Worker: class {
        constructor() { this.messages = []; workers.push(this) }
        postMessage(message) { this.messages.push(message) }
        terminate() { this.terminated = true }
    },
    renderInferredHypocenters: results => received.push(results),
    clearInferredHypocenters: () => { clearCount++ },
    isHypocenterEnabled: { value: true }
}
const clientSource = `import { mergePalertHypocenterUpdates } from '@/utils/PalertHypocenterUpdates';
const { Worker, renderInferredHypocenters, clearInferredHypocenters, isHypocenterEnabled } = globalThis.__palertClientDeps;
let hypocenterWorker = null, hypocenterRequestId = 0, inFlightHypocenterRequestId = null, pendingHypocenterUpdate = null;
const adjStations4Hypo = {};
${section(componentSource, 'const getHypocenterWorker =', 'const clearInferredHypocenters =')}
export { updateInferredHypocentersInWorker as update, resetHypocenterWorker as reset, terminateHypocenterWorker as terminate };`
const client = await load('src/components/components/test-palert-client.js', clientSource.replace('import.meta.url', JSON.stringify(new URL('../../../src/components/components/PalertNet.vue', import.meta.url).href)))
client.update(updateFor(pick)); client.update(merged)
assert.equal(workers[0].messages.length, 2)
workers[0].onmessage({ data: { requestId: workers[0].messages[1].requestId, results: ['first'] } })
assert.equal(workers[0].messages[2].pickCandidates[0].secondMaxLevel, 10)
const oldRequest = workers[0].messages[2].requestId
client.reset(); client.update(updateFor(newPick))
workers[0].onmessage({ data: { requestId: oldRequest, results: ['stale'] } })
assert(!received.some(result => result.includes('stale')))
assert.equal(workers.length, 1, 'Reset reuses the Worker')
assert(!workers[0].terminated)
const resetMessage = workers[0].messages.find(message => message.type === 'reset')
workers[0].onmessage({ data: { requestId: resetMessage.requestId, results: ['reset-ack'] } })
assert(!received.some(result => result.includes('reset-ack')), 'Reset acknowledgement cannot replace a newer result')
client.update({ pickCandidates: [], activeStations: [], inactiveStations: [] })
assert(!workers[0].terminated, 'An inactive frame resets the finder without destroying its Worker')
assert.equal(clearCount, 1)
client.terminate(); client.update(updateFor(newPick))
assert(workers[0].terminated)
assert.equal(workers.length, 2)
const currentRequest = workers[1].messages[1].requestId
workers[0].onmessage({ data: { requestId: currentRequest, results: ['old-worker'] } })
assert(!received.some(result => result.includes('old-worker')))
workers[1].onmessage({ data: { requestId: currentRequest, results: ['current'] } })
assert.deepEqual(received.at(-1), ['current'])
client.terminate()
delete globalThis.__palertClientDeps
console.log('PASS update merging, Worker reuse, reset acknowledgements, termination and stale-result rejection')

// Exercise NIED's production client with late callbacks from a replaced Worker.
const niedWorkers = [], niedReceived = [], niedErrors = []
let niedClearCount = 0
globalThis.__niedClientDeps = {
    Worker: class {
        constructor() { this.messages = []; niedWorkers.push(this) }
        postMessage(message) { this.messages.push(message) }
        terminate() { this.terminated = true }
    },
    renderInferredHypocenters: results => niedReceived.push(results),
    clearInferredHypocenters: () => niedClearCount++,
    console: { error: error => niedErrors.push(error) }
}
const niedClientSource = `import { mergeNiedHypocenterUpdates } from '@/utils/NiedHypocenterUpdates';
const { Worker, renderInferredHypocenters, clearInferredHypocenters, console } = globalThis.__niedClientDeps;
let hypocenterWorker = null, hypocenterRequestId = 0, inFlightHypocenterRequestId = null, pendingHypocenterUpdate = null;
const adjStations4Hypo = {}, isNiedHypoInfEnabled = () => true;
${section(niedComponentSource, 'const getHypocenterWorker =', 'const getPickDisplayWave =')}
export { updateInferredHypocentersInWorker as update, resetHypocenterWorker as reset, terminateHypocenterWorker as terminate };`
const niedClient = await load('src/components/components/test-nied-client.js', niedClientSource.replace('import.meta.url', JSON.stringify(new URL('../../../src/components/components/NiedNet.vue', import.meta.url).href)))
const niedStation = { id: 0, latLng: [35, 139], triggerStamp: stamp, updateStamp: stamp, ascend: 3, level: 8, isActive: true }
const sendNiedUpdate = station => niedClient.update([station], [station], new Set())
sendNiedUpdate(niedStation)
sendNiedUpdate({ ...niedStation, ascend: 4, updateStamp: stamp + 1000 })
assert.equal(niedWorkers[0].messages.length, 2, 'An in-flight NIED request retains subsequent updates')
niedWorkers[0].onmessage({ data: { requestId: niedWorkers[0].messages[1].requestId, results: ['first'] } })
assert.equal(niedWorkers[0].messages[2].pickCandidates[0].ascend, 4)
const staleNiedRequest = niedWorkers[0].messages[2].requestId
niedClient.reset()
const niedResetMessage = niedWorkers[0].messages.at(-1)
sendNiedUpdate(niedStation)
niedWorkers[0].onmessage({ data: { requestId: staleNiedRequest, results: ['stale'] } })
niedWorkers[0].onmessage({ data: { requestId: niedResetMessage.requestId, results: ['reset'] } })
assert.deepEqual(niedReceived, [['first']])
assert.equal(niedWorkers.length, 1, 'NIED reset reuses the Worker')
niedClient.terminate()
sendNiedUpdate(niedStation)
const newNiedWorker = niedWorkers[1]
const newNiedRequest = newNiedWorker.messages[1].requestId
niedWorkers[0].onmessage({ data: { requestId: newNiedRequest, results: ['old-worker'] } })
niedWorkers[0].onerror(new Error('late old-worker error'))
assert.deepEqual(niedReceived, [['first']])
assert(!newNiedWorker.terminated)
assert.equal(niedClearCount, 0)
newNiedWorker.onmessage({ data: { requestId: newNiedRequest, results: ['current'] } })
assert.deepEqual(niedReceived.at(-1), ['current'])
newNiedWorker.onerror(new Error('current worker error'))
assert(newNiedWorker.terminated)
assert.equal(niedClearCount, 1, 'A current NIED Worker error immediately clears the displayed inference')
assert.equal(niedErrors.length, 1)
sendNiedUpdate(niedStation)
assert.equal(niedWorkers.length, 3, 'The next frame recreates the failed NIED Worker')
niedClient.terminate()
delete globalThis.__niedClientDeps
console.log('PASS NIED Worker update queue, reset reuse, stale results/errors, error cleanup and restart')

const { reactive, ref, computed, watch, nextTick, effectScope } = require('vue')

// Verify all three production delay bindings react to the shared runtime state and map reset.
for(const name of ['Palert', 'Nied', 'Trem']) {
    const source = name === 'Palert' ? componentSource : name === 'Nied' ? niedComponentSource : tremComponentSource
    const statusStore = reactive({ seisNetReplayDelay: 0 })
    const scope = effectScope()
    let switches = 0
    try {
        const delay = scope.run(() => new Function('statusStore', 'ref', 'computed', 'watch', 'scheduleTimelineSwitch', `
            let unwatchDelay, delayInterval;
            const setInterval = () => 1, clearInterval = () => {};
            ${name === 'Nied'
                ? section(source, 'const defaultDelay =', 'const niedMaxShindo =') +
                    section(source, 'unwatchDelay = watch(', 'watch(() => settingsStore.mainSettings.displaySeisNet.httpDataPriority')
                : section(source, 'const delay = computed', '\n') + '\n' +
                    section(source, 'unwatchDelay = watch(delay, scheduleTimelineSwitch)', '\n')}
            return delay;
        `)(statusStore, ref, computed, watch, () => switches++))
        const realtimeDelay = delay.value
        statusStore.seisNetReplayDelay = 2.5
        await nextTick()
        assert.equal(delay.value, 150000, `${name} converts runtime replay minutes to milliseconds`)
        assert.equal(switches, 1, `${name} switches its timeline on replay changes`)
        const reset = new Function('statusStore', section(read('src/components/MainMapComponent.vue'),
            'const resetSeisNetDelay =', 'const tempEqlists =') + '\nreturn resetSeisNetDelay;')(statusStore)
        reset()
        await nextTick()
        assert.equal(statusStore.seisNetReplayDelay, 0)
        assert.equal(delay.value, realtimeDelay, `${name} returns to its original realtime delay`)
        assert.equal(switches, 2, `${name} switches its timeline on map reset`)
    }
    finally {
        scope.stop()
    }
}
console.log('PASS NIED/P-Alert/TREM runtime replay bindings, minute conversion, timeline switching and map reset')
// Run the production reminder computation and watcher without producing real sounds or notifications.
const alertStations = reactive({
    active: new PalertStation(null, 'active', [24, 121], true),
    inactive: new PalertStation(null, 'inactive', [24, 121], true)
})
alertStations.inactive.update({ timestamp: stamp, pga: 200, pgv: 150, level: 20 }, 0, false)
const alertSounds = [], alertNotifications = []
let alertFocusCount = 0, alertListCount = 0
const alertScope = effectScope()
const alertModel = alertScope.run(() => new Function('stations', 'computed', 'watch', 'settingsStore',
    'playSound', 'sendMyNotification', 'focusWindow', 'handleTempEqlists', 'iconUrls', `
        ${section(componentSource, 'const activeStations = computed', 'const normalizeMeasurement =')}
        ${section(componentSource, 'let shake1Notified =', 'onBeforeUnmount(')}
        return { activeLevels, currentMaxShindo };
    `)(alertStations, computed, watch, { mainSettings: { onShake: { sound: true, notification: true, focus: true } } },
        sound => alertSounds.push(sound), (...args) => alertNotifications.push(args),
        () => alertFocusCount++, () => alertListCount++, { caution: 'caution', warn: 'warn' }))
assert.equal(alertModel.currentMaxShindo.value, -1, 'Inactive stations do not contribute their historical peaks')
alertStations.active.isActive = true
for(const [second, level] of [10, 8, 10, 8, 10, 12].entries()) {
    alertStations.active.update({ timestamp: stamp + second * 1000, pga: 1, pgv: null, level }, 0, false)
    await nextTick()
    assert.equal(alertStations.active.holdLevel, level, 'Realtime display still follows the current sample')
    assert.equal(alertStations.active.recentMaxLevel, second < 5 ? 10 : 12)
}
assert.deepEqual(alertSounds, ['shindo2', 'shindo3'], 'Lower frames followed by the same peak cannot repeat a sound within the window')
assert.equal(alertNotifications.length, 1)
assert.equal(alertFocusCount, 1)
assert.equal(alertListCount, 2)
alertStations.active.holdLevel = 20
await nextTick()
assert.deepEqual(alertModel.activeLevels.value, [20])
assert.equal(alertModel.currentMaxShindo.value, 3, 'Changing the display hold level does not change reminder intensity')
assert.deepEqual(alertSounds, ['shindo2', 'shindo3'])
for(let second = 6; second <= 64; second++) {
    alertStations.active.update({ timestamp: stamp + second * 1000, pga: 1, pgv: null, level: 8 }, 0, false)
    await nextTick()
}
assert.equal(alertStations.active.recentMaxLevel, 12, 'The peak remains at an age of 59 seconds')
alertStations.active.update({ timestamp: stamp + 65000, pga: 1, pgv: null, level: 8 }, 0, false)
await nextTick()
assert.equal(alertStations.active.recentMaxLevel, 8, 'The peak expires at an age of 60 seconds')
assert.deepEqual(alertSounds, ['shindo2', 'shindo3'])
alertStations.active.update({ timestamp: stamp + 66000, pga: 2.5, pgv: null, level: 10 }, 0, false)
await nextTick()
assert.deepEqual(alertSounds, ['shindo2', 'shindo3', 'shindo2'], 'A later rise after peak expiry follows the existing reminder behavior')
assert.equal(alertNotifications.length, 2)
assert.equal(alertFocusCount, 2)
alertStations.active.clearRecentData()
await nextTick()
assert.equal(alertModel.currentMaxShindo.value, -1)
alertScope.stop()
const peakGapStation = new PalertStation(null, 'gap', [24, 121], true)
peakGapStation.update({ timestamp: stamp, pga: 2.5, pgv: null, level: 10 }, 0, false)
peakGapStation.update({ timestamp: stamp + 59000, pga: null, pgv: null, level: -1 }, 58, false)
assert.equal(peakGapStation.recentMaxLevel, 10, 'Missing samples do not erase a valid peak still inside the window')
peakGapStation.update({ timestamp: stamp + 60000, pga: null, pgv: null, level: -1 }, 0, false)
assert.equal(peakGapStation.recentMaxLevel, -1, 'An all-missing window has no alert peak')
console.log('PASS sixty-second reminder peaks, realtime display independence, rising-edge actions, missing data and history reset')

// Use actual Vue scheduling and the production frame entry to check that activation expiry cannot submit work.
const frameStations = reactive(Object.fromEntries(['A', 'B'].map(id => [id, new PalertStation(null, id, [24, 121], true)])))
const frameUpdates = []
const enabled = ref(false)
globalThis.__palertFrameDeps = {
    stations: frameStations, isHypocenterEnabled: enabled, watch,
    document: { visibilityState: 'hidden' },
    palertUpdateTime: ref(null), useStationCanvasRenderer: ref(true),
    detectActiveStations: () => detectStations(frameStations, { A: ['A', 'B'], B: ['A', 'B'] }),
    updateMaxShindo() {}, renderAll() {},
    terminateHypocenterWorker() {}, clearInferredHypocenters() {},
    updateInferredHypocentersInWorker: update => frameUpdates.push(update)
}
const frameSource = `import { createPalertHypocenterUpdate } from '@/utils/PalertHypocenterUpdates';
import { getPalertLevelFromPgaPgv, stampToTime } from '@/utils/Utils';
const { stations, isHypocenterEnabled, watch, document, palertUpdateTime, useStationCanvasRenderer,
    detectActiveStations, updateMaxShindo, renderAll, terminateHypocenterWorker, clearInferredHypocenters,
    updateInferredHypocentersInWorker } = globalThis.__palertFrameDeps;
let stopped = false, requestGeneration = 0, pendingTimelineSwitch = false, latestFrameStamp = null, pendingRender = false;
${section(componentSource, 'const normalizeMeasurement =', 'const parseTimestamp =')}
${section(componentSource, 'const commitFrame =', 'const getHypocenterWorker =')}
const stopWatch = ${section(componentSource, 'watch(isHypocenterEnabled,', 'watch(() => statusStore.isActive.cwaEew')}
export { commitFrame, stopWatch };`
const frameLoop = await load('src/components/components/test-palert-frame-loop.js', frameSource)
for(let second = -8; second < 0; second++) {
    frameLoop.commitFrame(stamp + second * 1000, { A: 0.2, B: 0.2 }, null, 0)
}
assert(Object.values(frameStations).every(station => !station.isActive && station.triggerStamp === null))
frameLoop.commitFrame(stamp, { A: 2.5, B: 2.5 }, null, 0)
assert(Object.values(frameStations).every(station => station.isActive && station.triggerStamp === stamp), 'Both inactive stations compute triggers before same-frame activation, even with inference disabled')
assert.equal(frameUpdates.length, 0, 'Computing triggers and activating stations does not bypass the inference setting')

enabled.value = true
await nextTick()
assert.equal(frameUpdates.length, 0, 'Enabling inference waits for a new frame')
frameLoop.commitFrame(stamp + 1000, { A: 8, B: 8 }, null, 0)
assert.equal(frameUpdates.length, 1)
assert.equal(frameUpdates[0].pickCandidates.length, 2)
assert(frameUpdates[0].pickCandidates.every(pick => pick.triggerStamp === stamp))
for(const station of Object.values(frameStations)) {
    clearTimeout(station.activeTimer)
    await new Promise(resolve => setTimeout(() => { station.isActive = false; resolve() }, 0))
    await nextTick()
    assert.equal(frameUpdates.length, 1, 'Separate expiry callbacks must not submit inference')
}
frameLoop.commitFrame(stamp + 1000, { A: 0.2, B: 0.2 }, null, 0)
assert.equal(frameUpdates.length, 1, 'Repeated frame timestamps are ignored')
frameLoop.commitFrame(stamp + 8000, { A: 0.2, B: 0.2 }, null, 0)
assert.equal(frameUpdates.length, 2)
assert.equal(frameUpdates[1].activeStations.length, 2, 'Seven unchanged time points retain compatible picks for activation')
assert(Object.values(frameStations).every(station => station.triggerStamp === stamp && station.activity > 0))
frameLoop.commitFrame(stamp + 10000, { A: 2.5, B: 2.5 }, null, 0)
assert.equal(frameUpdates[2].pickCandidates.length, 2)
assert(frameUpdates[2].pickCandidates.every(pick => pick.triggerStamp === stamp && pick.updateStamp === stamp + 9000),
    'The eighth unchanged time point in a gap closes the old picks and sends their final snapshots')
assert(frameUpdates[2].activeStations.every(station => station.triggerStamp === null))
assert(Object.values(frameStations).every(station => station.triggerStamp === null && station.activity > 0),
    'Returning peaks without complete background cannot reopen closed picks despite retained activity')
for(const station of Object.values(frameStations)) { clearTimeout(station.activeTimer); station.isActive = false }
frameLoop.commitFrame(stamp + 25000, { A: 2.5, B: 2.5 }, null, 0)
assert.equal(frameUpdates[3].pickCandidates.length, 0)
assert.equal(frameUpdates[3].activeStations.length, 0, 'A gap spanning zero activity prevents reactivation using pre-gap triggers')
assert(Object.values(frameStations).every(station => station.triggerStamp === null && station.activity > 0))
enabled.value = false
await nextTick()
frameLoop.stopWatch()
delete globalThis.__palertFrameDeps
console.log('PASS trigger-before-activation with inference disabled, active-only pick submission, frame-only inference, deferred enable, activation expiry and missing-data cleanup')

// Preserve every local neighbor, and fill sparse inference directions to three within 100 km.
globalThis.__palertAdjStations = Object.fromEntries(Object.entries({
    center: [0, 0], northLocal: [0.1, 0], northSecond: [0.2, 0], northFar: [0.5, 0], northExtra: [0.6, 0],
    east: [0, 0.5], eastSecond: [0, 0.6], eastThird: [0, 0.7], eastExtra: [0, 0.8],
    south: [-0.05, 0], southSecond: [-0.1, 0], southThird: [-0.15, 0], southFourth: [-0.2, 0], southFar: [-0.5, 0],
    west: [0, -0.89], westOutside: [0, -0.91]
}).map(([id, latLng]) => [id, { id, latLng }]))
const adjacencySource = `import { calcDistanceKm, calcBearingDeg } from '@/utils/Utils';
const stations = globalThis.__palertAdjStations;
${section(componentSource, 'const bearingDirections =', 'const isHypocenterEnabled =')}
${section(componentSource, 'const calcBearingDirection =', 'const clearTimelineState =')}
export { buildAdjStations };`
const { buildAdjStations } = await load('src/components/components/test-palert-adjacency.js', adjacencySource)
const directional = buildAdjStations()
const localStationIds = ['center', 'northLocal', 'northSecond', 'south', 'southSecond', 'southThird', 'southFourth']
assert.deepEqual(directional.detectionAdjStations.center.toSorted(), localStationIds.toSorted())
assert.equal(directional.triggerDiffTolerances.center.center, 2000)
assert.equal(directional.triggerDiffTolerances.center.northLocal, calcDistanceKm([0, 0], [0.1, 0]) / 3.5 * 1000 + 2000)
assert.equal(directional.triggerDiffTolerances.center.northLocal, directional.triggerDiffTolerances.northLocal.center)
assert.deepEqual(Object.keys(directional.triggerDiffTolerances.center), directional.detectionAdjStations.center, 'Only activation-neighbor tolerances are stored')
assert.deepEqual(directional.hypocenterAdjStations.center.map(station => station.stationId).toSorted(),
    [...localStationIds, 'northFar', 'east', 'eastSecond', 'eastThird', 'west'].toSorted(),
    'Two local north stations need one distant link; empty east needs three; four local south stations all remain; west can stay below three')
assert(directional.hypocenterAdjStations.center.every(station => station.distance <= 100))
const densityWithDirectionalLinks = FindPalertHypocenter.calcStationDensityWeights(directional.hypocenterAdjStations).center
assert.equal(densityWithDirectionalLinks, 1 / Math.sqrt(localStationIds.length), 'Directional supplements do not change density')
delete globalThis.__palertAdjStations.west
assert(!buildAdjStations().hypocenterAdjStations.center.some(station => station.stationId === 'westOutside'))
delete globalThis.__palertAdjStations
// Use controlled distances to check the inclusive bound without spherical floating-point rounding.
const boundaryStations = Object.fromEntries([['center', 0], ['atLimit', 100], ['outsideLimit', 100.001]].map(([id, distance]) =>
    [id, { id, latLng: [distance, 0] }]))
const buildControlledAdjacency = new Function('stations', 'calcDistanceKm', 'calcBearingDeg', `
    ${section(componentSource, 'const bearingDirections =', 'const isHypocenterEnabled =')}
    ${section(componentSource, 'const calcBearingDirection =', 'const clearTimelineState =')}
    return buildAdjStations();`)
const controlledAdjacency = stations => buildControlledAdjacency(stations,
    ([from], [to]) => Math.abs(to - from), ([from], [to]) => to >= from ? 0 : 180)
const boundaryAdjacency = controlledAdjacency(boundaryStations)
assert.deepEqual(boundaryAdjacency.hypocenterAdjStations.center.map(station => station.stationId), ['center', 'atLimit'])
console.log('PASS dense activation neighborhoods, unchanged density, three nearest inference neighbors per direction and inclusive 100 km boundary')

for(const [description, entries, expected] of [
    ['isolated station retains itself', [['center', 0]], ['center']],
    ['includes 40 km and stops when fewer than four are available',
        [['center', 0], ['at40', 40], ['outside40', 40.001], ['near', 35]], ['center', 'near', 'at40']],
    ['selects only the three nearest supplements',
        [['center', 0], ['far', 39], ['middle', 35], ['nearest', 31], ['third', 38]], ['center', 'nearest', 'middle', 'third']],
    ['counts self and the inclusive 30 km edge before filling one slot',
        [['center', 0], ['at30', 30], ['local', 10], ['nearest', 35], ['extra', 36]], ['center', 'local', 'at30', 'nearest']],
    ['does not supplement an existing four-station neighborhood',
        [['center', 0], ['one', 5], ['two', 10], ['three', 15], ['outside', 35]], ['center', 'one', 'two', 'three']],
    ['keeps every local station when more than four are present',
        [['center', 0], ['one', 5], ['two', 10], ['three', 15], ['four', 20], ['at30', 30], ['outside', 35]],
        ['center', 'one', 'two', 'three', 'four', 'at30']]
]) {
    const controlledStations = Object.fromEntries(entries.map(([id, distance]) => [id, { id, latLng: [distance, 0] }]))
    const adjacency = controlledAdjacency(controlledStations)
    assert.deepEqual(adjacency.detectionAdjStations.center, expected, description)
    assert.deepEqual(Object.keys(adjacency.triggerDiffTolerances.center), expected, 'Supplemental edges also receive trigger tolerances')
    for(const id of expected) {
        assert.equal(adjacency.triggerDiffTolerances.center[id], controlledStations[id].latLng[0] / 3.5 * 1000 + 2000)
    }
    const localCount = entries.filter(([, distance]) => distance <= 30).length
    assert.equal(FindPalertHypocenter.calcStationDensityWeights(adjacency.hypocenterAdjStations).center,
        1 / Math.sqrt(localCount), 'Activation supplements cannot increase the 30 km density count')
}
{
    const stations = Object.fromEntries([['center', 0], ['one', 35], ['two', 36], ['three', 37], ['extra', 38]]
        .map(([id, distance]) => [id, { id, latLng: [distance, 0], activity: id === 'extra' ? 0 : 1, triggerStamp: stamp }]))
    const adjacency = controlledAdjacency(stations)
    assert.deepEqual(adjacency.detectionAdjStations.center, ['center', 'one', 'two', 'three'])
    assert(!adjacency.detectionAdjStations.one.includes('center'), 'Each center fills independently; dense neighbors need no reverse edge')
    const detected = detectStations(stations, adjacency.detectionAdjStations, adjacency.triggerDiffTolerances, 1)
    assert.deepEqual([...detected].map(station => station.id).toSorted(), ['center', 'one', 'three', 'two'],
        'Supplemental neighbors contribute activity and support compatible chain activation')
}
console.log('PASS four-station activation minimum, nearest-first supplements, inclusive 30/40 km bounds, sparse limits and independent rows')

// Run NIED's actual initialization code with sparse and dense directions.
const buildNiedAdjacency = new Function('stationList', 'calcDistanceKm', 'calcBearingDeg', `
    const adjStationIds = {}, adjStations4Hypo = {}, expireSeconds = {}, triggerDiffToleranceMatrix = [];
    ${section(niedComponentSource, 'const bearingDirections =', 'let decimal =')}
    ${section(niedComponentSource, 'const calcBearingDirection =', 'let pendingRender =')}
    ${niedComponentSource.match(/const nearbyLength = \d+/)[0]};
    ${section(niedComponentSource, 'let latLngs = []', 'distanceMatrix.forEach(distanceRow => {')}
    return { detection: adjStationIds, inference: adjStations4Hypo };
`)
const niedNeighborCoords = [
    [0, 0], [0.1, 0], [0.5, 0], [0.6, 0], // self, local north, second north, extra north
    [0, 0.4], [0, 0.5], [0, 0.6], // empty east: add only its nearest two
    [-0.1, 0], [-0.15, 0], [-0.2, 0], [-0.5, 0], // retain all three local south stations
    [0, -2.6], [0, -2.8] // west has only one station inside 300 km
]
const niedDirectional = buildNiedAdjacency(niedNeighborCoords, calcDistanceKm, calcBearingDeg)
assert.deepEqual(niedDirectional.detection[0], [0, 1, 7, 8, 9], 'NIED activation uses only its original local neighbors')
assert.deepEqual(niedDirectional.inference[0].map(s => s.stationId).sort((a,b) => a-b), [0, 1, 2, 4, 5, 7, 8, 9, 11],
    'Self does not count toward north; fill two nearest per direction and preserve all local neighbors')
assert.equal(FindNiedHypocenter.calcStationDensityWeights(niedDirectional.inference)[0], 1 / Math.sqrt(5))
assert(niedDirectional.inference[0].every(s => s.distance <= 300))
const niedBoundary = buildNiedAdjacency([[0, 0], [300, 0], [300.001, 0]],
    ([from], [to]) => Math.abs(to-from), ([from], [to]) => to >= from ? 0 : 180)
assert.deepEqual(niedBoundary.inference[0].map(s => s.stationId), [0, 1], 'Include exactly 300 km and exclude points beyond it')
assert.deepEqual(niedBoundary.detection[0], [0], 'A remote inference link cannot enter the activation neighborhood')
assert.deepEqual(buildNiedAdjacency([[0, 0]], calcDistanceKm, calcBearingDeg).inference[0], [{stationId:0, distance:0}],
    'Keep the station itself when all directions lack neighbors')
console.log('PASS NIED two nearest neighbors per direction, local-density/activation preservation, sparse directions and inclusive 300 km boundary')

globalThis.__palertDisplayDeps = {
    settingsStore: { mainSettings: { displaySeisNet: { palertHypoInfAlwaysOn: false } }, effectivePalertHypoInfTextInfo: 1 },
    activeEewList: []
}
const displaySource = `import { calcLngDiff, compareFloat, timeToStamp } from '@/utils/Utils';
const { settingsStore, activeEewList } = globalThis.__palertDisplayDeps;
const inferredHypocenterLabelOffset = 24;
${section(componentSource, 'const minDisplayedHypocenterQualityScore =', 'const bearingDirections =')}
${section(componentSource, 'const getPickDisplayWave =', 'const layoutInferredHypocenterLabels =')}
export { shouldDisplayHypocenterResult, createInfLabelHtml, getPickDisplayWave };`
const display = await load('src/components/components/test-palert-display.js', displaySource)
const displayResult = { hypocenter: { lat: 24, lng: 121, depth: 30 }, originStamp: stamp, qualityScore: 1 }
const cwaMessage = { source: 'cwaEew', lat: 24, lng: 121, depth: 30, originTime: stampToTime(stamp, 8), timeZone: 8 }
const displayDeps = globalThis.__palertDisplayDeps
assert(display.shouldDisplayHypocenterResult(displayResult))
displayDeps.activeEewList.push({ eqMessage: cwaMessage })
assert(!display.shouldDisplayHypocenterResult(displayResult))
for(const change of [{ source: 'jmaEew' }, { isCanceled: true }, { isAssumption: true }, { lat: 25.01 },
    { lng: 122.01 }, { depth: 131 }, { originTime: stampToTime(stamp + 11000, 8) }]) {
    displayDeps.activeEewList[0] = { eqMessage: { ...cwaMessage, ...change } }
    assert(display.shouldDisplayHypocenterResult(displayResult), JSON.stringify(change))
}
displayDeps.activeEewList[0] = { eqMessage: cwaMessage }
displayDeps.settingsStore.mainSettings.displaySeisNet.palertHypoInfAlwaysOn = true
assert(display.shouldDisplayHypocenterResult(displayResult))
assert(!display.shouldDisplayHypocenterResult({ ...displayResult, qualityScore: -3.01 }))
assert(display.shouldDisplayHypocenterResult({ ...displayResult, qualityScore: -3 }))
const labelResult = { ...displayResult, reportNum: 3, stable: true, qualityRank: 'C', clusterId: 2, updates: 4,
    effectiveStationCount: 20, effectivePickCount: 21, score: 0.2, rmse: 1.1, inactivePenalty: 0,
    inactivePenaltyWeight: 6, waveCountPenalty: 0, unexplainedPickPenalty: 0, scenario: 'PP', inferenceFilterStageLevels: [1, 2] }
const labelInfo = { lat: 24, lng: 121, depth: 30, clusterStationCount: 20, originTimeTst: stampToTime(stamp, 8), waveCounts: { P: 18, S: 2, D: 1 } }
for(const mode of [0, 1, 2]) {
    displayDeps.settingsStore.effectivePalertHypoInfTextInfo = mode
    const html = display.createInfLabelHtml(labelResult, labelInfo)
    if(mode === 0) assert.equal(html, '')
    else {
        assert(html.includes('(+8)'))
        assert(html.includes('opacity: 0.8;'))
        assert.equal(html.includes('filter: 1 -> 2'), mode === 2)
        assert.equal(html.includes('opacity: 0.6;'), mode === 2)
    }
}
delete globalThis.__palertDisplayDeps
console.log('PASS CWA match boundaries, cancellation, always-on override and NIED label fields')

// Exercise both production renderers with separate map/group ownership at the Leaflet boundary.
for(const name of ['Palert', 'Nied']) {
    const isPalert = name === 'Palert'
    const id = name.toLowerCase()
    const source = isPalert ? componentSource : niedComponentSource
    const createMap = () => ({
        groups: new Set(), events: new Map(),
        on(event, handler) { assert(!this.events.has(event)); this.events.set(event, handler) },
        off(event, handler) { if(this.events.get(event) === handler) this.events.delete(event) },
        getSize: () => ({ x: 800, y: 600 }),
        latLngToContainerPoint: () => ({ x: 400, y: 300 })
    })
    const createLayer = (type, latLng, options) => ({
        type, options,
        addTo(group) { group.layers.push(this); return this },
        getElement: () => ({ firstElementChild: { offsetWidth: 200, offsetHeight: 100, style: {} } }),
        getLatLng: () => latLng
    })
    const firstMap = createMap(), secondMap = createMap()
    const renderDeps = {
        statusStore: { map: firstMap, isActive: {} },
        settingsStore: { mainSettings: { displaySeisNet: { [`${id}HypoInfAlwaysOn`]: false } }, [`effective${name}HypoInfTextInfo`]: 2 },
        isHypocenterEnabled: { value: true },
        L: {
            layerGroup: () => ({
                layers: [],
                addTo(map) { this.map = map; map.groups.add(this); return this },
                clearLayers() { this.layers.length = 0 },
                remove() { this.map.groups.delete(this) }
            }),
            circle: (latLng, options) => createLayer('circle', latLng, options),
            marker: (latLng, options) => createLayer('marker', latLng, options),
            divIcon: options => options
        }
    }
    globalThis.__hypocenterRendererDeps = renderDeps
    const rendererSource = `import { calcWaveDistance, calcLngDiff, compareFloat, timeToStamp, stampToTime } from '@/utils/Utils';
    import travelTimes from '@/utils/TravelTimes';
    const { L, settingsStore, statusStore, isHypocenterEnabled } = globalThis.__hypocenterRendererDeps;
    const activeEewList = [], infHypoIcon = {}, latestFrameStamp = ${stamp + 20000}, updateStamp = latestFrameStamp;
    const isNiedHypoInfEnabled = () => isHypocenterEnabled.value;
    let inferredHypocenterMap = null, inferredHypocenterLayers = null, inferredHypocenterLabelLayers = [];
    ${isPalert ? section(source, 'const inferredHypocenterLabelOffset =', 'const bearingDirections =') :
        source.split('\n').find(line => line.startsWith('const inferredHypocenterLabelOffset =')) + '\n' +
        section(source, 'const hypoInfEewMatchThreshold =', 'const isNiedHypoInfEnabled =')}
    ${isPalert ? section(source, 'const clearInferredHypocenters =', 'const fetchRealtimeData =') :
        section(source, 'const getPickDisplayWave =', 'const chainActivate =')}
    export { renderInferredHypocenters, destroyInferredHypocenterLayers };`
    const renderer = await load(`src/components/components/test-${id}-renderer.js`, rendererSource)
    renderer.renderInferredHypocenters([labelResult, { ...labelResult, qualityScore: -4 }])
    assert.equal(firstMap.groups.size, 1)
    const firstGroup = [...firstMap.groups][0]
    assert.equal(firstGroup.layers.length, 4, 'Two waves, a marker and a label for the visible event')
    assert(firstGroup.layers.filter(layer => layer.type === 'circle').every(layer => layer.options.pane === 'wavePane'))
    assert(firstGroup.layers.some(layer => layer.options.pane === 'eewMarkerPane'))
    const labelHtml = firstGroup.layers.find(layer => layer.options.icon?.html).options.icon.html
    assert(labelHtml.includes(isPalert ? '(+8)' : '(+9)'))
    assert(labelHtml.includes('opacity: 0.8;') && labelHtml.includes('opacity: 0.6;'))
    assert.equal(renderDeps.statusStore.isActive[`${id}InfHypo`], true)
    renderer.renderInferredHypocenters([labelResult])
    assert.equal(firstMap.groups.size, 1)
    assert.equal(firstGroup.layers.length, 4, 'Each returned result replaces the previous layers')
    renderer.renderInferredHypocenters([])
    assert.equal(firstGroup.layers.length, 0)
    assert.equal(renderDeps.statusStore.isActive[`${id}InfHypo`], false)
    renderer.renderInferredHypocenters([labelResult])
    renderDeps.statusStore.map = secondMap
    renderer.renderInferredHypocenters([labelResult])
    assert.equal(firstGroup.layers.length, 0, 'Map replacement clears the old result')
    assert.equal(firstMap.groups.size, 0, 'Map replacement removes the group from its original map')
    assert.equal(firstMap.events.size, 0, 'Map replacement removes old label listeners')
    assert.equal(secondMap.events.size, 1)
    assert.equal(secondMap.groups.size, 1)
    const secondGroup = [...secondMap.groups][0]
    assert.equal(secondGroup.layers.length, 4)
    renderDeps.settingsStore[`effective${name}HypoInfTextInfo`] = 0
    renderer.renderInferredHypocenters([labelResult])
    assert.equal(secondGroup.layers.length, 3, 'Hidden labels leave only the two waves and epicenter')
    renderDeps.isHypocenterEnabled.value = false
    renderer.renderInferredHypocenters([labelResult])
    assert.equal(secondGroup.layers.length, 0)
    assert.equal(renderDeps.statusStore.isActive[`${id}InfHypo`], false)
    renderer.destroyInferredHypocenterLayers()
    renderer.destroyInferredHypocenterLayers()
    assert.equal(secondMap.groups.size, 0)
    assert.equal(secondMap.events.size, 0)
    delete globalThis.__hypocenterRendererDeps
}
console.log('PASS NIED/P-Alert wavePane and label styling, result replacement, map replacement, disabled display and layer/event cleanup')

// Exercise the production map visibility expression across official/inferred results and the override.
const gridExpression = read('src/components/MainMapComponent.vue').split('\n').find(line => line.includes('if(taiwanGridPane)'))
const gridOpacity = new Function('statusStore', 'settingsStore', `const blinkOpac = 1, menuOpac = 1, taiwanGridPane = { style: {} }; ${gridExpression}; return taiwanGridPane.style.opacity;`)
for(const cwaEew of [false, true]) for(const palertInfHypo of [false, true]) for(const alwaysDisplayGrid of [false, true]) {
    const opacity = gridOpacity({ isActive: { cwaEew, palertInfHypo } }, { mainSettings: { displaySeisNet: { alwaysDisplayGrid } } })
    assert.equal(opacity, alwaysDisplayGrid || (!cwaEew && !palertInfHypo) ? 1 : 0)
}
console.log('PASS shared Taiwan grid visibility and always-display override')

// Replay a quantized P-wave episode through actual station -> snapshots -> core modules.
const center = { lat: 24, lng: 121, depth: 30 }
const origin = stamp + 45000
const stations = Array.from({ length: 20 }, (_, i) => new PalertStation(null, `W${i.toString().padStart(3, '0')}`,
    [24 + Math.cos(i * 2.39996) * (0.04 + i * 0.01), 121 + Math.sin(i * 2.39996) * (0.04 + i * 0.01)], true))
const adjacency = Object.fromEntries(stations.map(station => [station.id, stations.map(neighbor => ({
    stationId: neighbor.id, distance: calcDistanceKm(station.latLng, neighbor.latLng)
})).filter(neighbor => neighbor.distance <= 30)]))
const arrivals = new Map(stations.map(station => [station.id, Math.round((origin +
    calcReachTime(tables.jma2001, true, center.depth, calcDistanceKm([center.lat, center.lng], station.latLng)) * 1000) / 1000) * 1000]))
const replayFinder = new FindPalertHypocenter([], adjacency)
let bestResult = null
let frameAtFullNetwork = null
for(let frame = 0; frame < 125; frame++) {
    const timestamp = stamp + frame * 1000
    for(const station of stations) {
        const elapsed = (timestamp - arrivals.get(station.id)) / 1000
        const pga = elapsed >= 0 && elapsed < 12 ? elapsed === 0 ? 2.5 : elapsed === 1 ? 4.4 : 8 : 0.2
        station.update({ timestamp, pga, pgv: null, level: getPalertLevelFromPgaPgv(pga, null) }, 0, false)
        station.isActive = elapsed >= 0 && elapsed < 35
    }
    const update = createPalertHypocenterUpdate(stations)
    const results = replayFinder.update(update.pickCandidates, update.inactiveStations, update.activeStations)
    const result = results.find(result => result.effectiveStationCount >= 15)
    if(result && (!bestResult || result.score < bestResult.score)) bestResult = result
    if(!frameAtFullNetwork && update.pickCandidates.length === stations.length) frameAtFullNetwork = update
}
assert(bestResult, 'The full station/pick/solver pipeline must produce an event')
const distanceError = calcDistanceKm([center.lat, center.lng], [bestResult.hypocenter.lat, bestResult.hypocenter.lng])
assert(distanceError < 30, `Synthetic epicenter error ${distanceError} km`)
// Check both origin-time accuracy and the predicted arrivals for this synthetic episode.
assert(Number.isFinite(bestResult.originStamp))
assert(bestResult.originStamp < Math.min(...arrivals.values()))
assert(Math.abs(bestResult.originStamp - origin) < 5000)
assert.equal(bestResult.waveCountPenalty, expectedPhasePenalty(bestResult.pickResults, bestResult.filterStageLevel))
for(const result of bestResult.pickResults.filter(result => result.weight > 0)) {
    const distance = calcDistanceKm([bestResult.hypocenter.lat, bestResult.hypocenter.lng], result.pick.latLng)
    const predictedArrival = bestResult.originStamp + calcReachTime(
        profile.selectTravelTimeTable(distance), result.wave === 'P', bestResult.hypocenter.depth, distance
    ) * 1000
    assert(Math.abs(predictedArrival - arrivals.get(result.pick.stationId)) < 1000, 'Effective picks must fit observed arrivals within one sample')
}
assert.equal(replayFinder.picks.size, 0)
console.log(`PASS 125-frame synthetic Taiwan replay: ${bestResult.effectiveStationCount} stations, epicenter error ${distanceError.toFixed(2)} km, origin error ${Math.round(bestResult.originStamp - origin)} ms; event cleaned up`)

// Run the real worker handler, including a reset before scheduled processing.
const posted = []
globalThis.__palertTestWorker = { postMessage: message => posted.push(message) }
const palertWorkerState = await load('src/workers/test-palert-worker.js', `const self = globalThis.__palertTestWorker;
${read('src/workers/FindPalertHypocenterWorker.js')}
export { stationDensityWeights, finder };`)
const handler = globalThis.__palertTestWorker.onmessage
handler({ data: { type: 'init', adjStations: adjacency } })
const initializedPalertDensity = palertWorkerState.stationDensityWeights
assert.deepEqual(initializedPalertDensity, FindPalertHypocenter.calcStationDensityWeights(adjacency))
handler({ data: { ...frameAtFullNetwork, type: 'update', requestId: 1 } })
handler({ data: { type: 'reset', requestId: 2 } })
await new Promise(resolve => setTimeout(resolve, 10))
assert(!posted.some(message => message.requestId === 1))
handler({ data: { ...frameAtFullNetwork, type: 'update', requestId: 3 } })
await new Promise(resolve => setTimeout(resolve, 10))
assert(posted.find(message => message.requestId === 3)?.results.length > 0)
assert.equal(palertWorkerState.finder.stationDensityWeights, initializedPalertDensity)
handler({ data: { type: 'reset', requestId: 4 } })
handler({ data: { ...frameAtFullNetwork, type: 'update', requestId: 5 } })
await new Promise(resolve => setTimeout(resolve, 10))
assert.equal(palertWorkerState.finder.stationDensityWeights, initializedPalertDensity,
    'P-Alert preserves its initialized density table when resetting and recreating a finder')
handler({ data: { type: 'init', adjStations: {} } })
assert.notEqual(palertWorkerState.stationDensityWeights, initializedPalertDensity)
assert.deepEqual(palertWorkerState.stationDensityWeights, {}, 'A new station initialization replaces the density table')
delete globalThis.__palertTestWorker
console.log('PASS real Worker inference, scheduled-reset cancellation and density-table reuse/reinitialization')

// Control the NIED Worker task queue to exercise reinitialization between scheduled updates.
const niedWorkerCallbacks = [], niedWorkerPosted = [], niedFinderAdjacencies = [], niedFinderCalls = []
const niedDensityTables = [], niedFinderDensityTables = []
globalThis.__niedWorkerDeps = {
    self: { postMessage: message => niedWorkerPosted.push(message) },
    setTimeout: callback => niedWorkerCallbacks.push(callback),
    FindNiedHypocenter: class {
        static calcStationDensityWeights(adjStations) {
            const weights = FindNiedHypocenter.calcStationDensityWeights(adjStations)
            niedDensityTables.push(weights)
            return weights
        }
        constructor(inactiveStations, adjStations, stationDensityWeights) {
            niedFinderAdjacencies.push(adjStations)
            niedFinderDensityTables.push(stationDensityWeights)
            this.serial = niedFinderAdjacencies.length
        }
        update(...args) { niedFinderCalls.push(args); return [{ serial: this.serial }] }
    }
}
await load('src/workers/test-nied-worker.js', `const { self, setTimeout, FindNiedHypocenter } = globalThis.__niedWorkerDeps;
${read('src/workers/FindNiedHypocenterWorker.js').replace("import { FindNiedHypocenter } from '@/classes/NiedHypoInf'", '')}`)
const niedHandler = globalThis.__niedWorkerDeps.self.onmessage
const niedWorkerUpdate = requestId => ({ data: {
    type: 'update', requestId, inactiveStations: [], activeStations: [niedStation],
    pickCandidates: [{ ...niedStation, stationId: niedStation.id, pickId: `0:${stamp}`, ascend: requestId }]
} })
niedHandler({ data: { type: 'init', adjStations: { old: [] } } })
niedHandler(niedWorkerUpdate(1))
const newNiedAdjacency = { 0: [{ stationId: 0, distance: 0 }] }
niedHandler({ data: { type: 'init', adjStations: newNiedAdjacency } })
niedHandler(niedWorkerUpdate(2))
niedWorkerCallbacks.shift()()
niedHandler(niedWorkerUpdate(3))
assert.equal(niedWorkerCallbacks.length, 1, 'A stale callback cannot reset the new generation scheduling flag')
niedWorkerCallbacks.shift()()
assert.deepEqual(niedWorkerPosted.map(message => message.requestId), [3])
assert.equal(niedFinderAdjacencies[0], newNiedAdjacency)
assert.equal(niedDensityTables.length, 2, 'NIED calculates density once per initialization')
assert.deepEqual(niedDensityTables[1], { 0: 1 })
assert.equal(niedFinderDensityTables[0], niedDensityTables[1])
assert.equal(niedFinderCalls[0][0][0].ascend, 3)
niedHandler(niedWorkerUpdate(4))
niedHandler({ data: { type: 'reset', requestId: 5 } })
niedWorkerCallbacks.shift()()
assert.deepEqual(niedWorkerPosted.map(message => message.requestId), [3, 5])
assert.deepEqual(niedWorkerPosted.at(-1).results, [])
niedHandler(niedWorkerUpdate(6))
niedWorkerCallbacks.shift()()
assert.equal(niedWorkerPosted.at(-1).results[0].serial, 2, 'Reset creates a fresh finder for the next update')
assert.equal(niedFinderAdjacencies[1], newNiedAdjacency, 'Reset preserves the initialized adjacency')
assert.equal(niedDensityTables.length, 2, 'Reset and frame updates do not recalculate NIED density')
assert.equal(niedFinderDensityTables[1], niedDensityTables[1], 'Reset preserves the initialized density table')
niedHandler({ data: { type: 'init', adjStations: {} } })
niedHandler(niedWorkerUpdate(7))
niedWorkerCallbacks.shift()()
assert.equal(niedWorkerPosted.at(-1).results[0].serial, 3, 'Reinitialization also discards an existing finder')
assert.deepEqual(niedFinderAdjacencies[2], {})
assert.equal(niedDensityTables.length, 3)
assert.equal(niedFinderDensityTables[2], niedDensityTables[2])
assert.deepEqual(niedFinderDensityTables[2], {})
delete globalThis.__niedWorkerDeps
console.log('PASS NIED Worker reinitialization, pending-update cancellation, generation scheduling, reset acknowledgement and finder recreation')

// Test the actual settings actions/getter with an isolated capability store.
globalThis.__palertSettingsDeps = {
    capabilities: new Set(['iclEew', 'gqEew', 'tremFunctions'])
}
const settingsSource = `import { parseSettings, restoreSettings } from '@/utils/SettingsRestore';
const { capabilities } = globalThis.__palertSettingsDeps;
const defineStore = (id, options) => options;
const createDefaultDataSources = () => ({});
const useAccessStore = () => ({ canUse: name => capabilities.has(name) });
${read('src/stores/settings.js').replace(/^import .*;\r?\n/gm, '')}`
const { useSettingsStore: settingsDefinition } = await load('src/stores/test-palert-settings.js', settingsSource)
const settings = Object.assign(settingsDefinition.state(), settingsDefinition.actions)
assert.equal(settings.mainSettings.displaySeisNet.palertSensitivity, 1, 'New settings default to standard sensitivity')
settings.setMainSettings(JSON.stringify({ displaySeisNet: { palertNet: true } }))
assert.equal(settings.mainSettings.displaySeisNet.palertSensitivity, 1, 'Older settings restore standard sensitivity')
for(const sensitivity of [0, 1, 2, 3]) {
    settings.setMainSettings(JSON.stringify({ displaySeisNet: { palertSensitivity: sensitivity } }))
    settings.setMainSettings(JSON.stringify(settings.mainSettings))
    assert.equal(settings.mainSettings.displaySeisNet.palertSensitivity, sensitivity,
        'Sensitivity survives settings serialization and restoration, including disabled')
}
settings.setMainSettings(JSON.stringify({ displaySeisNet: { palertSensitivity: '2' } }))
assert.equal(settings.mainSettings.displaySeisNet.palertSensitivity, 1, 'Invalid setting types restore standard sensitivity')
assert.equal(settings.mainSettings.displaySeisNet.httpDataPriority, 'realtime')
settings.setMainSettings(JSON.stringify({ displaySeisNet: { httpDataPriority: 'complete' } }))
assert.equal(settings.mainSettings.displaySeisNet.httpDataPriority, 'complete')
settings.setMainSettings(JSON.stringify({ displaySeisNet: { httpDataPriority: 'invalid' } }))
assert.equal(settings.mainSettings.displaySeisNet.httpDataPriority, 'realtime')
const effectiveMode = () => settingsDefinition.getters.effectivePalertHypoInfTextInfo.call(settings, settings)
assert.equal(settings.mainSettings.displaySeisNet.palertHypoInf, false)
assert.equal(settings.mainSettings.displaySeisNet.palertHypoInfAlwaysOn, false)
assert.equal(effectiveMode(), 0)
settings.setMainSettings(JSON.stringify({ displaySeisNet: { palertHypoInf: true, palertHypoInfTextInfo: 2 } }))
assert.equal(effectiveMode(), 1, 'Imported detailed labels are masked without access')
settings.resetUnauthorizedFeatureSettings()
assert.equal(settings.mainSettings.displaySeisNet.palertHypoInfTextInfo, 1)
globalThis.__palertSettingsDeps.capabilities.add('advancedHypoInf')
settings.setMainSettings(JSON.stringify({ displaySeisNet: { palertHypoInfTextInfo: 2 } }))
settings.resetUnauthorizedFeatureSettings()
assert.equal(effectiveMode(), 2, 'Authorized startup retains detailed labels')
globalThis.__palertSettingsDeps.capabilities.delete('advancedHypoInf')
assert.equal(effectiveMode(), 1, 'Revocation immediately masks details')
settings.resetUnauthorizedFeatureSettings()
assert.equal(settings.mainSettings.displaySeisNet.palertHypoInfTextInfo, 1)
delete globalThis.__palertSettingsDeps
delete globalThis.__palertTestDayjs
console.log('PASS settings defaults, imported values, capability normalization and revocation')
