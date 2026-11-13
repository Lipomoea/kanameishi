// node etc/utils/test/map_loading.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { topojsonUrls } from '../../../src/utils/Urls.js'

const readSource = name => readFileSync(new URL(`../../../src/${name}`, import.meta.url), 'utf8')
const extract = (source, startMarker, endMarker) => {
    const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start)
    assert(start >= 0 && end > start)
    return source.slice(start, end)
}
const mapSource = extract(readSource('components/MainMapComponent.vue'), 'const loadMaps = async', '\nwatchEffect(() => {')
const appSource = extract(readSource('App.vue'), 'async function getGeojson', 'const autoScale')
const httpSource = extract(readSource('classes/Http.js'), 'class Http', 'export default Http')
const topo = { type: 'Topology', objects: { region: { type: 'GeometryCollection', geometries: [] } }, arcs: [] }
const response = () => Response.json(topo)
const failedUrl = topojsonUrls.cn_fault
const flush = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}
const createTimers = () => {
    const timers = new Map()
    let nextId = 0
    return {
        timers,
        setTimeout: (fn, ms) => { const id = ++nextId; timers.set(id, { fn, ms }); return id },
        clearTimeout: id => timers.delete(id),
        retryCount: () => [...timers.values()].filter(timer => timer.ms === 2000).length,
        retry: async () => {
            const entry = [...timers].find(([, timer]) => timer.ms === 2000)
            assert(entry, 'A retry must be scheduled')
            timers.delete(entry[0])
            entry[1].fn()
            await flush()
        },
    }
}

// Run the production loader with only transport, timers, rendering and UI replaced.
const createLoader = ({ web = false, urls = topojsonUrls } = {}) => {
    const clock = createTimers()
    const test = { draws: [], messages: [], requests: [], read: async () => response(), open: async () => cache }
    const cache = { match: url => test.read(url) }
    const context = vm.createContext({
        ...clock, console: { error: () => {} },
        isDisposed: false, firstMsg: false, mapLoadMessageTimer: undefined, mapLoadRetryTimer: undefined,
        isTauri: () => !web, window: web ? { caches: {} } : {}, topojsonUrls: urls,
        caches: { open: () => test.open() },
        fetch: url => { test.requests.push(url); return test.read(url) },
        ElMessage: message => test.messages.push(message),
        loadBaseMap: (...args) => { test.draws.push(args); return {} },
        settingsStore: {
            mainSettings: { disableEewBaseMap: true, displayPlaceName: false },
            advancedSettings: { forceCalcInt: false }, isDataSourceEnabled: () => false,
        },
        accessStore: { canUse: () => false }, watch: () => () => {}, trackMapLoadWatch: () => {}, jmaWarnArea: {},
    })
    vm.runInContext(`${mapSource}\nglobalThis.loadMaps = loadMaps`, context)
    return Object.assign(test, clock, { context, load: context.loadMaps })
}

for (const [name, web, failure] of [
    ['fetch rejection', false, () => { throw new TypeError('Failed to fetch') }],
    ['invalid response JSON', false, () => new Response('')],
    ['HTTP error with valid JSON', false, () => Response.json(topo, { status: 503 })],
    ['cache read rejection', true, () => { throw new Error('Cache read failed') }],
    ['invalid cached JSON', true, () => new Response('')],
    ['cache miss', true, () => undefined],
]) {
    const test = createLoader({ web })
    test.read = async url => url === failedUrl ? failure() : response()
    await test.load()
    assert.equal(test.draws.length, 0, name)
    assert.equal(test.retryCount(), 1, name)
    test.read = async () => response()
    await test.retry()
    assert.equal(test.draws.length, 3, `${name}: recover without refreshing`)
    assert.equal(test.retryCount(), 0, name)
}
{
    const test = createLoader({ web: true })
    const open = test.open
    test.open = async () => { throw new Error('Cache open failed') }
    await test.load()
    assert.equal(test.retryCount(), 1)
    test.open = open
    await test.retry()
    assert.equal(test.draws.length, 3)
}
{
    const optionalUrl = 'https://maps.example.invalid/tsunami.json'
    const test = createLoader({ urls: { ...topojsonUrls, cn_tsunami: optionalUrl } })
    const pending = deferred()
    test.read = async url => url === optionalUrl ? pending.promise : response()
    const loading = test.load()
    await flush()
    assert.equal(test.requests.length, 9)
    assert.equal(test.draws.length, 0, 'Continue waiting for every resource, including optional maps')
    assert.equal(test.retryCount(), 0, 'A pending request must not start a parallel retry')
    pending.resolve(response())
    await loading
    assert.equal(test.draws.length, 3)
}
for (const reject of [false, true]) {
    const test = createLoader(), pending = deferred()
    test.read = async url => url === failedUrl ? pending.promise : response()
    const loading = test.load()
    test.context.isDisposed = true
    if(reject) pending.reject(new Error('Late failure'))
    else pending.resolve(response())
    await loading
    assert.equal(test.draws.length, 0, 'Do not draw after disposal')
    assert.equal(test.retryCount(), 0, 'Do not retry after disposal')
}
{
    const test = createLoader()
    test.read = async () => { throw new Error('Persistent failure') }
    await test.load(50)
    assert.equal(test.retryCount(), 0)
    assert.equal(test.messages.filter(message => message.type === 'error').length, 1)
}
console.log('PASS map failure recovery, cache errors, all-resource barrier, disposal and retry limit')

const createPrefetch = () => {
    const clock = createTimers(), stored = new Map(), requests = []
    const test = { stored, requests, get: async () => ({ data: topo }) }
    const context = vm.createContext({
        ...clock, Response, console: { log: () => {} }, inTauri: false, window: { caches: {} }, topojsonUrls,
        axios: { get: async (...args) => { requests.push(args); return test.get(...args) } },
        caches: { open: async () => ({ put: async (url, value) => stored.set(url, value) }) },
    })
    vm.runInContext(`${httpSource}\n${appSource}\nglobalThis.prefetch = getGeojson`, context)
    return Object.assign(test, clock, { prefetch: context.prefetch })
}

for (const [name, failure] of [
    ['request failure', () => { throw new Error('Network error') }],
    ...[undefined, null, '', '<html>error</html>', {}, { type: 'Topology' }].map(data =>
        [`invalid map data: ${JSON.stringify(data)}`, () => ({ data })]),
]) {
    const test = createPrefetch(), previous = response()
    test.stored.set(failedUrl, previous)
    test.get = async url => url === failedUrl ? failure() : { data: topo }
    await test.prefetch()
    await flush()
    assert.equal(test.stored.get(failedUrl), previous, `${name}: preserve the good cached response`)
    assert.equal(test.stored.size, 8, `${name}: other maps still populate their cache`)
    assert.equal(test.retryCount(), 1, `${name}: propagate the failure to the retry handler`)
    test.get = async () => ({ data: topo })
    await test.retry()
    assert.notEqual(test.stored.get(failedUrl), previous)
    assert.deepEqual(await test.stored.get(failedUrl).clone().json(), topo)
    assert.equal(test.retryCount(), 0)
    assert(test.requests.every(([, config]) => config.timeout === 0), 'Preserve existing timeout behavior')
}
{
    const test = createPrefetch()
    test.get = async () => { throw new Error('Persistent failure') }
    await test.prefetch(3)
    assert.equal(test.stored.size, 0, 'Failed first-time downloads must not create empty cache entries')
    assert.equal(test.retryCount(), 0, 'Preserve the prefetch retry limit')
}
{
    const prefetch = createPrefetch(), loader = createLoader({ web: true })
    prefetch.stored.set(failedUrl, new Response(''))
    loader.read = async url => prefetch.stored.get(url)?.clone()
    await loader.load()
    assert.equal(loader.draws.length, 0)
    assert.equal(loader.retryCount(), 1)
    await prefetch.prefetch()
    await loader.retry()
    assert.equal(loader.draws.length, 3, 'Recover from an old poisoned cache after background download succeeds')
}
console.log('PASS cache preservation, invalid data rejection, download retry and recovery from old empty cache')
