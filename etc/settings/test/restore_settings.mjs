// node --experimental-vm-modules etc/settings/test/restore_settings.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SourceTextModule, SyntheticModule } from 'node:vm'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import { effectScope, nextTick, watch } from 'vue'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const modules = new Map([
    ['pinia', new SyntheticModule(['defineStore'], function() { this.setExport('defineStore', defineStore) })],
    // Geographic calculations are unrelated to restoration; all store actions and defaults are real.
    [path.join(root, 'src/utils/Utils.js'), new SyntheticModule(['calcDistanceKm'], function() {
        this.setExport('calcDistanceKm', () => { throw new Error('Unexpected geographic calculation') })
    })],
])
const moduleFor = filename => {
    if(!modules.has(filename)) {
        modules.set(filename, new SourceTextModule(readFileSync(filename, 'utf8'), { identifier: filename }))
    }
    return modules.get(filename)
}
const settingsModule = moduleFor(path.join(root, 'src/stores/settings.js'))
await settingsModule.link((specifier, parent) => {
    if(modules.has(specifier)) return modules.get(specifier)
    let filename = specifier.startsWith('@/')
        ? path.join(root, 'src', specifier.slice(2)) : path.resolve(path.dirname(parent.identifier), specifier)
    if(!path.extname(filename)) filename += '.js'
    return moduleFor(filename)
})
await settingsModule.evaluate()
const { useSettingsStore } = settingsModule.namespace
const { useAccessStore } = moduleFor(path.join(root, 'src/stores/access.js')).namespace
const { restoreSettings } = moduleFor(path.join(root, 'src/utils/SettingsRestore.js')).namespace
// Use the production status state without starting transports or invoking geographic helpers.
const statusSource = readFileSync(path.join(root, 'src/stores/status.js'), 'utf8')
const stateStart = statusSource.indexOf('state: ()=>({') + 'state: '.length
const stateEnd = statusSource.indexOf('    getters:', stateStart)
assert(stateStart >= 'state: '.length && stateEnd > stateStart)
const statusState = new Function('isTauri', 'defaultEqMessage', 'defaultTsunamiMessage',
    `return (${statusSource.slice(stateStart, stateEnd).trim().replace(/,$/, '')});`)(() => false, {}, {})
const storageActionStart = statusSource.indexOf('        setLocalStorageItem(')
const storageActionEnd = statusSource.indexOf('        configureDataSources(', storageActionStart)
assert(storageActionStart >= 0 && storageActionEnd > storageActionStart)
const storageActions = new Function(`return ({${statusSource.slice(storageActionStart, storageActionEnd)}});`)()
const useReplayStatusStore = defineStore('replay-status-test', { state: statusState, actions: storageActions })
const storage = new Map()
const originalStorage = globalThis.localStorage
globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
}
const snapshot = value => JSON.parse(JSON.stringify(value))
setActivePinia(createPinia())
const settings = useSettingsStore()
const access = useAccessStore()
const status = useReplayStatusStore()
const defaultMain = snapshot(settings.mainSettings)
const defaultAdvanced = snapshot(settings.advancedSettings)
const defaultAccess = snapshot(access.capabilities)

try {
    assert.equal(status.seisNetReplayDelay, 0, 'New sessions start in realtime mode')
    const valid = {
        ...defaultMain,
        displayLegend: false,
        masterVolume: 0,
        actionWhiteList: '',
        apiKeys: { lipoApiKey: 'test-key' },
        displaySeisNet: { ...defaultMain.displaySeisNet, httpDataPriority: 'complete', palertHypoInfTextInfo: 2 },
        historySources: [],
        userLatLng: [31.2, 121.5],
        viewLatLng: [0, -123],
    }
    settings.setMainSettings(JSON.stringify(valid))
    assert.deepEqual(snapshot(settings.mainSettings), valid, 'Valid settings, falsy values and empty lists survive restoration')
    settings.setAdvancedSettings(JSON.stringify({ ...defaultAdvanced, mockOnReplay: true }))
    assert.equal(settings.advancedSettings.mockOnReplay, true)

    settings.setMainSettings(JSON.stringify({
        unknown: true,
        dataSources: { cwaEqlist: { lipo: true, extraApi: false, trem: false }, unknownSource: { lipo: true } },
        displaySeisNet: { unknown: true, palertNet: true },
        apiKeys: { lipoApiKey: 'test-key', extraKey: 'ignored' },
        onEew: { sound: true, unknown: true },
    }))
    assert.equal(Object.hasOwn(settings.mainSettings, 'unknown'), false)
    assert.deepEqual(snapshot(settings.mainSettings.dataSources.cwaEqlist), { lipo: true })
    assert.equal(Object.hasOwn(settings.mainSettings.dataSources, 'unknownSource'), false)
    assert.equal(Object.hasOwn(settings.mainSettings.displaySeisNet, 'unknown'), false)
    assert.equal(settings.mainSettings.displaySeisNet.palertNet, true)
    assert.deepEqual(snapshot(settings.mainSettings.apiKeys), { lipoApiKey: 'test-key' })
    assert.deepEqual(snapshot(settings.mainSettings.onEew), { notification: false, sound: true, focus: false })
    assert.equal(settings.isDataSourceFullyEnabled('cwaEqlist'), true)
    assert.equal(settings.isDataSourcePartiallyEnabled('cwaEqlist'), false)
    settings.setAdvancedSettings('{"unknown":true,"displayApiType":true}')
    assert.deepEqual(snapshot(settings.advancedSettings), { ...defaultAdvanced, displayApiType: true })

    settings.setMainSettings('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"dataSources":{"cwaEqlist":{"__proto__":{"extraApi":true}}}}')
    assert.deepEqual(snapshot(settings.mainSettings), defaultMain)
    assert.equal({}.polluted, undefined)
    assert.deepEqual(restoreSettings({ enabled: false }, Object.create({ enabled: true })), { enabled: false })
    settings.mainSettings.unknown = true
    settings.mainSettings.displaySeisNet.unknown = true
    settings.mainSettings.masterVolume = 7
    settings.setMainSettings('{}')
    assert.deepEqual(snapshot(settings.mainSettings), defaultMain, 'The whitelist and fallback use fresh defaults, not mutable state')
    settings.setMainSettings('{"displaySeisNet":{"delay":123}}')
    assert.deepEqual(snapshot(settings.mainSettings), defaultMain, 'Saved station replay time is discarded as runtime state')
    assert.equal(Object.hasOwn(settings.mainSettings.displaySeisNet, 'delay'), false)
    console.log('PASS valid settings, recursive field filtering, API checkbox consistency and independent defaults')

    for(const input of [undefined, null, '', '{', 'null', '[]', '42', 'false', '"text"']) {
        settings.setMainSettings(input)
        settings.setAdvancedSettings(input)
        access.setAccessSettings(input)
        assert.deepEqual(snapshot(settings.mainSettings), defaultMain)
        assert.deepEqual(snapshot(settings.advancedSettings), defaultAdvanced)
        assert.deepEqual(snapshot(access.capabilities), defaultAccess)
    }
    settings.setMainSettings('{"masterVolume":1e999,"displayLegend":"false","actionWhiteList":[],"dataSources":{"cwaEqlist":{"lipo":"false"}},"displaySeisNet":{"httpDataPriority":"invalid"}}')
    assert.deepEqual(snapshot(settings.mainSettings), defaultMain)
    settings.setAdvancedSettings('{"defaultFanServer":"1","displayApiType":1,"mockEew":{}}')
    assert.deepEqual(snapshot(settings.advancedSettings), defaultAdvanced)
    for(const value of [null, [], 'wrong', false, 1]) {
        settings.setMainSettings(JSON.stringify({ dataSources: value, displaySeisNet: value, apiKeys: value, onEew: value }))
        assert.deepEqual(snapshot(settings.mainSettings), defaultMain)
        settings.setMainSettings(JSON.stringify({ dataSources: { cwaEqlist: value } }))
        assert.deepEqual(snapshot(settings.mainSettings), defaultMain)
    }
    settings.setMainSettings('{"historySources":["USGS","unknown",null,{},1,"CWA"]}')
    assert.deepEqual(snapshot(settings.mainSettings.historySources), ['USGS', 'CWA'])
    settings.setMainSettings('{"historySources":[]}')
    assert.deepEqual(snapshot(settings.mainSettings.historySources), [])
    for(const value of [null, {}, 'CWA', false]) {
        settings.setMainSettings(JSON.stringify({ historySources: value }))
        assert.deepEqual(snapshot(settings.mainSettings.historySources), defaultMain.historySources)
    }
    for(const value of [[], [31], [31, 121, 0], ['31', 121], [31, null], null, { 0: 31, 1: 121 }]) {
        settings.setMainSettings(JSON.stringify({ userLatLng: value, viewLatLng: value }))
        assert.deepEqual(snapshot(settings.mainSettings.userLatLng), [0, 0])
        assert.deepEqual(snapshot(settings.mainSettings.viewLatLng), [0, 0])
    }
    settings.setMainSettings('{"userLatLng":[1e999,121]}')
    assert.deepEqual(snapshot(settings.mainSettings.userLatLng), [0, 0])
    console.log('PASS damaged JSON, invalid roots/nested values, strict types, finite numbers and array replacement')

    for(const storageKey of ['iclUrl', 'gqUrl', 'tremUrl', 'nmefcTsunami']) storage.set(storageKey, '{}')
    const currentAccess = { iclEew: true, tremFunctions: true, gqEew: true, nmefcTsunamiMap: true, advancedHypoInf: true }
    access.setAccessSettings(JSON.stringify(currentAccess))
    assert.deepEqual(snapshot(access.capabilities), currentAccess, 'All current capabilities remain restorable')
    access.setAccessSettings('{"iclEew":true,"gqEew":"false","tremFunctions":1,"nmefcTsunamiMap":[],"advancedHypoInf":true,"unknown":true}')
    assert.deepEqual(snapshot(access.capabilities), { ...defaultAccess, iclEew: true, advancedHypoInf: true })
    storage.delete('iclUrl')
    access.setAccessSettings('{"iclEew":true,"advancedHypoInf":true}')
    assert.equal(access.canUse('iclEew'), false, 'Local configuration is still required')
    assert.equal(access.canUse('advancedHypoInf'), true)
    access.setAccessSettings('{"advancedHypoInf":"true"}')
    settings.setMainSettings('{"dataSources":{"iclEew":{"lipo":true}},"displaySeisNet":{"tremNet":true,"niedHypoInfTextInfo":2,"palertHypoInfTextInfo":2}}')
    settings.resetUnauthorizedFeatureSettings()
    assert.equal(settings.mainSettings.dataSources.iclEew.lipo, false)
    assert.equal(settings.mainSettings.displaySeisNet.tremNet, false)
    assert.equal(settings.mainSettings.displaySeisNet.niedHypoInfTextInfo, 1)
    assert.equal(settings.mainSettings.displaySeisNet.palertHypoInfTextInfo, 1)

    // Obsolete fields are ignored, including inputs that used to override current settings.
    settings.setMainSettings('{"source":{"cwaEqlist":false,"jmaEew":true,"kmaEew":"true"}}')
    assert.deepEqual(snapshot(settings.mainSettings), defaultMain, 'Old source switches do not restore current API switches')
    settings.setMainSettings('{"source":{"cwaEqlist":true},"dataSources":{"cwaEqlist":{"fan":false,"trem":true},"iclEew":{"fan":true,"lipo":false}}}')
    assert.deepEqual(snapshot(settings.mainSettings.dataSources.cwaEqlist), { lipo: false })
    assert.deepEqual(snapshot(settings.mainSettings.dataSources.iclEew), { lipo: false })
    for(const source of [true, 1, 'wrong', [], null]) {
        settings.setMainSettings(JSON.stringify({ source }))
        assert.deepEqual(snapshot(settings.mainSettings), defaultMain)
    }
    storage.set('iclUrl', '{}')
    const obsoleteAdvanced = '{"enableIclEew":true,"enableTremFunctions":true,"enableGqEew":true,"enableNmefcTsunami":true,"advancedHypoInf":true,"provinceCeaEew":true,"tokens":{},"enableMultiApi":true,"multiApi":{},"unknown":true}'
    storage.set('advancedSettings', obsoleteAdvanced)
    storage.delete('accessSettings')
    access.setAccessSettings(localStorage.getItem('accessSettings'))
    settings.setAdvancedSettings(localStorage.getItem('advancedSettings'))
    assert.deepEqual(snapshot(access.capabilities), defaultAccess, 'Old advanced settings cannot grant capabilities')
    assert.deepEqual(snapshot(settings.advancedSettings), defaultAdvanced)
    assert.equal(Object.hasOwn(settings.mainSettings, 'provinceCeaEew'), false)
    access.setAccessSettings(JSON.stringify(currentAccess))
    for(const enabled of [false, true]) {
        settings.mainSettings.apiAuthAutoReconnect = enabled
        settings.setAdvancedSettings(JSON.stringify({ ...JSON.parse(obsoleteAdvanced), provinceCeaEew: !enabled, displayApiType: true }))
        assert.equal(settings.mainSettings.apiAuthAutoReconnect, enabled, 'Old advanced settings cannot overwrite current main settings')
        assert.equal(Object.hasOwn(settings.mainSettings, 'provinceCeaEew'), false)
        assert.deepEqual(snapshot(settings.advancedSettings), { ...defaultAdvanced, displayApiType: true })
        assert.deepEqual(snapshot(access.capabilities), currentAccess)
    }
    console.log('PASS strict capabilities, local requirements, authorization normalization and ignored obsolete fields')

    const scope = effectScope()
    try {
        const appSource = readFileSync(path.join(root, 'src/App.vue'), 'utf8')
        const start = appSource.indexOf('watch(() => settingsStore.mainSettings,')
        const end = appSource.indexOf('watch(() => settingsStore.mainSettings.gameMode,', start)
        assert(start >= 0 && end > start)
        scope.run(() => new Function('watch', 'settingsStore', 'accessStore', 'statusStore', appSource.slice(start, end))(watch, settings, access, status))
        storage.set('mainSettings', '{"source":{"cwaEqlist":false},"dataSources":{"cwaEqlist":{"trem":true},"iclEew":{"lipo":true}},"unknown":true}')
        storage.set('advancedSettings', obsoleteAdvanced)
        storage.set('accessSettings', '{"enableIclEew":true,"enableTremFunctions":true,"enableGqEew":true,"enableNmefcTsunami":true,"unknown":true}')
        storage.set('multiApi', '{"obsolete":true}')
        settings.setMainSettings(storage.get('mainSettings'))
        access.setAccessSettings(storage.get('accessSettings'))
        settings.setAdvancedSettings(storage.get('advancedSettings'))
        settings.resetUnauthorizedFeatureSettings()
        await nextTick()
        assert.deepEqual(JSON.parse(storage.get('mainSettings')), defaultMain)
        assert.deepEqual(JSON.parse(storage.get('advancedSettings')), defaultAdvanced)
        assert.deepEqual(JSON.parse(storage.get('accessSettings')), defaultAccess)
        const savedMain = storage.get('mainSettings')
        status.seisNetReplayDelay = 7.5
        await nextTick()
        assert.equal(storage.get('mainSettings'), savedMain, 'Changing replay time does not persist user settings')
        settings.setMainSettings('{"displaySeisNet":{"delay":123}}')
        await nextTick()
        assert.equal(status.seisNetReplayDelay, 7.5, 'Restoring settings does not change the active replay')
        assert.equal(Object.hasOwn(JSON.parse(storage.get('mainSettings')).displaySeisNet, 'delay'), false)
        assert.equal(useReplayStatusStore(createPinia()).seisNetReplayDelay, 0, 'A fresh session does not inherit replay time')
        settings.mainSettings.masterVolume = 25
        await nextTick()
        assert.equal(JSON.parse(storage.get('mainSettings')).masterVolume, 25)

        assert.equal(status.isResettingApp, false)
        settings.mainSettings.masterVolume = 50
        settings.advancedSettings.displayApiType = true
        access.capabilities.advancedHypoInf = true
        status.isResettingApp = true
        storage.clear()
        await nextTick()
        assert.equal(storage.size, 0, 'Queued persistence watchers cannot repopulate storage after reset')
        settings.mainSettings.masterVolume = 75
        settings.advancedSettings.displayApiType = false
        access.capabilities.advancedHypoInf = false
        await nextTick()
        assert.equal(storage.size, 0, 'Later settings updates remain unsaved until restart')
        assert.equal(useReplayStatusStore(createPinia()).isResettingApp, false, 'A fresh session resumes persistence')
    }
    finally {
        scope.stop()
    }
    console.log('PASS App watchers persist cleaned settings and edits, and block writes during reset')
}
finally {
    if(originalStorage === undefined) delete globalThis.localStorage
    else globalThis.localStorage = originalStorage
}
