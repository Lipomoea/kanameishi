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
const createHarness = (source = 'jmaEew') => {
    let now = 0, timerId = 0, creations = 0, focuses = 0
    const timers = new Map(), sounds = [], notifications = [], ignoredIds = {}, activeEewList = reactive([])
    const setTimeoutFake = (fn, delay) => {
        const id = ++timerId
        timers.set(id, { fn, due: now + Math.max(1, delay) })
        return id
    }
    const clearTimeoutFake = id => timers.delete(id)
    const settingsStore = {
        mainSettings: {
            userLatLng: [0, 0], countdownStart: 10, actionMag: 0, intenseLocalCsis: 6,
            onEew: { sound: true, notification: true, focus: true }, onEewWarn: {}, gqActionMag: 0
        },
        advancedSettings: { forceCalcInt: false }, actionWhiteListArr: [],
        isValidUserLatLng: false, nearestJmaLoc: null
    }
    const eventDependencies = {
        ignoredIds, markRaw: value => value, useSettingsStore: () => settingsStore,
        setTimeout: setTimeoutFake, clearTimeout: clearTimeoutFake,
        document: { getElementById: () => null }, playSound: sound => sounds.push(sound),
        getClassLevel: name => name == 'green' ? 1 : 0,
        iconUrls: { info: 'info', caution: 'caution', warn: 'warn' },
        focusWindow() { focuses++ }, sendMyNotification(...args) { notifications.push(args) }
    }
    const EewEvent = new Function(...Object.keys(eventDependencies),
        `let settingsStore;\n${eventSource}\nreturn EewEvent;`)(...Object.values(eventDependencies))
    for(const method of ['renderStop', 'drawWaves', 'setMark']) EewEvent.prototype[method] = () => {}
    const update = EewEvent.prototype.update
    EewEvent.prototype.update = function(message, time, first = false) {
        if(first) creations++
        return update.call(this, message, time, first)
    }
    const statusStore = reactive({ eqMessage: { [source]: {} }, map: {} })
    const watcherDependencies = {
        watch, eqMessage: computed(() => statusStore.eqMessage[source]), className: ref(''),
        calcPassedTime: time => now - Date.parse(time), ignoredIds, activeEewList,
        judgeSameEvent: new Function(`${judgeSource}\nreturn judgeSameEvent;`)(),
        statusStore, settingsStore, props: { source }, reactive, EewEvent,
        handleTempEqlists() {}, smartSetView() {},
        setTimeout: setTimeoutFake, clearTimeout: clearTimeoutFake
    }
    const stop = new Function(...Object.keys(watcherDependencies),
        `let timer;\nreturn ${watcherSource}`)(...Object.values(watcherDependencies))
    return {
        activeEewList, sounds, notifications, stop,
        get creations() { return creations },
        get focuses() { return focuses },
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
        async deliver({ type = 0, quality = null, reportNum = 3, isCanceled = false, reportStamp = 0, id = 'same-event', ...fields } = {}) {
            Object.assign(statusStore.eqMessage[source], {
                source, id, type, quality, reportNum, isCanceled,
                reportTime: new Date(reportStamp).toISOString(), timeZone: 9,
                isEew: true, isWarn: false, isAssumption: false, isFinal: false,
                assumptionText: '', warnArea: '[]',
                lat: 35, lng: 140, magnitude: 3, hypocenter: 'test', className: 'white',
                ...fields,
            })
            await nextTick()
        }
    }
}

for(const normalType of [0, 1, 2]) for(const cancelType of [0, 1, 2]) {
    const h = createHarness()
    await h.deliver({ type: normalType })
    await h.advance(1000)
    await h.deliver({ type: cancelType, isCanceled: true, reportStamp: 1000 })
    assert.equal(h.activeEewList[0].eqMessage.type, cancelType, 'Accepted cancellation records its provider priority')
    await h.deliver({ type: normalType })
    assert.equal(h.activeEewList[0].eqMessage.isCanceled, true, 'Active cancellation outranks same-report normal data')
    await h.advance(21001)
    assert.equal(h.activeEewList.length, 0)
    for(const time of [30000, 40000, 50000]) {
        await h.advance(time)
        await h.deliver({ type: normalType })
        await h.deliver({ type: cancelType, isCanceled: true, reportStamp: 1000 })
        await h.advance(time + 2)
    }
    assert.equal(h.creations, 1, 'Expired cancellation cannot be revived by either provider at the same report number')
    assert.deepEqual(h.sounds, ['issue', 'cancel'])
    await h.deliver({ type: normalType, reportNum: 4, reportStamp: 50000 })
    assert.equal(h.creations, 2, 'A higher report number can reactivate the event')
    assert.equal(h.activeEewList[0].eqMessage.isCanceled, false)
    h.stop()
}
console.log('PASS same-report cancellation priority and no repeated activation across all three JMA provider priorities')

{
    const h = createHarness()
    await h.deliver({ type: 2, isAssumption: true, assumptionText: '大きな加速度を検知' })
    const active = h.activeEewList[0]
    const warnArea = JSON.stringify([{ name: 'test area', intensity: '5弱', className: 'orange' }])
    await h.deliver({ type: 1, isAssumption: true, assumptionText: '仮定震源要素', warnArea })
    assert.equal(active.eqMessage.type, 1)
    assert.equal(active.eqMessage.assumptionText, '仮定震源要素')
    assert.equal(active.eqMessage.warnArea, warnArea)
    await h.deliver({ type: 2 })
    assert.equal(active.eqMessage.type, 1, 'Lipo source 0 cannot replace source 1 at the same report')
    assert.equal(active.eqMessage.warnArea, warnArea)
    await h.deliver({ type: 0, warnArea })
    assert.equal(active.eqMessage.type, 0)
    assert.equal(active.eqMessage.isAssumption, false)
    assert.equal(active.eqMessage.assumptionText, '')
    for(const type of [1, 2]) await h.deliver({ type, isAssumption: true, assumptionText: '大きな加速度を検知' })
    assert.equal(active.eqMessage.type, 0, 'Neither Lipo upstream can replace Wolfx at the same report')
    assert.equal(active.eqMessage.assumptionText, '')
    assert.equal(active.eqMessage.warnArea, warnArea)
    assert.deepEqual(h.sounds, ['issue'])
    assert.equal(h.notifications.length, 1)
    assert.equal(h.focuses, 1)
    assert.equal(h.creations, 1)
    await h.deliver({ type: 2, reportNum: 4 })
    assert.equal(active.eqMessage.type, 2, 'A higher report from Lipo source 0 replaces Wolfx')
    assert.equal(active.eqMessage.warnArea, '[]', 'A new report cannot retain old regional forecasts')
    assert.deepEqual(h.sounds, ['issue', 'update'])
    assert.equal(h.notifications.length, 2)
    h.stop()
}
console.log('PASS Lipo upstream and Wolfx supplementation refreshes fields silently; newer reports replace forecasts')

{
    const h = createHarness()
    await h.deliver({ type: 0 })
    await h.advance(1000)
    await h.deliver({ type: 2, isCanceled: true, reportStamp: 1000 })
    const active = h.activeEewList[0]
    assert.equal(active.eqMessage.type, 2, 'Cancellation wins even from a lower-priority provider')
    for(const type of [1, 0]) {
        await h.deliver({ type, isCanceled: true, reportStamp: 1000 })
        assert.equal(active.eqMessage.type, type, 'Cancelled events also accept source upgrades')
    }
    const reportTime = active.eqMessage.reportTime
    await h.deliver({ type: 0, isCanceled: true, reportStamp: 2000 })
    assert.equal(active.eqMessage.reportTime, reportTime, 'A repeated cancellation is not another source upgrade')
    assert.deepEqual(h.sounds, ['issue', 'cancel'])
    assert.equal(h.notifications.length, 2)
    assert.equal(h.focuses, 1)
    await h.advance(21001)
    assert.equal(h.activeEewList.length, 0)
    h.stop()
}
console.log('PASS cancellation synchronizes provider priority and later source upgrades remain silent')

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

{
    const h = createHarness('gqEew')
    await h.deliver({ quality: 3 })
    const active = h.activeEewList[0]
    // GQ has no same-report supplementation, even if quality or the configured type changes.
    await h.deliver({ quality: 0, type: -1 })
    assert.equal(active.eqMessage.quality, 3)
    assert.equal(active.eqMessage.type, 0)
    assert.equal(h.sounds.length, 1)
    await h.deliver({ quality: 5, reportNum: 4 })
    assert.equal(active.eqMessage.quality, 5, 'Newer reports update even with worse quality')
    assert.equal(h.sounds.length, 2)
    await h.deliver({ quality: 0, reportNum: 3, isCanceled: true })
    assert.equal(active.eqMessage.isCanceled, false, 'Quality cannot override report-number ordering')
    await h.deliver({ quality: 5, reportNum: 4, isCanceled: true })
    assert.equal(active.eqMessage.isCanceled, true)
    assert.equal(active.eqMessage.quality, 5)
    assert.equal(h.sounds.at(-1), 'cancel')
    await h.advance(21001)
    await h.deliver({ quality: 0, reportNum: 4, reportStamp: 21001 })
    assert.equal(h.creations, 1, 'Same-report quality cannot revive a cancelled GQ event')
    h.stop()
}
console.log('PASS GQ updates by report number and cancellation state only; quality is display metadata')

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
