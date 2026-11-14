import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createPinia, defineStore } from 'pinia'
import { computed, effectScope, nextTick, ref, watch } from 'vue'
import * as dataSources from '../src/utils/DataSources.js'
import * as settingsRestore from '../src/utils/SettingsRestore.js'
import * as uiScale from '../src/utils/UiScale.js'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const withoutImports = source => source.replace(/^import[^\n]*\n/gm, '')
const evaluate = (source, dependencies) => new Function(...Object.keys(dependencies), source)(...Object.values(dependencies))
const createStore = saved => {
    const source = withoutImports(read('src/stores/settings.js')).replace('export const useSettingsStore', 'const useSettingsStore')
    const store = evaluate(source + '\nreturn useSettingsStore(pinia)', {
        defineStore, pinia: createPinia(), ...dataSources, ...settingsRestore, ...uiScale,
    })
    store.setMainSettings(saved)
    return store
}
const setup = (t, original = 1, storage = new Map([['mainSettings', JSON.stringify({ uiScale: original })]])) => {
    const settings = createStore(storage.get('mainSettings'))
    const scope = effectScope()
    const mounted = [], unmounted = [], deactivated = []
    const timers = new Map(), listeners = new Map()
    let now = 100000, timerId = 0
    const eventTarget = target => ({
        addEventListener: (event, callback) => listeners.set(`${target}:${event}`, callback),
        removeEventListener: event => listeners.delete(`${target}:${event}`),
    })
    const source = withoutImports(read('src/components/components/UiScaleControl.vue').match(/<script setup>([\s\S]*?)<\/script>/)[1])
    const state = scope.run(() => evaluate(source + `
        return { selectedScale, customPercent, confirmVisible, remainingSeconds, customLabel,
            selectScale, tryCustomScale, cancelPreview, confirmPreview };
    `, {
        computed, ref, watch, ...uiScale, useSettingsStore: () => settings,
        onMounted: callback => mounted.push(callback),
        onBeforeUnmount: callback => unmounted.push(callback),
        onDeactivated: callback => deactivated.push(callback),
        window: eventTarget('window'), document: eventTarget('document'),
        Date: { now: () => now },
        setInterval: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId },
        clearInterval: id => timers.delete(id),
    }))
    // Exercise the actual persistence watcher, including saves triggered by other settings.
    const persistence = read('src/App.vue').match(/watch\(\(\) => settingsStore\.mainSettings,[\s\S]*?\}, \{ deep: true \}\)/)[0]
    scope.run(() => evaluate(persistence, {
        watch, settingsStore: settings,
        statusStore: { setLocalStorageItem: (key, value) => storage.set(key, value) },
    }))
    mounted.forEach(callback => callback())
    let stopped = false
    const stop = () => {
        if(stopped) return
        stopped = true
        unmounted.forEach(callback => callback())
        scope.stop()
    }
    t.after(stop)
    return {
        ...state, settings, storage, timers, listeners, stop,
        saved: () => JSON.parse(storage.get('mainSettings')),
        advance: (ms, runTimers = true) => {
            now += ms
            if(runTimers) [...timers.values()].forEach(timer => timer.callback())
        },
        dispatch: event => listeners.get(event)?.(),
        deactivate: () => deactivated.forEach(callback => callback()),
    }
}

test('every preset, including automatic mode, is previewed without saving until confirmed', async t => {
    for(const value of [-1, 0.5, 0.75, 1, 1.25, 1.5, 2]) {
        const state = setup(t, 1.13)
        state.selectScale(value)
        assert.equal(state.confirmVisible.value, true)
        assert.equal(state.settings.effectiveUiScale, value)
        assert.equal(state.settings.mainSettings.uiScale, 1.13)
        await nextTick()
        assert.equal(state.saved().uiScale, 1.13)
        state.confirmPreview()
        await nextTick()
        assert.equal(state.saved().uiScale, value)
        assert.equal(state.settings.uiScalePreview, null)
        assert.equal(state.confirmVisible.value, false)
        assert.equal(state.timers.size, 0)
    }
})

test('custom input stays a draft until trial and returns to the original selection on cancellation', async t => {
    const state = setup(t)
    state.selectScale('custom')
    state.customPercent.value = 113
    await nextTick()
    assert.equal(state.confirmVisible.value, false)
    assert.equal(state.settings.effectiveUiScale, 1)
    state.tryCustomScale()
    assert.equal(state.settings.effectiveUiScale, 1.13)
    assert.equal(state.customLabel.value, '113%（自定义）')
    state.cancelPreview()
    assert.equal(state.selectedScale.value, 1)
    assert.equal(state.settings.effectiveUiScale, 1)
    assert.equal(state.saved().uiScale, 1)

    state.selectScale('custom')
    state.customPercent.value = 113
    state.tryCustomScale()
    state.confirmPreview()
    await nextTick()
    assert.equal(state.saved().uiScale, 1.13)
    const reopened = setup(t, 1, state.storage)
    assert.equal(reopened.selectedScale.value, 'custom')
    assert.equal(reopened.customPercent.value, 113)
    assert.equal(reopened.customLabel.value, '113%（自定义）')
})

test('unconfirmed scale never reaches storage, even with unrelated saves and restart without cleanup', async t => {
    for(const original of [-1, 0.75, 1.13]) {
        const state = setup(t, original)
        state.selectScale(2)
        state.settings.mainSettings.masterVolume = 42
        await nextTick()
        assert.equal(state.saved().masterVolume, 42)
        assert.equal(state.saved().uiScale, original)
        assert.equal(Object.hasOwn(state.saved(), 'uiScalePreview'), false)
        // A fresh instance loads only disk state while the old instance is still mid-preview.
        const restarted = setup(t, 1, state.storage)
        assert.equal(restarted.settings.effectiveUiScale, original)
        assert.equal(restarted.settings.uiScalePreview, null)
        assert.equal(restarted.confirmVisible.value, false)
    }
})

test('timeout uses the deadline and restores automatic and custom settings exactly', t => {
    for(const original of [-1, 1.13]) {
        const state = setup(t, original)
        state.selectScale(1.5)
        state.advance(14300)
        assert.equal(state.remainingSeconds.value, 1)
        assert.equal(state.confirmVisible.value, true)
        state.advance(700)
        assert.equal(state.confirmVisible.value, false)
        assert.equal(state.settings.effectiveUiScale, original)
        assert.equal(state.selectedScale.value, original === -1 ? -1 : 'custom')
        assert.equal(state.timers.size, 0)
    }
})

test('returning from background or confirming after a suspended deadline restores instead of saving', async t => {
    for(const resume of ['window:focus', 'document:visibilitychange', 'confirm']) {
        const state = setup(t)
        state.selectScale(2)
        state.advance(20000, false)
        if(resume === 'confirm') state.confirmPreview()
        else state.dispatch(resume)
        await nextTick()
        assert.equal(state.confirmVisible.value, false)
        assert.equal(state.settings.effectiveUiScale, 1)
        assert.equal(state.saved().uiScale, 1)
        assert.equal(state.timers.size, 0)
    }
})

test('closing or leaving the control cancels preview and clears resources', t => {
    for(const action of ['cancelPreview', 'deactivate', 'stop']) {
        const state = setup(t, 0.75)
        state.selectScale(2)
        state[action]()
        assert.equal(state.settings.effectiveUiScale, 0.75)
        assert.equal(state.confirmVisible.value, false)
        assert.equal(state.timers.size, 0)
        if(action === 'stop') assert.equal(state.listeners.size, 0)
    }
})

test('same selection, incomplete custom values and duplicate trials do not start a new confirmation', t => {
    const state = setup(t)
    state.selectScale(1)
    assert.equal(state.confirmVisible.value, false)
    state.selectScale('custom')
    for(const value of [null, undefined, NaN, Infinity, 0, 49, 201, 113.5]) {
        state.customPercent.value = value
        state.tryCustomScale()
        assert.equal(state.confirmVisible.value, false)
        assert.equal(state.settings.effectiveUiScale, 1)
    }
    state.customPercent.value = 113
    state.tryCustomScale()
    state.selectScale(2)
    assert.equal(state.settings.effectiveUiScale, 1.13)
    assert.equal(state.timers.size, 1)
})

test('restoration accepts automatic, bounds and custom values, and rejects invalid scale data', () => {
    for(const value of [-1, 0.5, 1.13, 2]) {
        assert.equal(createStore(JSON.stringify({ uiScale: value })).mainSettings.uiScale, value)
    }
    for(const value of [null, '1.13', 0, -2, 0.49, 2.01]) {
        assert.equal(createStore(JSON.stringify({ uiScale: value })).mainSettings.uiScale, 1)
    }
})
