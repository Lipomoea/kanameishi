import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const withoutImports = source => source.replace(/^import .*\r?\n/gm, '').replace(/^export /gm, '')
// Use Leaflet's coordinate/bounds implementation without loading its browser UI.
const geometry = ['leaflet/src/geo/LatLng.js', 'leaflet/src/geo/LatLngBounds.js']
    .map(name => withoutImports(readFileSync(require.resolve(name), 'utf8'))).join('\n')
export const L = new Function('Util', geometry + '\nreturn { latLng: toLatLng, latLngBounds: toLatLngBounds };')({ isArray: Array.isArray })
const source = readFileSync(new URL('../../../../src/features/map/MapViewBounds.js', import.meta.url), 'utf8')
export const mapViewBounds = new Function('L', withoutImports(source) +
    '\nreturn { extendLayerBounds, collectFilledAreaBounds, collectStrokedAreaBounds };')(L)
