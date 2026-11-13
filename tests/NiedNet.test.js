import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { computed, effectScope, markRaw, nextTick, reactive, ref, watch } from 'vue'
import { StationFrameQueue } from '../src/features/stations/StationFrameQueue.js'

const coordinates = [[35, 135], [36, 136]]
const settle = async () => { await Promise.resolve(); await nextTick() }
const setup = (context, publishedCoordinates = coordinates) => {
    const source = readFileSync(new URL('../src/components/components/NiedNet.vue', import.meta.url), 'utf8')
        .match(/<script setup>([\s\S]*?)<\/script>/)[1]
        .replace(/^import[^\n]*\n/gm, '')
        .replaceAll('import.meta.url', 'componentUrl')
    const scope = effectScope()
    const map = markRaw({ on() {}, off() {}, hasLayer() { return false }, eachLayer() {} })
    const status = reactive({ map: null, seisNetReplayDelay: 0, isActive: { niedNet: false } })
    const settings = reactive({
        advancedSettings: { fallbackSvgStationRender: true },
        mainSettings: {
            displaySeisNet: { niedNet: true, niedSensitivity: 1, niedHypoInf: false, httpDataPriority: 'realtime' },
            onShake: {},
        },
    })
    const provided = {
        niedUpdateTime: ref('1970-01-01 09:00:00'), niedMaxShindo: ref('?'),
        niedPeriodMaxShindo: ref('?'), niedPeriodBarClass: ref('gray'), activeEewList: ref([]),
        smartSetView() {}, handleTempEqlists() {},
    }
    const mounted = [], unmounted = [], requests = [], dataRequests = [], created = [], updates = [], distances = []
    const timers = new Map()
    let timerId = 0
    class FakeStation {
        constructor(stationMap, id, latLng) {
            assert.equal(stationMap, map)
            this.id = id
            this.latLng = latLng
            this.map = stationMap
            this.level = -1
            this.activity = 0
            this.isActive = false
            this.recentLevel = []
            this.maxRecentLength = 60
            created.push(this)
        }
        update(intensity, timestamp) { updates.push({ id: this.id, intensity, timestamp }) }
        render() {}
        terminate() { this.terminated = true }
    }
    class FakeLayer {
        addTo() { return this }
        redraw() {}
        setGrids() {}
    }
    const dependencies = {
        ref, reactive, computed, watch, StationFrameQueue,
        componentUrl: new URL('../src/components/components/NiedNet.vue', import.meta.url).href,
        onMounted: callback => mounted.push(callback),
        onBeforeUnmount: callback => unmounted.push(callback),
        inject: name => provided[name],
        useStatusStore: () => status,
        useSettingsStore: () => settings,
        isNetworkPeriodActive: () => false,
        seisNetUrls: { nied: { stationList: 'https://nied.test/stations', stationData: 'https://nied.test/data' } },
        Http: { get: url => new Promise(resolve => requests.push({ url, resolve })) },
        axios: { get: url => new Promise(resolve => dataRequests.push({ url, resolve })) },
        getTimeNumberString: () => '19700101090001',
        NiedStation: FakeStation, NiedStationCanvasLayer: FakeLayer, NiedGridCanvasLayer: FakeLayer,
        niedSitePub: publishedCoordinates.map(([latitude, longitude]) => ({ latitude, longitude })),
        abnormalNiedStations: {}, simpleIcon: ref(false),
        L: { icon: options => options }, infHypoIconUrl: '',
        document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
        exactRound: (value, digits) => Number(value.toFixed(digits)),
        calcDistanceKm: (first, second) => { distances.push([first, second]); return 10 },
        calcBearingDeg: () => 0,
        getShindoFromLevel: String,
        timeToStamp: (time, zone) => Date.parse(time.replace(' ', 'T') + 'Z') - zone * 3600000,
        setInterval: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId },
        clearInterval: id => timers.delete(id),
        clearTimeout() {},
    }
    const state = scope.run(() => new Function(...Object.keys(dependencies), source + `
        return {
            stations, stationList, siteConfigId, fetchStationList, commitFrame,
            adjStationIds, adjStations4Hypo, triggerDiffToleranceMatrix,
            generation: () => requestGeneration,
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
        ...state, map, status, settings, created, updates, distances, provided, stop, dataRequests,
        poll: () => [...timers.values()].find(timer => timer.delay === 500).callback(),
        receiveList: async (items = coordinates, siteConfigId = 'test-roster') => {
            requests[0].resolve({ siteConfigId, items: structuredClone(items) })
            await settle()
        },
        refreshList: async (items = coordinates, siteConfigId = 'test-roster') => {
            const pending = state.fetchStationList()
            requests.at(-1).resolve({ siteConfigId, items: structuredClone(items) })
            await pending
            await settle()
        },
        frame: (timestamp = 1000, intensity = 'ab', siteConfigId = 'test-roster') => ({
            timestamp, frameTime: new Date(timestamp + 9 * 3600000).toISOString().slice(0, 19),
            intensity, siteConfigId, generation: state.generation(),
        }),
    }
}

test('NIED retains an early station list and waits for the map before creating instances', async context => {
    const app = setup(context)
    await app.receiveList()
    assert.equal(app.siteConfigId.value, 'test-roster')
    assert.equal(app.created.length, 0)
    assert.equal(app.distances.length, 0)
    assert.equal(app.commitFrame(app.frame()), false)
    assert.equal(app.provided.niedUpdateTime.value, '1970-01-01 09:00:00')
    app.status.map = app.map
    await nextTick()
    assert.equal(app.stations.length, 2)
    assert.equal(app.distances.length, 1)
    assert.deepEqual(app.stations.map(station => [...station.latLng]), coordinates)
    assert.equal(app.updates.length, 2)
    assert.equal(app.provided.niedUpdateTime.value, '1970-01-01 09:00:01')
    assert.equal(app.pending(), null)
    assert.equal(app.commitFrame(app.frame()), false)
    assert.equal(app.updates.length, 2)
})

test('NIED creates instances when the list follows the map and identical lists preserve them', async context => {
    const app = setup(context)
    app.status.map = app.map
    await nextTick()
    assert.equal(app.created.length, 0)
    await app.receiveList()
    const stations = [...app.stations]
    assert.equal(stations.length, 2)
    await app.refreshList()
    assert.equal(app.created.length, 2)
    assert.equal(app.distances.length, 1)
    assert.ok(stations.every((station, index) => station === app.stations[index]))
})

test('NIED normalizes coordinates before publishing the list without retriggering its watcher', async context => {
    const preciseCoordinates = [[35.01, 135.02], [36.03, 136.04]]
    const app = setup(context, preciseCoordinates)
    app.status.map = app.map
    await nextTick()
    await app.receiveList()
    assert.deepEqual(app.stationList, preciseCoordinates)
    assert.deepEqual(app.stations.map(station => [...station.latLng]), preciseCoordinates)
    await app.refreshList()
    assert.equal(app.created.length, 2)
    assert.equal(app.distances.length, 1)
})

test('NIED list changes rebuild instances and adjacency through the watcher without advancing data time', async context => {
    const app = setup(context)
    app.status.map = app.map
    await nextTick()
    await app.receiveList()
    app.commitFrame(app.frame())
    const previousStations = [...app.stations]
    await app.refreshList([coordinates[0]])
    assert.ok(previousStations.every(station => station.terminated))
    assert.equal(app.stations.length, 1)
    assert.equal(app.created.length, 3)
    assert.deepEqual(Object.keys(app.adjStationIds), ['0'])
    assert.deepEqual(Object.keys(app.adjStations4Hypo), ['0'])
    assert.equal(app.triggerDiffToleranceMatrix.length, 1)
    assert.equal(app.triggerDiffToleranceMatrix[0].length, 1)
    assert.equal(app.provided.niedUpdateTime.value, '1970-01-01 09:00:01')
})

test('NIED cannot initialize a cached list after unmounting while waiting for the map', async context => {
    const app = setup(context)
    await app.receiveList()
    const frame = app.frame()
    app.commitFrame(frame)
    app.stop()
    assert.equal(app.pending(), null)
    assert.equal(app.commitFrame(frame), false)
    app.status.map = app.map
    await nextTick()
    app.stationList.splice(0, app.stationList.length, coordinates[0])
    await nextTick()
    assert.equal(app.created.length, 0)
})

for(const mapFirst of [true, false]) {
    test(`NIED applies only the newest early HTTP frame with ${mapFirst ? 'map' : 'list'} ready first`, async context => {
        const app = setup(context)
        for(const timestamp of [1000, 3000, 2000]) {
            const pending = app.poll()
            const frame = app.frame(timestamp)
            app.dataRequests.at(-1).resolve({ status: 200, data: { realTimeData: {
                siteConfigId: frame.siteConfigId, dataTime: frame.frameTime + '+09:00', intensity: frame.intensity,
            } } })
            await pending
        }
        assert.equal(app.pending().timestamp, 3000)
        assert.equal(app.provided.niedUpdateTime.value, '1970-01-01 09:00:00')
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
        assert.ok(app.updates.every(update => update.timestamp === 3000))
        assert.equal(app.provided.niedUpdateTime.value, '1970-01-01 09:00:03')
        assert.equal(app.pending(), null)
        assert.equal(app.commitFrame(app.frame(3000)), false)
    })
}

for(const mismatch of ['version', 'count']) {
    test(`NIED discards an initial frame whose ${mismatch} does not match the arriving list`, async context => {
        const app = setup(context)
        app.commitFrame(app.frame(1000, mismatch === 'count' ? 'a' : 'ab', mismatch === 'version' ? 'old-roster' : 'test-roster'))
        await app.receiveList()
        assert.equal(app.pending(), null)
        app.status.map = app.map
        await nextTick()
        assert.equal(app.updates.length, 0)
        assert.equal(app.provided.niedUpdateTime.value, '1970-01-01 09:00:00')
        assert.equal(app.commitFrame(app.frame()), true)
        assert.equal(app.updates.length, 2)
    })
}

for(const change of ['identical', 'version', 'coordinates']) {
    test(`NIED ${change === 'identical' ? 'preserves' : 'discards'} initialization cache on ${change} list refresh`, async context => {
        const app = setup(context)
        await app.receiveList()
        app.commitFrame(app.frame())
        await app.refreshList(change === 'coordinates' ? [...coordinates].reverse() : coordinates,
            change === 'version' ? 'new-roster' : 'test-roster')
        app.status.map = app.map
        await nextTick()
        assert.equal(app.updates.length, change === 'identical' ? 2 : 0)
        assert.equal(app.pending(), null)
    })
}

for(const change of ['timeline', 'priority']) {
    test(`NIED clears early frames on ${change} change and rejects obsolete requests`, async context => {
        const app = setup(context)
        app.commitFrame(app.frame(3000))
        const pending = app.poll()
        if(change === 'timeline') app.status.seisNetReplayDelay = 1
        else app.settings.mainSettings.displaySeisNet.httpDataPriority = 'complete'
        await nextTick()
        assert.equal(app.pending(), null)
        app.dataRequests.at(-1).resolve({ status: 200, data: { realTimeData: {
            siteConfigId: 'test-roster', dataTime: '1970-01-01T09:00:04+09:00', intensity: 'ab',
        } } })
        await pending
        assert.equal(app.pending(), null)
        app.commitFrame(app.frame(1000))
        await app.receiveList()
        app.status.map = app.map
        await nextTick()
        assert.equal(app.updates.length, 2)
        assert.ok(app.updates.every(update => update.timestamp === 1000))
    })
}

test('NIED ignores a station list response arriving after unmounting', async context => {
    const app = setup(context)
    app.status.map = app.map
    await nextTick()
    app.stop()
    await app.receiveList()
    assert.equal(app.created.length, 0)
    assert.equal(app.siteConfigId.value, '')
})
