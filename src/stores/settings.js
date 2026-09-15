import { defineStore } from 'pinia';
import { jmaSeisIntLoc } from '@/utils/JmaSeisIntLoc';
import { calcDistanceKm } from '@/utils/Utils';
import { createDefaultDataSources, dataSourceCatalog } from '@/utils/DataSources';
import { useAccessStore } from './access';
import { parseSettings, restoreSettings } from '@/utils/SettingsRestore';

const createDefaultSettings = () => {
    return {
        mainSettings: {
            dataSources: createDefaultDataSources(),
            provinceCeaEew: false,
            apiKeys: {
                fanApiKey: ''
            },
            displaySeisNet: {
                style: 'nied',
                hideNoData: false,
                displayShindo0: false,
                alwaysDisplayGrid: false,
                displayMaxInt: false,
                displayPeriodMaxInt: false,
                httpDataPriority: 'realtime',
                palertNet: false,
                palertSensitivity: 1,
                palertLevelHold: 1,
                palertHypoInf: false,
                palertHypoInfAlwaysOn: false,
                palertHypoInfTextInfo: 0,
                displayPalertShindo: false,
                tremNet: false,
                tremApi: 'lb-1',
                displayTremShindo: false,
                niedNet: false,
                niedSensitivity: 1,
                displayNiedShindo: false,
                niedHypoInf: false,
                niedHypoInfAlwaysOn: false,
                niedHypoInfTextInfo: 0,
                kmaNet: false,
                kmaSensitivity: 1,
                kmaIntHold: 1,
                displayKmaInt: false,
            },
            actionMag: 0.0,
            actionLocalCsis: 0,
            actionLocalShindo: 0,
            playIntenseSound: false,
            intenseLocalCsis: 5,
            intenseLocalShindo: 3,
            gqActionMag: 5.0,
            usgsActionMag: 5.0,
            fssnActionMag: 5.0,
            fssnActionType: 1,
            actionWhiteList: '',
            historyMagThres: 0.0,
            historySources: ['CENC', 'CWA', 'JMA', 'USGS', 'FSSN'],
            onEew: {
                notification: false,
                sound: false,
                focus:false,
            },
            onEewWarn: {
                notification: false,
                sound: false,
                focus:false,
            },
            onReport: {
                notification: false,
                sound: false,
                focus:false,
            },
            onShake: {
                notification: false,
                sound: false,
                focus:false,
            },
            onTsunami: {
                notification: false,
                sound: false,
                focus:false,
            },
            masterVolume: 100,
            muteNotification: true,
            soundEffect: 'srev',
            userLatLng: [0, 0],
            displayUser: false,
            displayLegend: true,
            displayCountdown: false,
            forceDisplayCountdown: false,
            playCountdownSound: false,
            countdownOnlyIntense: false,
            countdownSpeech: true,
            countdownStart: 10,
            displayAreaIntensities: true,
            viewLatLng: [0, 0],
            defaultZoom: 5,
            uiScale: 1,
            displayPlaceName: false,
            placeNameOnHover: false,
            displayClock: false,
            displayCnFault: false,
            displayTerminator: false,
            useRomanCsis: true,
            fillSWave: true,
            sWaveColorMode: 0,
            hideDrawer: false,
            defaultMenuId: 'main',
            disableLastingEqlists: false,
            tempEqlistDuration: 6.5,
            tempTsunamiDuration: 15,
            eqlistsDisplayMode: 0,
            alwaysDisplayLatestInfo: false,
            disableEewBaseMap: false,
            mapSimplifyFactor: 0,
            maxWaveRenderRate: 10,
            useCanvasRenderer: false,
            minimizeOnLaunch: false,
            autoCheckNewVersion: false,
            checkPrerelease: false,
            gameMode: false,
            autoRefresh: false,
            displayTyphoon: false
        },
        advancedSettings: {
            defaultFanServer: 0,
            displayApiType: false,
            forceCalcInt: false,
            useClassicMapLoader: false,
            preventFlickerMode: false,
            mockEew: false,
            mockOnReplay: false,
            fallbackSvgStationRender: false
        }
    }
}

const restoreCoordinates = (value, fallback) => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)
    ? value.slice() : fallback.slice()

const mainSettingsArrayReaders = {
    historySources: (value, fallback) => Array.isArray(value)
        ? value.filter(source => fallback.includes(source)) : fallback.slice(),
    userLatLng: restoreCoordinates,
    viewLatLng: restoreCoordinates,
}

export const useSettingsStore = defineStore('settingsStore', {
    state: createDefaultSettings,
    getters: {
        isValidUserLatLng: (state) => state.mainSettings.userLatLng.every(item => item || item === 0) && !state.mainSettings.userLatLng.every(item => item === 0),
        isValidViewLatLng: (state) => state.mainSettings.viewLatLng.every(item => item || item === 0) && !state.mainSettings.viewLatLng.every(item => item === 0),
        isDisplayUser(state) { return this.isValidUserLatLng && state.mainSettings.displayUser },
        nearestJmaLoc(state) {
            if(!this.isValidUserLatLng) return null
            const userLatLng = state.mainSettings.userLatLng
            const [userLat, userLng] = userLatLng
            let nearestLoc = null
            let nearestDist = 30
            for(let loc in jmaSeisIntLoc) {
                const candidate = jmaSeisIntLoc[loc]
                const [locLat, locLng] = candidate.location
                if(Math.abs(userLng - locLng) >= 0.39 || Math.abs(userLat - locLat) >= 0.27) continue
                const dist = calcDistanceKm(userLatLng, candidate.location)
                if(dist < nearestDist) {
                    nearestDist = dist
                    nearestLoc = candidate
                }
            }
            return nearestLoc
        },
        actionWhiteListArr: (state) => state.mainSettings.actionWhiteList.split('|').filter(key => key),
        isDataSourceAvailable: () => source => {
            const requiredCapability = dataSourceCatalog[source]?.requiredCapability
            return !requiredCapability || useAccessStore().canUse(requiredCapability)
        },
        isDataSourceEnabled(state) {
            return source => this.isDataSourceAvailable(source)
                && Object.values(state.mainSettings.dataSources[source] || {}).some(Boolean)
        },
        isDataSourceFullyEnabled(state) {
            return source => {
                if(!this.isDataSourceAvailable(source)) return false
                const apis = Object.values(state.mainSettings.dataSources[source] || {})
                return apis.length > 0 && apis.every(Boolean)
            }
        },
        isDataSourcePartiallyEnabled(state) {
            return source => {
                if(!this.isDataSourceAvailable(source)) return false
                const apis = Object.values(state.mainSettings.dataSources[source] || {})
                return apis.some(Boolean) && !apis.every(Boolean)
            }
        },
        effectiveDataSources(state) {
            return Object.fromEntries(Object.entries(dataSourceCatalog).map(([source, config]) => [
                source,
                Object.fromEntries(config.apis.map(api => [
                    api,
                    this.isDataSourceAvailable(source)
                        && Boolean(state.mainSettings.dataSources[source]?.[api]),
                ])),
            ]))
        },
        effectiveNiedHypoInfTextInfo(state) {
            const mode = Number(state.mainSettings.displaySeisNet.niedHypoInfTextInfo)
            return useAccessStore().canUse('advancedHypoInf') ? mode : Math.min(mode, 1)
        },
        effectivePalertHypoInfTextInfo(state) {
            const mode = Number(state.mainSettings.displaySeisNet.palertHypoInfTextInfo)
            return useAccessStore().canUse('advancedHypoInf') ? mode : Math.min(mode, 1)
        },
        enabledDataSources() {
            return Object.entries(this.effectiveDataSources)
                .filter(([, apis]) => Object.values(apis).some(Boolean))
                .map(([source]) => source)
        },
    },
    actions: {
        resetUnauthorizedFeatureSettings() {
            const accessStore = useAccessStore()
            if(!accessStore.canUse('iclEew')) {
                this.setDataSourceEnabled('iclEew', false)
            }
            if(!accessStore.canUse('gqEew')) {
                this.setDataSourceEnabled('gqEew', false)
            }
            if(!accessStore.canUse('tremFunctions')) {
                this.mainSettings.displaySeisNet.tremNet = false
            }
            if(
                !accessStore.canUse('advancedHypoInf') &&
                Number(this.mainSettings.displaySeisNet.niedHypoInfTextInfo) > 1
            ) {
                this.mainSettings.displaySeisNet.niedHypoInfTextInfo = 1
            }
            if(!accessStore.canUse('advancedHypoInf') && Number(this.mainSettings.displaySeisNet.palertHypoInfTextInfo) > 1) {
                this.mainSettings.displaySeisNet.palertHypoInfTextInfo = 1
            }
        },
        setDataSourceEnabled(source, enabled) {
            const apis = this.mainSettings.dataSources[source]
            if(!apis) return
            if(enabled && !this.isDataSourceAvailable(source)) return
            Object.keys(apis).forEach(api => {
                apis[api] = enabled
            })
        },
        setMainSettings(jsonString){
            const json = parseSettings(jsonString)
            this.mainSettings = restoreSettings(createDefaultSettings().mainSettings, json, mainSettingsArrayReaders)
            if(!['realtime', 'complete'].includes(this.mainSettings.displaySeisNet.httpDataPriority)) {
                this.mainSettings.displaySeisNet.httpDataPriority = 'realtime'
            }
        },
        setAdvancedSettings(jsonString){
            const json = parseSettings(jsonString)
            this.advancedSettings = restoreSettings(createDefaultSettings().advancedSettings, json)
        },
    }
})
