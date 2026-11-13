import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { computed, effectScope, markRaw, nextTick, reactive, ref, watch } from 'vue'
import { StationFrameQueue } from '../src/features/stations/StationFrameQueue.js'

const startStamp = 1700000000000
const stationInfos = [{ station: 'first', lat: 23, lon: 121 }, { station: 'second', lat: 24, lon: 121 }]
const frameTime = timestamp => new Date(timestamp + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ')
const settle = async () => { await Promise.resolve(); await nextTick() }
const setup = context => {
    const source = readFileSync(new URL('../src/components/components/PalertNet.vue', import.meta.url), 'utf8')
        .match(/<script setup>([\s\S]*?)<\/script>/)[1]
        .replace(/^import[^\n]*\n/gm, '')
        .replaceAll('import.meta.url', 'componentUrl')
    const scope = effectScope()
    const map = markRaw({ on() {}, off() {} })
    const status = reactive({ map: null, seisNetReplayDelay: 0, isActive: { palertNet: false } })
    const settings = reactive({
        advancedSettings: { fallbackSvgStationRender: true },
        mainSettings: {
            displaySeisNet: { palertNet: true, palertSensitivity: 0, palertHypoInf: false, httpDataPriority: 'realtime' },
            onShake: {},
        },
    })
    const provided = {
        palertUpdateTime: ref('1970-01-01 08:00:00'), palertMaxShindo: ref('?'),
        palertPeriodMaxShindo: ref('?'), palertPeriodBarClass: ref('gray'), activeEewList: ref([]),
        smartSetView() {}, handleTempEqlists() {},
        taiwanSeisNetLayers: { registerSource: () => () => {}, redrawStations() {} },
    }
    const mounted = [], unmounted = [], listRequests = [], dataRequests = [], created = [], updates = []
    const timers = new Map()
    let timerId = 0
    class FakeStation {
        constructor(stationMap, id, latLng) {
            assert.equal(stationMap, map)
            this.id = id
            this.latLng = latLng
            this.level = this.holdLevel = this.recentMaxLevel = -1
            this.activity = 0
            this.isActive = false
            created.push(this)
        }
        update(frame, missingSeconds, render) { updates.push({ id: this.id, ...frame, missingSeconds, render }) }
        clearHistory() {}
        clearRecentData() {}
        updateHoldLevel() {}
        render() {}
        terminate() { this.terminated = true }
    }
    const dependencies = {
        reactive, computed, watch, StationFrameQueue,
        componentUrl: new URL('../src/components/components/PalertNet.vue', import.meta.url).href,
        onMounted: callback => mounted.push(callback),
        onBeforeUnmount: callback => unmounted.push(callback),
        inject: name => provided[name],
        useStatusStore: () => status,
        useSettingsStore: () => settings,
        useTimeStore: () => ({ getTimeStamp: () => startStamp }),
        isNetworkPeriodActive: () => false,
        Palert: {
            getStationList: () => new Promise(resolve => listRequests.push({ resolve })),
            getRealtimeData: (type, recordTime) => new Promise(resolve => dataRequests.push({ type, recordTime, resolve })),
        },
        PalertStation: FakeStation, simpleIcon: ref(false),
        L: { icon: options => options }, infHypoIconUrl: '',
        document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
        calcDistanceKm: () => 10, calcBearingDeg: () => 0,
        getShindoFromLevel: String, getPalertLevelFromPgaPgv: () => 0, stampToTime: frameTime,
        setInterval: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId },
        setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId },
        clearInterval: id => timers.delete(id), clearTimeout: id => timers.delete(id),
    }
    const state = scope.run(() => new Function(...Object.keys(dependencies), source + `
        return {
            stations, stationList, fetchStationList, fetchRealtimeData,
            pending: () => pendingStationFrame,
        };
    `)(...Object.values(dependencies)))
    mounted.forEach(callback => callback())
    let stopped = false
    const stop = () => {
        if(stopped) return
        stopped = true
        unmounted.forEach(callback => callback())
        scope.stop()
    }
    context.after(stop)
    return {
        ...state, map, status, settings, created, updates, provided, dataRequests, stop,
        receiveList: async (items = stationInfos, version = 'test-roster') => {
            listRequests[0].resolve({ version, staInfos: structuredClone(items) })
            await settle()
        },
        refreshList: async (items = stationInfos, version = 'test-roster') => {
            const pending = state.fetchStationList()
            listRequests.at(-1).resolve({ version, staInfos: structuredClone(items) })
            await pending
            await settle()
        },
        receiveFrame: async (timestamp = startStamp, pgaData = { first: 0, second: 1 }, pgvData = null) => {
            const pending = state.fetchRealtimeData()
            dataRequests.at(-1).resolve({ timestamp, dataVals: pgaData })
            await settle()
            if(pgvData) {
                const request = dataRequests.at(-1)
                assert.equal(request.type, 1)
                assert.equal(request.recordTime, timestamp / 1000)
                request.resolve({ timestamp, dataVals: pgvData })
            }
            await pending
            await settle()
        },
    }
}

for(const mapFirst of [true, false]) {
    test(`P-Alert applies only the latest complete PGA/PGV pair with ${mapFirst ? 'map' : 'list'} ready first`, async context => {
        const app = setup(context)
        await app.receiveFrame(startStamp)
        await app.receiveFrame(startStamp + 2000, { first: 100, second: 0 }, { first: 5, second: 0 })
        await app.receiveFrame(startStamp + 1000)
        assert.equal(app.pending().timestamp, startStamp + 2000)
        assert.equal(app.provided.palertUpdateTime.value, '1970-01-01 08:00:00')
        if(mapFirst) {
            app.status.map = app.map
            await nextTick()
            await app.receiveList()
        } else {
            await app.receiveList()
            app.status.map = app.map
            await nextTick()
        }
        assert.equal(app.updates.length, 2)
        assert.deepEqual(app.updates.map(({ id, timestamp, pga, pgv, missingSeconds }) => ({ id, timestamp, pga, pgv, missingSeconds })), [
            { id: 'first', timestamp: startStamp + 2000, pga: 100, pgv: 5, missingSeconds: 0 },
            { id: 'second', timestamp: startStamp + 2000, pga: 0, pgv: 0, missingSeconds: 0 },
        ])
        assert.equal(app.provided.palertUpdateTime.value, frameTime(startStamp + 2000))
        assert.equal(app.pending(), null)
        await app.receiveFrame(startStamp + 2000)
        assert.equal(app.updates.length, 2)
        await app.receiveFrame(startStamp + 5000)
        assert.equal(app.updates.length, 4)
        assert.equal(app.updates.at(-1).missingSeconds, 2)
    })
}

test('P-Alert waits for PGV before caching a new high-PGA frame', async context => {
    const app = setup(context)
    await app.receiveFrame(startStamp)
    const pending = app.fetchRealtimeData()
    app.dataRequests.at(-1).resolve({ timestamp: startStamp + 1000, dataVals: { first: 100 } })
    await settle()
    assert.equal(app.pending().timestamp, startStamp)
    app.dataRequests.at(-1).resolve({ timestamp: startStamp + 1000, dataVals: { first: 5 } })
    await pending
    assert.equal(app.pending().timestamp, startStamp + 1000)
    assert.deepEqual(app.pending().pgvData, { first: 5 })
})

for(const change of ['identical', 'version', 'coordinates']) {
    test(`P-Alert ${change === 'identical' ? 'preserves' : 'discards'} initialization cache on ${change} list refresh`, async context => {
        const app = setup(context)
        await app.receiveList()
        await app.receiveFrame()
        await app.refreshList(change === 'coordinates' ? [stationInfos[0]] : stationInfos,
            change === 'version' ? 'new-roster' : 'test-roster')
        app.status.map = app.map
        await nextTick()
        assert.equal(app.updates.length, change === 'identical' ? 2 : 0)
        assert.equal(app.pending(), null)
    })
}

for(const change of ['timeline', 'priority']) {
    test(`P-Alert clears initialization cache on ${change} change and rejects obsolete PGV completions`, async context => {
        const app = setup(context)
        await app.receiveFrame(startStamp + 3000)
        const pending = app.fetchRealtimeData()
        app.dataRequests.at(-1).resolve({ timestamp: startStamp + 4000, dataVals: { first: 100 } })
        await settle()
        const pgvRequest = app.dataRequests.at(-1)
        assert.equal(pgvRequest.type, 1)
        if(change === 'timeline') app.status.seisNetReplayDelay = 1
        else app.settings.mainSettings.displaySeisNet.httpDataPriority = 'complete'
        await nextTick()
        assert.equal(app.pending(), null)
        pgvRequest.resolve({ timestamp: startStamp + 4000, dataVals: { first: 5 } })
        await pending
        assert.equal(app.pending(), null)
        await app.receiveFrame(startStamp)
        await app.receiveList()
        app.status.map = app.map
        await nextTick()
        assert.equal(app.updates.length, 2)
        assert.ok(app.updates.every(update => update.timestamp === startStamp))
    })
}

test('P-Alert clears initialization cache on unmount and ignores late data and list responses', async context => {
    const app = setup(context)
    await app.receiveFrame()
    app.stop()
    assert.equal(app.pending(), null)
    app.dataRequests[0].resolve({ timestamp: startStamp + 1000, dataVals: { first: 1 } })
    await app.receiveList()
    app.status.map = app.map
    await nextTick()
    assert.equal(app.pending(), null)
    assert.equal(app.created.length, 0)
    assert.equal(app.updates.length, 0)
})

test('P-Alert ignores a late frame from before a roster replacement while waiting for the map', async context => {
    const app = setup(context)
    await app.receiveList()
    const pending = app.fetchRealtimeData()
    const request = app.dataRequests.at(-1)
    await app.refreshList([stationInfos[0]], 'new-roster')
    request.resolve({ timestamp: startStamp, dataVals: { first: 1, second: 0 } })
    await pending
    assert.equal(app.pending(), null)
    app.status.map = app.map
    await nextTick()
    assert.equal(app.updates.length, 0)
    await app.receiveFrame()
    assert.equal(app.updates.length, 1)
    assert.equal(app.updates[0].id, 'first')
})
