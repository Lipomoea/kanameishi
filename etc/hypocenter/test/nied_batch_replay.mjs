// Batch replay of user-supplied replay starts (UTC+8), not origin times.
// node --experimental-vm-modules etc/hypocenter/test/nied_batch_replay.mjs [index ...]
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { SourceTextModule } from 'node:vm'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const output = path.join(root, 'etc/hypocenter/test/nied-batch-20260926.local')
const cache = path.join(output, 'frames')
mkdirSync(cache, { recursive: true })
const read = name => readFileSync(path.join(root, name), 'utf8')
const section = (source, start, end) => {
    const a = source.indexOf(start), b = source.indexOf(end, a + start.length)
    assert(a >= 0 && b > a, 'Missing production section ' + start)
    return source.slice(a, b)
}
const fmt = (stamp, offset = 8) => new Date(stamp + offset * 3600000).toISOString().slice(0, 23)
const fetchJson = async (filename, url) => {
    if(existsSync(filename)) return JSON.parse(readFileSync(filename, 'utf8'))
    let lastError
    for(let retry = 0; retry < 3; retry++) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
            assert(response.ok, response.status + ': ' + url)
            const data = await response.json()
            writeFileSync(filename, JSON.stringify(data))
            return data
        } catch(error) { lastError = error }
    }
    throw lastError
}
const roster = await fetchJson(path.join(output, 'sitelist.json'), 'https://weather-kyoshin.east.edge.storage-yahoo.jp/SiteList/sitelist.json')
const getFrame = async stamp => {
    const key = fmt(stamp, 9).slice(0, 19).replaceAll(/[-:T]/g, '')
    const previous = path.join(root, 'etc/hypocenter/test/nied-20260616.local', key + '.json')
    const data = existsSync(previous) ? JSON.parse(readFileSync(previous, 'utf8')) :
        await fetchJson(path.join(cache, key + '.json'), 'https://weather-kyoshin.east.edge.storage-yahoo.jp/RealTimeData/' + key.slice(0, 8) + '/' + key + '.json')
    const frame = data.realTimeData
    assert.equal(frame.siteConfigId, roster.siteConfigId)
    assert.equal(Date.parse(frame.dataTime), stamp)
    assert.equal(frame.intensity.length, roster.items.length)
    return { stamp, ...frame }
}
const getFrames = async stamps => {
    const results = new Array(stamps.length)
    let next = 0
    await Promise.all(Array.from({ length: 4 }, async () => {
        while(next < stamps.length) { const i = next++; results[i] = await getFrame(stamps[i]) }
    }))
    return results
}

const require = createRequire(import.meta.url)
globalThis.__niedReplayDayjs = require('dayjs')
globalThis.__niedReplayDayjs.extend(require('dayjs/plugin/utc'))
const utils = read('src/utils/Utils.js')
const math = [
    'const dayjs = globalThis.__niedReplayDayjs;',
    section(utils, 'const EARTH_RADIUS_KM', 'export const formatNumber'),
    section(utils, 'export const timeToStamp', 'export const convertCompactTimeString'),
    section(utils, 'export const calcWaveDistance', 'export const extractNumbers'),
    section(utils, 'export const exactRound', 'export const getCoordByDistanceBearing'),
    section(utils, 'export const getShindoFromChar', 'const palertPgaThresholds')
].join('\n')
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
let replayNow = 0, timerId = 0
const timers = new Map()
globalThis.__niedReplayTimers = {
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, at: replayNow + delay }); return id },
    clearTimeout: id => timers.delete(id)
}
const stationSource = `
import { getShindoFromChar } from '@/utils/Utils';
const markRaw = x => x;
let settingsStore = {};
export const abnormalNiedStations = {};
const { setTimeout, clearTimeout } = globalThis.__niedReplayTimers;
${section(read('src/classes/StationClasses.js'), 'export class NiedStation', 'export class KmaStation')}`
await load('src/classes/replay-nied-station.js', stationSource)
const component = read('src/components/components/NiedNet.vue')
const detectorSource = `
import { NiedStation, abnormalNiedStations } from '@/classes/replay-nied-station';
import { createHypocenterTriggerSnapshots } from '@/features/stations/HypocenterTriggerSnapshots';
import { niedSitePub } from '@/utils/NiedSitePub';
import { exactRound, calcDistanceKm, calcBearingDeg, timeToStamp, getShindoFromLevel } from '@/utils/Utils';
export function createDetector(roster, sensitivity) {
    const stationList = structuredClone(roster.items), stations = [], stationData = { value: [] };
    const settingsStore = { mainSettings: { displaySeisNet: { niedSensitivity: sensitivity } } };
    const statusStore = { isActive: { niedNet: false } };
    const document = { visibilityState: 'hidden' }, reactive = x => x;
    const niedUpdateTime = { value: '' }, niedMaxShindo = { value: '' };
    const useStationCanvasRenderer = { value: true };
    const map = {}, adjStationIds = {}, adjStations4Hypo = {}, triggerDiffToleranceMatrix = [];
    const triggerCompatibilityConfig = { waveSpeedKmPerSecond: 3.5, fixedToleranceMilliseconds: 2000 };
    const bearingDirections = ['N', 'E', 'S', 'W'], minHypocenterNeighborsPerDirection = 2;
    let stationDistanceTable, updateStamp, decimal = [0, 0], pendingRender = false, captured = null;
    const isNiedHypoInfEnabled = () => true, renderAll = () => {}, terminateHypocenterWorker = () => {}, clearInferredHypocenters = () => {};
    const resetHypocenterWorker = () => { captured = null };
    ${section(component, 'const nearbyLength', 'const inferredHypocenterLabelOffset')}
    ${section(component, 'const calcBearingDirection', 'let pendingRender')}
    ${section(component, 'const stationToInferredHypocenterSnapshot', 'const updateInferredHypocentersInWorker')}
    const updateInferredHypocentersInWorker = (picks, active, inactive, frameStamp) => {
        captured = { frameStamp, triggerStations: createHypocenterTriggerSnapshots(stations), pickCandidates: picks.map(stationToInferredHypocenterPickSnapshot), activeStations: active.map(stationToInferredHypocenterSnapshot), inactiveStations: [...inactive].map(stationToInferredHypocenterSnapshot) };
    };
    ${section(component, 'const update = ()=>', 'const getHypocenterWorker')}
    ${section(component, 'const chainActivate =', 'const renderAll =')}
    ${section(component, '//使用NIED的测站数据提高经纬度精度', '            initStationCanvasLayer()')}
    Object.keys(abnormalNiedStations).forEach(key => delete abnormalNiedStations[key]);
    return {
        stations, adjacency: adjStations4Hypo, distanceTable: stationDistanceTable,
        next(frame) {
            captured = null;
            stationData.value = frame.intensity.split('');
            niedUpdateTime.value = frame.dataTime.slice(0, 19).replace('T', ' ');
            update();
            statusStore.isActive.niedNet = stations.some(station => station.isActive);
            return captured;
        }
    };
}`
const { createDetector } = await load('src/components/components/replay-nied-detector.js', detectorSource)
const { FindNiedHypocenter } = await load('src/classes/NiedHypoInf.js')
const { calcDistanceKm } = await load('src/utils/Utils.js')
const { shouldDisplayInferredHypocenter } = await load('src/features/eew/EewNetworkRelations.js')

const inputPath = 'etc/hypocenter/test/fixtures/nied_replay_windows_20260926.txt'
const catalogPath = 'etc/hypocenter/test/fixtures/nied_replay_catalog_20260926.json'
// Independent catalog times are used only after inference, never as search seeds.
const catalogEntries = JSON.parse(read(catalogPath))
const events = read(inputPath).trim().split(/\r?\n/).map((line, index) => {
    const [date, time, lat, lng, depth] = line.trim().split(/\s+/)
    const startStamp = Date.parse(`${date}T${time}+08:00`)
    assert(Number.isFinite(startStamp))
    return { index: index + 1, startChina: `${date} ${time}`, startStamp, lat: +lat, lng: +lng, depth: +depth }
})
const selected = process.argv.slice(2).map(Number)
assert(selected.every(index => Number.isInteger(index) && index >= 1 && index <= events.length))
const sourceHashes = Object.fromEntries([
    'src/classes/StationClasses.js', 'src/classes/FindHypocenter.js', 'src/classes/NiedHypocenterProfile.js',
    'src/features/stations/HypocenterTriggerSnapshots.js',
    'src/components/components/NiedNet.vue', 'src/utils/TravelTimes.js', 'src/utils/NiedSitePub.js', inputPath, catalogPath,
    'etc/hypocenter/test/nied_batch_replay.mjs'
].map(name => [name, createHash('sha256').update(read(name)).digest('hex')]))
const waveCounts = results => results.reduce((counts, item) => {
    counts[item.wave] = (counts[item.wave] ?? 0) + 1
    return counts
}, {})
const referenceFits = (finder, event, result) => {
    // Keep exactly the same effective observations and weights for each comparison.
    // The replay start is never used as an origin-time constraint.
    const cache = new Map()
    const catalog = catalogEntries.find(entry => entry.index === event.index)
    const items = result.pickResults.filter(item => item.weight > 0 && ['P', 'S'].includes(item.wave)).map(item => {
        const options = finder.calcPickOriginOptions(item.pick, event, cache)
        return { stationId: item.pick.stationId, weight: item.weight, assigned: item.wave,
            P: options.P.originStamp, S: options.S.originStamp,
            pResidualSeconds: (options.P.originStamp - catalog.originStamp) / 1000,
            sResidualSeconds: (options.S.originStamp - catalog.originStamp) / 1000,
            pArrivalChina: fmt(catalog.originStamp + options.P.reachTime),
            sArrivalChina: fmt(catalog.originStamp + options.S.reachTime) }
    })
    const fit = waves => {
        const entries = items.map((item, i) => ({ value: item[waves[i]], weight: item.weight }))
        const originStamp = finder.calcWeightedMean(entries)
        return { originStamp, originChina: fmt(originStamp), rmse: finder.calcWeightedRmse(entries, originStamp) / 1000,
            waves: waveCounts(waves.map(wave => ({ wave }))) }
    }
    const allP = fit(items.map(() => 'P'))
    const allS = fit(items.map(() => 'S'))
    const assigned = fit(items.map(item => item.assigned))
    // In one-dimensional origin time, nearest-phase assignments change only at
    // each pick's P/S midpoint. Enumerating these intervals finds the global fit.
    const boundaries = [...new Set(items.map(item => (item.P + item.S) / 2))].sort((a, b) => a - b)
    const probes = [boundaries[0] - 1, ...boundaries.map(value => value + 0.001)]
    const alternatives = probes.map(origin => {
        const waves = items.map(item => Math.abs(item.P - origin) <= Math.abs(item.S - origin) ? 'P' : 'S')
        return { ...fit(waves), assignments: items.map((item, i) => ({ stationId: item.stationId, wave: waves[i] })) }
    }).sort((a, b) => a.rmse - b.rmse)
    return { catalog, allP, allS, assigned, best: alternatives[0], items }
}
const summarize = (finder, detector, event, result, stamp) => ({
    timeChina: fmt(stamp), stamp, secondsFromReplayStart: (stamp - event.startStamp) / 1000,
    hypocenter: result.hypocenter, originChina: fmt(result.originStamp),
    epicenterErrorKm: calcDistanceKm([event.lat, event.lng], [result.hypocenter.lat, result.hypocenter.lng]),
    waves: waveCounts(result.pickResults.filter(item => item.weight > 0)),
    scenario: result.scenario, filterStageLevel: result.filterStageLevel,
    stations: result.clusterStationCount, rmse: result.rmse, score: result.score,
    waveCountPenalty: result.waveCountPenalty, inactivePenalty: result.inactivePenalty * result.inactivePenaltyWeight,
    unexplainedPickPenalty: result.unexplainedPickPenalty, qualityScore: result.qualityScore,
    reportNum: result.reportNum, clusterId: result.clusterId,
    nearestReferenceDistanceKm: Math.min(...result.clusterPicks.map(pick => calcDistanceKm(pick.latLng, [event.lat, event.lng]))),
    referenceFits: referenceFits(finder, event, result),
    picks: result.pickResults.map(item => ({
        ...item, triggerChina: fmt(item.pick.triggerStamp),
        historyNewestFirst: [...detector.stations[item.pick.stationId].recentLevel]
    }))
})

for(const event of events.filter(event => selected.length === 0 || selected.includes(event.index))) {
    console.log(`START ${event.index} ${event.startChina} ${event.lat},${event.lng} ${event.depth} km`)
    const evidence = { event, sourceHashes, siteConfigId: roster.siteConfigId, sensitivity: 1,
        replay: 'Start exactly at supplied UTC+8 time; complete one-second frames; production activation and solver; virtual timers; no EEW suppression.',
        first: null, firstVisible: null, initialClusters: [], processedFrames: 0 }
    const filename = path.join(output, `event-${String(event.index).padStart(2, '0')}.json`)
    const detector = createDetector(roster, 1)
    timers.clear()
    let finder = null
    const seenClusters = new Set()
    try {
        for(let offset = 0; offset <= 600 && !evidence.firstVisible; offset += 30) {
            const stamps = Array.from({ length: Math.min(30, 601 - offset) }, (_, i) => event.startStamp + (offset + i) * 1000)
            const frames = await getFrames(stamps)
            for(const frame of frames) {
                replayNow = frame.stamp
                for(const [id, timer] of timers) if(timer.at <= replayNow) { timers.delete(id); timer.fn() }
                const update = detector.next(frame)
                evidence.processedFrames++
                evidence.lastFrameChina = fmt(frame.stamp)
                if(!update) { finder = null; seenClusters.clear(); continue }
                finder ??= new FindNiedHypocenter(update.inactiveStations, detector.adjacency, null, detector.distanceTable)
                const results = finder.update(update.pickCandidates, update.inactiveStations, update.activeStations, update.frameStamp, update.triggerStations)
                for(const result of results) {
                    if(!Number.isFinite(result.score)) continue
                    const visible = shouldDisplayInferredHypocenter('niedNet', result, [], true)
                    if(!evidence.first || (!evidence.firstVisible && visible) || !seenClusters.has(result.clusterId)) {
                        const summary = summarize(finder, detector, event, result, frame.stamp)
                        if(!evidence.first) evidence.first = summary
                        if(!seenClusters.has(result.clusterId)) evidence.initialClusters.push(summary)
                        if(!evidence.firstVisible && visible) evidence.firstVisible = summary
                        seenClusters.add(result.clusterId)
                    }
                }
                if(evidence.firstVisible) break
            }
            writeFileSync(filename, JSON.stringify(evidence, null, 2))
            console.log(`PROGRESS ${event.index} ${evidence.lastFrameChina} first=${evidence.first?.timeChina ?? '-'} visible=${evidence.firstVisible?.timeChina ?? '-'}`)
        }
        evidence.complete = true
    } catch(error) {
        evidence.error = error.stack
        evidence.complete = false
        console.log(`ERROR ${event.index} ${error}`)
    }
    evidence.finishedAt = new Date().toISOString()
    writeFileSync(filename, JSON.stringify(evidence, null, 2))
    const first = evidence.firstVisible
    console.log('RESULT ' + JSON.stringify({ index: event.index, complete: evidence.complete, processedFrames: evidence.processedFrames,
        first: evidence.first?.timeChina, visible: first?.timeChina, waves: first?.waves,
        hypo: first?.hypocenter, rmse: first?.rmse, referenceP: first?.referenceFits.allP.rmse,
        referenceS: first?.referenceFits.allS.rmse, referenceBest: first?.referenceFits.best.waves }))
}
