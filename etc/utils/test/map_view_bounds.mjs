// node etc/utils/test/map_view_bounds.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { L, mapViewBounds } from './fixtures/map_view_bounds.mjs'

const { extendLayerBounds, collectFilledAreaBounds, collectStrokedAreaBounds } = mapViewBounds
const defaultFill = '#39393900', defaultStroke = '#ffffff00'
const area = (corners, options = {}) => ({ options, getBounds: () => L.latLngBounds(corners) })
const point = (latLng, options = {}) => ({ options, getLatLng: () => L.latLng(latLng) })
const group = layers => ({
    eachLayer: visit => layers.forEach(visit),
    getBounds: () => layers.reduce((bounds, layer) => extendLayerBounds(bounds, layer), L.latLngBounds([]))
})
const bbox = bounds => bounds?.isValid() ? bounds.toBBoxString() : null

const bounds = L.latLngBounds([])
for(const layer of [undefined, null, {}, area([]), { getBounds: () => null },
    { getLatLng: () => null }, { getLatLng: () => ({ lat: NaN, lng: 121 }) },
    { getLatLng: () => ({ lat: 24, lng: Infinity }) }]) {
    assert.equal(extendLayerBounds(bounds, layer), bounds)
    assert.equal(bounds.isValid(), false)
}
extendLayerBounds(bounds, point([24, 121]))
extendLayerBounds(bounds, { ...area([[23, 120], [25, 122]]), getLatLng: () => L.latLng(60, 160) })
assert.equal(bbox(bounds), '120,23,122,25', 'Area geometry takes precedence over a layer center')

const filled = area([[23, 120], [25, 122]], { fillColor: '#ff0000', color: defaultStroke, opacity: 0 })
const stroked = area([[30, 130], [32, 132]], { fillColor: defaultFill, color: '#ffff00' })
const inactive = area([[-60, -160], [60, 160]], { fillColor: defaultFill, color: defaultStroke })
const unstyled = area([[-80, -170], [80, 170]])
const layers = group([group([filled, group([stroked, inactive])]), unstyled, null])
layers.options = { fillColor: '#ff0000', color: '#ffff00' }
assert.equal(bbox(collectFilledAreaBounds(layers, defaultFill)), '120,23,122,25')
assert.equal(bbox(collectStrokedAreaBounds(layers, defaultStroke)), '130,30,132,32')
assert.equal(bbox(filled.getBounds()), '120,23,122,25', 'Collection does not mutate source geometry')
assert.equal(bbox(collectFilledAreaBounds(group([point([24, 121], { fillColor: '#ff0000' })]), defaultFill)), '121,24,121,24')
for(const empty of [undefined, group([]), group([inactive, unstyled])]) {
    assert.equal(bbox(collectFilledAreaBounds(empty, defaultFill)), null)
    assert.equal(bbox(collectStrokedAreaBounds(empty, defaultStroke)), null)
}
const preserved = L.latLngBounds([[23, 120], [25, 122]])
preserved.extend(collectFilledAreaBounds(undefined, defaultFill))
assert.equal(bbox(preserved), '120,23,122,25', 'An empty collection is safe to merge')
console.log('PASS real Leaflet geometry, absent/empty layers, nested fill/stroke filtering and hidden styled areas')

// Exercise the production setView branches with geometry from the shared helpers.
const component = readFileSync(new URL('../../../src/components/MainMapComponent.vue', import.meta.url), 'utf8')
const start = component.indexOf('const setView ='), end = component.indexOf('const smartSetView =', start)
assert(start >= 0 && end > start)
const setViewSource = component.slice(start, end)
const collectView = ({ menu = 'eqlists', temporary = '', active = {}, history = [], events = [],
    markers = [], fills = group([]), tsunami } = {}) => {
    let result = null
    const center = { lat: 38.1, lng: 104.6 }
    const deps = {
        L, ...mapViewBounds, document: { visibilityState: 'visible' },
        map: {
            eachLayer: visit => markers.forEach(visit),
            _getBoundsCenterZoom: bounds => { result = bounds; return { center, zoom: 8 } },
            getCenter: () => center, getZoom: () => 8
        },
        menuId: { value: menu }, tempEqlists: { value: temporary }, historyList: history,
        statusStore: { isActive: active }, activeEqlistList: { value: events }, activeEewList: [],
        eewBaseGroup: fills, jpTsunamiBaseMap: tsunami, cnTsunamiBaseMap: undefined,
        eewBaseMapDefaultFill: defaultFill, tsunamiBaseMapDefaultStroke: defaultStroke,
        getGridNetworkRelation: () => undefined, shouldIncludeEewSWaveBounds: () => true,
        isValidViewLatLng: { value: false }, isValidUserLatLng: { value: false },
        defaultLatLng: [center.lat, center.lng], settingsStore: { mainSettings: { defaultZoom: 8 } }
    }
    new Function(...Object.keys(deps), `${setViewSource}\nsetView(true);`)(...Object.values(deps))
    return bbox(result)
}
const coastalMap = group([stroked, area([[40, 140], [42, 142]], { color: defaultStroke })])
const distantEvent = { isValidHypo: true, hypoLatLng: [-40, -100], eqMessage: { source: 'usgsEqlist' } }
assert.equal(collectView({ temporary: 'jmaTsunami', active: { jmaTsunami: true }, tsunami: coastalMap,
    events: [distantEvent] }), '130,30,132,32', 'Temporary tsunami uses only active warning areas')
assert.equal(collectView({ temporary: 'jmaTsunami', tsunami: coastalMap }), '130,30,142,42',
    'Temporary tsunami falls back to its whole base map')
assert.equal(collectView({ temporary: 'jmaTsunami', events: [distantEvent] }), null,
    'Missing temporary geometry falls back to the default view, not unrelated events')
assert.equal(collectView({ temporary: 'jmaTsunami', history: [{}], active: { jmaTsunami: true },
    tsunami: coastalMap, events: [distantEvent], fills: group([group([filled, inactive])]), markers: [
        point([24, 121], { pane: 'historyMarkerPane' }), point([26, 123], { pane: 'intReportStationPane3' })
    ] }), '120,23,123,26', 'History overrides temporary/active information and includes station and filled-area bounds')
assert.equal(collectView({ history: [{}], events: [distantEvent] }), '-100,-40,-100,-40',
    'History without usable geometry still falls through to active information')
assert.equal(collectView({ active: { jmaTsunami: true }, tsunami: coastalMap,
    events: [{ ...distantEvent, hypoLatLng: [24, 121] }], fills: group([filled, inactive]) }), '120,23,132,32',
    'Ordinary active information combines earthquake, fill and warning bounds without the full tsunami base map')
const earthquakeMarkers = [point([24, 121], { pane: 'eqlistMarkerPane' }), point([-40, -100], { pane: 'eqlistMarkerPane' })]
assert.equal(collectView({ markers: earthquakeMarkers }), '121,24,121,24', 'Fallback retains the preferred geographical region')
assert.equal(collectView({ markers: earthquakeMarkers.slice(1) }), '-100,-40,-100,-40', 'Remote fallback remains available')
for(const menu of ['main', 'settings', 'eews']) {
    assert.equal(collectView({ menu, events: [distantEvent], markers: [point([24, 121], { pane: 'eewMarkerPane' })] }),
        '121,24,121,24', `${menu} retains EEW priority`)
}
assert.equal(collectView({ menu: 'eews', events: [distantEvent] }), null, 'EEW tab does not fall through to earthquake information')
console.log('PASS actual setView priorities, temporary tsunami fallback, history, active-area unions and regional fallback')
