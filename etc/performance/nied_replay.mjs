// node --experimental-vm-modules etc/performance/nied_replay.mjs [--baseline] [--infer] [--profile]
// Actual one-second Yahoo/NIED frames; production detector with Vue reactivity.
// DOM/map rendering is excluded. Fetching and initialization are not timed.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { SourceTextModule, SyntheticModule } from 'node:vm'
import { Session } from 'node:inspector/promises'
import * as vue from 'vue'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = path.join(root, 'etc/performance/shizuoka-20261108.local')
const cache = path.join(output, 'frames')
mkdirSync(cache, { recursive: true })
const baseline = process.argv.includes('--baseline')
const infer = process.argv.includes('--infer')
const profile = process.argv.includes('--profile')
const label = `${baseline ? 'baseline' : 'optimized'}${infer ? '-inference' : ''}`
const read = name => readFileSync(path.join(root, name), 'utf8')
const section = (source, start, end) => {
    const a = source.indexOf(start), b = source.indexOf(end, a + start.length)
    assert(a >= 0 && b > a, `Missing production section ${start}`)
    return source.slice(a, b)
}
const fetchJson = async (filename, url) => {
    if(existsSync(filename)) return JSON.parse(readFileSync(filename, 'utf8'))
    let lastError
    for(let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
            assert(response.ok, `${response.status}: ${url}`)
            const data = await response.json()
            writeFileSync(filename, JSON.stringify(data))
            return data
        } catch(error) { lastError = error }
    }
    throw lastError
}
const base = 'https://weather-kyoshin.east.edge.storage-yahoo.jp'
const roster = await fetchJson(path.join(output, 'sitelist.json'), `${base}/SiteList/sitelist.json`)
const startStamp = Date.parse('2026-11-08T01:03:40+09:00')
const frames = new Array(301)
let next = 0
await Promise.all(Array.from({ length: 4 }, async () => {
    while(next < frames.length) {
        const i = next++, stamp = startStamp + i * 1000
        const key = new Date(stamp + 9 * 3600000).toISOString().slice(0, 19).replaceAll(/[-:T]/g, '')
        const data = await fetchJson(path.join(cache, `${key}.json`), `${base}/RealTimeData/${key.slice(0, 8)}/${key}.json`)
        assert.equal(data.realTimeData.siteConfigId, roster.siteConfigId)
        assert.equal(Date.parse(data.realTimeData.dataTime), stamp)
        assert.equal(data.realTimeData.intensity.length, roster.items.length)
        frames[i] = { stamp, ...data.realTimeData }
    }
}))
console.log(`Loaded ${frames.length} frames / ${roster.items.length} stations`)

const require = createRequire(import.meta.url)
globalThis.__perfDayjs = require('dayjs')
globalThis.__perfDayjs.extend(require('dayjs/plugin/utc'))
const utils = read('src/utils/Utils.js')
const math = [
    'const dayjs = globalThis.__perfDayjs;',
    section(utils, 'const EARTH_RADIUS_KM', 'export const formatNumber'),
    section(utils, 'export const timeToStamp', 'export const convertCompactTimeString'),
    section(utils, 'export const calcWaveDistance', 'export const extractNumbers'),
    section(utils, 'export const exactRound', 'export const getCoordByDistanceBearing'),
    section(utils, 'export const getShindoFromChar', 'const palertPgaThresholds')
].join('\n')
const modules = new Map()
modules.set('vue', new SyntheticModule(Object.keys(vue), function() {
    for(const [name, value] of Object.entries(vue)) this.setExport(name, value)
}))
const moduleFor = (filename, source) => {
    if(!modules.has(filename)) modules.set(filename, new SourceTextModule(source ?? read(path.relative(root, filename)), { identifier: filename }))
    return modules.get(filename)
}
const linker = (specifier, parent) => {
    if(specifier === 'vue') return modules.get('vue')
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
let replayNow = 0, timerId = 0
const timers = new Map()
globalThis.__perfTimers = {
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, at: replayNow + delay }); return id },
    clearTimeout: id => timers.delete(id)
}
let stationBody = section(read('src/classes/StationClasses.js'), 'export class NiedStation', 'export class KmaStation')
if(baseline) {
    // Recreate the pre-fix implementation in memory, without changing the checkout.
    stationBody = stationBody.replace('this.recentLevel = markRaw([])', 'this.recentLevel = []')
    const ascent = section(stationBody, '    calcAscend() {', '    isAbnormalStation() {')
    const uncached = ascent.replace(/        const recentLevel = this.recentLevel;\r?\n/, '')
        .replace(/\brecentLevel\b/g, 'this.recentLevel')
    stationBody = stationBody.replace(ascent, uncached)
}
await load('src/classes/perf-station.js', `
    import { markRaw } from 'vue';
    import { getShindoFromChar } from '@/utils/Utils';
    let settingsStore = {};
    export const abnormalNiedStations = {};
    const { setTimeout, clearTimeout } = globalThis.__perfTimers;
    ${stationBody}`)
const component = read('src/components/components/NiedNet.vue')
const detectorSource = `
import { reactive, ref, computed, watch } from 'vue';
import { NiedStation, abnormalNiedStations } from '@/classes/perf-station';
import { createHypocenterTriggerSnapshots } from '@/features/stations/HypocenterTriggerSnapshots';
import { niedSitePub } from '@/utils/NiedSitePub';
import { exactRound, calcDistanceKm, calcBearingDeg, timeToStamp, getShindoFromLevel } from '@/utils/Utils';
export function createDetector(roster, sensitivity) {
    const stationList = structuredClone(roster.items), stations = reactive([]), stationData = ref([]);
    const settingsStore = reactive({ mainSettings: { displaySeisNet: { niedSensitivity: sensitivity } } });
    const statusStore = reactive({ isActive: { niedNet: false } });
    const document = { visibilityState: 'hidden' };
    const niedUpdateTime = ref(''), niedMaxShindo = ref('');
    const useStationCanvasRenderer = { value: true };
    const map = {}, adjStationIds = {}, adjStations4Hypo = {}, triggerDiffToleranceMatrix = [];
    const triggerCompatibilityConfig = { waveSpeedKmPerSecond: 3.5, fixedToleranceMilliseconds: 2000 };
    const bearingDirections = ['N', 'E', 'S', 'W'], minHypocenterNeighborsPerDirection = 2;
    let stationDistanceTable, updateStamp, decimal = [0, 0], pendingRender = false, captured = null;
    const isNiedHypoInfEnabled = () => true, renderAll = () => {}, terminateHypocenterWorker = () => {}, clearInferredHypocenters = () => {};
    const resetHypocenterWorker = () => { captured = null };
    ${section(component, 'const nearbyLength', 'const inferredHypocenterLabelOffset')}
    ${section(component, 'const calcBearingDirection', 'let pendingRender')}
    ${section(component, 'const activeStations = computed', 'const getData =')}
    ${section(component, 'const stationToInferredHypocenterSnapshot', 'const updateInferredHypocentersInWorker')}
    const updateInferredHypocentersInWorker = (picks, active, inactive, frameStamp) => {
        captured = { frameStamp, triggerStations: createHypocenterTriggerSnapshots(stations), pickCandidates: picks.map(stationToInferredHypocenterPickSnapshot), activeStations: active.map(stationToInferredHypocenterSnapshot), inactiveStations: [...inactive].map(stationToInferredHypocenterSnapshot) };
    };
    ${section(component, 'const update =', 'const getHypocenterWorker')}
    ${section(component, 'const chainActivate =', 'const renderAll =')}
    const list = stationList;
    ${section(component, '//使用NIED的测站数据提高经纬度精度', '            const listChanged =')}
    ${section(component, '            const latLngs = stationList', '            initStationCanvasLayer()')}
    const stop = watch(grids, value => { statusStore.isActive.niedNet = value.length > 0 });
    return {
        stations, adjacency: adjStations4Hypo, distanceTable: stationDistanceTable, stop,
        next(frame) {
            captured = null;
            stationData.value = frame.intensity.split('');
            niedUpdateTime.value = frame.dataTime.slice(0, 19).replace('T', ' ');
            update(timeToStamp(niedUpdateTime.value, 9));
            return captured;
        }
    };
}`
const { createDetector } = await load('src/components/components/perf-detector.js', detectorSource)
const { FindNiedHypocenter } = await load('src/classes/NiedHypoInf.js')
const detector = createDetector(roster, 1)
const session = profile ? new Session() : null
if(session) {
    session.connect()
    await session.post('Profiler.enable')
    await session.post('Profiler.start')
}
const timeline = [], hash = createHash('sha256')
let finder = null
for(const frame of frames) {
    replayNow = frame.stamp
    const start = performance.now()
    for(const [id, timer] of timers) if(timer.at <= replayNow) { timers.delete(id); timer.fn() }
    const update = detector.next(frame)
    await vue.nextTick()
    const detectorMs = performance.now() - start
    // Snapshot serialization is measured separately from the detector.
    const cloneStart = performance.now()
    structuredClone(update)
    const cloneMs = performance.now() - cloneStart
    const solverStart = performance.now()
    let results = []
    if(infer) {
        if(!finder && (update.activeStations.length || update.pickCandidates.length)) {
            finder = new FindNiedHypocenter(update.inactiveStations, detector.adjacency, null, detector.distanceTable)
        }
        results = finder?.update(update.pickCandidates, update.inactiveStations, update.activeStations, update.frameStamp, update.triggerStations) ?? []
        if(update.activeStations.length === 0 && finder?.clusters.length === 0) finder = null
    }
    const solverMs = performance.now() - solverStart
    hash.update(JSON.stringify(update))
    timeline.push({ time: frame.dataTime, active: update.activeStations.length, picks: update.pickCandidates.length, detectorMs, cloneMs, solverMs, results: results.length })
    if(timeline.length % 60 === 0) console.log(`${label}: ${timeline.length}/${frames.length}, active=${update.activeStations.length}, detector=${detectorMs.toFixed(1)}ms, solver=${solverMs.toFixed(1)}ms`)
}
if(session) {
    const { profile: data } = await session.post('Profiler.stop')
    writeFileSync(path.join(output, `${label}.cpuprofile`), JSON.stringify(data))
    session.disconnect()
}
detector.stop()
const stats = values => {
    const sorted = [...values].sort((a, b) => a - b)
    return { mean: values.reduce((a, b) => a + b, 0) / values.length, p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1) }
}
const summary = {
    label, frames: frames.length, stations: roster.items.length, snapshotHash: hash.digest('hex'),
    node: process.version, platform: process.platform, profile,
    sourceHash: createHash('sha256').update(stationBody).update(component).digest('hex'),
    peakActive: Math.max(...timeline.map(row => row.active)),
    detectorMs: stats(timeline.map(row => row.detectorMs)),
    activeDetectorMs: stats(timeline.filter(row => row.active).map(row => row.detectorMs)),
    cloneMs: stats(timeline.map(row => row.cloneMs)),
    solverMs: stats(timeline.map(row => row.solverMs))
}
writeFileSync(path.join(output, `${label}.json`), JSON.stringify({ summary, timeline }, null, 2))
const comparison = path.join(output, `${baseline ? 'optimized' : 'baseline'}${infer ? '-inference' : ''}.json`)
if(existsSync(comparison)) {
    assert.equal(summary.snapshotHash, JSON.parse(readFileSync(comparison, 'utf8')).summary.snapshotHash, 'Per-frame detector outputs must match')
    console.log('Per-frame snapshot comparison passed')
}
console.log(JSON.stringify(summary, null, 2))
