import assert from 'node:assert/strict'
import test from 'node:test'
import WebSocketObj, { LipoApiClient, WolfxClient, P2pQuakeClient, GlobalQuakeClient } from '../src/classes/WebSocket.js'

const setup = t => {
    let now = 0, nextTimerId = 0
    const timers = new Map()
    t.mock.method(Date, 'now', () => now)
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
            this.sentAt = []
            sockets.push(this)
        }
        open() {
            this.readyState = 1
            this.onopen?.()
        }
        send(message) {
            assert.equal(this.readyState, 1)
            this.sent.push(message)
            this.sentAt.push(now)
        }
        close() {
            if (this.readyState < 2) this.readyState = 2
        }
        receiveText(data) { this.onmessage?.({ data }) }
        receive(message) { this.receiveText(JSON.stringify(message)) }
        finishClose(event) {
            this.readyState = 3
            this.onclose?.(event)
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

test('retries wait 1, 2, 5, 10, then 20 seconds, keep the cap, resend auth, and rotate configured servers', async t => {
    const { sockets, create, advance } = setup(t)
    const client = create()
    const expectedUrls = ['primary', 'primary', 'primary', 'primary', 'backup', 'primary', 'backup']
    for (const [index, delay] of [1000, 2000, 5000, 10000, 20000, 20000, 20000].entries()) {
        client.socket.open()
        assert.deepEqual(client.socket.sent, ['auth'])
        client.retryAfterFailure()
        await advance(delay - 1)
        assert.equal(sockets.length, index + 1)
        await advance(1)
        assert.equal(sockets.length, index + 2)
        assert.equal(client.socket.url, `wss://${expectedUrls[index]}.test`)
    }
})

test('network and authentication failures share backoff until authentication succeeds', async t => {
    const { sockets, create, advance } = setup(t)
    const client = create()
    client.socket.finishClose()
    await advance(1000)
    client.socket.open()
    client.retryAfterFailure()
    await advance(1999)
    assert.equal(sockets.length, 2)
    await advance(1)
    client.socket.finishClose()
    await advance(4999)
    assert.equal(sockets.length, 3)
    await advance(1)
    client.socket.open()
    client.resetRetryInterval()
    client.socket.finishClose()
    await advance(999)
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
    await advance(250)
    client.retryAfterFailure()
    failedSocket.finishClose()
    pendingCloseHandler()
    assert.equal(closeHandler.mock.callCount(), 1)
    assert.equal(failedSocket.onmessage, null)
    await advance(749)
    assert.equal(sockets.length, 1)
    await advance(1)
    assert.equal(sockets.length, 2)
    assert.equal(client.socket.onmessage, messageHandler)
    client.socket.open()
    client.retryAfterFailure()
    await advance(1999)
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
    await advance(500)
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
    await advance(25999)
    assert.deepEqual(client.socket.sent, ['auth', 'history', 'another-history'])
    await advance(1)
    assert.equal(client.socket.sent.at(-1), 'ping')
    assert.deepEqual(oldSocket.sent, ['auth'])
})

test('default connections still reset backoff as soon as the socket opens', async t => {
    const { sockets, create, advance } = setup(t)
    const client = create({})
    client.socket.finishClose()
    await advance(1000)
    client.socket.finishClose()
    await advance(2000)
    client.socket.open()
    client.socket.finishClose()
    await advance(999)
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
    await advance(1000)
    first.socket.open()
    first.retryAfterFailure()
    const failedSocket = first.socket
    second.resetRetryInterval()
    second.socket.finishClose()
    const secondFailedSocket = second.socket
    await advance(1000)
    assert.equal(first.socket, failedSocket)
    assert.notEqual(second.socket, secondFailedSocket)
    await advance(1000)
    assert.notEqual(first.socket, failedSocket)
})

test('Lipo waits for authentication and init, queries only visible requested lists, and echoes JSON heartbeat IDs', async t => {
    const { sockets, advance } = setup(t)
    const client = new LipoApiClient('wss://lipo.test/all', {
        key: 'test-key', reportRequests: ['cenc_report_list', 'cwa_report_list', 'usgs_report_list', 'kma_report_list'],
    })
    t.after(() => client.close())
    const received = []
    client.setMessageHandler(message => received.push(message))
    const socket = sockets[0]
    socket.open()
    socket.receive({ type: 'cenc_report', data: { eventId: 'before-auth' } })
    await advance(10000)
    assert.deepEqual(socket.sent.map(JSON.parse), [{ type: 'auth', key: 'test-key' }])
    assert.equal(received.length, 0)
    socket.receive({ type: 'auth_ok', data: { tier: 'basic' } })
    await advance(10000)
    assert.equal(socket.sent.length, 1)
    const snapshot = { cenc_report: { type: 'cenc_report', data: null }, cenc_ir: { type: 'cenc_ir', data: [] } }
    socket.receive({ type: 'init', data: snapshot })
    assert.deepEqual(socket.sent.map(JSON.parse).slice(1), [{ type: 'cenc_report_list' }])
    socket.receive({ type: 'heartbeat', data: { id: '1', timestamp: 1793678400000 } })
    assert.deepEqual(JSON.parse(socket.sent.at(-1)), { type: 'heartbeat', data: { id: '1' } })
    socket.receive({ type: 'cenc_report_list', data: [] })
    const before = socket.sent.length
    await advance(29999)
    assert.equal(socket.sent.length, before, 'Lists wait 30 seconds between polling rounds')
    await advance(1)
    assert.deepEqual(JSON.parse(socket.sent.at(-1)), { type: 'cenc_report_list' })
    await advance(1999)
    assert.equal(socket.sent.length, before + 1)
    await advance(1)
    assert.deepEqual(JSON.parse(socket.sent.at(-1)), { type: 'query_all' })
    assert.equal(socket.sentAt.at(-1), 52000)
    socket.receive({ type: 'query_all', data: snapshot })
    assert.equal(received.filter(message => message.type === 'query_all').length, 1)
})

test('Lipo echoes authenticated string heartbeat IDs, ignores text pings and invalid IDs, and keeps heartbeats out of business messages', async t => {
    const { sockets, advance } = setup(t)
    const client = new LipoApiClient('wss://lipo.test/all', { key: 'test-key' })
    t.after(() => client.close())
    const received = []
    client.setMessageHandler(message => received.push(message))
    const socket = sockets[0]
    socket.open()
    socket.receive({ type: 'heartbeat', data: { id: '1', timestamp: 1793678400000 } })
    assert.deepEqual(socket.sent.map(JSON.parse), [{ type: 'auth', key: 'test-key' }])
    assert.deepEqual(received, [])
    socket.receive({ type: 'auth_ok' })
    socket.receive({ type: 'init', data: {} })
    for (const text of ['ping', 'pong', 'PING', ' ping', 'ping\n', '"ping"', 'not JSON']) socket.receiveText(text)
    for (const data of [undefined, null, {}, [], { id: null }, { id: 1 }, { id: '' }, { id: false }, { id: ['1'] }]) {
        socket.receive({ type: 'heartbeat', data })
    }
    assert.equal(socket.sent.length, 1)
    await advance(60000)
    assert.deepEqual(socket.sent.map(JSON.parse), [
        { type: 'auth', key: 'test-key' }, { type: 'query_all' }, { type: 'query_all' },
    ])
    socket.receive({ type: 'heartbeat', data: { id: '1', timestamp: 1793678400000 } })
    assert.deepEqual(JSON.parse(socket.sent.at(-1)), { type: 'heartbeat', data: { id: '1' } })
    assert.equal(socket.sentAt.at(-1), 60000)
    assert.equal(socket.sent.length, 4)
    socket.receive({ type: 'heartbeat', data: { id: '9007199254740993', timestamp: 1793678460000 } })
    assert.deepEqual(JSON.parse(socket.sent.at(-1)), { type: 'heartbeat', data: { id: '9007199254740993' } })
    assert.equal(socket.sent.length, 5)
    socket.receive({ type: 'query_all', data: {} })
    const report = { type: 'jma_eew', data: { eventId: 'after-heartbeat' }, md5: 'current-digest' }
    socket.receive(report)
    assert.deepEqual(received, [
        { type: 'auth_ok' }, { type: 'init', data: {} }, { type: 'query_all', data: {} }, report,
    ])
    socket.finishClose({ code: 1006, reason: '' })
    await advance(1000)
    sockets[1].open()
    sockets[1].receive({ type: 'heartbeat', data: { id: '1', timestamp: 1793678520000 } })
    assert.deepEqual(sockets[1].sent.map(JSON.parse), [{ type: 'auth', key: 'test-key' }])
    sockets[1].receive({ type: 'auth_ok' })
    sockets[1].receive({ type: 'init', data: {} })
    sockets[1].receive({ type: 'heartbeat', data: { id: '1', timestamp: 1793678520000 } })
    assert.deepEqual(JSON.parse(sockets[1].sent.at(-1)), { type: 'heartbeat', data: { id: '1' } })
    client.close()
    sockets[1].receive({ type: 'heartbeat', data: { id: '2', timestamp: 1793678580000 } })
    assert.equal(sockets[1].sent.length, 2)
})

test('Lipo polls all lists and query_all every 30 seconds with stable stagger offsets', async t => {
    const { sockets, advance } = setup(t)
    const requests = ['cenc_report_list', 'cwa_report_list', 'kma_report_list', 'usgs_report_list']
    const client = new LipoApiClient('wss://lipo.test/all', {
        key: 'test-key', reportRequests: [...requests, 'unknown_list'],
    })
    t.after(() => client.close())
    const socket = sockets[0]
    socket.open()
    socket.receive({ type: 'auth_ok' })
    const snapshot = Object.fromEntries(requests.map(type => [type.replace(/_list$/, ''), { data: null }]))
    socket.receive({ type: 'init', data: snapshot })
    await advance(6000)
    assert.deepEqual(socket.sent.map(JSON.parse).map(message => message.type), ['auth', ...requests])
    assert.deepEqual(socket.sentAt, [0, 0, 2000, 4000, 6000])
    requests.forEach(type => socket.receive({ type, data: [] }))
    for (let round = 1; round <= 3; round++) {
        await advance(round * 30000 + 8000 - Date.now())
        requests.forEach(type => socket.receive({ type, data: [] }))
        if (JSON.parse(socket.sent.at(-1)).type === 'query_all') socket.receive({ type: 'query_all', data: snapshot })
    }
    const sent = socket.sent.map((message, index) => ({ type: JSON.parse(message).type, at: socket.sentAt[index] }))
    requests.forEach((type, index) => {
        assert.deepEqual(sent.filter(message => message.type === type).map(message => message.at),
            [0, 30000, 60000, 90000].map(at => at + index * 2000))
    })
    assert.deepEqual(sent.filter(message => message.type === 'query_all').map(message => message.at), [38000, 68000, 98000])
    assert.equal(sent.some(message => message.type === 'unknown_list'), false)
})

test('Lipo refreshes the matching list for each report push, but not for snapshots, list replies or other sources', async t => {
    const { sockets, advance } = setup(t)
    const sources = ['cenc_report', 'cwa_report', 'kma_report', 'usgs_report']
    const client = new LipoApiClient('wss://lipo.test/all', {
        key: 'test-key', reportRequests: sources.map(type => `${type}_list`),
    })
    t.after(() => client.close())
    const socket = sockets[0]
    const snapshot = Object.fromEntries(sources.map(type => [type, { type, data: { eventId: 'snapshot' } }]))
    socket.open()
    socket.receive({ type: 'auth_ok' })
    socket.receive({ type: 'init', data: snapshot })
    await advance(6000)
    sources.forEach(type => socket.receive({ type: `${type}_list`, data: [] }))
    assert.equal(socket.sent.length, 5, 'The init snapshot only requests the initial lists once')
    socket.receive({ type: 'query_all', data: snapshot })
    assert.equal(socket.sent.length, 5, 'Reports inside a query_all snapshot do not trigger list refreshes')
    for (const type of sources) {
        const before = socket.sent.length
        socket.receive({ type, data: { eventId: `${type}-new` } })
        assert.equal(socket.sent.length, before + 1)
        assert.deepEqual(JSON.parse(socket.sent.at(-1)), { type: `${type}_list` })
        assert.equal(socket.sentAt.at(-1), 6000, 'Push-triggered refreshes are immediate')
        socket.receive({ type: `${type}_list`, data: [] })
        assert.equal(socket.sent.length, before + 1, 'List replies must not trigger a query loop')
    }
    const beforeOtherSources = socket.sent.length
    for (const type of ['jma_eew', 'cea_eew', 'icl_eew', 'kma_eew', 'nmefc_tsunami', 'cenc_ir', 'unknown_report']) {
        socket.receive({ type, data: {} })
    }
    assert.equal(socket.sent.length, beforeOtherSources)
})

test('Lipo push-triggered list refreshes require init, configured lists and visible sources', t => {
    const { sockets } = setup(t)
    const client = new LipoApiClient('wss://lipo.test/all', {
        key: 'test-key', reportRequests: ['cenc_report_list', 'usgs_report_list'],
    })
    t.after(() => client.close())
    const socket = sockets[0]
    socket.open()
    socket.receive({ type: 'auth_ok' })
    socket.receive({ type: 'cenc_report', data: {} })
    assert.equal(socket.sent.length, 1)
    const snapshot = { cenc_report: { data: null }, cwa_report: { data: null } }
    socket.receive({ type: 'init', data: snapshot })
    socket.receive({ type: 'cenc_report_list', data: [] })
    socket.receive({ type: 'cwa_report', data: {} })
    socket.receive({ type: 'usgs_report', data: {} })
    assert.deepEqual(socket.sent.map(JSON.parse), [{ type: 'auth', key: 'test-key' }, { type: 'cenc_report_list' }])
    socket.receive({ type: 'query_all', data: { ...snapshot, usgs_report: { data: null } } })
    assert.equal(socket.sent.length, 2)
    socket.receive({ type: 'usgs_report', data: {} })
    assert.deepEqual(JSON.parse(socket.sent.at(-1)), { type: 'usgs_report_list' })
})

test('Lipo coalesces pushes during an in-flight list, follows up once, and discards refreshes on disconnect', async t => {
    const { sockets, advance } = setup(t)
    const client = new LipoApiClient('wss://lipo.test/all', { key: 'test-key', reportRequests: ['cenc_report_list'] })
    t.after(() => client.close())
    const socket = sockets[0]
    const snapshot = { cenc_report: { data: null } }
    socket.open()
    socket.receive({ type: 'auth_ok' })
    socket.receive({ type: 'init', data: snapshot })
    await advance(1000)
    socket.receive({ type: 'cenc_report', data: { eventId: 'first' } })
    socket.receive({ type: 'cenc_report', data: { eventId: 'second' } })
    assert.equal(socket.sent.length, 2, 'Concurrent pushes do not duplicate an in-flight query')
    socket.receive({ type: 'cenc_report_list', data: [] })
    assert.equal(socket.sent.length, 3, 'A possibly stale response is followed by one fresh query')
    assert.deepEqual(JSON.parse(socket.sent.at(-1)), { type: 'cenc_report_list' })
    assert.equal(socket.sentAt.at(-1), 1000)
    socket.receive({ type: 'cenc_report_list', data: [] })
    assert.equal(socket.sent.length, 3)
    await advance(29000)
    assert.equal(socket.sent.length, 4, 'A push refresh does not reset the periodic polling timer')
    assert.equal(socket.sentAt.at(-1), 30000)
    socket.receive({ type: 'cenc_report', data: { eventId: 'before-disconnect' } })
    socket.finishClose({ code: 1006, reason: '' })
    await advance(1000)
    sockets[1].open()
    sockets[1].receive({ type: 'auth_ok' })
    sockets[1].receive({ type: 'init', data: snapshot })
    sockets[1].receive({ type: 'cenc_report_list', data: [] })
    socket.receive({ type: 'cenc_report_list', data: [] })
    await advance(2000)
    assert.deepEqual(sockets[1].sent.map(JSON.parse), [{ type: 'auth', key: 'test-key' }, { type: 'cenc_report_list' }])
    assert.equal(socket.sent.length, 4)
    sockets[1].receive({ type: 'cenc_report', data: { eventId: 'before-disposal' } })
    sockets[1].receive({ type: 'cenc_report', data: { eventId: 'queued-before-disposal' } })
    client.close()
    const before = sockets[1].sent.length
    await advance(60000)
    assert.equal(sockets.length, 2)
    assert.equal(sockets[1].sent.length, before)
})

test('Lipo replaces an unanswered list after timeout without duplicating a queued push refresh', async t => {
    const { sockets, advance } = setup(t)
    const client = new LipoApiClient('wss://lipo.test/all', { key: 'test-key', reportRequests: ['cenc_report_list'] })
    t.after(() => client.close())
    const socket = sockets[0]
    socket.open()
    socket.receive({ type: 'auth_ok' })
    socket.receive({ type: 'init', data: { cenc_report: { data: null } } })
    await advance(1000)
    socket.receive({ type: 'cenc_report', data: { eventId: 'new' } })
    await advance(28999)
    assert.equal(socket.sent.length, 2)
    await advance(1)
    assert.deepEqual(socket.sent.map(JSON.parse), [
        { type: 'auth', key: 'test-key' }, { type: 'cenc_report_list' }, { type: 'cenc_report_list' },
    ])
    socket.receive({ type: 'cenc_report_list', data: [] })
    assert.equal(socket.sent.length, 3, 'The periodic retry already covers the queued refresh')
    await advance(1000)
    socket.receive({ type: 'cenc_report', data: { eventId: 'another' } })
    assert.equal(socket.sent.length, 4, 'A new push can refresh again as soon as the previous query finishes')
    assert.equal(socket.sentAt.at(-1), 31000)
})

test('Lipo staggers initial lists and periodic queries, replies to heartbeats immediately, and times pending requests from sending', async t => {
    const { sockets, advance } = setup(t)
    const client = new LipoApiClient('wss://lipo.test/all', {
        key: 'test-key', reportRequests: ['cenc_report_list', 'cwa_report_list'],
    })
    t.after(() => client.close())
    const socket = sockets[0]
    const snapshot = { cenc_report: { data: null }, cwa_report: { data: null } }
    socket.open()
    socket.receive({ type: 'auth_ok' })
    socket.receive({ type: 'init', data: snapshot })
    assert.deepEqual(socket.sent.map(JSON.parse).map(message => message.type), ['auth', 'cenc_report_list'])
    await advance(1000)
    socket.receive({ type: 'heartbeat', data: { id: '1', timestamp: 1793678400000 } })
    assert.deepEqual(JSON.parse(socket.sent.at(-1)), { type: 'heartbeat', data: { id: '1' } })
    await advance(999)
    assert.equal(socket.sent.length, 3)
    await advance(1)
    assert.equal(JSON.parse(socket.sent.at(-1)).type, 'cwa_report_list')
    socket.receive({ type: 'cenc_report_list', data: [] })
    socket.receive({ type: 'cwa_report_list', data: [] })
    await advance(30000)
    assert.deepEqual(socket.sent.map((message, index) => [JSON.parse(message).type, socket.sentAt[index]]), [
        ['auth', 0], ['cenc_report_list', 0], ['heartbeat', 1000], ['cwa_report_list', 2000],
        ['cenc_report_list', 30000], ['cwa_report_list', 32000],
    ])
    const sentCount = socket.sent.length
    await advance(1999)
    assert.equal(socket.sent.length, sentCount, 'Unanswered requests stay suppressed for 30 seconds')
    await advance(1)
    assert.deepEqual(JSON.parse(socket.sent.at(-1)), { type: 'query_all' })
    await advance(25999)
    assert.equal(socket.sent.length, sentCount + 1)
    await advance(1)
    assert.deepEqual(JSON.parse(socket.sent.at(-1)), { type: 'cenc_report_list' })
    await advance(1999)
    assert.equal(socket.sent.length, sentCount + 2)
    await advance(1)
    assert.deepEqual(socket.sentAt.slice(-3), [34000, 60000, 62000])
    assert.deepEqual(socket.sent.slice(-3).map(JSON.parse), [
        { type: 'query_all' }, { type: 'cenc_report_list' }, { type: 'cwa_report_list' },
    ])
    await advance(1999)
    assert.equal(socket.sent.length, sentCount + 3)
    await advance(1)
    assert.deepEqual(JSON.parse(socket.sent.at(-1)), { type: 'query_all' })
    assert.equal(socket.sentAt.at(-1), 64000)
})

test('Lipo stops unsent batch requests on disconnect and disposal, and rebuilds the batch after reauthentication', async t => {
    const { sockets, advance } = setup(t)
    const client = new LipoApiClient('wss://lipo.test/all', {
        key: 'test-key', reportRequests: ['cenc_report_list', 'cwa_report_list'],
    })
    t.after(() => client.close())
    const snapshot = { cenc_report: { data: null }, cwa_report: { data: null } }
    sockets[0].open()
    sockets[0].receive({ type: 'auth_ok' })
    sockets[0].receive({ type: 'init', data: snapshot })
    await advance(1000)
    sockets[0].finishClose({ code: 1006, reason: '' })
    await advance(1000)
    assert.deepEqual(sockets[0].sent.map(JSON.parse).map(message => message.type), ['auth', 'cenc_report_list'])
    sockets[1].open()
    await advance(2000)
    assert.deepEqual(sockets[1].sent.map(JSON.parse).map(message => message.type), ['auth'])
    sockets[1].receive({ type: 'auth_ok' })
    sockets[1].receive({ type: 'init', data: snapshot })
    await advance(2000)
    assert.deepEqual(sockets[1].sent.map(JSON.parse).map(message => message.type), ['auth', 'cenc_report_list', 'cwa_report_list'])
    sockets[1].receive({ type: 'cenc_report_list', data: [] })
    sockets[1].receive({ type: 'cwa_report_list', data: [] })
    await advance(28000)
    assert.equal(JSON.parse(sockets[1].sent.at(-1)).type, 'cenc_report_list')
    client.close()
    const sentCount = sockets[1].sent.length
    await advance(60000)
    assert.equal(sockets.length, 2)
    assert.equal(sockets[1].sent.length, sentCount)
})

test('Lipo restarts polling after init without report lists or orphan timers', async t => {
    const { sockets, advance } = setup(t)
    const client = new LipoApiClient('wss://lipo.test/all', { key: 'test-key' })
    t.after(() => client.close())
    sockets[0].open()
    sockets[0].receive({ type: 'auth_ok' })
    sockets[0].receive({ type: 'init', data: {} })
    await advance(20000)
    assert.deepEqual(sockets[0].sent.map(JSON.parse), [{ type: 'auth', key: 'test-key' }])
    sockets[0].finishClose({ code: 1006, reason: '' })
    await advance(1000)
    sockets[1].open()
    await advance(15000)
    assert.deepEqual(sockets[1].sent.map(JSON.parse), [{ type: 'auth', key: 'test-key' }])
    sockets[1].receive({ type: 'auth_ok' })
    sockets[1].receive({ type: 'init', data: {} })
    await advance(29999)
    assert.deepEqual(sockets[1].sent.map(JSON.parse), [{ type: 'auth', key: 'test-key' }])
    await advance(1)
    assert.equal(JSON.parse(sockets[1].sent.at(-1)).type, 'query_all')
    client.close()
    const sentCount = sockets[1].sent.length
    await advance(60000)
    assert.equal(sockets.length, 2)
    assert.equal(sockets[1].sent.length, sentCount)
})

test('Lipo PEWS forwards station messages without heartbeats, polling or a heartbeat timeout', async t => {
    const { sockets, advance } = setup(t)
    const client = new LipoApiClient('wss://lipo.test/kma_pews', { key: 'test-key', pews: true })
    t.after(() => client.close())
    const messages = []
    client.setMessageHandler(message => messages.push(message))
    sockets[0].open()
    sockets[0].receive({ type: 'auth_ok' })
    sockets[0].receive({ type: 'station_list', data: { frameTime: '2026-11-03 23:00:00', staLatLng: [{ latitude: 35, longitude: 127 }] } })
    sockets[0].receive({ type: 'station_int', data: { frameTime: '2026-11-04 00:00:00', mmi: [-3] } })
    await advance(180000)
    sockets[0].receiveText('ping')
    sockets[0].receiveText('pong')
    sockets[0].receive({ type: 'heartbeat', data: { id: '1', timestamp: 1793678400000 } })
    client.request('query_all')
    assert.deepEqual(messages.map(message => message.type), ['auth_ok', 'station_list', 'station_int'])
    assert.deepEqual(sockets[0].sent.map(JSON.parse), [{ type: 'auth', key: 'test-key' }])
    assert.equal(sockets.length, 1)
    assert.equal(sockets[0].readyState, 1)
})

test('Lipo stops invalid credentials by default, backs off opt-in auth retries, and resets only after auth succeeds', async t => {
    const { sockets, advance } = setup(t)
    const stopped = new LipoApiClient('wss://lipo.test/all', { key: 'test-key' })
    const retrying = new LipoApiClient('wss://lipo.test/all', { key: 'test-key', autoReconnectOnAuthFail: true })
    t.after(() => { stopped.close(); retrying.close() })
    sockets[0].open()
    sockets[1].open()
    sockets[0].receive({ type: 'error', data: { code: 'AUTH_FAILED' } })
    sockets[1].receive({ type: 'error', data: { code: 'AUTH_FAILED' } })
    await advance(999)
    assert.equal(sockets.length, 2)
    await advance(1)
    assert.equal(stopped.shouldConnect, false)
    assert.equal(sockets.length, 3)
    sockets[2].open()
    sockets[2].receive({ type: 'error', data: { code: 'AUTH_FAILED' } })
    await advance(1999)
    assert.equal(sockets.length, 3)
    await advance(1)
    assert.equal(sockets.length, 4)
    sockets[3].open()
    sockets[3].receive({ type: 'auth_ok' })
    sockets[3].finishClose({ code: 1006, reason: '' })
    await advance(999)
    assert.equal(sockets.length, 4)
    await advance(1)
    assert.equal(sockets.length, 5)
})

test('Lipo handles a forbidden query delivered only in the close frame', async t => {
    const { sockets, advance } = setup(t)
    const client = new LipoApiClient('wss://lipo.test/all', { key: 'test-key', autoReconnectOnAuthFail: true })
    t.after(() => client.close())
    const received = []
    client.setMessageHandler(message => received.push(message))
    sockets[0].open()
    sockets[0].receive({ type: 'auth_ok' })
    sockets[0].finishClose({ code: 1008, reason: 'REQUEST_FORBIDDEN' })
    await advance(60000)
    assert.equal(sockets.length, 1)
    assert.equal(client.shouldConnect, false)
    assert.equal(received.at(-1).data.code, 'REQUEST_FORBIDDEN')
})

test('provider clients send initial queries and pings immediately and repeat every 30 seconds', async t => {
    const { sockets, advance } = setup(t)
    const wolfx = new WolfxClient('wss://wolfx.test', ['ceaEew', 'jmaEew', 'cwaEew', 'jmaEqlist', 'cencEqlist'])
    const p2p = new P2pQuakeClient('wss://p2p.test')
    const gq = new GlobalQuakeClient('wss://gq.test')
    t.after(() => { wolfx.close(); p2p.close(); gq.close() })
    const received = []
    wolfx.setMessageHandler(message => received.push(message))
    sockets.forEach(socket => socket.open())
    await advance(1999)
    assert.deepEqual(sockets[0].sent, ['query_cenceew'])
    await advance(1)
    assert.deepEqual(sockets[0].sent, ['query_cenceew', 'query_jmaeew'])
    await advance(6000)
    const queries = ['query_cenceew', 'query_jmaeew', 'query_cwaeew', 'query_jmaeqlist', 'query_cenceqlist']
    assert.deepEqual(sockets[0].sent, queries)
    assert.deepEqual(sockets[1].sent, ['ping'])
    assert.deepEqual(sockets[2].sent, ['ping'])
    await advance(21999)
    assert.deepEqual(sockets[0].sent, queries)
    assert.deepEqual(sockets[1].sent, ['ping'])
    assert.deepEqual(sockets[2].sent, ['ping'])
    await advance(1)
    assert.deepEqual(sockets[0].sent, [...queries, queries[0]])
    assert.deepEqual(sockets[1].sentAt, [0, 30000])
    assert.deepEqual(sockets[2].sentAt, [0, 30000])
    await advance(38000)
    assert.deepEqual(sockets[0].sent, [...queries, ...queries, ...queries])
    assert.deepEqual(sockets[0].sentAt, [0, 30000, 60000].flatMap(at => [0, 2000, 4000, 6000, 8000].map(offset => at + offset)))
    assert.deepEqual(sockets[1].sentAt, [0, 30000, 60000])
    assert.deepEqual(sockets[2].sentAt, [0, 30000, 60000])
    const sentCounts = sockets.map(socket => socket.sent.length)
    sockets.forEach(socket => socket.receiveText('ping'))
    assert.deepEqual(sockets.map(socket => socket.sent.length), sentCounts)
    sockets[0].onmessage({ data: 'not JSON' })
    sockets[0].receive({ type: 'jma_eew', EventID: 'test' })
    assert.deepEqual(received, [{ type: 'jma_eew', EventID: 'test' }])
})
