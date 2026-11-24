import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { ref } from 'vue'
import { compareVersions } from '../src/utils/Version.js'
import { parseSettings, restoreSettings } from '../src/utils/SettingsRestore.js'
import { createDefaultDataSources, migrateDataSources } from '../src/utils/DataSources.js'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const withoutImports = source => source.replace(/^import[^\n]*\n/gm, '')
const component = read('src/components/VersionNotification.vue')
const source = withoutImports(component.match(/<script setup>([\s\S]*?)<\/script>/)[1])
const migrationSource = withoutImports(component.match(/<script>([\s\S]*?)<\/script>/)[1]).replace(/^export /gm, '')
const appSource = read('src/App.vue')
const restoreSource = appSource.slice(appSource.indexOf('  const savedMainSettings ='), appSource.indexOf('  accessStore.setAccessSettings'))
const startLaunch = (storage, currentVersion = '2.12.0', options = {}) => {
    const mounted = [], unmounted = [], fsCalls = [], errors = []
    const statusStore = {
        isResettingApp: options.isResettingApp ?? false,
        setLocalStorageItem: (key, value) => storage.set(key, value),
    }
    const localStorage = { getItem: key => storage.get(key) ?? null }
    const lastVersion = localStorage.getItem('lastVersion') || ''
    const migrations = new Function('compareVersions', 'parseSettings', 'APP_VERSION', migrationSource
        + '\nreturn { isUpgradeToVersion, migrateVersionSettings }')(compareVersions, parseSettings, currentVersion)
    // Exercise the actual startup migration before obsolete provider fields are filtered out.
    const settingsStore = { setMainSettings: json => {
        const saved = parseSettings(json)
        saved.dataSources = migrateDataSources(saved.dataSources)
        settingsStore.mainSettings = restoreSettings({ dataSources: createDefaultDataSources() }, saved)
    } }
    new Function('localStorage', 'lastVersion', 'migrateVersionSettings', 'statusStore', 'settingsStore', restoreSource)(
        localStorage, lastVersion, migrations.migrateVersionSettings, statusStore, settingsStore,
    )
    const dependencies = {
        ref, compareVersions, ...migrations, APP_VERSION: currentVersion,
        defineProps: () => ({ lastVersion }),
        onMounted: callback => mounted.push(callback),
        onBeforeUnmount: callback => unmounted.push(callback),
        useStatusStore: () => statusStore,
        isTauri: () => options.desktop ?? false,
        appDataDir: async () => { fsCalls.push('appDataDir'); return '/data' },
        join: async (...parts) => parts.join('/'),
        exists: async path => { fsCalls.push(['exists', path]); return options.audioDirectoryExists ?? true },
        readDir: async path => { fsCalls.push(['readDir', path]); return options.readDir ? options.readDir() : options.entries ?? [] },
        console: { error: (...args) => errors.push(args) },
    }
    const state = new Function(...Object.keys(dependencies), source
        + '\nreturn { visible, lastVersion, versionOrder, showTsunamiMigration, showTsunamiAudioNotice }')(
        ...Object.values(dependencies),
    )
    return {
        ...state, statusStore, settingsStore, fsCalls, errors,
        ready: Promise.all(mounted.map(callback => callback())),
        unmount: () => unmounted.forEach(callback => callback()),
    }
}
const launch = async (...args) => {
    const state = startLaunch(...args)
    await state.ready
    return state
}

test('versions compare numeric segments and prerelease identifiers in release order', () => {
    const versions = ['2.9.9', '2.10.0', '2.11.1-pre.2', '2.11.1-pre.10', '2.11.1-rc.1', '2.11.1', '2.12.0', '3.0.0']
    for(let i = 0; i < versions.length; i++) {
        for(let j = 0; j < versions.length; j++) {
            assert.equal(compareVersions(versions[i], versions[j]), i === j ? 0 : i < j ? -1 : 1)
        }
    }
    assert.equal(compareVersions('2.11.1+build.1', '2.11.1+build.2'), 0)
})

test('missing or malformed versions cannot be compared', () => {
    for(const value of [null, undefined, '', 'unknown', '2.11', '2.11.1-', 2111]) {
        assert.equal(compareVersions(value, '2.11.1'), null)
        assert.equal(compareVersions('2.11.1', value), null)
    }
})

test('no version record still migrates legacy settings and checks custom tsunami audio', async () => {
    const saved = '{"dataSources":{"jmaTsunami":{"p2pquake":true}},"onTsunami":{"sound":true}}'
    const storage = new Map([['mainSettings', saved], ['SHOW_ABOUT_FLG', '20260313.00']])
    const state = await launch(storage, '2.12.0', {
        desktop: true, entries: [{ name: 'tsunami1issue.mp3', isFile: true }],
    })
    assert.equal(state.lastVersion, '')
    assert.equal(state.visible.value, true)
    assert.equal(state.showTsunamiMigration, true)
    assert.equal(state.showTsunamiAudioNotice.value, true)
    assert.deepEqual(state.fsCalls, ['appDataDir', ['exists', '/data/audio'], ['readDir', '/data/audio']])
    assert.equal(storage.get('lastVersion'), '2.12.0')
    assert.deepEqual(state.settingsStore.mainSettings.dataSources.jmaTsunami, { wolfx: true })
    assert.deepEqual(JSON.parse(storage.get('mainSettings')), {
        dataSources: { jmaTsunami: { wolfx: true } }, onTsunami: { sound: true },
    })
    const next = await launch(storage, '2.12.0', { desktop: true })
    assert.equal(next.visible.value, false)
    assert.equal(next.showTsunamiMigration, false)
    assert.deepEqual(next.fsCalls, [])
})

test('a fresh install has no settings to migrate and keeps the default tsunami switch', async () => {
    const storage = new Map()
    const state = await launch(storage, '2.12.0', { desktop: true, audioDirectoryExists: false })
    assert.equal(state.lastVersion, '')
    assert.equal(state.visible.value, true)
    assert.equal(state.showTsunamiMigration, true)
    assert.equal(state.showTsunamiAudioNotice.value, false)
    assert.deepEqual(state.settingsStore.mainSettings.dataSources.jmaTsunami, { wolfx: false })
    assert.equal(storage.has('mainSettings'), false)
    assert.equal(storage.get('lastVersion'), '2.12.0')
})

test('an upgrade retains the previous version for custom content after persisting the current version', async () => {
    const storage = new Map([['lastVersion', '2.9.9']])
    const state = await launch(storage)
    assert.equal(state.lastVersion, '2.9.9')
    assert.equal(state.visible.value, true)
    assert.equal(state.showTsunamiMigration, true)
    assert.equal(storage.get('lastVersion'), '2.12.0')
    state.visible.value = false
    assert.equal(state.lastVersion, '2.9.9')
    assert.equal((await launch(storage)).visible.value, false)
})

test('a downgrade records the actual launch version without presenting an upgrade', async () => {
    const storage = new Map([['lastVersion', '2.13.0']])
    const state = await launch(storage)
    assert.equal(state.visible.value, false)
    assert.equal(state.showTsunamiMigration, false)
    assert.equal(storage.get('lastVersion'), '2.12.0')
    assert.equal((await launch(storage, '2.13.0')).visible.value, true)
})

test('upgrading from a prerelease to the stable version shows a notice', async () => {
    const storage = new Map([['lastVersion', '2.12.0-rc.1']])
    assert.equal((await launch(storage)).visible.value, true)
    assert.equal((await launch(storage)).visible.value, false)
})

test('an invalid saved version shows the generic notice and skips migrations', async () => {
    const storage = new Map([['lastVersion', 'invalid']])
    const state = await launch(storage)
    assert.equal(state.versionOrder, null)
    assert.equal(state.visible.value, true)
    assert.equal(state.showTsunamiMigration, false)
    assert.equal(storage.get('lastVersion'), '2.12.0')
})

test('a pending mount does not repopulate storage or open a notice during application reset', async () => {
    const storage = new Map()
    assert.equal((await launch(storage, '2.12.0', { isResettingApp: true })).visible.value, false)
    assert.equal(storage.size, 0)
})

test('the 2.12.0 migration preserves enabled and disabled tsunami settings before restoration', async () => {
    for(const lastVersion of ['', '2.11.1']) for(const enabled of [true, false]) {
        const saved = { dataSources: { jmaTsunami: { p2pquake: enabled }, jmaEqlist: { p2pquake: true } }, masterVolume: 42 }
        const storage = new Map([['mainSettings', JSON.stringify(saved)]])
        if(lastVersion) storage.set('lastVersion', lastVersion)
        const state = await launch(storage)
        assert.deepEqual(state.settingsStore.mainSettings.dataSources.jmaTsunami, { wolfx: enabled })
        assert.deepEqual(JSON.parse(storage.get('mainSettings')), {
            ...saved, dataSources: { ...saved.dataSources, jmaTsunami: { wolfx: enabled } },
        })
        assert.equal(state.showTsunamiMigration, true)
        assert.deepEqual(state.fsCalls, [], 'Web launches must not access native files')
        const second = await launch(storage)
        assert.equal(second.showTsunamiMigration, false)
        assert.deepEqual(second.settingsStore.mainSettings.dataSources.jmaTsunami, { wolfx: enabled })
    }
})

test('migration preserves an explicit Wolfx choice and skips users already on 2.12.0', async () => {
    const saved = { dataSources: { jmaTsunami: { p2pquake: true, wolfx: false } } }
    const storage = new Map([['lastVersion', '2.11.1'], ['mainSettings', JSON.stringify(saved)]])
    assert.deepEqual((await launch(storage)).settingsStore.mainSettings.dataSources.jmaTsunami, { wolfx: false })
    storage.set('mainSettings', JSON.stringify(saved))
    const state = await launch(storage, '2.12.0', { desktop: true })
    assert.equal(storage.get('mainSettings'), JSON.stringify(saved))
    assert.equal(state.showTsunamiMigration, false)
    assert.deepEqual(state.fsCalls, [])
})

test('old custom tsunami files trigger the audio notice even when sound is disabled', async () => {
    const names = [
        'tsunami1issue.mp3', 'tsunami1update.mp3', 'tsunami1switch.mp3', 'tsunami1cancel.mp3',
        'tsunami2issue.mp3', 'tsunami2update.mp3', 'tsunami2switch.mp3', 'tsunami2cancel.mp3',
        'tsunami3issue.mp3', 'tsunami3update.mp3', 'tsunami3cancel.mp3',
    ]
    for(const name of names) {
        const storage = new Map([['lastVersion', '2.11.1'], ['mainSettings', '{"onTsunami":{"sound":false}}']])
        const state = await launch(storage, '2.12.0', { desktop: true, entries: [{ name, isFile: true }] })
        assert.equal(state.showTsunamiAudioNotice.value, true, name)
        assert.deepEqual(state.fsCalls, ['appDataDir', ['exists', '/data/audio'], ['readDir', '/data/audio']])
        const second = await launch(storage, '2.12.0', { desktop: true, entries: [{ name, isFile: true }] })
        assert.equal(second.showTsunamiAudioNotice.value, false)
        assert.deepEqual(second.fsCalls, [])
    }
})

test('missing directories, new filenames, unrelated files and directories do not trigger the audio notice', async () => {
    for(const options of [
        { audioDirectoryExists: false },
        { entries: [] },
        { entries: [
            { name: 'tsunami-advisory-issue.mp3', isFile: true },
            { name: 'eew-issue.mp3', isFile: true },
            { name: 'tsunami1issue.mp3.bak', isFile: true },
            { name: 'tsunami1issue.mp3', isFile: false },
        ] },
    ]) {
        const state = await launch(new Map([['lastVersion', '2.11.1']]), '2.12.0', { desktop: true, ...options })
        assert.equal(state.showTsunamiAudioNotice.value, false)
    }
})

test('an audio read failure preserves the old version so the check can retry next launch', async () => {
    const storage = new Map([['lastVersion', '2.11.1']])
    const state = await launch(storage, '2.12.0', { desktop: true, readDir: () => { throw new Error('read failed') } })
    assert.equal(state.visible.value, true)
    assert.equal(state.showTsunamiAudioNotice.value, false)
    assert.equal(state.errors.length, 1)
    assert.equal(storage.get('lastVersion'), '2.11.1')
    await launch(storage, '2.12.0', { desktop: true })
    assert.equal(storage.get('lastVersion'), '2.12.0')
})

test('a delayed audio check cannot reopen a disposed dialog or write after reset', async () => {
    for(const reset of [false, true]) {
        let finish
        const pending = new Promise(resolve => { finish = resolve })
        const storage = new Map([['lastVersion', '2.11.1']])
        const state = startLaunch(storage, '2.12.0', { desktop: true, readDir: () => pending })
        if(reset) {
            state.statusStore.isResettingApp = true
            storage.clear()
        }
        else state.unmount()
        finish([{ name: 'tsunami1issue.mp3', isFile: true }])
        await state.ready
        assert.equal(state.visible.value, false)
        assert.equal(state.showTsunamiAudioNotice.value, false)
        assert.equal(storage.get('lastVersion'), reset ? undefined : '2.11.1')
    }
})
