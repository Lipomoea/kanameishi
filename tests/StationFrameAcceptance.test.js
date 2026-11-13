import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { StationFrameQueue } from '../src/features/stations/StationFrameQueue.js'

const frameTime = timestamp => new Date(timestamp).toISOString().slice(0, 19).replace('T', ' ')
const section = (source, start, end) => {
    const first = source.indexOf(start)
    const last = source.indexOf(end, first)
    assert.ok(first >= 0 && last > first)
    return source.slice(first, last)
}
const setup = network => {
    const source = readFileSync(new URL(`../src/components/components/${network}Net.vue`, import.meta.url), 'utf8')
    const stations = network === 'Nied' ? [] : {}
    const stationList = []
    const updateTime = { value: 'initial' }
    const document = { visibilityState: 'visible' }
    const updates = []
    const failures = { enabled: false }
    const dependencies = {
        stations, stationList, document,
        siteConfigId: { value: 'test-roster' },
        stationData: { value: [] },
        [`${network.toLowerCase()}UpdateTime`]: updateTime,
        niedMaxShindo: {}, tremMaxShindo: {},
        useStationCanvasRenderer: { value: false },
        statusStore: { isActive: { niedNet: false } },
        getShindoFromLevel: String, getShindoFromInstShindo: String,
        stampToTime: frameTime,
        normalizeMeasurement: value => Number.isFinite(value) ? value : null,
        getPalertLevelFromPgaPgv: () => 0,
        renderAll() {}, updateMaxShindo() {}, updateHypocenters() {},
        detectActiveStations: () => new Set(),
        isNiedHypoInfEnabled: () => false,
        terminateHypocenterWorker() {}, clearInferredHypocenters() {}, clearTimeout() {},
    }
    let methods
    let commit
    if(network === 'Nied') {
        methods = section(source, 'const update =', 'const hasValidTriggerStamp')
            + section(source, 'const commitFrame =', 'onMounted(')
        commit = 'frame => commitFrame(frame)'
    } else if(network === 'Palert') {
        methods = section(source, 'const commitFrame =', 'const updateHypocenters =')
        commit = 'frame => commitFrame(frame.timestamp, frame.pgaData, frame.pgvData, frame.generation)'
    } else {
        methods = section(source, 'const update =', 'const renderAll =')
            + section(source, 'const commitFrame =', 'const fetchReplayFrame =')
        commit = 'frame => commitFrame(frame)'
    }
    const app = new Function(...Object.keys(dependencies), `
        let latestFrameStamp = null, requestGeneration = 0, pendingTimelineSwitch = false;
        let pendingRender = false, stopped = false, updateStamp = null, stationFrame, pendingStationFrame = null;
        ${methods}
        return {
            commit: ${commit},
            apply: ${network === 'Trem' ? 'update' : 'undefined'},
            latest: () => latestFrameStamp,
            switchTimeline() { requestGeneration++; pendingTimelineSwitch = true; },
        };
    `)(...Object.values(dependencies))
    const addStation = () => {
        const station = {
            level: 0, activity: 0, isActive: false, recentLevel: [], maxRecentLength: 60,
            update(...args) {
                if(failures.enabled) throw new Error('station update failed')
                updates.push({ args, previousTime: updateTime.value })
            },
        }
        if(network === 'Nied') {
            stationList.push([35, 135])
            stations.push(station)
        } else stations.station = station
    }
    const frame = (timestamp, generation = 0) => ({
        timestamp, generation, frameTime: frameTime(timestamp), intensity: 'a', siteConfigId: 'test-roster',
        pgaData: { station: 0 }, pgvData: { station: 0 },
        data: { station: { i: 0, alert: false } },
    })
    return { ...app, frame, addStation, stations, updateTime, updates, failures, document }
}

for(const network of ['Nied', 'Palert', 'Trem']) {
    test(`${network} leaves both timestamps unchanged without instances and accepts the same frame once ready`, () => {
        const app = setup(network)
        const queue = new StationFrameQueue(frame => app.commit(frame))
        const frame = app.frame(100000)
        queue.finish(queue.begin(frame.timestamp), frame)
        assert.equal(queue.lastStamp, null)
        assert.equal(app.latest(), null)
        assert.equal(app.updateTime.value, 'initial')
        assert.deepEqual(app.updates, [])
        app.addStation()
        queue.finish(queue.begin(frame.timestamp), frame)
        assert.equal(queue.lastStamp, frame.timestamp)
        assert.equal(app.latest(), frame.timestamp)
        assert.equal(app.updateTime.value, frameTime(frame.timestamp))
        assert.equal(app.updates[0].previousTime, 'initial')
        if(network === 'Nied') assert.equal(app.updates[0].args[1], frame.timestamp)
    })

    test(`${network} accepts newer equal readings while hidden and rejects duplicate and obsolete frames`, () => {
        const app = setup(network)
        app.addStation()
        app.document.visibilityState = 'hidden'
        assert.equal(app.commit(app.frame(100000)), true)
        assert.equal(app.commit(app.frame(101000)), true)
        assert.equal(app.updateTime.value, frameTime(101000))
        assert.equal(app.updates.length, 2)
        assert.equal(app.updates[1].args.at(-1), false)
        assert.equal(app.updates[1].previousTime, frameTime(100000))
        assert.equal(app.commit(app.frame(101000)), false)
        assert.equal(app.commit(app.frame(99000)), false)
        assert.equal(app.commit(app.frame(102000, -1)), false)
        assert.equal(app.updates.length, 2)
    })

    test(`${network} does not advance either timestamp on update failure and permits a corrected retry`, () => {
        const app = setup(network)
        app.addStation()
        const queue = new StationFrameQueue(frame => app.commit(frame))
        const frame = app.frame(100000)
        app.failures.enabled = true
        assert.throws(() => queue.finish(queue.begin(frame.timestamp), frame), /station update failed/)
        assert.equal(queue.lastStamp, null)
        assert.equal(app.latest(), null)
        assert.equal(app.updateTime.value, 'initial')
        app.failures.enabled = false
        queue.finish(queue.begin(frame.timestamp), frame)
        assert.equal(queue.lastStamp, frame.timestamp)
        assert.equal(app.updateTime.value, frameTime(frame.timestamp))
    })

    test(`${network} can apply an older replay timestamp after switching timeline`, () => {
        const app = setup(network)
        app.addStation()
        app.commit(app.frame(100000))
        app.switchTimeline()
        assert.equal(app.commit(app.frame(110000)), false)
        assert.equal(app.commit(app.frame(50000, 1)), true)
        assert.equal(app.latest(), 50000)
        assert.equal(app.updateTime.value, frameTime(50000))
    })
}

test('NIED count mismatch cannot consume a timestamp before a matching correction arrives', () => {
    const app = setup('Nied')
    app.addStation()
    const queue = new StationFrameQueue(frame => app.commit(frame), () => true)
    const frame = app.frame(100000)
    queue.finish(queue.begin(frame.timestamp), { ...frame, intensity: 'ab' })
    assert.equal(queue.lastStamp, null)
    assert.equal(app.updateTime.value, 'initial')
    queue.finish(queue.begin(frame.timestamp), frame)
    assert.equal(app.updateTime.value, frameTime(frame.timestamp))
    assert.equal(app.updates.length, 1)
})

test('TREM applies only the newest cached frame after instance creation and isolates old source generations', () => {
    const app = setup('Trem')
    app.commit(app.frame(100000))
    app.commit(app.frame(101000))
    app.commit(app.frame(99000))
    app.addStation()
    assert.equal(app.apply(), true)
    assert.equal(app.updateTime.value, frameTime(101000))
    assert.equal(app.updates.length, 1)
    app.switchTimeline()
    assert.equal(app.apply(), false)
    assert.equal(app.updates.length, 1)
    assert.equal(app.updateTime.value, frameTime(101000))
    app.commit(app.frame(50000, 1))
    assert.equal(app.updateTime.value, frameTime(50000))
})

test('ordered frame queues preserve earlier-first delivery after a rejected frame', () => {
    const accepted = []
    const queue = new StationFrameQueue(frame => {
        if(!frame.valid) return false
        accepted.push(frame.timestamp)
        return true
    }, () => true)
    queue.finish(queue.begin(100000), { timestamp: 100000, valid: false })
    const earlier = queue.begin(100000)
    const later = queue.begin(101000)
    queue.finish(later, { timestamp: 101000, valid: true })
    assert.deepEqual(accepted, [])
    queue.finish(earlier, { timestamp: 100000, valid: true })
    assert.deepEqual(accepted, [100000, 101000])
    assert.equal(queue.lastStamp, 101000)
})

test('a commit that resets the frame queue cannot restore its old timestamp', () => {
    const queue = new StationFrameQueue(() => {
        queue.reset()
        return true
    })
    queue.finish(queue.begin(100000), { timestamp: 100000 })
    assert.equal(queue.lastStamp, null)
})
