// node etc/utils/test/eew_cancel_lifecycle.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { computed, nextTick, reactive, ref, watch } from 'vue'

const read = name => readFileSync(new URL(`../../../${name}`, import.meta.url), 'utf8')
const section = (source, start, end) => {
    const from = source.indexOf(start), to = source.indexOf(end, from)
    assert(from >= 0 && to > from, `Missing section: ${start}`)
    return source.slice(from, to)
}
const eventSource = section(read('src/classes/EewEqlistClasses.js'),
    'export class EewEvent {', 'export class EqlistEvent').replace('export ', '')
const watcherSource = section(read('src/components/components/EqGrid.vue'),
    'watch(eqMessage, (newVal)=>{', 'const passedTimeFromOrigin')
const judgeSource = section(read('src/utils/Utils.js'),
    'export const judgeSameEvent', 'export const focusWindow').replace('export ', '')

// Run the production watcher and event lifecycle with virtual time and no map/audio side effects.
const createHarness = () => {
    let now = 0, timerId = 0, creations = 0
    const timers = new Map(), sounds = [], ignoredIds = {}, activeEewList = reactive([])
    const setTimeoutFake = (fn, delay) => {
        const id = ++timerId
        timers.set(id, { fn, due: now + Math.max(1, delay) })
        return id
    }
    const clearTimeoutFake = id => timers.delete(id)
    const settingsStore = {
        mainSettings: {
            userLatLng: [0, 0], countdownStart: 10, actionMag: 0, intenseLocalCsis: 6,
            onEew: { sound: true }, onEewWarn: {}
        },
        advancedSettings: { forceCalcInt: false }, actionWhiteListArr: [],
        isValidUserLatLng: false, nearestJmaLoc: null
    }
    const eventDependencies = {
        ignoredIds, markRaw: value => value, useSettingsStore: () => settingsStore,
        setTimeout: setTimeoutFake, clearTimeout: clearTimeoutFake,
        document: { getElementById: () => null }, playSound: sound => sounds.push(sound),
        getClassLevel: name => name == 'green' ? 1 : 0,
        iconUrls: {}, focusWindow() {}, sendMyNotification() {}
    }
    const EewEvent = new Function(...Object.keys(eventDependencies),
        `let settingsStore;\n${eventSource}\nreturn EewEvent;`)(...Object.values(eventDependencies))
    for(const method of ['renderStop', 'drawWaves', 'setMark']) EewEvent.prototype[method] = () => {}
    const update = EewEvent.prototype.update
    EewEvent.prototype.update = function(message, time, first = false) {
        if(first) creations++
        return update.call(this, message, time, first)
    }
    const statusStore = reactive({ eqMessage: { jmaEew: {} }, map: {} })
    const watcherDependencies = {
        watch, eqMessage: computed(() => statusStore.eqMessage.jmaEew), className: ref(''),
        calcPassedTime: time => now - Date.parse(time), ignoredIds, activeEewList,
        judgeSameEvent: new Function(`${judgeSource}\nreturn judgeSameEvent;`)(),
        statusStore, settingsStore, props: { source: 'jmaEew' }, reactive, EewEvent,
        handleTempEqlists() {}, smartSetView() {},
        setTimeout: setTimeoutFake, clearTimeout: clearTimeoutFake
    }
    const stop = new Function(...Object.keys(watcherDependencies),
        `let timer;\nreturn ${watcherSource}`)(...Object.values(watcherDependencies))
    return {
        activeEewList, sounds, stop,
        get creations() { return creations },
        async advance(target) {
            while(true) {
                const next = [...timers].filter(([, timer]) => timer.due <= target)
                    .sort((a, b) => a[1].due - b[1].due)[0]
                if(!next) break
                const [id, timer] = next
                now = timer.due
                timers.delete(id)
                timer.fn()
                await nextTick()
            }
            now = target
            await nextTick()
        },
        async deliver({ type = 0, reportNum = 3, isCanceled = false, reportStamp = 0, id = 'same-event' } = {}) {
            Object.assign(statusStore.eqMessage.jmaEew, {
                source: 'jmaEew', id, type, reportNum, isCanceled,
                reportTime: new Date(reportStamp).toISOString(), timeZone: 9,
                isEew: true, isWarn: false, isAssumption: false, isFinal: false,
                lat: 35, lng: 140, magnitude: 3, hypocenter: 'test', className: 'white'
            })
            await nextTick()
        }
    }
}

for(const cancelType of [0, 1]) {
    const h = createHarness()
    await h.deliver({ type: 1 - cancelType })
    await h.advance(1000)
    await h.deliver({ type: cancelType, isCanceled: true, reportStamp: 1000 })
    await h.deliver({ type: 1 - cancelType })
    assert.equal(h.activeEewList[0].eqMessage.isCanceled, true, 'Active cancellation outranks same-report normal data')
    await h.advance(21001)
    assert.equal(h.activeEewList.length, 0)
    for(const time of [30000, 40000, 50000]) {
        await h.advance(time)
        await h.deliver({ type: 1 - cancelType })
        await h.deliver({ type: cancelType, isCanceled: true, reportStamp: 1000 })
        await h.advance(time + 2)
    }
    assert.equal(h.creations, 1, 'Expired cancellation cannot be revived by either provider at the same report number')
    assert.deepEqual(h.sounds, ['issue', 'cancel'])
    await h.deliver({ type: 1 - cancelType, reportNum: 4, reportStamp: 50000 })
    assert.equal(h.creations, 2, 'A higher report number can reactivate the event')
    assert.equal(h.activeEewList[0].eqMessage.isCanceled, false)
    h.stop()
}
console.log('PASS same-report cancellation priority and no repeated activation for either cancellation provider')

{
    const h = createHarness()
    await h.deliver()
    await h.advance(180001)
    assert.equal(h.activeEewList.length, 0, 'Normal report has expired')
    await h.deliver({ type: 1, reportStamp: 180001 })
    assert.equal(h.creations, 1, 'Same-report normal data stays ignored even with a fresh timestamp')
    await h.deliver({ type: 1, isCanceled: true, reportStamp: 180001 })
    assert.equal(h.creations, 2, 'Same-report cancellation outranks the expired normal report')
    assert.equal(h.activeEewList[0].eqMessage.isCanceled, true)
    await h.advance(200002)
    await h.deliver({ type: 0, isCanceled: true, reportStamp: 200002 })
    assert.equal(h.creations, 2, 'Same-report cancellation cannot repeat after cancellation expiry')
    assert.deepEqual(h.sounds, ['issue', 'cancel'])
    h.stop()
}
console.log('PASS a cancellation can supersede an expired normal report once at the same report number')

{
    const h = createHarness()
    await h.deliver({ type: 1 })
    await h.deliver({ type: 0 })
    assert.equal(h.activeEewList[0].eqMessage.type, 0, 'Active same-status reports retain provider preference')
    assert.deepEqual(h.sounds, ['issue'], 'Provider supplementation does not repeat sound')
    await h.deliver({ type: 1, reportNum: 2, isCanceled: true })
    assert.equal(h.activeEewList[0].eqMessage.isCanceled, false, 'A lower report number does not override a newer report')
    await h.advance(180001)
    await h.deliver({ type: 0, reportNum: 2, isCanceled: true, reportStamp: 180001 })
    assert.equal(h.creations, 1, 'Lower report cancellation also stays ignored after expiry')
    await h.deliver({ id: 'another-event', reportNum: 1, reportStamp: 180001 })
    assert.equal(h.creations, 2, 'Different event IDs are independent')
    h.stop()
}
console.log('PASS report-number priority, active provider supplementation and independent event IDs')

for(const isCanceled of [false, true]) {
    const h = createHarness()
    await h.deliver({ isCanceled })
    h.activeEewList[0].terminate(true)
    for(const reportNum of [3, 4, Infinity]) {
        for(const incomingCanceled of [false, true]) {
            await h.deliver({ type: 1, reportNum, isCanceled: incomingCanceled })
        }
    }
    assert.equal(h.creations, 1, 'Manual close blocks all later reports, including Infinity cancellation reports')
    assert.equal(h.activeEewList.length, 0)
    h.stop()
}
console.log('PASS manual close continues to suppress all later reports of the event')
