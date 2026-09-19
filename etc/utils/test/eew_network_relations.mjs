// node etc/utils/test/eew_network_relations.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import { L, mapViewBounds } from './fixtures/map_view_bounds.mjs'

dayjs.extend(utc)
const read = name => readFileSync(new URL(`../../../${name}`, import.meta.url), 'utf8')
const section = (source, start, end) => {
    const from = source.indexOf(start), to = source.indexOf(end, from)
    assert(from >= 0 && to > from, `Missing section: ${start}`)
    return source.slice(from, to)
}
const withoutImports = source => source.replace(/^import .*\r?\n/gm, '').replace(/^export /gm, '')
const utils = read('src/utils/Utils.js')
const math = new Function('dayjs',
    withoutImports(section(utils, 'export const calcLngDiff', 'export const calcBearingDeg')) +
    withoutImports(section(utils, 'export const timeToStamp', 'export const convertCompactTimeString')) +
    withoutImports(section(utils, 'export const exactRound', 'export const getCoordByDistanceBearing')) +
    '\nreturn { calcLngDiff, compareFloat, timeToStamp, stampToTime };'
)(dayjs)
const relations = new Function(...Object.keys(math), withoutImports(read('src/features/eew/EewNetworkRelations.js')) + `
    return { getEewNetworkRelation, getNetworkEewRelation, getGridNetworkRelation,
        shouldIncludeEewSWaveBounds, shouldDisplayNetworkGrid, isNetworkPeriodActive,
        matchesAssociatedEewHypocenter, shouldDisplayInferredHypocenter };
`)(...Object.values(math))
const { getEewNetworkRelation, getNetworkEewRelation, getGridNetworkRelation,
    shouldIncludeEewSWaveBounds, shouldDisplayNetworkGrid, isNetworkPeriodActive,
    matchesAssociatedEewHypocenter, shouldDisplayInferredHypocenter } = relations

const cases = [
    { eew: 'cwaEew', networks: ['palertNet', 'tremNet'], pane: 'taiwanGridPane', inference: { palertNet: 'palertInfHypo' } },
    { eew: 'jmaEew', networks: ['niedNet'], pane: 'niedGridPane', inference: { niedNet: 'niedInfHypo' } },
    { eew: 'kmaEew', networks: ['kmaNet'], pane: 'kmaGridPane', inference: {} }
]
for(const { eew, networks, pane, inference } of cases) {
    const relation = getEewNetworkRelation(eew)
    assert.deepEqual(relation.networkSources, networks)
    assert.deepEqual(relation.inferenceSources, inference)
    assert.equal(getGridNetworkRelation(pane), relation)
    for(const network of networks) assert.equal(getNetworkEewRelation(network), relation)
}

// Characterize the previous source-specific conditions over all activity combinations.
const activeKeys = ['cwaEew', 'jmaEew', 'kmaEew', 'palertNet', 'tremNet', 'niedNet', 'kmaNet', 'palertInfHypo', 'niedInfHypo']
for(let mask = 0; mask < 2 ** activeKeys.length; mask++) {
    const active = Object.fromEntries(activeKeys.map((key, index) => [key, !!(mask & (1 << index))]))
    const { cwaEew, jmaEew, kmaEew, palertNet, tremNet, niedNet, kmaNet, palertInfHypo, niedInfHypo } = active
    assert.equal(shouldIncludeEewSWaveBounds('cwaEew', active), !(palertNet || tremNet))
    assert.equal(shouldIncludeEewSWaveBounds('jmaEew', active), !niedNet)
    assert.equal(shouldIncludeEewSWaveBounds('kmaEew', active), !kmaNet)
    assert.equal(shouldIncludeEewSWaveBounds('ceaEew', active), true, 'Unassociated EEWs retain their wave bounds')
    assert.equal(shouldDisplayNetworkGrid('taiwanGridPane', active), !(cwaEew || palertInfHypo))
    assert.equal(shouldDisplayNetworkGrid('niedGridPane', active), !(jmaEew || niedInfHypo))
    assert.equal(shouldDisplayNetworkGrid('kmaGridPane', active), !kmaEew)
    for(const { pane } of cases) assert.equal(shouldDisplayNetworkGrid(pane, active, true), true)
    assert.equal(isNetworkPeriodActive('palertNet', active), cwaEew || palertNet)
    assert.equal(isNetworkPeriodActive('tremNet', active), cwaEew || tremNet)
    assert.equal(isNetworkPeriodActive('niedNet', active), jmaEew || niedNet)
    assert.equal(isNetworkPeriodActive('kmaNet', active), kmaEew || kmaNet)
}
assert.equal(getEewNetworkRelation('unknown'), undefined)
assert.equal(getNetworkEewRelation('unknown'), undefined)
assert.equal(getGridNetworkRelation('eewMarkerPane'), undefined)
console.log('PASS source associations, all 512 activity combinations, independent Taiwan periods and grid visibility overrides')

// Exercise the production setView: opacity must not remove a grid from bounds.
const setViewSource = section(read('src/components/MainMapComponent.vue'), 'const setView =', 'const smartSetView =')
const collectView = (eewSource, active, gridPane) => {
    const boundsParts = []
    const epicenter = L.latLng(24, 121)
    const grid = L.latLngBounds([[23, 120], [25, 122]])
    const wave = L.latLngBounds([[22, 119], [26, 123]])
    const layers = [{ options: { pane: 'eewMarkerPane' }, getLatLng: () => epicenter }]
    if(gridPane) layers.push({
        options: { pane: gridPane, isGridCanvasLayer: true, opacity: 0 },
        hasGrid: () => true, getBounds: () => grid
    })
    const bounds = L.latLngBounds([])
    const extend = bounds.extend.bind(bounds)
    bounds.extend = part => {
        boundsParts.push(part === epicenter ? 'epicenter' : part === grid ? 'grid' : 'wave')
        return extend(part)
    }
    const center = { lat: 24, lng: 121 }
    const map = {
        eachLayer: visit => layers.forEach(visit),
        _getBoundsCenterZoom: () => ({ center, zoom: 8 }),
        getCenter: () => center, getZoom: () => 8
    }
    const deps = { map, L: { latLngBounds: () => bounds }, document: { visibilityState: 'visible' },
        menuId: { value: 'eews' }, tempEqlists: { value: '' }, historyList: [],
        statusStore: { isActive: active }, getGridNetworkRelation, shouldIncludeEewSWaveBounds,
        ...mapViewBounds,
        activeEewList: [{ eqMessage: { source: eewSource }, sWaveFill: { getBounds: () => wave } }] }
    new Function(...Object.keys(deps), `${setViewSource}\nsetView(true);`)(...Object.values(deps))
    return boundsParts
}
for(const { eew, networks, pane } of cases) {
    assert.deepEqual(collectView(eew, {}, null), ['epicenter', 'wave'])
    for(const network of networks) {
        const active = { [eew]: true, [network]: true }
        assert.equal(shouldDisplayNetworkGrid(pane, active), false)
        assert.deepEqual(collectView(eew, active, pane), ['epicenter', 'grid'])
    }
}
assert.deepEqual(collectView('jmaEew', { palertNet: true }, 'taiwanGridPane'), ['epicenter', 'grid', 'wave'])
console.log('PASS actual map bounds retain hidden grids, substitute only related active networks and retain unrelated EEW waves')

const stamp = Date.UTC(2026, 8, 19, 0, 0, 0)
for(const [network, source, timeZone] of [['palertNet', 'cwaEew', 8], ['niedNet', 'jmaEew', 9]]) {
    const result = { hypocenter: { lat: 24, lng: 121, depth: 30 }, originStamp: stamp, qualityScore: -3 }
    const message = { source, ...result.hypocenter, originTime: math.stampToTime(stamp, timeZone), timeZone }
    const matches = change => matchesAssociatedEewHypocenter(network, result, { ...message, ...change })
    assert(matches({}))
    for(const change of [{ source: 'ceaEew' }, { isCanceled: true }, { isAssumption: true }, { lat: NaN },
        { lng: Infinity }, { depth: undefined }, { originTime: '' }, { originTime: 'invalid' }]) {
        assert.equal(matches(change), false, `${network}: ${JSON.stringify(change)}`)
    }
    assert(matches({ depth: 130 }))
    assert.equal(matches({ depth: 130.001 }), false)
    for(const sign of [-1, 1]) {
        assert(matches({ originTime: math.stampToTime(stamp + sign * 10000, timeZone) }))
        assert.equal(matches({ originTime: math.stampToTime(stamp + sign * 11000, timeZone) }), false)
    }
    assert(matchesAssociatedEewHypocenter(network, { ...result, hypocenter: { lat: 24, lng: 179.5, depth: 30 } },
        { ...message, lng: -179.5 }), 'Matching crosses the date line')
    const events = [{ eqMessage: { ...message, source: 'ceaEew' } }, { eqMessage: { ...message, lat: 40 } }]
    assert.equal(shouldDisplayInferredHypocenter(network, result, events), true)
    events.push({ eqMessage: message })
    assert.equal(shouldDisplayInferredHypocenter(network, result, events), false, 'Any matching event suppresses the result')
    assert.equal(shouldDisplayInferredHypocenter(network, result, events, true), true)
    assert.equal(shouldDisplayInferredHypocenter(network, { ...result, qualityScore: -3.01 }, events, true), false)
    assert.equal(shouldDisplayInferredHypocenter(network, result, undefined), true)
}
console.log('PASS inference event matching, time zones, inclusive thresholds, invalid/canceled/assumed EEWs and quality overrides')
