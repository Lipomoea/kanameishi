// Real-event replay, using production station activation and inference code.
// node --experimental-vm-modules etc/hypocenter/test/nied_event_bias.mjs
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { SourceTextModule } from 'node:vm'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const output = path.join(root, 'etc/hypocenter/test/nied-20260616.local')
mkdirSync(output, { recursive: true })
const read = name => readFileSync(path.join(root, name), 'utf8')
const section = (source, start, end) => {
    const a = source.indexOf(start), b = source.indexOf(end, a + start.length)
    assert(a >= 0 && b > a, `Missing production section ${start}`)
    return source.slice(a, b)
}
// This is the replay start, not the earthquake origin.
const event = { replayStartStamp: Date.parse('2026-06-16T18:46:30+08:00'), lat: 36.1117, lng: 139.8750, depth: 50 }
const fmt = (stamp, offset = 8) => new Date(stamp + offset * 3600000).toISOString().slice(0, 23)
const cacheJson = async (name, url) => {
    const filename = path.join(output, name)
    if(existsSync(filename)) return JSON.parse(readFileSync(filename, 'utf8'))
    let lastError
    for(let retry = 0; retry < 3; retry++) {
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
const roster = await cacheJson('sitelist.json', 'https://weather-kyoshin.east.edge.storage-yahoo.jp/SiteList/sitelist.json')
const frameSpecs = Array.from({ length: 136 }, (_, i) => {
    const stamp = event.replayStartStamp + (i - 70) * 1000
    const key = fmt(stamp, 9).slice(0, 19).replaceAll(/[-:T]/g, '')
    return { stamp, key }
})
const frames = new Array(frameSpecs.length)
let fetchIndex = 0
await Promise.all(Array.from({ length: 4 }, async () => {
    while(fetchIndex < frameSpecs.length) {
        const index = fetchIndex++, { stamp, key } = frameSpecs[index]
        const data = await cacheJson(`${key}.json`, `https://weather-kyoshin.east.edge.storage-yahoo.jp/RealTimeData/${key.slice(0, 8)}/${key}.json`)
        const frame = data.realTimeData
        assert.equal(frame.siteConfigId, roster.siteConfigId)
        assert.equal(Date.parse(frame.dataTime), stamp)
        assert.equal(frame.intensity.length, roster.items.length)
        frames[index] = { stamp, ...frame }
    }
}))
console.log(`Loaded ${frames.length} complete frames, ${roster.items.length} stations, configuration ${roster.siteConfigId}`)

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
        adjacency: adjStations4Hypo, distanceTable: stationDistanceTable,
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
const summarize = (result, stamp) => {
    if(!result) return null
    const waves = result.pickResults.reduce((counts, pick) => {
        if(pick.weight > 0) counts[pick.wave] = (counts[pick.wave] ?? 0) + 1
        return counts
    }, {})
    return {
        timeChina: fmt(stamp), elapsed: (stamp - event.replayStartStamp) / 1000,
        hypocenter: result.hypocenter, originChina: fmt(result.originStamp),
        epicenterErrorKm: calcDistanceKm([event.lat, event.lng], [result.hypocenter.lat, result.hypocenter.lng]),
        scenario: result.scenario, waves, stations: result.clusterStationCount, rmse: result.rmse,
        inactivePenalty: result.inactivePenalty * result.inactivePenaltyWeight,
        waveCountPenalty: result.waveCountPenalty, unexplainedPickPenalty: result.unexplainedPickPenalty,
        score: result.score, qualityScore: result.qualityScore, reportNum: result.reportNum
    }
}
const detections = new Map()
for(const sensitivity of [1, 2, 3]) {
    timers.clear()
    const detector = createDetector(roster, sensitivity)
    const updates = frames.map(frame => {
        replayNow = frame.stamp
        for(const [id, timer] of timers) if(timer.at <= replayNow) { timers.delete(id); timer.fn() }
        return { stamp: frame.stamp, update: detector.next(frame) }
    })
    detections.set(sensitivity, { detector, updates })
}
timers.clear()
const shortLeadDetector = createDetector(roster, 1)
const shortLeadUpdates = frames.filter(frame => frame.stamp >= event.replayStartStamp - 9000).map(frame => {
    replayNow = frame.stamp
    for(const [id, timer] of timers) if(timer.at <= replayNow) { timers.delete(id); timer.fn() }
    return { stamp: frame.stamp, update: shortLeadDetector.next(frame) }
})
detections.set('standard-nine-second-lead', { detector: shortLeadDetector, updates: shortLeadUpdates })
const run = (sensitivity, mode, bias, full = false) => {
    const { detector, updates } = detections.get(sensitivity)
    let finder, first = null, firstVisible = null, firstSnapshot = null
    const timeline = []
    for(const { stamp, update } of updates) {
        if(full && stamp > event.replayStartStamp + 20000) break
        if(!update) { finder = null; continue }
        if(!finder) {
            finder = new FindNiedHypocenter(update.inactiveStations, detector.adjacency, null, detector.distanceTable)
            finder.parameters = structuredClone(finder.parameters)
            if(mode === 'ratioCap') finder.parameters.defaultWaveCountPenaltyConfig.maxPenalty = bias
            if(mode === 'sBranch' || mode === 'sMajority') {
                finder.calcWaveCountPenalty = () => 0
                const create = finder.createScenarioLikelihoodResult
                finder.createScenarioLikelihoodResult = function(...args) {
                    const result = create.apply(this, args)
                    const pCount = result.pickResults.filter(p => p.weight > 0 && p.wave === 'P').length
                    const sCount = result.pickResults.filter(p => p.weight > 0 && p.wave === 'S').length
                    const penalized = mode === 'sBranch' ? result.firstWave === 'S' : sCount > pCount
                    const waveCountPenalty = penalized ? bias : 0
                    return this.createLikelihoodResultWithPickMetrics({ ...result, waveCountPenalty }, result.pickResults, args[8]?.picks.length ?? args[0].length)
                }
            }
        }
        const results = finder.update(update.pickCandidates, update.inactiveStations, update.activeStations, update.frameStamp, update.triggerStations)
        // Associate by the observed station cluster, never seed the solver with the catalog hypocenter.
        const matches = results.filter(result => result.clusterPicks.some(pick => calcDistanceKm(pick.latLng, [event.lat, event.lng]) < 100))
        for(const result of matches) {
            if(!first) {
                first = summarize(result, stamp)
                firstSnapshot = { stamp, picks: structuredClone(finder.clusters.find(c => c.id === result.clusterId).picks), update: structuredClone(update), result: structuredClone(result) }
            }
            if(!firstVisible && shouldDisplayInferredHypocenter('niedNet', result, [], true)) firstVisible = summarize(result, stamp)
            if(full) timeline.push(summarize(result, stamp))
        }
        if(!full && first && firstVisible) break
    }
    return { sensitivity, mode, bias, first, firstVisible, timeline, firstSnapshot }
}
const runs = []
for(const sensitivity of [1, 2, 3]) {
    for(const cap of [0, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2]) {
        const result = run(sensitivity, 'ratioCap', cap)
        const { firstSnapshot, ...compact } = result
        runs.push(compact)
        console.log(`sensitivity=${sensitivity} cap=${cap}: ${JSON.stringify(compact.first?.waves)} depth=${compact.first?.hypocenter.depth}`)
        if(cap === 0 || cap === 1) writeFileSync(path.join(output, `first-sensitivity${sensitivity}-cap${cap}.json`), JSON.stringify(firstSnapshot, null, 2))
    }
}
for(const mode of ['ratioCap', 'sBranch', 'sMajority']) {
    for(const bias of [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 2, 3, 5, 10]) {
        const { firstSnapshot, ...compact } = run(1, mode, bias)
        runs.push(compact)
        console.log(`${mode} bias=${bias}: ${JSON.stringify(compact.first?.waves)} depth=${compact.first?.hypocenter.depth}`)
    }
}
const thresholdBrackets = []
for(const mode of ['ratioCap', 'sBranch', 'sMajority']) {
    for(const criterion of ['pAnchor', 'pMajority']) {
        const accepted = r => criterion === 'pAnchor' ? r.first.scenario.startsWith('P') : (r.first.waves.P ?? 0) > (r.first.waves.S ?? 0)
        const samples = runs.filter(r => r.mode === mode && r.sensitivity === 1).sort((a, b) => a.bias - b.bias)
        const upper = samples.find(accepted)
        if(!upper) { thresholdBrackets.push({ mode, criterion, noSuccessThrough: 10 }); continue }
        let high = upper.bias, low = samples.filter(r => r.bias < high && !accepted(r)).at(-1)?.bias ?? 0
        while(high - low > 0.00001) {
            const mid = (low + high) / 2
            if(accepted(run(1, mode, mid))) high = mid
            else low = mid
        }
        const lowerRun = run(1, mode, low), upperRun = run(1, mode, high)
        thresholdBrackets.push({ mode, criterion, low, high, below: lowerRun.first, above: upperRun.first })
    }
}
console.log('THRESHOLDS', JSON.stringify(thresholdBrackets.map(({ mode, criterion, low, high, noSuccessThrough }) => ({ mode, criterion, low, high, noSuccessThrough }))))

// Diagnose independently optimized P-anchor/S-anchor branches and multiple depth seeds.
const snapshot = run(1, 'ratioCap', 0).firstSnapshot
const { detector } = detections.get(1)
const independent = []
for(const firstWave of ['P', 'S', null]) {
    for(const depth of [0, 10, 30, 50, 70, 100, 200, 400, 600]) {
        const finder = new FindNiedHypocenter(snapshot.update.inactiveStations, detector.adjacency, null, detector.distanceTable)
        finder.parameters = structuredClone(finder.parameters)
        finder.calcWaveCountPenalty = () => 0
        if(firstWave) finder.calcLikelihood = function(picks, hypocenter, previousWaveMaps, penaltyContext) {
            return this.calcFirstWaveLikelihood(picks, hypocenter, firstWave, new Map(), null, penaltyContext)
        }
        const initial = { ...finder.calcInitialHypocenterLatLng(snapshot.picks), depth }
        const result = finder.findBestHypocenterWithEffectivePicks(snapshot.picks, initial, null)
        independent.push({ firstWave, initial, ...summarize(result, snapshot.stamp) })
    }
}
console.log(`Evaluated ${independent.length} independent branch/depth starts`)
const catalogFinder = new FindNiedHypocenter(snapshot.update.inactiveStations, detector.adjacency, null, detector.distanceTable)
const catalogPicks = snapshot.picks.map(pick => {
    const options = catalogFinder.calcPickOriginOptions(pick, event, new Map())
    return {
        stationId: pick.stationId, latLng: pick.latLng, triggerChina: fmt(pick.triggerStamp),
        pOriginChina: fmt(options.P.originStamp),
        sOriginChina: fmt(options.S.originStamp),
        maxAscend: pick.maxAscend, maxLevel: pick.maxLevel
    }
})
const ablations = []
for(const excludedStation of [null, snapshot.picks[0].stationId]) {
    for(const cap of [0, 0.02, 0.05, 0.1, 0.2, 0.5, 1]) {
        const finder = new FindNiedHypocenter(snapshot.update.inactiveStations, detector.adjacency, null, detector.distanceTable)
        finder.parameters = structuredClone(finder.parameters)
        finder.parameters.defaultWaveCountPenaltyConfig.maxPenalty = cap
        const picks = snapshot.picks.filter(p => p.stationId !== excludedStation)
        const result = finder.findBestHypocenterWithEffectivePicks(picks, null, null)
        ablations.push({ excludedStation, cap, ...summarize(result, snapshot.stamp) })
    }
}
const earliestStationHistory = frames.filter(frame => frame.stamp >= event.replayStartStamp - 15000 && frame.stamp <= snapshot.stamp)
    .map(frame => ({ timeChina: fmt(frame.stamp), level: frame.intensity.charCodeAt(snapshot.picks[0].stationId) - 100 }))
console.log(`Evaluated ${ablations.length} single-station diagnostic comparisons`)
// Generate leave-one-out alternatives without knowing which station is suspect.
// Keep the full cluster's inactive evidence and charge its existing O-pick penalty.
const leaveOneOutResults = []
for(const excludedStation of [null, ...snapshot.picks.map(p => p.stationId)]) {
    const finder = new FindNiedHypocenter(snapshot.update.inactiveStations, detector.adjacency, null, detector.distanceTable)
    finder.calcWaveCountPenalty = () => 0
    const retained = snapshot.picks.filter(p => p.stationId !== excludedStation)
    const context = finder.createInactivePenaltyContext(snapshot.picks)
    let result = finder.findBestHypocenter(retained, null, null, context)
    const excluded = snapshot.picks.find(p => p.stationId === excludedStation)
    if(excluded) result = finder.createLikelihoodResultWithPickMetrics(result,
        [...result.pickResults, { pick: excluded, wave: 'O', weight: 0, excludedReason: 'leave-one-out-diagnostic' }], snapshot.picks.length)
    leaveOneOutResults.push({ excludedStation, result })
}
const leaveOneOut = leaveOneOutResults.map(({ excludedStation, result }) => ({ excludedStation, ...summarize(result, snapshot.stamp) }))
const leaveOneOutComparisons = [0, 0.074, 0.07461, 0.07462, 0.075, 0.1].map(cap => {
    const ranked = leaveOneOutResults.map(({ excludedStation, result }) => {
        const waveCountPenalty = catalogFinder.calcWaveCountPenalty(result.pickResults, { thresholdRatio: 3, maxPenalty: cap })
        return { excludedStation, result: catalogFinder.createLikelihoodResultWithPickMetrics({ ...result, waveCountPenalty }, result.pickResults, snapshot.picks.length) }
    }).sort((a, b) => a.result.score - b.result.score)
    return { cap, winner: { excludedStation: ranked[0].excludedStation, ...summarize(ranked[0].result, snapshot.stamp) } }
})
console.log('LEAVE_ONE_OUT', JSON.stringify(leaveOneOutComparisons.map(({ cap, winner }) => ({ cap, excludedStation: winner.excludedStation, waves: winner.waves, score: winner.score }))))
const shortLeadRuns = [0, 1, 1.2, 1.5, 2, 3, 5, 10].map(cap => {
    const { firstSnapshot, ...compact } = run('standard-nine-second-lead', 'ratioCap', cap)
    return compact
})
const shortSnapshot = run('standard-nine-second-lead', 'ratioCap', 0).firstSnapshot
const shortLeaveOneOut = []
for(const excludedStation of [null, ...shortSnapshot.picks.map(p => p.stationId)]) {
    const finder = new FindNiedHypocenter(shortSnapshot.update.inactiveStations, shortLeadDetector.adjacency, null, shortLeadDetector.distanceTable)
    finder.calcWaveCountPenalty = () => 0
    const retained = shortSnapshot.picks.filter(p => p.stationId !== excludedStation)
    let result = finder.findBestHypocenter(retained, null, null, finder.createInactivePenaltyContext(shortSnapshot.picks))
    const excluded = shortSnapshot.picks.find(p => p.stationId === excludedStation)
    if(excluded) result = finder.createLikelihoodResultWithPickMetrics(result,
        [...result.pickResults, { pick: excluded, wave: 'O', weight: 0, excludedReason: 'leave-one-out-diagnostic' }], shortSnapshot.picks.length)
    shortLeaveOneOut.push({ excludedStation, ...summarize(result, shortSnapshot.stamp) })
}
let shortLow = 0, shortHigh = shortLeadRuns.find(r => r.first.scenario.startsWith('P'))?.bias
if(shortHigh !== undefined) {
    while(shortHigh - shortLow > 0.00001) {
        const mid = (shortHigh + shortLow) / 2
        if(run('standard-nine-second-lead', 'ratioCap', mid).first.scenario.startsWith('P')) shortHigh = mid
        else shortLow = mid
    }
}
const shortLeadThreshold = { low: shortLow, high: shortHigh }
console.log('SHORT_LEAD', JSON.stringify({ shortLeadThreshold, candidates: shortLeaveOneOut.filter(r => r.excludedStation === null || r.excludedStation === 843) }))
const timelines = [0, 1, 1.5].map(bias => {
    console.log(`Replaying first 20 seconds with cap ${bias}`)
    const { firstSnapshot, ...compact } = run(1, 'ratioCap', bias, true)
    return compact
})
const provenance = {
    event, retrievedAt: new Date().toISOString(), siteConfigId: roster.siteConfigId,
    firstFrame: frames[0].dataTime, lastFrame: frames.at(-1).dataTime, frameCount: frames.length,
    replay: 'Complete one-second frames, production station/activation/solver code, virtual expiration timers, synchronous worker processing, no EEW display suppression.',
    sourceHashes: Object.fromEntries(['src/classes/StationClasses.js', 'src/classes/FindHypocenter.js', 'src/classes/NiedHypocenterProfile.js', 'src/features/stations/HypocenterTriggerSnapshots.js', 'src/components/components/NiedNet.vue', 'src/utils/TravelTimes.js', 'src/utils/NiedSitePub.js'].map(name => [name, createHash('sha256').update(read(name)).digest('hex')]))
}
writeFileSync(path.join(output, 'scan.json'), JSON.stringify({ provenance, runs, thresholdBrackets, independent, catalogPicks, ablations, earliestStationHistory, leaveOneOut, leaveOneOutComparisons, shortLeadRuns, shortLeaveOneOut, shortLeadThreshold, timelines }, null, 2))
console.log(`Saved replay evidence to ${output}`)
