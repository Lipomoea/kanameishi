// node etc/utils/test/float_boundaries.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = name => readFileSync(new URL(`../../../${name}`, import.meta.url), 'utf8')
const section = (source, start, end) => {
    const from = source.indexOf(start), to = source.indexOf(end, from)
    assert(from >= 0 && to > from, `Missing section: ${start}`)
    return source.slice(from, to)
}
const withoutImports = source => source.replace(/^import .*\r?\n/gm, '').replace(/^export /gm, '')
const utils = read('src/utils/Utils.js')
const { exactRound, compareFloat, calcDistanceKm, calcLngDiff } = new Function(
    withoutImports(section(utils, 'const EARTH_RADIUS_KM', 'export const calcBearingDeg')) +
    withoutImports(section(utils, 'export const exactRound', 'export const getCoordByDistanceBearing')) +
    '\nreturn { exactRound, compareFloat, calcDistanceKm, calcLngDiff };'
)()

const earthHalfCircumference = Math.PI * 6371.0088
assert.equal(calcDistanceKm([23.8, 120], [23.8, 120]), 0)
for(const [from, to] of [
    [[23.8, 120], [-23.8, -60]], [[0, 0], [0, 180]], [[90, 0], [-90, 0]],
]) {
    const distance = calcDistanceKm(from, to)
    assert(Number.isFinite(distance))
    assert(Math.abs(distance - earthHalfCircumference) < 1e-6)
    assert.equal(distance, calcDistanceKm(to, from))
}
assert(Math.abs(calcDistanceKm([0, 0], [0, 1]) - earthHalfCircumference / 180) < 1e-9)
for(const longitude of [179.99, 179.999, 179.9999]) {
    const distance = calcDistanceKm([0, 0], [0, longitude])
    assert(distance < earthHalfCircumference, 'Near-antipodal points retain their distance below the maximum')
    assert(Math.abs(distance - earthHalfCircumference * longitude / 180) < 1e-3)
}
assert(Number.isNaN(calcDistanceKm([NaN, 0], [0, 0])))
console.log('PASS coincident, ordinary, antipodal and near-antipodal distances')

const profile = new Function('travelTimes', withoutImports(read('src/classes/NiedHypocenterProfile.js')) +
    '\nreturn niedHypocenterProfile;')({})
const Finder = new Function('compareFloat', 'calcLngDiff', withoutImports(read('src/classes/FindHypocenter.js')) +
    '\nreturn FindHypocenter;')(compareFloat, calcLngDiff)
const finder = Object.assign(Object.create(Finder.prototype), { parameters: profile.parameters })
const stamp = 1788880000000
const matchesAssociatedEewHypocenter = new Function('compareFloat', 'calcLngDiff', 'timeToStamp',
    withoutImports(read('src/features/eew/EewNetworkRelations.js')) + '\nreturn matchesAssociatedEewHypocenter;'
)(compareFloat, calcLngDiff, () => stamp)
const matchers = [['niedNet', 'jmaEew'], ['palertNet', 'cwaEew']].map(([networkSource, eventSource]) => ({
    eventSource,
    match: (result, message) => matchesAssociatedEewHypocenter(networkSource, result, message)
}))
for(const axis of ['lat', 'lng']) {
    for(const delta of [-1e-9, 0, 1e-9]) {
        const first = { originStamp: stamp, hypocenter: { lat: 31.7, lng: 127.7, depth: 10 } }
        const second = { originStamp: stamp, hypocenter: { ...first.hypocenter, [axis]: first.hypocenter[axis] + 1 + delta } }
        const expected = delta <= 0
        assert.equal(finder.canMergeClusterResults(first, second), expected, `${axis} cluster boundary ${delta}`)
        for(const { match, eventSource } of matchers) {
            assert.equal(match(first, { source: eventSource, ...second.hypocenter, originTime: stamp }), expected,
                `${eventSource} ${axis} match boundary ${delta}`)
        }
    }
}
assert(finder.canMergeClusterResults(
    { originStamp: stamp, hypocenter: { lat: 0, lng: 179.7, depth: 10 } },
    { originStamp: stamp, hypocenter: { lat: 0, lng: -179.3, depth: 10 } }
), 'Longitude matching still wraps across the date line')
console.log('PASS shared cluster merge, NIED/JMA and P-Alert/CWA coordinate boundaries')

const gridBuilders = ['Nied', 'Kma'].map(name => {
    const source = read(`src/components/components/${name}Net.vue`)
    const start = source.indexOf('const grids = computed')
    const end = source.indexOf('\nconst ', start + 1)
    assert(start >= 0 && end > start)
    const build = new Function('exactRound', 'computed', 'activeStations', 'decimal',
        source.slice(start, end) + '\nreturn grids.value;')
    return { name, build: (points, decimal) => build(exactRound, fn => ({ value: fn() }),
        { value: points.map(point => ({ ...point, activityLevel: point.level })) }, decimal) }
})
const TaiwanLayers = new Function('exactRound', withoutImports(read('src/classes/TaiwanSeisNetLayers.js')) +
    '\nreturn TaiwanSeisNetLayers;')(exactRound)
gridBuilders.push({ name: 'Taiwan', build: (points, decimal) => {
    const layer = Object.assign(Object.create(TaiwanLayers.prototype), { decimal, gridPositionSignature: '' })
    layer.updateGrids(points)
    return layer.grids
} })
for(const [axis, center, boundary, lowerCenter] of [
    [0, 32.51, 32.01, 31.51], [1, 128.51, 128.01, 127.51], [0, -31.49, -31.99, -32.49],
]) {
    for(const delta of [-1e-9, 0, 1e-9]) {
        const decimal = [0, 0], centerLatLng = [24, 121], boundaryLatLng = [24, 121]
        decimal[axis] = 0.51
        centerLatLng[axis] = center
        boundaryLatLng[axis] = boundary + delta
        const points = [{ latLng: centerLatLng, level: 10 }, { latLng: boundaryLatLng, level: 8 }]
        for(const { name, build } of gridBuilders) {
            const grids = build(points, decimal)
            assert.equal(grids.length, delta < 0 ? 2 : 1, `${name} grid boundary ${boundary} + ${delta}`)
            assert(grids.some(grid => grid.latLng[axis] === center && grid.level === 10))
            if(delta < 0) assert(grids.some(grid => grid.latLng[axis] === lowerCenter && grid.level === 8))
        }
    }
}
console.log('PASS NIED, KMA and Taiwan grid boundaries on both sides, negative coordinates and merged levels')
