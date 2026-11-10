// node etc/settings/test/advanced_functions.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextTick } from 'vue'
import { createAdvancedTest, deferred, fullConfig, successResponse } from './fixtures/advanced_functions.mjs'

const snapshot = value => JSON.parse(JSON.stringify(value))
const setup = (t, options) => {
    const app = createAdvancedTest(options)
    t.after(() => app.dispose())
    return app
}
const assertNoAuthorization = app => {
    assert.equal(app.stored.size, 0)
    assert(Object.values(app.accessStore.capabilities).every(value => value === false))
    assert.equal(app.pendingAdvancedConfig.value, null)
    assert.equal(app.tremUpdates, 0)
    assert.equal(app.reloads, 0)
    assert(!app.messages.some(message => message.type === 'success'))
}

test('one request saves all four configurations, restores permissions and preserves settings', async t => {
    const app = setup(t)
    const settingsBefore = snapshot(app.settingsStore.mainSettings)
    app.advancedKey.value = '  custom-Test_Key  '
    await app.submitAdvancedFunctions()
    await nextTick()
    assert.equal(app.requests.length, 1)
    const [url, body, options] = app.requests[0]
    assert.equal(url, 'https://api.lipomoea.cn/kanameishi-advanced')
    assert.deepEqual(body, { key: 'custom-Test_Key' })
    assert.equal(options.timeout, 30000)
    assert.equal(options.withCredentials, false)
    assert.equal(options.headers['Content-Type'], 'application/json')
    assert.equal(options.validateStatus(409), true)
    assert.equal(app.stored.get('iclUrl'), '{}')
    assert.deepEqual(JSON.parse(app.stored.get('tremUrl')), fullConfig.enableTremFunctions)
    assert.deepEqual(JSON.parse(app.stored.get('gqUrl')), fullConfig.enableGqEew)
    assert.deepEqual(JSON.parse(app.stored.get('nmefcTsunami')), fullConfig.enableNmefcTsunami)
    assert.deepEqual(snapshot(app.accessStore.capabilities), {
        iclEew: true, tremFunctions: true, gqEew: true, nmefcTsunamiMap: true, advancedHypoInf: false,
    })
    assert.deepEqual(snapshot(app.restartAccess().capabilities), snapshot(app.accessStore.capabilities))
    assert.deepEqual(snapshot(app.settingsStore.mainSettings), settingsBefore)
    assert.deepEqual(snapshot(app.tremConfig.value), fullConfig.enableTremFunctions.seisNetUrls.trem)
    assert.equal(app.tremUpdates, 1)
    assert.equal(app.reloads, 1)
    assert.equal(app.advancedKey.value, '')
    assert.equal(app.verifyDialog.value, false)
    assert.equal(app.pendingAdvancedConfig.value, null)
    const grantStart = app.events.findIndex(event => event.startsWith('grant:'))
    for(const key of ['iclUrl', 'tremUrl', 'gqUrl', 'nmefcTsunami']) {
        assert(app.events.indexOf(`write:${key}`) < grantStart)
    }
    assert(app.events.indexOf('write:accessSettings') < app.events.indexOf('trem'))
    assert(app.events.indexOf('write:accessSettings') < app.events.indexOf('message:success'))
    assert(app.events.indexOf('message:success') < app.events.indexOf('reload'))
    assert(!JSON.stringify([...app.stored]).includes('custom-Test_Key'))
    assert.deepEqual(app.logs, [])
})

for(const [field, capability, storageKey] of [
    ['enableIclEew', 'iclEew', 'iclUrl'],
    ['enableTremFunctions', 'tremFunctions', 'tremUrl'],
    ['enableGqEew', 'gqEew', 'gqUrl'],
    ['enableNmefcTsunami', 'nmefcTsunamiMap', 'nmefcTsunami'],
]) {
    test(`single-feature response grants only ${capability}`, async t => {
        const app = setup(t, { post: () => successResponse({ [field]: fullConfig[field] }) })
        await app.submitAdvancedFunctions()
        assert.deepEqual(Object.keys(app.accessStore.capabilities).filter(key => app.accessStore.canUse(key)), [capability])
        assert.deepEqual([...app.stored.keys()].sort(), ['accessSettings', storageKey].sort())
        assert.deepEqual(JSON.parse(app.stored.get(storageKey)), fullConfig[field])
    })
}

test('partial responses preserve existing permissions and configuration, including independent capabilities', async t => {
    const oldGq = JSON.stringify({ gqEew_ws: ['wss://existing.example.invalid/gq'] })
    const app = setup(t, {
        initialStorage: { gqUrl: oldGq, accessSettings: JSON.stringify({ gqEew: true, advancedHypoInf: true }) },
        post: () => successResponse({ enableTremFunctions: fullConfig.enableTremFunctions }),
    })
    await app.submitAdvancedFunctions()
    assert.equal(app.stored.get('gqUrl'), oldGq)
    assert.equal(app.accessStore.canUse('gqEew'), true)
    assert.equal(app.accessStore.canUse('advancedHypoInf'), true)
    assert.equal(app.accessStore.canUse('tremFunctions'), true)
    assert.equal(app.accessStore.canUse('iclEew'), false)
    assert.deepEqual(snapshot(app.restartAccess().capabilities), snapshot(app.accessStore.capabilities))
})

test('repeated successful authentication updates complete configuration arrays without changing source selections', async t => {
    let config = fullConfig
    const app = setup(t, { post: () => successResponse(config) })
    await app.submitAdvancedFunctions()
    config = {
        enableGqEew: { gqEew_ws: ['wss://new.example.invalid/gq', ...fullConfig.enableGqEew.gqEew_ws] },
        enableTremFunctions: structuredClone(fullConfig.enableTremFunctions),
    }
    config.enableTremFunctions.seisNetUrls.trem.stationSources.reverse()
    app.handleAdvance('enableAdvancedFunctions')
    app.advancedKey.value = 'another-test-key'
    await app.submitAdvancedFunctions()
    assert.equal(app.requests.length, 2)
    assert.deepEqual(JSON.parse(app.stored.get('gqUrl')), config.enableGqEew)
    assert.deepEqual(snapshot(app.tremConfig.value.stationSources), config.enableTremFunctions.seisNetUrls.trem.stationSources)
    assert.equal(app.accessStore.canUse('iclEew'), true)
    assert.equal(app.accessStore.canUse('nmefcTsunamiMap'), true)
})

test('duplicate clicks and Enter presses do not send additional requests', async t => {
    const response = deferred()
    const app = setup(t, { post: () => response.promise })
    const pending = app.submitAdvancedFunctions()
    assert.equal(app.isVerifying.value, true)
    await app.submitAdvancedFunctions()
    await app.submitAdvancedFunctions()
    assert.equal(app.requests.length, 1)
    response.resolve(successResponse(fullConfig))
    await pending
    assert.equal(app.isVerifying.value, false)
    assert.equal(app.reloads, 1)
})

test('key validation trims whitespace and counts Unicode characters without imposing an admin creation format', async t => {
    const app = setup(t)
    for(const key of ['', '  \n ', 'a'.repeat(129), '😀'.repeat(129)]) {
        app.advancedKey.value = key
        await app.submitAdvancedFunctions()
    }
    assert.equal(app.requests.length, 0)
    app.advancedKey.value = `  ${'😀'.repeat(128)}  `
    await app.submitAdvancedFunctions()
    assert.equal(app.requests[0][1].key, '😀'.repeat(128))
    app.advancedKey.value = 'X'
    await app.submitAdvancedFunctions()
    assert.equal(app.requests[1][1].key, 'X')
})

test('unknown fields never grant permissions, while known features can still be applied', async t => {
    const app = setup(t, { post: () => successResponse({ enableIclEew: {}, advancedHypoInf: {}, futureFeature: {} }) })
    await app.submitAdvancedFunctions()
    assert.equal(app.accessStore.canUse('iclEew'), true)
    assert.equal(app.accessStore.canUse('advancedHypoInf'), false)
    assert.equal(app.accessStore.canUse('futureFeature'), false)
    assert(app.messages.some(message => message.message.includes('升级客户端')))
    assert.deepEqual([...app.stored.keys()].sort(), ['accessSettings', 'iclUrl'])
})

test('empty or unsupported-only results are not reported as successful activation', async t => {
    for(const data of [{}, { futureFeature: {} }, { advancedHypoInf: {} }]) {
        const app = setup(t, { post: () => successResponse(data) })
        await app.submitAdvancedFunctions()
        assertNoAuthorization(app)
        assert.equal(app.messages[0].type, 'warning')
    }
})

test('all known configurations are validated before any configuration is written', async t => {
    const invalidTrem = change => {
        const config = structuredClone(fullConfig.enableTremFunctions)
        change(config.seisNetUrls.trem)
        return { enableTremFunctions: config }
    }
    const invalid = [
        null, [], 'invalid',
        { enableIclEew: null }, { enableIclEew: [] }, { enableIclEew: true },
        { enableGqEew: { gqEew_ws: [] } },
        { enableGqEew: { gqEew_ws: 'wss://example.invalid' } },
        { enableGqEew: { gqEew_ws: ['ws://example.invalid'] } },
        { enableGqEew: { gqEew_ws: ['wss://example.invalid', 'invalid'] } },
        { enableNmefcTsunami: { cn_tsunami: ['https://example.invalid'] } },
        { enableNmefcTsunami: { cn_tsunami: 'http://example.invalid' } },
        { enableTremFunctions: {} },
        invalidTrem(trem => { trem.stationList = 'http://example.invalid' }),
        invalidTrem(trem => { trem.stationReplay = '' }),
        invalidTrem(trem => { trem.stationSources = [] }),
        invalidTrem(trem => { trem.stationSources = [null] }),
        invalidTrem(trem => { trem.stationSources[0].id = '  ' }),
        invalidTrem(trem => { trem.stationSources[0].name = '' }),
        invalidTrem(trem => { trem.stationSources[0].url = 'wss://example.invalid' }),
        invalidTrem(trem => { trem.stationSources[0].id = trem.stationSources[1].id }),
    ]
    for(const data of invalid) {
        const app = setup(t, { post: () => successResponse(data && !Array.isArray(data) && typeof data === 'object'
            ? { enableIclEew: {}, ...data } : data) })
        await app.submitAdvancedFunctions()
        assertNoAuthorization(app)
        assert.match(app.messages[0].message, /功能配置无效/)
        assert.equal(app.requests.length, 1)
    }
})

test('HTTP errors retain their distinct meanings without granting or automatically retrying', async t => {
    for(const [status, code, expected] of [
        [400, 'INVALID_REQUEST', /请求格式/],
        [401, 'INVALID_KEY', /密钥无效/],
        [409, 'KEY_ALREADY_USED', /已使用/],
        [413, 'INVALID_REQUEST', /请求过大/],
        [415, 'INVALID_REQUEST', /请求格式/],
        [405, 'METHOD_NOT_ALLOWED', /请求方式/],
        [503, 'CONFIGURATION_ERROR', /配置异常.*已回滚/],
        [503, 'SERVICE_UNAVAILABLE', /暂不可用.*未完成/],
    ]) {
        const app = setup(t, { post: () => ({ status, data: { success: false, code, message: 'untrusted-message' } }) })
        await app.submitAdvancedFunctions()
        assertNoAuthorization(app)
        assert.match(app.messages[0].message, expected)
        assert.equal(app.requests.length, 1)
    }
})

test('HTML, malformed bodies and unexpected status/code combinations are treated as uncertain results', async t => {
    for(const response of [
        { status: 413, data: '<html>too large</html>' },
        { status: 502, data: '<html>bad gateway</html>' },
        { status: 504, data: { success: false, code: 'SERVICE_UNAVAILABLE' } },
        { status: 200, data: '{"success":' },
        { status: 200, data: null },
        { status: 200, data: [] },
        { status: 200, data: { success: 'true', data: fullConfig } },
        { status: 201, data: { success: true, data: fullConfig } },
    ]) {
        const app = setup(t, { post: () => response })
        await app.submitAdvancedFunctions()
        assertNoAuthorization(app)
        assert.match(app.messages[0].message, /无法确认/)
        assert.equal(app.requests.length, 1)
    }
})

test('network and timeout failures do not leak request secrets or trigger automatic retries', async t => {
    for(const code of ['ERR_NETWORK', 'ECONNABORTED']) {
        const app = setup(t, { post: () => {
            throw Object.assign(new Error('custom-Test_Key'), { code, config: { data: { key: 'custom-Test_Key' } } })
        } })
        await app.submitAdvancedFunctions()
        await nextTick()
        assertNoAuthorization(app)
        assert.match(app.messages[0].message, /密钥可能已使用/)
        assert.equal(app.requests.length, 1)
        assert.equal(app.isVerifying.value, false)
        assert(!JSON.stringify(app.messages).includes('custom-Test_Key'))
        assert.deepEqual(app.logs, [])
    }
})

for(const failedKey of ['tremUrl', 'accessSettings']) {
    test(`${failedKey} write failure keeps the result for local-only retry after reopening`, async t => {
        const app = setup(t, { initialStorage: {
            gqUrl: JSON.stringify(fullConfig.enableGqEew),
            accessSettings: JSON.stringify({ gqEew: true }),
        } })
        app.failWrite = key => key === failedKey
        const previousCapabilities = snapshot(app.accessStore.capabilities)
        await app.submitAdvancedFunctions()
        await nextTick()
        assert.deepEqual(snapshot(app.accessStore.capabilities), previousCapabilities)
        assert.equal(app.verifyDialog.value, true)
        assert.notEqual(app.pendingAdvancedConfig.value, null)
        assert.equal(app.tremUpdates, 0)
        assert.equal(app.reloads, 0)
        assert.match(app.messages.at(-1).message, /本地保存失败/)
        app.verifyDialog.value = false
        app.advancedKey.value = ''
        app.handleAdvance('enableAdvancedFunctions')
        app.failWrite = null
        await app.submitAdvancedFunctions()
        await nextTick()
        assert.equal(app.requests.length, 1)
        assert.equal(app.reloads, 1)
        assert.equal(app.pendingAdvancedConfig.value, null)
        assert.equal(app.tremUpdates, 1)
        assert.equal(app.accessStore.canUse('tremFunctions'), true)
        assert.equal(app.accessStore.canUse('gqEew'), true)
        assert.deepEqual(snapshot(app.restartAccess().capabilities), snapshot(app.accessStore.capabilities))
    })
}

test('a refused grant rolls back new permissions and can be retried locally', async t => {
    const app = setup(t)
    app.refuseGrant = 'gqEew'
    await app.submitAdvancedFunctions()
    await nextTick()
    assert(Object.values(app.accessStore.capabilities).every(value => value === false))
    assert(Object.values(JSON.parse(app.stored.get('accessSettings'))).every(value => value === false))
    assert.notEqual(app.pendingAdvancedConfig.value, null)
    assert.equal(app.reloads, 0)
    assert.equal(app.tremUpdates, 0)
    app.refuseGrant = null
    await app.submitAdvancedFunctions()
    assert.equal(app.requests.length, 1)
    assert.equal(app.reloads, 1)
})

test('requests and pending saves cannot run while the application is resetting', async t => {
    const app = setup(t)
    app.statusStore.isResettingApp = true
    await app.submitAdvancedFunctions()
    assert.equal(app.requests.length, 0)
    assertNoAuthorization(app)
    app.statusStore.isResettingApp = false
    app.failWrite = key => key === 'tremUrl'
    await app.submitAdvancedFunctions()
    assert.notEqual(app.pendingAdvancedConfig.value, null)
    app.statusStore.isResettingApp = true
    app.localStorage.clear()
    app.failWrite = null
    await app.submitAdvancedFunctions()
    assert.equal(app.stored.size, 0)
    assert.equal(app.requests.length, 1)
    assert.equal(app.reloads, 0)
})

test('unmounting ignores late responses and discards the in-memory result', async t => {
    const response = deferred()
    const app = setup(t, { post: () => response.promise })
    const pending = app.submitAdvancedFunctions()
    app.dispose()
    response.resolve(successResponse(fullConfig))
    await pending
    assertNoAuthorization(app)
    assert.equal(app.advancedKey.value, '')
    assert.deepEqual(app.messages, [])
})

test('only the new command opens authentication and independent advanced commands still work', async t => {
    const app = setup(t)
    app.verifyDialog.value = false
    for(const command of ['enableIclEew', 'enableTremFunctions', 'enableGqEew', 'enableNmefcTsunami', 'verifyAdmin']) {
        app.handleAdvance(command)
        assert.equal(app.verifyDialog.value, false)
    }
    app.handleAdvance('enableAdvancedHypoInf')
    assert.equal(app.accessStore.canUse('advancedHypoInf'), true)
    app.handleAdvance('disableAdvancedHypoInf')
    assert.equal(app.accessStore.canUse('advancedHypoInf'), false)
    app.handleAdvance('enableAdvancedFunctions')
    assert.equal(app.verifyDialog.value, true)
    assert.equal(app.requests.length, 0)
    await nextTick()
})
