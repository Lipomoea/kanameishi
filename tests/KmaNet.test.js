import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { computed, effectScope, markRaw, nextTick, reactive, ref, watch } from 'vue'
import { LipoApiClient } from '../src/classes/WebSocket.js'
import { createPewsFrame } from './fixtures/KmaPews.js'

const coordinates = [{ latitude: 35, longitude: 127 }, { latitude: 36, longitude: 128 }]
const setup = (context, mapReady = true, Client) => {
    const source = readFileSync(new URL('../src/components/components/KmaNet.vue', import.meta.url), 'utf8')
        .match(/<script setup>([\s\S]*?)<\/script>/)[1]
        .replace(/^import[^\n]*\n/gm, '')
    const scope = effectScope()
    const map = markRaw({ on() {}, off() {}, eachLayer() {}, hasLayer() { return false } })
    const status = reactive({ map: mapReady ? map : null, isActive: { kmaNet: false } })
    const settings = {
        advancedSettings: { fallbackSvgStationRender: true },
        mainSettings: {
            apiKeys: { lipoApiKey: 'test-key' }, apiAuthAutoReconnect: false,
            displaySeisNet: { kmaNet: true, kmaSensitivity: 0 }, onShake: {},
        },
    }
    const provided = {
        kmaUpdateTime: ref('2026-11-04 10:00:00'), kmaMaxInt: ref('?'),
        kmaPeriodMaxInt: ref('?'), kmaPeriodBarClass: ref('gray'),
        handleTempEqlists() {}, smartSetView() {},
    }
    const updates = []
    const timesDuringUpdate = []
    const document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
    const mounted = [], unmounted = []
    let socket
    class FakeClient {
        constructor() { socket = this }
        setMessageHandler(handler) { this.messageHandler = handler }
        setCloseHandler(handler) { this.closeHandler = handler }
        close() { this.closeHandler?.() }
        receive(message) { this.messageHandler(message) }
    }
    class FakeStation {
        constructor(stationMap, id, latLng) {
            this.id = id
            this.latLng = latLng
            this.holdLevel = -1
            this.recentLevel = []
            this.recentSeconds = 60
            this.isActive = false
            this.ascend = 0
        }
        update(intensity) {
            timesDuringUpdate.push(provided.kmaUpdateTime.value)
            this.holdLevel = intensity + 2
            this.recentLevel.unshift(intensity + 2)
            this.recentLevel.splice(this.recentSeconds)
            updates.push({ latLng: [...this.latLng], intensity })
        }
        render() {}
        terminate() { this.terminated = true }
    }
    class FakeGridLayer {
        addTo() { return this }
        setGrids() {}
    }
    const dependencies = {
        ref, reactive, computed, watch,
        onMounted: callback => mounted.push(callback),
        onBeforeUnmount: callback => unmounted.push(callback),
        inject: name => provided[name],
        useStatusStore: () => status,
        useSettingsStore: () => settings,
        isNetworkPeriodActive: () => false,
        seisNetUrls: { kma: 'wss://lipo.test/kma_pews' },
        LipoApiClient: Client || FakeClient,
        KmaStation: FakeStation,
        KmaGridCanvasLayer: FakeGridLayer,
        simpleIcon: ref(false),
        ElMessage() {},
        document,
        calcDistanceKm: () => 10,
        calcTimeDiff: (first, firstZone, second, secondZone) =>
            Date.parse(first.replace(' ', 'T') + 'Z') - firstZone * 3600000
            - Date.parse(second.replace(' ', 'T') + 'Z') + secondZone * 3600000,
        getMmiFromKmaLevel: level => level === -1 ? '?' : String(Math.max(level - 2, 0)),
    }
    const state = scope.run(() => new Function(...Object.keys(dependencies), source + '\nreturn { stations, stationList };')(...Object.values(dependencies)))
    mounted.forEach(callback => callback())
    context.after(() => {
        unmounted.forEach(callback => callback())
        scope.stop()
    })
    return {
        ...state, updates, timesDuringUpdate, document, status, map, socket, provided,
        list: staLatLng => socket.receive({ type: 'station_list', data: { staLatLng } }),
        intensity: (second, mmi) => socket.receive({ type: 'station_int', data: { frameTime: `2026-11-04 10:00:0${second}`, mmi } }),
    }
}

test('KMA replaces reordered and resized lists synchronously before interpreting the next intensity frame', context => {
    const client = setup(context)
    client.list(coordinates)
    client.intensity(1, [2, 3])
    const previousStations = [...client.stations]
    const reordered = [...coordinates].reverse()
    client.list(reordered)
    assert.ok(previousStations.every(station => station.terminated))
    assert.deepEqual(client.stations.map(station => [...station.latLng]), [[36, 128], [35, 127]])
    client.intensity(2, [4, 5])
    assert.deepEqual(client.updates.slice(-2), [
        { latLng: [36, 128], intensity: 4 }, { latLng: [35, 127], intensity: 5 },
    ])
    const currentStations = [...client.stations]
    client.list(reordered.map(station => ({ ...station })))
    assert.ok(currentStations.every((station, index) => station === client.stations[index]))
    client.intensity(3, [4, 5])
    assert.equal(client.updates.length, 6)
    client.list([coordinates[0]])
    client.intensity(4, [6])
    assert.equal(client.stations.length, 1)
    assert.deepEqual(client.updates.at(-1), { latLng: [35, 127], intensity: 6 })
    client.intensity(5, [-3])
    assert.equal(client.updates.length, 7)
    assert.equal(client.provided.kmaUpdateTime.value, '2026-11-04 10:00:04')
})

test('KMA applies only the latest queued intensity once the map and its station list are ready', async context => {
    const client = setup(context, false)
    client.list(coordinates)
    client.intensity(1, [2, 3])
    client.intensity(2, [4, 5])
    assert.deepEqual(client.updates, [])
    assert.equal(client.provided.kmaUpdateTime.value, '2026-11-04 10:00:00')
    client.status.map = client.map
    await nextTick()
    assert.deepEqual(client.updates, [
        { latLng: [35, 127], intensity: 4 }, { latLng: [36, 128], intensity: 5 },
    ])
    assert.equal(client.provided.kmaUpdateTime.value, '2026-11-04 10:00:02')
})

test('KMA advances time only after updating nonempty station instances, including while hidden', context => {
    const client = setup(context)
    client.intensity(1, [])
    assert.equal(client.provided.kmaUpdateTime.value, '2026-11-04 10:00:00')
    client.list(coordinates)
    client.document.visibilityState = 'hidden'
    client.intensity(1, [2, 3])
    assert.deepEqual(client.timesDuringUpdate, ['2026-11-04 10:00:00', '2026-11-04 10:00:00'])
    assert.equal(client.provided.kmaUpdateTime.value, '2026-11-04 10:00:01')
    client.intensity(2, [2, 3])
    assert.equal(client.provided.kmaUpdateTime.value, '2026-11-04 10:00:02')
    assert.equal(client.updates.length, 4)
})

test('KMA keeps the accepted timestamp when a station update fails so the same frame can retry', context => {
    const client = setup(context)
    client.list(coordinates)
    const station = client.stations[0]
    const originalUpdate = station.update
    station.update = () => { throw new Error('station update failed') }
    assert.throws(() => client.intensity(1, [2, 3]), /station update failed/)
    assert.equal(client.provided.kmaUpdateTime.value, '2026-11-04 10:00:00')
    station.update = originalUpdate
    client.intensity(1, [2, 3])
    assert.equal(client.provided.kmaUpdateTime.value, '2026-11-04 10:00:01')
})

for (const reason of ['list replacement', 'disconnect']) {
    test(`KMA clears pending intensity on ${reason} so it cannot be paired with a new list`, async context => {
        const client = setup(context, false)
        client.list(coordinates)
        client.intensity(1, [8, 9])
        if (reason === 'list replacement') client.list([...coordinates].reverse())
        else client.socket.close()
        client.status.map = client.map
        await nextTick()
        assert.deepEqual(client.updates, [])
        assert.equal(client.provided.kmaUpdateTime.value, '2026-11-04 10:00:00')
    })
}

test('KMA accepts a corrected binary frame after -3 and preserves accepted time and history across protocol reconnects', context => {
    const originalWebSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket')
    class FakeWebSocket {
        constructor() { this.readyState = 1 }
        close() { this.readyState = 3 }
        receive(data) { this.onmessage?.({ data }) }
    }
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FakeWebSocket })
    context.after(() => {
        if (originalWebSocket) Object.defineProperty(globalThis, 'WebSocket', originalWebSocket)
        else delete globalThis.WebSocket
    })
    let connection
    class BinaryClient extends LipoApiClient {
        constructor(...args) {
            super(...args)
            connection = this
        }
    }
    const component = setup(context, true, BinaryClient)
    const baselineSecond = Date.parse('2026-11-04T10:00:00+09:00') / 1000
    const receive = (type, values, second) => connection.transport.socket.receive(createPewsFrame(type, values, baselineSecond + second))
    connection.transport.socket.receive(JSON.stringify({ type: 'auth_ok' }))
    receive(1, [500 * 1024 + 700, 600 * 1024 + 800], -3600)
    receive(2, [13, 2], 1)
    receive(2, [8, 0], 2)
    assert.equal(component.provided.kmaUpdateTime.value, '2026-11-04 10:00:01')
    assert.equal(connection.transport.reconnectTimer, undefined)
    receive(2, [8, 9], 2)
    assert.equal(component.provided.kmaUpdateTime.value, '2026-11-04 10:00:02')
    assert.deepEqual(component.updates.map(update => update.intensity), [0, 2, 8, 9])
    receive(2, [10, 11], 2)
    receive(2, [10, 11], 1)
    assert.equal(component.updates.length, 4)
    const stations = [...component.stations]
    const history = [...stations[0].recentLevel]
    receive(2, [15, 9], 3)
    assert.equal(connection.authenticated, false)
    assert.equal(connection.pewsStationCount, 0)
    assert.equal(component.provided.kmaUpdateTime.value, '2026-11-04 10:00:02')
    assert.deepEqual(stations[0].recentLevel, history)
    connection.transport.reconnect()
    connection.transport.socket.receive(JSON.stringify({ type: 'auth_ok' }))
    receive(1, [500 * 1024 + 700, 600 * 1024 + 800], -7200)
    assert.ok(stations.every((station, index) => station === component.stations[index]))
    receive(2, [10, 11], 1)
    assert.equal(component.updates.length, 4)
    receive(2, [1, 14], 5)
    assert.deepEqual(stations[0].recentLevel, [0, -1, -1, ...history])
    assert.equal(component.provided.kmaUpdateTime.value, '2026-11-04 10:00:05')
})
