import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const component = read('src/components/MainMapComponent.vue')
const leaflet = read('node_modules/leaflet/src/map/Map.js')
const evaluate = (source, dependencies) => new Function(...Object.keys(dependencies), source)(...Object.values(dependencies))
const section = (start, end) => component.slice(component.indexOf(start), component.indexOf(end, component.indexOf(start)))

// Run Leaflet's installed zoom implementation, including its RAF and proxy race,
// with controlled timers and stand-ins for layout/DOM, rather than a mock setView.
const setup = ({ zoom = 6, targetZoom = 8, zoomAnimated = true } = {}) => {
    let id = 0
    const timers = new Map(), frames = new Map(), listeners = new Map(), unmount = []
    const calls = [], events = []
    const setTimeout = (callback, delay) => { timers.set(++id, { callback, delay }); return id }
    const clearTimeout = id => timers.delete(id)
    const flushTimers = (delay = 0) => {
        for(let pass = 0; pass < 20; pass++) {
            const pending = [...timers].filter(([, timer]) => timer.delay === delay)
            if(!pending.length) return
            for(const [id, timer] of pending) {
                if(timers.delete(id)) timer.callback()
            }
        }
        throw new Error('Timer loop did not settle')
    }
    const frame = () => {
        const pending = [...frames.values()]
        frames.clear()
        pending.forEach(callback => callback())
    }
    const target = { center: { lat: 35, lng: 140 }, zoom: targetZoom }
    const map = {
        _zoom: zoom, center: { lat: 30, lng: 120 }, _loaded: true, _zoomAnimated: zoomAnimated,
        options: { zoomAnimationThreshold: 4 }, _mapPane: {}, _panes: { mapPane: { appendChild() {} } },
        on(types, callback, context) {
            for(const type of types.split(' ')) {
                const list = listeners.get(type) ?? []
                list.push({ callback, context })
                listeners.set(type, list)
            }
            return this
        },
        _on(...args) { return this.on(...args) },
        off(type, callback) {
            listeners.set(type, (listeners.get(type) ?? []).filter(item => item.callback !== callback))
            return this
        },
        once(type, callback) {
            const once = event => { this.off(type, once); callback(event) }
            return this.on(type, once)
        },
        fire(type, data) {
            events.push(type)
            for(const { callback, context } of [...(listeners.get(type) ?? [])]) callback.call(context, data)
            return this
        },
        getZoom() { return this._zoom }, getCenter() { return { ...this.center } },
        getBounds() { return { contains: () => this.containsBounds } },
        _limitZoom: zoom => Math.max(2, Math.min(12, zoom)), _limitCenter: center => center,
        _nothingToAnimate: () => false,
        getZoomScale(zoom, from = this._zoom) { return 2 ** (zoom - from) },
        project: (center, zoom) => ({ x: center.lng * 2 ** zoom, y: center.lat * 2 ** zoom }),
        unproject: ([x, y], zoom) => ({ lat: y / 2 ** zoom, lng: x / 2 ** zoom }),
        _getCenterOffset: center => ({ center, _divideBy() { return this }, _trunc() { return this } }),
        _move(center, zoom) { this.center = { ...center }; this._zoom = zoom; return this },
        _getBoundsCenterZoom: () => ({ center: { ...target.center }, zoom: target.zoom }),
        layers: [{ options: { pane: 'historyMarkerPane' } }],
        eachLayer(callback) { this.layers.forEach(callback) },
        hasLayer: layer => layer.attached,
        removeLayer(layer) { layer.attached = false },
        panBy(offset) {
            if(this.zeroPan) return this.fire('moveend')
            let timer
            this._panAnim = { _inProgress: true, stop: () => {
                if(!this._panAnim._inProgress) return
                clearTimeout(timer)
                this._panAnim._inProgress = false
                this.fire('moveend')
            } }
            this.fire('movestart')
            timer = setTimeout(() => {
                this.center = { ...offset.center }
                this._panAnim._inProgress = false
                this.fire('move').fire('moveend')
            }, 250)
            return this
        },
        remove() {},
    }
    const leafletDependencies = {
        Util: {
            extend: Object.assign, bind: (fn, context) => fn.bind(context),
            requestAnimFrame: (callback, context) => { frames.set(++id, () => callback.call(context)); return id },
            cancelAnimFrame: id => frames.delete(id),
        },
        DomUtil: {
            TRANSFORM: 'transform', create: () => ({ style: {} }),
            setTransform: (element, point, scale) => { element.style.transform = JSON.stringify([point, scale]) },
            addClass() {}, removeClass() {}, setPosition() {},
        },
        Point: class { constructor(x, y) { this.x = x; this.y = y } },
        toLatLng: center => center, setTimeout, clearTimeout,
    }
    for(const name of ['setView', '_stop', '_resetView', '_moveStart', '_moveEnd', '_tryAnimatedPan',
        '_tryAnimatedZoom', '_createAnimProxy', '_animMoveEnd', '_animateZoom', '_onZoomTransitionEnd']) {
        const start = leaflet.indexOf(`\t${name}: function`)
        assert.notEqual(start, -1, `Leaflet method ${name}`)
        const method = leaflet.slice(leaflet.indexOf('function', start), leaflet.indexOf('\n\t}', start) + 3)
        map[name] = evaluate(`return (${method})`, leafletDependencies)
    }
    map._createAnimProxy()
    const nativeSetView = map.setView
    map.setView = function(center, zoom, options) {
        calls.push({ center: { ...center }, zoom, animate: options.animate,
            fromCenter: this.getCenter(), fromZoom: this.getZoom() })
        return nativeSetView.call(this, center, zoom, options)
    }
    const group = () => ({ attached: true, addTo() { this.attached = true } })
    const eewBaseGroup = group(), tsunamiBaseGroup = group()
    const isAutoZoom = { value: true }, menuId = { value: 'eqlists' }
    const document = { visibilityState: 'visible', removeEventListener() {} }
    const source = `let isDisposed = false, autoZoomTimer;
        let mainInterval, terminatorInterval, autoZoomInterval, terminatorUpdateTimer,
            mapLoadMessageTimer, mapLoadRetryTimer, defaultMenuTimer, tempEqlistsTimer;
        ${section('const handleManual =', 'const handleMenu =')}
        ${section('const handleVisibilityChange =', 'onMounted(')}
        ${section('let pendingSetView =', "provide('smartSetView'")}
        ${section('onBeforeUnmount(()=>{', '</script>')}
        return { setView, smartSetView, handleManual, handleHome, handleVisibilityChange }`
    const state = evaluate(source, {
        map, document, isAutoZoom, menuId, setTimeout, clearTimeout, clearInterval() {},
        requestAnimationFrame: callback => { frames.set(++id, callback); return id },
        cancelAnimationFrame: id => frames.delete(id),
        eewBaseGroup, tsunamiBaseGroup,
        L: { latLngBounds: () => ({ valid: false, isValid() { return this.valid }, extend() {} }) },
        tempEqlists: { value: '' }, historyList: [{}], activeEewList: [], activeEqlistList: { value: [] }, eqlistList: [],
        collectFilledAreaBounds: () => ({}), extendLayerBounds: bounds => { bounds.valid = true },
        eewBaseMapDefaultFill: '', getGridNetworkRelation: pane => pane === 'grid',
        statusStore: { isActive: {} }, settingsStore: { mainSettings: { defaultZoom: 6 } },
        isValidViewLatLng: { value: false }, isValidUserLatLng: { value: false }, defaultLatLng: [38.1, 104.6],
        mapLoadWatchStops: new Set(), resetDefaultMenuTimer() {}, handleKeydown() {},
        onBeforeUnmount: callback => unmount.push(callback), onUnmounted: callback => unmount.push(callback),
    })
    return {
        ...state, map, target, calls, events, timers, frames, document, menuId, isAutoZoom,
        eewBaseGroup, tsunamiBaseGroup, frame, flushTimers,
        finish: () => flushTimers(250), dispose: () => unmount.forEach(callback => callback()),
        listenerCount: type => listeners.get(type)?.length ?? 0,
    }
}

test('same targets before the first frame and during zoom start only one animation', () => {
    const s = setup()
    s.smartSetView()
    s.smartSetView(true)
    s.flushTimers()
    s.setView(true)
    assert.equal(s.calls.length, 1)
    s.frame()
    assert.equal(s.map._animatingZoom, true)
    s.setView()
    assert.equal(s.calls.length, 1)
    s.finish()
    assert.equal(s.events.filter(type => type === 'zoomend').length, 1)
    assert.equal(s.map._animatingZoom, false)
})

test('the installed Leaflet reproduces the original bug without the duplicate guard', () => {
    const s = setup()
    s.map.setView(s.target.center, 8, { animate: true })
    s.map.setView(s.target.center, 8, { animate: true })
    s.frame()
    assert.equal(s.map._animatingZoom, false)
})

test('different targets before the first frame are immediately passed to native setView', () => {
    const s = setup()
    s.setView()
    s.target.center.lat += 2
    s.setView()
    assert.equal(s.calls.length, 2)
    assert.deepEqual(s.calls[1].center, s.target.center)
    s.setView(true)
    assert.equal(s.calls.length, 2, 'only an equivalent latest target is suppressed')
})

test('different targets during zoom retain Leaflet behavior without queuing or forcing completion', () => {
    const s = setup()
    s.setView()
    s.frame()
    s.target.center.lat += 2
    s.target.zoom = 9
    s.setView()
    assert.equal(s.calls.length, 2, 'submit immediately while the first zoom is active')
    assert.equal(s.map._animatingZoom, true, 'do not force the first CSS zoom to end')
    assert.equal(s.events.includes('zoomend'), false)
    s.setView()
    assert.equal(s.calls.length, 2, 'deduplicate the latest submitted task without inspecting Leaflet state')
    s.finish()
    s.flushTimers()
    assert.equal(s.calls.length, 2, 'do not replay the request after completion')
    assert.equal(s.map.getZoom(), 8, 'Leaflet itself ignores a different zoom while animating')
    s.setView()
    assert.equal(s.calls.length, 3, 'a previously ignored request is allowed after the animation')
})

test('different pan targets interrupt through native setView while identical targets are skipped', () => {
    const s = setup({ targetZoom: 6 })
    s.setView()
    s.frame()
    s.setView()
    assert.equal(s.calls.length, 1)
    s.target.center.lat += 2
    s.setView()
    assert.equal(s.calls.length, 2)
    assert.equal(s.events.filter(type => type === 'moveend').length, 1, 'native setView stopped the first pan')
    s.setView()
    assert.equal(s.calls.length, 2)
    s.finish()
    assert.deepEqual(s.map.getCenter(), s.target.center)
})

test('resize moveend does not release duplicate protection during zoom or pan', () => {
    for(const targetZoom of [6, 8]) {
        const s = setup({ targetZoom })
        s.setView()
        s.map.fire('moveend').fire('resize')
        s.flushTimers()
        s.setView()
        s.frame()
        s.map.fire('moveend').fire('resize')
        s.flushTimers()
        s.setView()
        assert.equal(s.calls.length, 1)
    }
})

test('target tolerance and force retain the existing view semantics', () => {
    const s = setup({ targetZoom: 6 })
    s.menuId.value = 'main'
    s.map.layers = [{ options: { pane: 'grid', isGridCanvasLayer: true }, hasGrid: () => true }]
    s.map.containsBounds = true
    s.setView()
    assert.equal(s.calls.length, 0)
    s.setView(true)
    s.target.center.lat += 0.5 / 2 ** 6
    s.setView(true)
    assert.equal(s.calls.length, 1)
    s.target.center.lat += 1 / 2 ** 6
    s.setView(true)
    assert.equal(s.calls.length, 2)
})

test('completed targets do not block later returns to the same location', () => {
    const s = setup()
    s.setView()
    s.frame()
    s.finish()
    s.map.center.lat -= 2
    s.setView()
    assert.equal(s.calls.length, 2)
})

test('manual input preserves native animation and disables deferred automatic requests', () => {
    const s = setup()
    s.setView()
    s.frame()
    s.target.center.lat += 2
    s.smartSetView()
    s.handleManual()
    assert.equal(s.map._animatingZoom, true, 'the manual handler does not replace Leaflet interruption behavior')
    s.flushTimers()
    s.finish()
    assert.equal(s.calls.length, 1)
    s.handleHome()
    assert.equal(s.calls.length, 2)
})

test('large jumps, unsupported animations and zero-pixel pans do not leave a permanent guard', () => {
    for(const options of [{ zoom: 2 }, { zoomAnimated: false }, { targetZoom: 6 }]) {
        const s = setup(options)
        s.map.zeroPan = true
        s.setView()
        s.frame()
        s.flushTimers()
        assert.equal(s.eewBaseGroup.attached, true)
        assert.equal(s.tsunamiBaseGroup.attached, true)
        if(options.zoom === 2) assert.equal(s.calls[0].animate, false)
        s.target.center.lat += 2
        s.setView()
        assert.equal(s.calls.length, 2)
    }
    const s = setup({ zoom: 4 })
    s.setView()
    assert.equal(s.calls[0].animate, true)
    s.frame()
    assert.equal(s.map._animatingZoom, true)
})

test('hidden pages and unmount retain deferred-view behavior and clean up task listeners', () => {
    const s = setup()
    s.document.visibilityState = 'hidden'
    s.setView()
    assert.equal(s.calls.length, 0)
    s.document.visibilityState = 'visible'
    s.handleVisibilityChange()
    assert.equal(s.calls.length, 1)
    s.frame()
    s.finish()
    s.target.center.lat += 2
    s.setView()
    assert.equal(s.listenerCount('movestart'), 1)
    assert.equal(s.listenerCount('resize'), 1)
    s.smartSetView()
    s.dispose()
    assert.equal(s.frames.size, 0)
    assert.equal(s.listenerCount('movestart'), 0)
    assert.equal(s.listenerCount('resize'), 0)
    s.flushTimers()
    s.setView()
    assert.equal(s.calls.length, 2)
})

test('a newer pan owns the recorded target while an older zoom is still running', () => {
    const s = setup()
    s.setView()
    s.frame()
    const A = { ...s.target.center }
    s.target.center = { lat: 37, lng: 142 }
    s.setView()
    s.map.center = { lat: 36, lng: 141 }
    s.setView()
    assert.equal(s.calls.length, 2, 'duplicate B must not interrupt the newer pan')
    s.target.center = A
    s.setView()
    assert.equal(s.calls.length, 3, 'A must be submitted because the recorded task is now B')
    assert.equal(s.events.filter(type => type === 'moveend').length, 1, 'native setView stops B')
    s.flushTimers()
    s.setView()
    assert.equal(s.calls.length, 3, 'the stopped old pan must not clear the new task')
})

test('an older zoom completion does not clear the latest pan task', () => {
    const s = setup()
    s.setView()
    s.frame()
    s.target.center = { lat: 37, lng: 142 }
    s.setView()
    s.map.center = { lat: 36, lng: 141 }
    s.map._onZoomTransitionEnd()
    s.flushTimers()
    s.setView()
    assert.equal(s.calls.length, 2)
    s.finish()
    s.flushTimers()
    s.map.center.lat -= 2
    s.setView()
    assert.equal(s.calls.length, 3, 'the task is cleared when its own pan completes')
})

test('synchronous completion and failed submissions do not retain obsolete tasks', () => {
    const s = setup({ zoomAnimated: false })
    s.setView()
    s.map.center.lat -= 2
    s.setView()
    assert.equal(s.calls.length, 2)
    const submit = s.map.setView
    s.map.setView = () => { throw new Error('submission failed') }
    s.target.center.lat += 2
    assert.throws(() => s.setView(), /submission failed/)
    s.map.setView = submit
    s.setView()
    assert.equal(s.calls.length, 3)
})
