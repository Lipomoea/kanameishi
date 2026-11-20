import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createPinia, defineStore } from 'pinia'
import { computed, effectScope, nextTick, ref, watch } from 'vue'
import * as dataSources from '../src/utils/DataSources.js'
import * as settingsRestore from '../src/utils/SettingsRestore.js'
import * as uiScale from '../src/utils/UiScale.js'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const evaluate = (source, dependencies) => new Function(...Object.keys(dependencies), source)(...Object.values(dependencies))
const storeSource = read('src/stores/settings.js').replace(/^import[^\n]*\n/gm, '')
    .replace('export const useSettingsStore', 'const useSettingsStore')
const createStore = saved => {
    const settings = evaluate(storeSource + '\nreturn useSettingsStore(pinia)', {
        defineStore, pinia: createPinia(), ...dataSources, ...settingsRestore, ...uiScale,
    })
    settings.setMainSettings(saved)
    return settings
}
const sources = ['CENC', 'CWA', 'JMA', 'KMA', 'USGS']
const thresholds = value => Object.fromEntries(sources.map(source => [source, value]))
const snapshot = value => JSON.parse(JSON.stringify(value))
const createList = (settings, events) => {
    // Run the actual list filter after sorting; replay/map dependencies are unrelated to filtering.
    const source = read('src/components/components/EqlistHistory.vue')
    const start = source.indexOf('const eqlists = computed(')
    const end = source.indexOf('onBeforeUnmount(', start)
    assert(start >= 0 && end > start)
    return evaluate(source.slice(start, end) + '\nreturn eqlists', {
        computed, sorted: ref(events), settingsStore: settings, maxHistoryNumber: 100,
    })
}

test('new settings and reset defaults enable unified mode with every threshold at zero', () => {
    const settings = createStore()
    const assertDefaults = () => {
        assert.equal(settings.mainSettings.historyMagUnified, true)
        assert.equal(settings.mainSettings.historyMagThres, 0)
        assert.deepEqual(snapshot(settings.mainSettings.historyMagThresBySource), thresholds(0))
    }
    assertDefaults()
    settings.setHistoryMagThres(4.5)
    assert.deepEqual(snapshot(createStore().mainSettings.historyMagThresBySource), thresholds(0))
    settings.setHistoryMagUnified(false)
    settings.setHistorySourceMagThres('CENC', 3)
    settings.$reset()
    assertDefaults()
    settings.setHistoryMagThres(5)
    settings.setMainSettings(null)
    assertDefaults()
})

test('old saved thresholds migrate to unified mode without changing the selected sources', () => {
    for(const threshold of [0, 2, 4.5, 8]) {
        const settings = createStore(JSON.stringify({ historyMagThres: threshold, historySources: ['CENC', 'USGS'] }))
        assert.equal(settings.mainSettings.historyMagUnified, true)
        assert.equal(settings.mainSettings.historyMagThres, threshold)
        assert.deepEqual(snapshot(settings.mainSettings.historyMagThresBySource), thresholds(threshold))
        assert.deepEqual(snapshot(settings.mainSettings.historySources), ['CENC', 'USGS'])
    }
})

test('unified changes synchronize all sources including unselected and disabled sources', () => {
    const settings = createStore(JSON.stringify({ historySources: ['CENC'] }))
    settings.setHistoryMagThres(4.2)
    assert.deepEqual(snapshot(settings.mainSettings.historyMagThresBySource), thresholds(4.2))
    for(const source of sources) assert.equal(settings.historyMagnitudeThreshold(source), 4.2)
    settings.setHistorySourceMagThres('CENC', 1)
    assert.equal(settings.mainSettings.historyMagThresBySource.CENC, 4.2)
    settings.setHistoryMagThres(0)
    assert.deepEqual(snapshot(settings.mainSettings.historyMagThresBySource), thresholds(0))
})

test('independent changes preserve the unified value and re-enabling unified mode overwrites them', () => {
    const settings = createStore()
    settings.setHistoryMagThres(4)
    settings.setHistoryMagUnified(false)
    assert.deepEqual(snapshot(settings.mainSettings.historyMagThresBySource), thresholds(4))
    settings.setHistorySourceMagThres('CENC', 3)
    settings.setHistorySourceMagThres('USGS', 5)
    settings.setHistorySourceMagThres('JMA', 0)
    settings.setHistorySourceMagThres('unknown', 6)
    assert.equal(settings.mainSettings.historyMagThres, 4)
    assert.equal(settings.historyMagnitudeThreshold('CENC'), 3)
    assert.equal(settings.historyMagnitudeThreshold('USGS'), 5)
    assert.equal(settings.historyMagnitudeThreshold('JMA'), 0)
    assert.equal(Object.hasOwn(settings.mainSettings.historyMagThresBySource, 'unknown'), false)
    settings.setHistoryMagUnified(true)
    assert.deepEqual(snapshot(settings.mainSettings.historyMagThresBySource), thresholds(4))
    settings.setHistoryMagUnified(false)
    assert.deepEqual(snapshot(settings.mainSettings.historyMagThresBySource), thresholds(4))
})

test('saved modes restore their own values, fill missing sources and discard unknown keys', () => {
    const saved = {
        historyMagUnified: false, historyMagThres: 4,
        historyMagThresBySource: { CENC: 0, CWA: 2.5, USGS: 5, unknown: 6 },
    }
    const settings = createStore(JSON.stringify(saved))
    assert.equal(settings.mainSettings.historyMagUnified, false)
    assert.equal(settings.mainSettings.historyMagThres, 4)
    assert.deepEqual(snapshot(settings.mainSettings.historyMagThresBySource), {
        CENC: 0, CWA: 2.5, JMA: 0, KMA: 0, USGS: 5,
    })
    settings.setMainSettings(JSON.stringify({ ...saved, historyMagUnified: true }))
    assert.deepEqual(snapshot(settings.mainSettings.historyMagThresBySource), thresholds(4))
})

test('restoration normalizes range and precision while rejecting invalid types and non-finite numbers', () => {
    const settings = createStore(JSON.stringify({
        historyMagUnified: false, historyMagThres: 12,
        historyMagThresBySource: { CENC: -2, CWA: 15, JMA: 4.26, KMA: '5', USGS: null },
    }))
    assert.equal(settings.mainSettings.historyMagThres, 9)
    assert.deepEqual(snapshot(settings.mainSettings.historyMagThresBySource), {
        CENC: 0, CWA: 9, JMA: 4.3, KMA: 0, USGS: 0,
    })
    settings.setMainSettings('{"historyMagUnified":false,"historyMagThres":1e999,"historyMagThresBySource":{"CENC":1e999}}')
    assert.equal(settings.mainSettings.historyMagThres, 0)
    assert.deepEqual(snapshot(settings.mainSettings.historyMagThresBySource), thresholds(0))
    for(const value of [null, [], 'wrong', false, 1]) {
        settings.setMainSettings(JSON.stringify({ historyMagUnified: false, historyMagThresBySource: value }))
        assert.deepEqual(snapshot(settings.mainSettings.historyMagThresBySource), thresholds(0))
    }
})

test('the App persistence watcher saves mode and thresholds for the next session', async t => {
    const settings = createStore()
    const storage = new Map()
    const scope = effectScope()
    t.after(() => scope.stop())
    const persistence = read('src/App.vue').match(/watch\(\(\) => settingsStore\.mainSettings,[\s\S]*?\}, \{ deep: true \}\)/)[0]
    scope.run(() => evaluate(persistence, {
        watch, settingsStore: settings,
        statusStore: { setLocalStorageItem: (key, value) => storage.set(key, value) },
    }))
    settings.setHistoryMagThres(4)
    settings.setHistoryMagUnified(false)
    settings.setHistorySourceMagThres('CENC', 0)
    settings.setHistorySourceMagThres('USGS', 5)
    await nextTick()
    const restored = createStore(storage.get('mainSettings'))
    assert.deepEqual(snapshot(restored.mainSettings), snapshot(settings.mainSettings))
    settings.setHistoryMagUnified(true)
    await nextTick()
    const unified = createStore(storage.get('mainSettings'))
    assert.equal(unified.mainSettings.historyMagUnified, true)
    assert.deepEqual(snapshot(unified.mainSettings.historyMagThresBySource), thresholds(4))
})

test('zero keeps unknown and negative magnitudes; positive thresholds include the exact boundary', () => {
    const settings = createStore()
    const magnitudes = [undefined, null, NaN, -1, 0, 3.9, 4, 4.1]
    const events = magnitudes.map((magnitude, id) => ({ source: 'CENC', magnitude, id }))
    const list = createList(settings, events)
    assert.deepEqual(list.value.map(event => event.id), events.map(event => event.id))
    settings.setHistoryMagThres(4)
    assert.deepEqual(list.value.map(event => event.magnitude), [4, 4.1])
    settings.setHistoryMagUnified(false)
    settings.setHistorySourceMagThres('CENC', 0)
    assert.equal(list.value.length, events.length)
    assert.equal(settings.mainSettings.historyMagThres, 4)
})

test('each source uses its own threshold and source selection still controls visibility', () => {
    const settings = createStore()
    settings.setHistoryMagThres(4)
    settings.setHistoryMagUnified(false)
    settings.setHistorySourceMagThres('CENC', 3)
    settings.setHistorySourceMagThres('USGS', 5)
    const events = [
        { id: 1, source: 'CENC', magnitude: 3 },
        { id: 2, source: 'USGS', magnitude: 4.9 },
        { id: 3, source: 'USGS', magnitude: 5 },
        { id: 4, source: 'JMA', magnitude: 4 },
        { id: 5, source: 'CENC', magnitude: 2.9 },
    ]
    const list = createList(settings, events)
    assert.deepEqual(list.value.map(event => event.id), [1, 3, 4])
    settings.mainSettings.historySources = ['USGS']
    assert.deepEqual(list.value.map(event => event.id), [3])
    settings.mainSettings.historySources = []
    assert.equal(list.value.length, 0)
})

test('the 100 event limit is applied after filtering without changing the supplied order', () => {
    const settings = createStore()
    settings.setHistoryMagThres(5)
    const events = Array.from({ length: 260 }, (_, id) => ({ id, source: 'CENC', magnitude: id < 150 ? 4 : 5 }))
    const list = createList(settings, events)
    assert.equal(list.value.length, 100)
    assert.deepEqual(list.value.map(event => event.id), events.slice(150, 250).map(event => event.id))
})
