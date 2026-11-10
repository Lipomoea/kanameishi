// node etc/settings/test/reset_application.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { nextTick, ref } from 'vue'
import { createAdvancedTest, fullConfig, successResponse } from './fixtures/advanced_functions.mjs'

const source = readFileSync(new URL('../../../src/components/SettingsComponent.vue', import.meta.url), 'utf8')
const extract = (startMarker, endMarker) => {
    const start = source.indexOf(startMarker)
    const end = source.indexOf(endMarker, start)
    assert(start >= 0 && end > start)
    return source.slice(start, end)
}
const resetSource = extract('const isResetConfirming =', 'const handleMockEew =')
const createReset = new Function('ref', 'statusStore', 'ElMessageBox', 'ElMessage', 'localStorage', 'window', 'console', 'isTauri',
    `${resetSource}; return handleResetApp`)
const deferred = () => {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}
const setup = ({ clearFails = false, isTauri = false } = {}) => {
    const storage = new Map([['mainSettings', '{}'], ['accessSettings', '{}'], ['obsoleteKey', 'old']])
    const status = { isResettingApp: false }
    const confirmation = deferred()
    const calls = []
    const errors = []
    const handleReset = createReset(ref, status, {
        confirm: (_message, _title, options) => {
            calls.push('confirm')
            assert.equal(options.cancelButtonText, '取消')
            return confirmation.promise
        },
    }, error => errors.push(error), {
        clear: () => {
            calls.push('clear')
            assert.equal(status.isResettingApp, true, 'Persistence is blocked before storage is cleared')
            if(clearFails) throw new Error('Storage unavailable')
            storage.clear()
        },
    }, { location: { reload: () => {
        calls.push('reload')
        assert.equal(storage.size, 0, 'Page reload follows clearing all keys')
    } } }, { error: () => {} }, isTauri)
    return { storage, status, confirmation, calls, errors, handleReset }
}

for(const action of ['cancel', 'close']) {
    const test = setup()
    const pending = test.handleReset()
    await test.handleReset()
    assert.deepEqual(test.calls, ['confirm'], 'Repeated clicks do not open more confirmations')
    assert.equal(test.storage.size, 3, 'Opening the dialog does not clear storage')
    test.confirmation.reject(action)
    await pending
    assert.deepEqual(test.calls, ['confirm'])
    assert.equal(test.storage.size, 3)
    assert.equal(test.status.isResettingApp, false)
    await test.handleReset()
    assert.deepEqual(test.calls, ['confirm', 'confirm'], 'Cancellation re-enables the button')
}
console.log('PASS cancellation, dialog dismissal and repeated clicks leave storage untouched')

for(const isTauri of [false, true]) {
    const test = setup({ isTauri })
    const pending = test.handleReset()
    test.confirmation.resolve()
    await Promise.resolve()
    assert.equal(test.storage.size, 0)
    assert.equal(test.status.isResettingApp, true)
    await test.handleReset()
    await pending
    assert.deepEqual(test.calls, ['confirm', 'clear', 'reload'])
}
console.log('PASS confirmation clears every key before page reload')

{
    const test = setup({ clearFails: true })
    const pending = test.handleReset()
    test.confirmation.resolve()
    await pending
    assert.equal(test.storage.size, 3)
    assert.equal(test.status.isResettingApp, false)
    assert.equal(test.errors[0].type, 'error')
    assert.deepEqual(test.calls, ['confirm', 'clear'], 'Failed clear must not reload')
}
console.log('PASS storage failure aborts reset and reports the error')

for(const outcome of ['success', 'failure']) {
    const response = deferred()
    const test = createAdvancedTest({ post: () => response.promise })
    const pending = test.submitAdvancedFunctions()
    test.statusStore.isResettingApp = true
    test.localStorage.clear()
    if(outcome === 'success') response.resolve(successResponse(fullConfig))
    else response.reject(new Error('Network error'))
    await pending
    await nextTick()
    assert.equal(test.stored.size, 0, 'Late authorization responses cannot restore cleared local data')
    assert(Object.values(test.accessStore.capabilities).every(value => value === false))
    assert.equal(test.pendingAdvancedConfig.value, null)
    assert.equal(test.tremUpdates, 0)
    assert.equal(test.reloads, 0)
    assert.deepEqual(test.messages, [])
    test.dispose()
}
console.log('PASS in-flight authorization responses cannot restore local data after reset')
