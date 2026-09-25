// Run from any directory: node --experimental-vm-modules etc/hypocenter/test/compare_nied_profile.mjs [baseline-ref]
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SourceTextModule } from 'node:vm'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const baselineRef = process.argv[2] ?? '2a420f4c5fe435688a6862147e0967e9393623fc'
const baselineSource = execFileSync('git', ['show', `${baselineRef}:src/classes/NiedHypoInf.js`], { cwd: root, encoding: 'utf8' })
const parameterNames = [...baselineSource.slice(0, baselineSource.indexOf('const sortedInactiveStationsCacheKey'))
    .matchAll(/^const (\w+) =/gm)].map(match => match[1]).filter(name => name !== 'nearTravelTimeMaxDistance')
assert.equal(parameterNames.length, 25, 'The baseline must be the original NIED implementation')

// Load the actual math exports without importing Utils.js's UI dependencies.
// Both implementations share these unmodified functions and the actual travel-time tables.
const utilsSource = readFileSync(path.join(root, 'src/utils/Utils.js'), 'utf8')
const section = (start, end) => {
    const from = utilsSource.indexOf(start)
    const to = utilsSource.indexOf(end, from)
    assert(from >= 0 && to > from, `Missing utility section: ${start}`)
    return utilsSource.slice(from, to)
}
const mathSource = [
    section('const EARTH_RADIUS_KM', 'export const calcBearingDeg'),
    section('export const calcReachTime', 'export const extractNumbers'),
    section('export const exactRound', 'export const getCoordByDistanceBearing')
].join('\n')
const modules = new Map()
const moduleFor = (filename, source) => {
    if(!modules.has(filename)) {
        modules.set(filename, new SourceTextModule(source ?? readFileSync(filename, 'utf8'), { identifier: filename }))
    }
    return modules.get(filename)
}
const linker = (specifier, referringModule) => {
    let filename = specifier.startsWith('@/')
        ? path.join(root, 'src', specifier.slice(2))
        : path.resolve(path.dirname(referringModule.identifier), specifier)
    if(!path.extname(filename)) filename += '.js'
    return moduleFor(filename, specifier === '@/utils/Utils' ? mathSource : undefined)
}
const baselineModule = moduleFor(path.join(root, 'baseline-nied.js'),
    `${baselineSource}\nexport const baselineParameters = { ${parameterNames.join(', ')} }`)
await baselineModule.link(linker)
await baselineModule.evaluate()
const currentModule = moduleFor(path.join(root, 'src/classes/NiedHypoInf.js'))
await currentModule.link(linker)
await currentModule.evaluate()
const Baseline = baselineModule.namespace.FindNiedHypocenter
const Current = currentModule.namespace.FindNiedHypocenter
const Core = modules.get(path.join(root, 'src/classes/FindHypocenter.js')).namespace.FindHypocenter
const profile = modules.get(path.join(root, 'src/classes/NiedHypocenterProfile.js')).namespace.niedHypocenterProfile
const { calcDistanceKm, calcReachTime } = modules.get(path.join(root, 'src/utils/Utils.js')).namespace
const travelTimes = modules.get(path.join(root, 'src/utils/TravelTimes.js')).namespace.default
for(const name of parameterNames) assert.deepStrictEqual(profile.parameters[name], baselineModule.namespace.baselineParameters[name], name)
console.log(`PASS ${parameterNames.length} parameters against the unmodified original NIED baseline`)

let comparisons = 0
const equal = (current, baseline, label) => {
    assert.deepStrictEqual(current, baseline, label)
    comparisons++
}
const oldFinder = new Baseline([], {})
const newFinder = new Current([], {})
const compareMethod = (name, ...args) => equal(newFinder[name](...args), oldFinder[name](...args), name)
const stamp = 1788880000000
for(const id of [0, 1, -1, 1.5, '1', 'W460', '', null, undefined, NaN, Infinity]) {
    for(const triggerStamp of [0, stamp, NaN, Infinity]) {
        const pick = { stationId: id, triggerStamp, pickId: `${id}:${triggerStamp}` }
        compareMethod('hasValidPickCandidate', pick)
        compareMethod('hasValidPickCandidate', { ...pick, pickId: 'invalid' })
    }
}
for(const ascend of [undefined, null, NaN, -1, 0, 1.999, 2, 2.999, 3, 3.999, 4, 9.999, 10, 12, Infinity]) {
    for(const level of [-1, 4.999, 5, 20]) {
        const pick = { maxAscend: ascend, maxLevel: level }
        compareMethod('isPenaltyReferencePick', pick)
        for(const densityWeight of [undefined, 0, 0.25, 1]) {
            compareMethod('getPickWeight', { ...pick, densityWeight }, 0.7)
        }
    }
}
for(const count of [0, 4, 5, 9, 10, 29, 30, 49, 50, 99, 100, 199, 200]) {
    compareMethod('calcInactivePenaltyWeight', count)
    for(const rank of [1, 20, 21, 40, 41, 80, 81, 100]) compareMethod('calcTriggerRankWeight', rank, count)
    for(const score of [-Infinity, -1, 0, 0.999, 1, 1.999, 2, 2.999, 3, 5, Infinity, NaN]) {
        compareMethod('calcQualityScore', score, count)
        compareMethod('calcQualityRank', score, count)
    }
}
for(const depth of [undefined, null, -1, 0, 10, 699, 700, 701, NaN]) {
    const hypo = { lat: 35.333, lng: 181.5, depth }
    compareMethod('normalizeHypocenter', hypo)
    compareMethod('createNeighborHypocenters', hypo, 0.1, 10)
}
for(const distance of [0, 30, 1999.999, 2000, 2000.001, 2100, NaN]) {
    assert.equal(profile.selectTravelTimeTable(distance), distance <= 2000 ? travelTimes.jma2001 : travelTimes.jb)
    for(const delta of [-0.001, 0, 0.001]) {
        compareMethod('arePicksAssociated', { triggerStamp: stamp },
            { triggerStamp: stamp + distance / 3.5 * 1000 + 2000 + delta }, distance)
    }
}
for(const pCount of [0, 1, 4]) {
    for(const sCount of [0, 3, 4, 5, 12, 20]) {
        const picks = [
            ...Array.from({ length: pCount }, () => ({ wave: 'P', weight: 1 })),
            ...Array.from({ length: sCount }, () => ({ wave: 'S', weight: 1 }))
        ]
        compareMethod('calcWaveCountPenalty', picks)
        for(const stage of profile.parameters.inheritedOutlierFilterStages) compareMethod('calcWaveCountPenalty', picks, stage.waveCountPenalty)
    }
}
const entries = Array.from({ length: 30 }, (_, i) => ({ value: stamp + (i % 2 ? 100 : -100), weight: 1 }))
const options = { P: { wave: 'P', originStamp: stamp + 6000 }, S: { wave: 'S', originStamp: stamp + 15000 } }
for(const stage of [undefined, null, { minCount: 1, ratio: 2, minResidual: 500 }]) {
    compareMethod('selectClosestOption', options, entries, stage)
    compareMethod('isResidualOutlier', options, entries, stamp, stage)
}
assert.equal(newFinder.selectClosestOption(options, entries), null, 'Undefined uses the current default filter')
assert.equal(newFinder.selectClosestOption(options, entries, null), options.P, 'Null disables the filter')
const filterLevels = new Set()
for(const count of [9, 10, 29, 30, 99, 100, 110]) {
    const inheritedItems = Array.from({ length: count }, (_, index) => ({
        index, originStamp: stamp + (index === count - 1 ? 9000 : index % 2 ? 100 : -100), weight: 1
    }))
    compareMethod('calcInheritedOutlierFilterResults', inheritedItems, count)
    newFinder.calcInheritedOutlierFilterResults(inheritedItems, count).forEach(result => filterLevels.add(result.filterStage?.level ?? 0))
}
assert.deepEqual([...filterLevels].sort(), [0, 1, 2, 3], 'Exercise all inherited filter stages')

const hypocenter = { lat: 35, lng: 139, depth: 30 }
const makeStations = (count, center = hypocenter, offset = 0) => Array.from({ length: count }, (_, index) => ({
    id: offset + index,
    latLng: [center.lat + Math.cos(index * 2.39996) * (0.1 + index * 0.025),
        center.lng + Math.sin(index * 2.39996) * (0.1 + index * 0.025)]
}))
const makePick = (station, wave = 'P', originStamp = stamp, center = hypocenter) => {
    const distance = calcDistanceKm([center.lat, center.lng], station.latLng)
    const table = distance <= 2000 ? travelTimes.jma2001 : travelTimes.jb
    const triggerStamp = Math.round((originStamp + calcReachTime(table, wave === 'P', center.depth, distance) * 1000) / 1000) * 1000
    return { stationId: station.id, pickId: `${station.id}:${triggerStamp}`, latLng: station.latLng,
        triggerStamp, updateStamp: triggerStamp + 1000, ascend: 5, level: 9 }
}
const activeSnapshot = pick => ({ ...pick, id: pick.stationId, isActive: true })
const adjacency = (stations, connected = () => true) => Object.fromEntries(stations.map(station => [station.id,
    stations.filter(neighbor => connected(station, neighbor)).map(neighbor => ({
        stationId: neighbor.id, distance: calcDistanceKm(station.latLng, neighbor.latLng)
    }))]))
// Compare all enumerable state apart from the new configuration references and opaque caches.
const snapshot = finder => Object.fromEntries(Object.entries(finder)
    .filter(([key, value]) => key !== 'profile' && key !== 'parameters' && key !== 'stationDistanceTable' && !(value instanceof WeakMap)))
// Keep the original density inputs and disable the breadth station bonus to isolate
// solver equivalence. Both intentional policies are covered by palert_inference.mjs.
const pair = adj => {
    const baseline = new Baseline([], adj)
    const current = new Current([], adj, structuredClone(baseline.stationDensityWeights))
    current.parameters = { ...current.parameters, penaltyBreadthKmPerStation: 0 }
    return { baseline, current }
}
let frames = 0
const update = (finders, picks, active = picks.map(activeSnapshot), inactive = []) => {
    const args = [picks, inactive, active]
    const expected = finders.baseline.update(...structuredClone(args))
    const actual = finders.current.update(...structuredClone(args))
    equal(actual, expected, `Frame ${frames}: public results`)
    equal(snapshot(finders.current), snapshot(finders.baseline), `Frame ${frames}: state and PREV results`)
    frames++
    return actual
}
for(const center of [hypocenter, { lat: 38, lng: 142, depth: 150 }]) {
    const stations = makeStations(16, center)
    const picks = stations.map((station, i) => makePick(station, i % 3 ? 'P' : 'S', stamp, center))
        .sort((a, b) => a.triggerStamp - b.triggerStamp)
    const finders = pair(adjacency(stations))
    update(finders, [])
    assert.equal(update(finders, picks.slice(0, 4)).length, 0)
    assert(update(finders, picks.slice(0, 5)).length > 0, 'First solution at five stations')
    update(finders, picks.slice(0, 12))
    update(finders, picks)
    assert(finders.current.clusters.some(cluster => cluster.previousResults.P && cluster.previousResults.S))
    update(finders, picks, picks.map(pick => activeSnapshot({ ...pick, ascend: 6, level: 11, updateStamp: pick.updateStamp + 1000 })))
    const repeated = [1000, 2000].map(delta => ({ ...picks[0], triggerStamp: picks[0].triggerStamp + delta,
        pickId: `${picks[0].stationId}:${picks[0].triggerStamp + delta}` }))
    const withDuplicates = update(finders, [...picks, ...repeated])
    assert(withDuplicates.some(result => result.pickResults.some(pick => pick.excludedReason === 'duplicate-phase')))
    // Repeated submissions update the existing pick instead of creating another identity.
    update(finders, [...picks, ...repeated])
    update(finders, [], [], stations.map(station => ({ ...station, updateStamp: stamp + 120000 })))
    assert.equal(finders.current.clusters.length, 0)
    assert.equal(finders.current.picks.size, 0)
    const nextPicks = stations.map(station => makePick(station, 'P', stamp + 180000, center))
    assert(update(finders, nextPicks).length > 0, 'A new event starts after cleanup')
    console.log(`PASS sequential inference at depth ${center.depth} km`)
}

// Two subthreshold groups become one cluster when a connecting station triggers.
const mergeStations = makeStations(9)
const mergePicks = mergeStations.map(station => makePick(station))
const mergePair = pair(adjacency(mergeStations, (a, b) => a.id === 8 || b.id === 8 || Math.floor(a.id / 4) === Math.floor(b.id / 4)))
update(mergePair, mergePicks.slice(0, 8))
assert.equal(mergePair.current.clusters.length, 2)
assert(update(mergePair, mergePicks).length > 0)
assert.equal(mergePair.current.clusters.length, 1)

// Reference selection is unchanged; excess inactive evidence remains a finite, uncapped ratio.
const penaltyStations = makeStations(6)
const penaltyPicks = penaltyStations.map(station => oldFinder.createPickSnapshot(makePick(station)))
const weakPicks = penaltyPicks.map(pick => ({ ...pick, maxAscend: 2, maxLevel: 4 }))
const quietStations = Array.from({ length: 8 }, (_, index) => ({ id: 100 + index, latLng: [35, 139], updateStamp: stamp + 60000 }))
const penaltyPair = pair({})
for(const finder of Object.values(penaltyPair)) finder.setInactiveStations(quietStations)
for(const picks of [penaltyPicks, weakPicks]) {
    for(const name of ['getInactivePenaltyReferenceDistance', 'selectFallbackPenaltyReferencePick']) {
        const argsFor = () => [structuredClone(picks), hypocenter, new Map()]
        equal(penaltyPair.current[name](...argsFor()), penaltyPair.baseline[name](...argsFor()), name)
    }
    assert.equal(penaltyPair.baseline.calcInactiveStationPenalty(hypocenter, picks, new Map()).exceeded, true)
    assert.equal(penaltyPair.current.calcInactiveStationPenalty(hypocenter, picks, new Map()), 8 / 6)
    assert.equal(penaltyPair.baseline.evaluateHypocenter(picks, hypocenter).score, Infinity)
    assert(Number.isFinite(penaltyPair.current.evaluateHypocenter(picks, hypocenter).score), 'Excess inactive stations no longer invalidate a candidate')
}
for(const finder of Object.values(penaltyPair)) finder.setInactiveStations(quietStations.slice(0, 2))
equal(penaltyPair.current.calcInactiveStationPenalty(hypocenter, penaltyPicks, new Map()),
    penaltyPair.baseline.calcInactiveStationPenalty(hypocenter, penaltyPicks, new Map()).penalty, 'Finite inactive penalty')
for(const picks of [[], weakPicks.map(pick => ({ ...pick, latLng: [NaN, NaN] }))]) {
    compareMethod('getInactivePenaltyReferenceDistance', picks, hypocenter, new Map())
    compareMethod('selectFallbackPenaltyReferencePick', picks, hypocenter, new Map())
}

const baselineCluster = oldFinder.createCluster([], null)
const currentCluster = newFinder.createCluster([], null)
for(let i = 0; i < 16; i++) {
    oldFinder.refreshClusterReportState(baselineCluster, hypocenter)
    newFinder.refreshClusterReportState(currentCluster, hypocenter)
    equal(currentCluster, baselineCluster, 'Stable report counter')
}
assert.equal(currentCluster.stable, true)
for(const next of [{ ...hypocenter, depth: 40 }, null]) {
    oldFinder.refreshClusterReportState(baselineCluster, next)
    newFinder.refreshClusterReportState(currentCluster, next)
    equal(currentCluster, baselineCluster, 'Changed or invalid report resets stability')
}

// A separate profile can change policies without changing another finder or NIED defaults.
const alternativeProfile = { ...profile, parameters: { ...profile.parameters, minInferenceStationCount: 99, initialDepth: 25 },
    isValidStationId: id => typeof id === 'string', getPickBaseWeight: () => 2,
    isPenaltyReferencePick: () => false, selectTravelTimeTable: () => travelTimes.jb, calcQualityScore: () => 42 }
const alternative = new Core([], {}, alternativeProfile)
assert(alternative.hasValidPickCandidate({ stationId: 'W460', triggerStamp: stamp, pickId: `W460:${stamp}` }))
assert(!newFinder.hasValidPickCandidate({ stationId: 'W460', triggerStamp: stamp, pickId: `W460:${stamp}` }))
assert.equal(alternative.getPickWeight({ maxAscend: 0, densityWeight: 0.5 }), 1)
assert.equal(alternative.isPenaltyReferencePick({ maxAscend: 10, maxLevel: 10 }), false)
assert.equal(alternative.calcQualityScore(1, 10), 42)
assert.equal(alternative.normalizeHypocenter({ lat: 35, lng: 139 }).depth, 25)
assert.equal(alternative.getOptionCacheEntry(penaltyPicks[0], hypocenter, new Map()).travelTime, travelTimes.jb)
assert.equal(alternative.update(mergePicks, [], mergePicks.map(activeSnapshot)).length, 0)
assert.equal(newFinder.parameters.minInferenceStationCount, 5)
console.log(`PASS ${frames} sequential frames and ${comparisons} exact comparisons with original density inputs and no breadth station bonus; profile isolation verified`)
