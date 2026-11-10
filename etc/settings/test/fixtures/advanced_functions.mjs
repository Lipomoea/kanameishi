import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createPinia, defineStore } from 'pinia'
import { effectScope, ref, watch } from 'vue'
import { parseSettings, restoreSettings } from '../../../../src/utils/SettingsRestore.js'
import { setTremConfig, tremConfig } from '../../../../src/features/stations/TremConfig.js'

const readSource = name => readFileSync(new URL(`../../../../src/${name}`, import.meta.url), 'utf8')
const extract = (source, startMarker, endMarker) => {
    const start = source.indexOf(startMarker)
    const end = source.indexOf(endMarker, start)
    assert(start >= 0 && end > start)
    return source.slice(start, end)
}
const componentSource = readSource('components/SettingsComponent.vue')
const advancedSource = extract(componentSource, "const advancedInput = ref('')", 'const handleNeedReload =')
const disposeSource = extract(componentSource, 'onBeforeUnmount(() => {', '\n</script>')
const accessSource = readSource('stores/access.js').replace(/^import .*\r?\n/gm, '').replace('export const ', 'const ')
const storageSource = extract(readSource('stores/status.js'), '        setLocalStorageItem(', '        configureDataSources(')
const persistenceSource = extract(readSource('App.vue'), 'watch(() => accessStore.capabilities,', 'watch(() => settingsStore.mainSettings.gameMode,')

export const fullConfig = {
    enableIclEew: {},
    enableTremFunctions: {
        seisNetUrls: {
            trem: {
                stationList: 'https://stations.example.invalid/list',
                stationReplay: 'https://stations.example.invalid/replay',
                stationSources: [
                    { id: 'second', name: '第二个源', url: 'https://second.example.invalid/sse?mode=live' },
                    { id: 'first', name: '第一个源', url: 'https://first.example.invalid/sse?mode=live' },
                ],
            },
        },
    },
    enableGqEew: { gqEew_ws: ['wss://second.example.invalid/gq', 'wss://first.example.invalid/gq'] },
    enableNmefcTsunami: { cn_tsunami: 'https://maps.example.invalid/cn.tsunami.topo.json' },
}
export const successResponse = data => ({ status: 200, data: { success: true, data: structuredClone(data) } })
export const deferred = () => {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

// Exercise the component handlers, real access store, storage action and App watcher together.
// Only transport, browser storage and UI notifications are replaced.
export const createAdvancedTest = ({ post = () => successResponse(fullConfig), initialStorage = {} } = {}) => {
    const stored = new Map(Object.entries(initialStorage))
    const events = []
    const messages = []
    const requests = []
    const logs = []
    const test = { stored, events, messages, requests, logs, failWrite: null, refuseGrant: null, reloads: 0, tremUpdates: 0 }
    const localStorage = {
        getItem: key => stored.get(key) ?? null,
        setItem: (key, value) => {
            if(test.failWrite?.(key, value)) throw new Error('Storage unavailable')
            stored.set(key, String(value))
            events.push(`write:${key}`)
        },
        removeItem: key => stored.delete(key),
        clear: () => stored.clear(),
    }
    const useAccessStore = new Function('defineStore', 'parseSettings', 'restoreSettings', 'localStorage',
        `${accessSource}; return useAccessStore`)(defineStore, parseSettings, restoreSettings, localStorage)
    const accessStore = useAccessStore(createPinia())
    accessStore.setAccessSettings(localStorage.getItem('accessSettings'))
    const grant = accessStore.grant
    accessStore.grant = capability => {
        events.push(`grant:${capability}`)
        return test.refuseGrant === capability ? false : grant(capability)
    }
    const statusStore = {
        isResettingApp: false,
        ...new Function('localStorage', `return ({${storageSource}})`)(localStorage),
    }
    const settingsStore = {
        mainSettings: {
            apiKeys: { lipoApiKey: 'separate-data-service-key' },
            displaySeisNet: { tremNet: false, niedHypoInfTextInfo: 1, palertHypoInfTextInfo: 1 },
        },
        isDataSourceEnabled: () => false,
        setDataSourceEnabled: () => assert.fail('Authorization must not change data-source selections'),
    }
    const scope = effectScope()
    scope.run(() => new Function('watch', 'accessStore', 'statusStore', persistenceSource)(watch, accessStore, statusStore))
    setTremConfig(null)
    let dispose
    const handlers = new Function('ref', 'axios', 'accessStore', 'statusStore', 'settingsStore',
        'localStorage', 'setTremConfig', 'handleNeedReload', 'ElMessage', 'onBeforeUnmount', 'autoCheckInterval', 'console',
        `${advancedSource}\n${disposeSource}\nreturn { advancedInput, advancedKey, isVerifying, pendingAdvancedConfig, verifyDialog,
            handleAdvance, submitAdvancedFunctions, validateAdvancedFunctions }`)(
        ref,
        { post: async (...args) => { requests.push(args); return post(...args) } },
        accessStore, statusStore, settingsStore, localStorage,
        config => { test.tremUpdates++; events.push('trem'); setTremConfig(config) },
        () => { test.reloads++; events.push('reload') },
        message => { messages.push(message); events.push(`message:${message.type}`) },
        callback => { dispose = callback }, undefined,
        Object.fromEntries(['log', 'warn', 'error'].map(name => [name, (...args) => logs.push(args)])),
    )
    handlers.handleAdvance('enableAdvancedFunctions')
    handlers.advancedKey.value = 'custom-Test_Key'
    return Object.assign(test, handlers, {
        accessStore, statusStore, settingsStore, localStorage, tremConfig,
        restartAccess: () => {
            const restarted = useAccessStore(createPinia())
            restarted.setAccessSettings(localStorage.getItem('accessSettings'))
            return restarted
        },
        dispose: () => { dispose(); scope.stop() },
    })
}
