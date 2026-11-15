import assert from 'node:assert/strict'
import test from 'node:test'
import { gzipSync } from 'node:zlib'
import { connectTremRts } from '../src/features/stations/TremRtsClient.js'

const urls = ['preferred', 'backup', 'last'].map(host =>
    `https://${host}.test/api/v1/trem/sse?topics=trem.rts.v1&mode=live`)
const encode = payload => gzipSync(JSON.stringify(payload)).toString('base64')
const frame = timestamp => ({ ts: timestamp, stations: { station: { i: 0.4, alert: 1 } } })

const setup = context => {
    let now = 0, nextTimerId = 0, creationFailures = 0
    const timers = new Map()
    context.mock.method(globalThis, 'setTimeout', (callback, delay) => {
        const timerId = ++nextTimerId
        timers.set(timerId, { callback, delay, at: now + delay })
        return timerId
    })
    context.mock.method(globalThis, 'clearTimeout', timerId => timers.delete(timerId))
    const connections = [], attempts = [], frames = [], stops = []
    const onlineListeners = new Set()
    class FakeEventSource {
        constructor(url) {
            attempts.push(url)
            if(creationFailures > 0) {
                creationFailures--
                throw new Error('connection creation failed')
            }
            assert.ok(connections.every(source => source.closed), 'Only one connection may remain open')
            this.url = url
            this.closed = false
            this.closeCount = 0
            this.readyState = 0
            this.listeners = new Map()
            connections.push(this)
        }
        addEventListener(type, callback) { this.listeners.set(type, callback) }
        removeEventListener(type, callback) {
            if(this.listeners.get(type) === callback) this.listeners.delete(type)
        }
        close() {
            this.closed = true
            this.closeCount++
            this.readyState = 2
        }
        dispatch(type, data) { this.listeners.get(type)?.({ data }) }
        emit(payload) { this.dispatch('trem.rts.v1', encode(payload)) }
    }
    const originals = ['EventSource', 'window'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
    Object.defineProperty(globalThis, 'EventSource', { configurable: true, value: FakeEventSource })
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
        addEventListener: (type, callback) => { if(type === 'online') onlineListeners.add(callback) },
        removeEventListener: (type, callback) => { if(type === 'online') onlineListeners.delete(callback) }
    } })
    context.after(() => {
        stops.forEach(stop => stop())
        for(const [key, descriptor] of originals) {
            if(descriptor) Object.defineProperty(globalThis, key, descriptor)
            else delete globalThis[key]
        }
    })
    const create = (url = urls[0], fallbacks = urls.slice(1), onFrame = data => frames.push(data)) => {
        const stop = connectTremRts(url, onFrame, fallbacks)
        stops.push(stop)
        return stop
    }
    const advance = milliseconds => {
        const until = now + milliseconds
        while(true) {
            const next = [...timers.entries()].sort((left, right) => left[1].at - right[1].at)[0]
            if(!next || next[1].at > until) break
            const [timerId, timer] = next
            now = timer.at
            timers.delete(timerId)
            timer.callback()
        }
        now = until
    }
    return {
        connections, attempts, frames, timers, onlineListeners, create, advance,
        online: () => [...onlineListeners].forEach(callback => callback()),
        failCreations: count => { creationFailures = count }
    }
}

test('retries after 1, 2, 3, then 5 seconds and rotates distinct configured URLs after two failures', context => {
    const app = setup(context)
    app.create(urls[0], [urls[0], urls[1], urls[1], urls[2]])
    const expected = [urls[0], urls[1], urls[1], urls[2], urls[2], urls[0]]
    for(const [index, delay] of [1000, 2000, 3000, 5000, 5000, 5000].entries()) {
        const source = app.connections.at(-1)
        source.dispatch('open')
        source.dispatch('info', '{"location":"test"}')
        source.readyState = index % 2 === 0 ? 0 : 2
        source.dispatch('error')
        assert.equal(source.closed, true)
        assert.equal(source.closeCount, 1)
        assert.equal(source.listeners.size, 0)
        assert.equal(app.timers.size, 1)
        app.advance(delay - 1)
        assert.equal(app.connections.length, index + 1)
        app.advance(1)
        assert.equal(app.connections.length, index + 2)
        assert.equal(app.connections.at(-1).url, expected[index])
    }
})

test('valid frames reset retry counters before the consumer accepts them and keep the recovered node', context => {
    const app = setup(context)
    const received = []
    app.create(undefined, undefined, data => { received.push(data); return false })
    app.connections.at(-1).dispatch('error')
    app.advance(1000)
    app.connections.at(-1).dispatch('error')
    app.advance(2000)
    const recovered = app.connections.at(-1)
    assert.equal(recovered.url, urls[1])
    recovered.emit(frame(0))
    app.advance(500)
    recovered.emit(frame(500))
    assert.deepEqual(received.map(data => data.timestamp), [0, 500])
    app.advance(4900)
    recovered.emit(frame(500))
    app.advance(4900)
    assert.equal(recovered.closed, false)
    assert.equal(app.connections.length, 3)
    recovered.dispatch('error')
    app.advance(999)
    assert.equal(app.connections.length, 3)
    app.advance(1)
    assert.equal(app.connections.at(-1).url, urls[1])
    app.connections.at(-1).dispatch('error')
    app.advance(2000)
    assert.equal(app.connections.at(-1).url, urls[2])
})

test('initial data has ten seconds to arrive and later data resets the five-second silence timeout', context => {
    const app = setup(context)
    app.create()
    const source = app.connections[0]
    source.dispatch('open')
    app.advance(9999)
    assert.equal(source.closed, false)
    const initialTimeout = [...app.timers.values()][0].callback
    source.emit(frame(0))
    initialTimeout()
    app.advance(4999)
    assert.equal(source.closed, false)
    const staleTimeout = [...app.timers.values()][0].callback
    source.emit(frame(500))
    staleTimeout()
    app.advance(4999)
    assert.equal(source.closed, false)
    app.advance(1)
    assert.equal(source.closed, true)
    app.advance(1000)
    assert.equal(app.connections.length, 2)
    app.advance(9999)
    assert.equal(app.connections[1].closed, false)
    app.advance(1)
    assert.equal(app.connections[1].closed, true)
    app.advance(2000)
    assert.equal(app.connections.at(-1).url, urls[1])
})

test('info events, invalid frames and malformed data cannot keep a broken stream alive', context => {
    const app = setup(context)
    context.mock.method(console, 'log', () => {})
    app.create()
    app.connections[0].dispatch('error')
    app.advance(1000)
    const source = app.connections[1]
    app.advance(9000)
    source.dispatch('info', '{"location":"test"}')
    source.emit({ ts: '500', stations: {} })
    source.dispatch('trem.rts.v1', 'not gzip')
    assert.equal(source.closed, false)
    assert.equal(app.frames.length, 0)
    app.advance(1000)
    assert.equal(source.closed, true)
    app.advance(1999)
    assert.equal(app.connections.length, 2)
    app.advance(1)
    assert.equal(app.connections.at(-1).url, urls[1])
})

test('duplicate errors, close events, timeouts and stale frame callbacks cannot create extra retries', context => {
    const app = setup(context)
    app.create()
    const source = app.connections[0]
    const oldError = source.listeners.get('error')
    const oldClose = source.listeners.get('close')
    const oldFrame = source.listeners.get('trem.rts.v1')
    const oldTimeout = [...app.timers.values()][0].callback
    oldClose({ data: 'server restart' })
    oldError()
    oldTimeout()
    oldFrame({ data: encode(frame(10000)) })
    assert.equal(app.timers.size, 1)
    assert.equal(source.closeCount, 1)
    app.advance(1000)
    oldError()
    oldTimeout()
    oldFrame({ data: encode(frame(20000)) })
    assert.equal(app.timers.size, 1)
    assert.equal(app.connections.length, 2)
    assert.equal(app.frames.length, 0)
    app.connections[1].emit(frame(500))
    assert.equal(app.frames[0].timestamp, 500)
})

for(const phase of ['connecting', 'streaming', 'retrying']) {
    test(`stopping while ${phase} clears timers and listeners and rejects late callbacks`, context => {
        const app = setup(context)
        const stop = app.create()
        const source = app.connections[0]
        const oldError = source.listeners.get('error')
        const oldFrame = source.listeners.get('trem.rts.v1')
        if(phase === 'streaming') source.emit(frame(0))
        if(phase === 'retrying') source.dispatch('error')
        const oldTimer = [...app.timers.values()][0].callback
        const received = app.frames.length
        stop()
        stop()
        assert.equal(source.closeCount, 1)
        assert.equal(source.listeners.size, 0)
        assert.equal(app.onlineListeners.size, 0)
        assert.equal(app.timers.size, 0)
        oldError()
        oldFrame({ data: encode(frame(10000)) })
        oldTimer()
        app.online()
        app.advance(60000)
        assert.equal(app.connections.length, 1)
        assert.equal(app.frames.length, received)
        assert.equal(app.timers.size, 0)
    })
}

test('network recovery skips pending backoff without disturbing an active connection or duplicating retries', context => {
    const app = setup(context)
    app.create()
    app.online()
    assert.equal(app.connections.length, 1)
    app.connections[0].dispatch('error')
    const oldRetry = [...app.timers.values()][0].callback
    app.advance(250)
    app.online()
    assert.equal(app.connections.length, 2)
    oldRetry()
    app.online()
    app.advance(750)
    assert.equal(app.connections.length, 2)
    app.connections[1].emit(frame(0))
    app.online()
    assert.equal(app.connections.length, 2)
    assert.equal(app.connections[1].closed, false)
})

test('connection creation failures retry and switch nodes through the same lifecycle', context => {
    const app = setup(context)
    context.mock.method(console, 'log', () => {})
    app.failCreations(2)
    app.create()
    assert.equal(app.timers.size, 1)
    app.advance(1000)
    assert.equal(app.timers.size, 1)
    app.advance(2000)
    assert.deepEqual(app.attempts, [urls[0], urls[0], urls[1]])
    assert.equal(app.connections.length, 1)
    app.connections[0].emit(frame(0))
    assert.equal(app.frames.length, 1)
})

test('fallback URLs are a snapshot and a single configured URL keeps retrying without losing cleanup', context => {
    const app = setup(context)
    const fallbacks = [urls[1]]
    const stop = app.create(urls[0], fallbacks)
    fallbacks[0] = urls[2]
    app.connections[0].dispatch('error')
    app.advance(1000)
    app.connections[1].dispatch('error')
    app.advance(2000)
    assert.equal(app.connections[2].url, urls[1])
    stop()
    app.create(urls[2], [])
    app.connections.at(-1).dispatch('error')
    app.advance(1000)
    app.connections.at(-1).dispatch('error')
    app.advance(2000)
    assert.equal(app.connections.at(-1).url, urls[2])
    assert.equal(app.onlineListeners.size, 1)
})
