import assert from 'node:assert/strict'
import test from 'node:test'
import WebSocketObj from '../src/classes/WebSocket.js'

const setup = t => {
    let now = 0, nextTimerId = 0
    const timers = new Map()
    const schedule = (callback, delay, repeat = false) => {
        const id = ++nextTimerId
        timers.set(id, { callback, delay, repeat, at: now + delay })
        return id
    }
    t.mock.method(globalThis, 'setTimeout', (callback, delay) => schedule(callback, delay))
    t.mock.method(globalThis, 'setInterval', (callback, delay) => schedule(callback, delay, true))
    t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id))
    t.mock.method(globalThis, 'clearInterval', id => timers.delete(id))
    const sockets = []
    const originalWebSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket')
    class FakeWebSocket {
        constructor(url) {
            this.url = url
            this.readyState = 0
            this.sent = []
            sockets.push(this)
        }
        open() {
            this.readyState = 1
            this.onopen?.()
        }
        send(message) {
            assert.equal(this.readyState, 1)
            this.sent.push(message)
        }
        close() {
            if (this.readyState < 2) this.readyState = 2
        }
        finishClose() {
            this.readyState = 3
            this.onclose?.()
        }
    }
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FakeWebSocket })
    t.after(() => {
        if (originalWebSocket) Object.defineProperty(globalThis, 'WebSocket', originalWebSocket)
        else delete globalThis.WebSocket
    })
    const create = (options = { resetRetryOnOpen: false }, initMessages = ['auth']) => {
        const client = new WebSocketObj(['wss://primary.test', 'wss://backup.test'], ['ping'], initMessages, options)
        t.after(() => client.close())
        return client
    }
    const advance = async ms => {
        const until = now + ms
        while (true) {
            const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0]
            if (!next || next[1].at > until) break
            const [id, timer] = next
            now = timer.at
            if (timer.repeat) timer.at += timer.delay
            else timers.delete(id)
            timer.callback()
            await Promise.resolve()
        }
        now = until
        await Promise.resolve()
    }
    return { sockets, create, advance }
}

test('authentication failures retain increasing delays, resend auth, and rotate servers at the cap', async t => {
    const { sockets, create, advance } = setup(t)
    const client = create()
    for (const [index, delay] of [3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 10000].entries()) {
        client.socket.open()
        assert.deepEqual(client.socket.sent, ['auth'])
        client.retryAfterFailure()
        await advance(delay - 1)
        assert.equal(sockets.length, index + 1)
        await advance(1)
        assert.equal(sockets.length, index + 2)
        assert.equal(client.socket.url, index === 7 ? 'wss://backup.test' : 'wss://primary.test')
    }
})

test('network and authentication failures share backoff until authentication succeeds', async t => {
    const { sockets, create, advance } = setup(t)
    const client = create()
    client.socket.finishClose()
    await advance(3000)
    client.socket.open()
    client.retryAfterFailure()
    await advance(3999)
    assert.equal(sockets.length, 2)
    await advance(1)
    client.socket.finishClose()
    await advance(4999)
    assert.equal(sockets.length, 3)
    await advance(1)
    client.socket.open()
    client.resetRetryInterval()
    client.socket.finishClose()
    await advance(2999)
    assert.equal(sockets.length, 4)
    await advance(1)
    assert.equal(sockets.length, 5)
})

test('duplicate failure and close events keep one retry and its original deadline', async t => {
    const { sockets, create, advance } = setup(t)
    const client = create()
    const closeHandler = t.mock.fn()
    const messageHandler = t.mock.fn()
    client.setCloseHandler(closeHandler)
    client.setMessageHandler(messageHandler)
    client.socket.open()
    const failedSocket = client.socket
    const pendingCloseHandler = failedSocket.onclose
    client.retryAfterFailure()
    await advance(1000)
    client.retryAfterFailure()
    failedSocket.finishClose()
    pendingCloseHandler()
    assert.equal(closeHandler.mock.callCount(), 1)
    assert.equal(failedSocket.onmessage, null)
    await advance(1999)
    assert.equal(sockets.length, 1)
    await advance(1)
    assert.equal(sockets.length, 2)
    assert.equal(client.socket.onmessage, messageHandler)
    client.socket.open()
    client.retryAfterFailure()
    await advance(3999)
    assert.equal(sockets.length, 2)
    await advance(1)
    assert.equal(sockets.length, 3)
})

test('closing during backoff stops retries and prevents later callbacks from reviving the connection', async t => {
    const { sockets, create, advance } = setup(t)
    const client = create()
    client.socket.open()
    const oldSocket = client.socket
    client.retryAfterFailure()
    await advance(1000)
    client.close()
    oldSocket.finishClose()
    client.retryAfterFailure()
    client.reconnect()
    await advance(60000)
    assert.equal(sockets.length, 1)
    assert.deepEqual(oldSocket.sent, ['auth'])
})

test('a failed socket stops pending initial messages and periodic messages', async t => {
    const { create, advance } = setup(t)
    const client = create(undefined, ['auth', 'history', 'another-history'])
    client.socket.open()
    const oldSocket = client.socket
    client.retryAfterFailure()
    await advance(2000)
    assert.deepEqual(oldSocket.sent, ['auth'])
    await advance(1000)
    client.socket.open()
    await advance(2000)
    assert.deepEqual(client.socket.sent, ['auth', 'history'])
    await advance(2000)
    assert.deepEqual(client.socket.sent, ['auth', 'history', 'another-history'])
    await advance(6000)
    assert.equal(client.socket.sent.at(-1), 'ping')
    assert.deepEqual(oldSocket.sent, ['auth'])
})

test('default connections still reset backoff as soon as the socket opens', async t => {
    const { sockets, create, advance } = setup(t)
    const client = create({})
    client.socket.finishClose()
    await advance(3000)
    client.socket.finishClose()
    await advance(4000)
    client.socket.open()
    client.socket.finishClose()
    await advance(2999)
    assert.equal(sockets.length, 3)
    await advance(1)
    assert.equal(sockets.length, 4)
})

test('authentication success on one connection does not reset another connection', async t => {
    const { create, advance } = setup(t)
    const first = create()
    const second = create()
    first.socket.open()
    second.socket.open()
    first.retryAfterFailure()
    await advance(3000)
    first.socket.open()
    first.retryAfterFailure()
    const failedSocket = first.socket
    second.resetRetryInterval()
    second.socket.finishClose()
    const secondFailedSocket = second.socket
    await advance(3000)
    assert.equal(first.socket, failedSocket)
    assert.notEqual(second.socket, secondFailedSocket)
    await advance(1000)
    assert.notEqual(first.socket, failedSocket)
})
