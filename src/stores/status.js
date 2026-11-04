import { defineStore } from 'pinia';
import Http from '@/classes/Http';
import { WolfxClient, LipoApiClient, P2pQuakeClient, GlobalQuakeClient } from '@/classes/WebSocket';
import { eqUrls, iconUrls, tsunamiUrls } from '@/utils/Urls';
import { setClassName, calcCsisLevel, stampToTime, getShindoFromInstShindo, shindoScaleKanji, getShindoRank, calcTimeDiff, playSound, sendMyNotification, focusWindow, formatShindo, timeToStamp, systemTimeZone, convertCompactTimeString } from '@/utils/Utils';
import { jmaSeisIntLoc } from '@/utils/JmaSeisIntLoc';
import { useSettingsStore } from './settings';
import { isTauri } from '@tauri-apps/api/core';
import { getFEName } from '@/utils/FERegions';
import { normalizeUsgsEvent, hashUsgsContent } from '@/utils/UsgsData';
import {
    dataSourceProviders,
    eewSources,
    eqlistSources,
    tsunamiSources,
    wolfxSocketSources,
    lipoSocketSources,
    wolfxSourceTypes,
    lipoSourceTypes,
    p2pquakeSocketSources,
} from '@/utils/DataSources';

export const defaultEqMessage = {
    source: '',
    type: 0,
    id: '',
    isEew: false,
    timeZone: 8,
    intTitle: '',
    reportNum: 0,
    reportNumText: '',
    reportTime: '',
    reviewType: '',
    isAssumption: false,
    isWarn: false,
    isFinal: false,
    isCanceled: false,
    title: '',
    titleText: '',
    hypocenter: '',
    hypocenterText: '',
    lat: 0,
    lng: 0,
    depth: 0,
    depthText: '',
    originTime: '',
    originTimeText: '',
    magnitude: 0,
    magnitudeText: '',
    useShindo: false,
    maxIntensity: '',
    maxIntensityText: '',
    warnArea: '[]',
    className: ''
}
export const defaultTsunamiMessage = {
    source: '',
    id: '',
    timeZone: 8,
    reportTime: '',
    title: '',
    titleText: '',
    status: 0,
    warnArea: '[]',
    className: ''
}

export { eewSources, eqlistSources, tsunamiSources }
export const seisNetSources = ['palertNet', 'tremNet', 'niedNet', 'kmaNet']

const wolfx2Source = Object.fromEntries(Object.entries(wolfxSourceTypes).map(([source, type]) => [type, source]))
const lipo2Source = Object.fromEntries(Object.entries(lipoSourceTypes).map(([source, type]) => [type, source]))

// Provider IDs are stable parser keys; only EEW uses these numbers as priorities (lower wins).
export const sourceTypes = {
    jmaEew: {
        0: 'wolfx',
        1: 'lipo'
    },
    cwaEew: {
        0: 'wolfx'
    },
    ceaEew: {
        0: 'lipo',
        1: 'wolfx'
    },
    iclEew: {
        1: 'lipo'
    },
    kmaEew: {
        1: 'lipo'
    },
    gqEew: {
        0: 'globalquake'
    },
    mockEew: {
        0: 'mock'
    },
    jmaEqlist: {
        0: 'p2pquake'
    },
    cwaEqlist: {
        1: 'lipo'
    },
    cencEqlist: {
        0: 'wolfx',
        1: 'lipo'
    },
    kmaEqlist: {
        1: 'lipo'
    },
    usgsEqlist: {
        0: 'usgs',
        1: 'lipo'
    },
    history: {
        0: ''
    }
}

const getSourceType = (source, provider) => {
    const entry = Object.entries(sourceTypes[source] ?? {}).find(([, name]) => name === provider)
    return entry ? Number(entry[0]) : undefined
}

export const getProviderLabel = eqMessage =>
    dataSourceProviders[sourceTypes[eqMessage.source]?.[eqMessage.type]] ?? ''

const irDetailCache = new Map()
const irDetailRequests = new Map()

const formatLipoNumber = (value, digits, unknown = '不明') => Number.isFinite(value) ? value.toFixed(digits) : unknown

const createUsgsMessage = event => {
    const originTime = stampToTime(event.originTimeStamp, systemTimeZone)
    const translated = Number.isFinite(event.latitude) && Number.isFinite(event.longitude)
        ? getFEName(event.latitude, event.longitude) : ''
    const hypocenter = translated || event.epicenter
    const title = 'USGS' + (event.reviewType.toLowerCase() === 'reviewed' ? '正式' : '自动') + '测定'
    const maxIntensity = event.magnitude == null || event.depth == null ? '?' : calcCsisLevel(event.magnitude, event.depth, 0)
    return {
        source: 'usgsEqlist', id: event.id, timeZone: systemTimeZone, useShindo: false,
        reviewType: event.reviewType,
        title, titleText: title, hypocenter, hypocenterText: '震中: ' + hypocenter,
        lat: event.latitude, lng: event.longitude, depth: event.depth ?? -1,
        depthText: '深度: ' + (event.depth == null ? '不明' : event.depth.toFixed(0) + 'km'),
        originTime, originTimeStamp: event.originTimeStamp, originTimeText: '发震时间: ' + originTime,
        reportTime: stampToTime(event.versionTime, systemTimeZone), reportTimeStamp: event.versionTime,
        magnitude: event.magnitude ?? -1, magnitudeText: '震级: ' + formatLipoNumber(event.magnitude, 1),
        maxIntensity, maxIntensityText: '预估最大烈度: ' + maxIntensity,
        className: setClassName(maxIntensity, false), url: event.url,
    }
}

const cencHistoryTolerance = 1e-9

const isSameCencHistoryEvent = (event1, event2) => {
    const stamp1 = timeToStamp(event1.originTime, event1.timeZone)
    const stamp2 = timeToStamp(event2.originTime, event2.timeZone)
    return Number.isFinite(stamp1)
        && stamp1 === stamp2
        && Math.abs(event1.lat - event2.lat) <= cencHistoryTolerance
        && Math.abs(event1.lng - event2.lng) <= cencHistoryTolerance
        && Math.abs(event1.depth - event2.depth) <= cencHistoryTolerance
        && Math.abs(event1.magnitude - event2.magnitude) <= cencHistoryTolerance
}

export const useStatusStore = defineStore('statusStore', {
    state: ()=>({
        map: null,
        isTauri: isTauri(),
        isResettingApp: false,
        showMockDialog: false,
        showStatusPanel: false,
        httpRequest: null,
        wsConnectTimer: null,
        wolfxSocket: null,
        lipoSocket: null,
        lipoAuthStatus: -1,
        lipoError: '',
        p2pquakeSocket: null,
        gqSocket: null,
        webSocketStatus: {
            wolfx: { readyState: 4, urlIndex: 0 },
            lipo: { readyState: 4, urlIndex: 0 },
            p2pquake: { readyState: 4, urlIndex: 0 },
            gq: { readyState: 4, urlIndex: 0 },
        },
        sourceRoutes: {},
        enabledSource: [],
        isNiedUpdating: false,
        seisNetReplayDelay: 0, // Minutes behind realtime; only retained for the current session.
        eqMessage: {
            jmaEew: Object.assign({}, defaultEqMessage),
            cwaEew: Object.assign({}, defaultEqMessage),
            ceaEew: Object.assign({}, defaultEqMessage),
            iclEew: Object.assign({}, defaultEqMessage),
            kmaEew: Object.assign({}, defaultEqMessage),
            gqEew: Object.assign({}, defaultEqMessage),
            mockEew: Object.assign({}, defaultEqMessage),
            jmaEqlist: Object.assign({}, defaultEqMessage),
            cwaEqlist: Object.assign({}, defaultEqMessage),
            cencEqlist: Object.assign({}, defaultEqMessage),
            kmaEqlist: Object.assign({}, defaultEqMessage),
            usgsEqlist: Object.assign({}, defaultEqMessage),
        },
        tsunamiMessage: {
            jmaTsunami: Object.assign({}, defaultTsunamiMessage),
            nmefcTsunami: Object.assign({}, defaultTsunamiMessage),
        },
        isActive: {
            jmaEew: false,
            cwaEew: false,
            ceaEew: false,
            iclEew: false,
            kmaEew: false,
            gqEew: false,
            mockEew: false,
            jmaEqlist: false,
            cwaEqlist: false,
            cencEqlist: false,
            kmaEqlist: false,
            usgsEqlist: false,
            jmaTsunami: false,
            nmefcTsunami: false,
            palertNet: false,
            tremNet: false,
            niedNet: false,
            kmaNet: false,
            niedInfHypo: false,
            palertInfHypo: false,
        },
        history: {
            jmaEqlist: [],
            cwaEqlist: [],
            cencEqlist: [],
            kmaEqlist: [],
            usgsEqlist: [],
        },
        usgsHistoryCache: { lipo: new Map(), usgs: new Map() },
        usgsRealtimeCache: new Map(),
        usgsHttpRequestId: 0,
        cencHistoryCache: {
            wolfx: [],
            lipo: [],
        },
        intReportIds: new Set(),
        intReportsInitialized: false,
        historyList: null,
    }),
    getters: {
        activeWolfxSources: state => wolfxSocketSources.filter(source => state.sourceRoutes[source]?.wolfx),
        activeLipoSources: state => lipoSocketSources.filter(source => state.sourceRoutes[source]?.lipo),
        activeP2pquakeSources: state => p2pquakeSocketSources.filter(source => state.sourceRoutes[source]?.p2pquake),
        activeEqlistSources: state => eqlistSources.filter(source => state.enabledSource.includes(source)),
    },
    actions: {
        setLocalStorageItem(key, value) {
            if(this.isResettingApp) return
            localStorage.setItem(key, value)
        },
        configureDataSources(routes) {
            this.sourceRoutes = Object.fromEntries(
                Object.entries(routes).map(([source, apis]) => [source, { ...apis }])
            )
            this.enabledSource = Object.entries(this.sourceRoutes)
                .filter(([, apis]) => Object.values(apis).some(Boolean))
                .map(([source]) => source)
            this.usgsHttpRequestId++
            for(const provider of ['lipo', 'usgs']) {
                if(!this.isApiEnabled('usgsEqlist', provider)) this.usgsHistoryCache[provider].clear()
            }
            this.rebuildUsgsHistory(true)
        },
        isApiEnabled(source, api) {
            return Boolean(this.sourceRoutes[source]?.[api])
        },
        trackWebSocketStatus(source, socket) {
            socket.setStateHandler((readyState, urlIndex) => {
                Object.assign(this.webSocketStatus[source], { readyState, urlIndex })
            })
        },
        setUsgsEqMessage(data, provider, type) {
            const event = normalizeUsgsEvent(data, provider)
            if(!event) return
            // Single updates extend the provider's latest full snapshot; they never delete IDs.
            const events = this.usgsHistoryCache[provider]
            const previous = events.get(event.id)
            if(!previous || event.versionTime >= previous.versionTime) {
                events.set(event.id, event)
                this.rebuildUsgsHistory()
            }
            const cached = this.usgsRealtimeCache.get(event.id)
            if(cached && event.versionTime <= cached.timestamp) return
            const hash = hashUsgsContent(event)
            this.usgsRealtimeCache.set(event.id, { hash, timestamp: event.versionTime })
            // Advance the watermark for metadata-only changes without refreshing the report time.
            if(cached?.hash === hash) return
            Object.assign(this.eqMessage.usgsEqlist, createUsgsMessage(event), { type })
        },
        replaceUsgsHistory(data, provider) {
            if(!Array.isArray(data)) return
            const events = data.map(item => normalizeUsgsEvent(item, provider)).filter(Boolean)
            if(data.length > 0 && events.length === 0) return
            const previous = this.usgsHistoryCache[provider]
            const next = new Map()
            for(const event of events) {
                const existing = next.get(event.id) || previous.get(event.id)
                next.set(event.id, existing && existing.versionTime > event.versionTime ? existing : event)
            }
            this.usgsHistoryCache[provider] = next
            // History updates do not seed or advance realtime content hashes.
            this.rebuildUsgsHistory(true)
        },
        rebuildUsgsHistory(prune = false) {
            const merged = new Map()
            // Official GeoJSON wins a tie, independently of realtime's equal-time rejection.
            for(const provider of ['lipo', 'usgs']) {
                if(!this.isApiEnabled('usgsEqlist', provider)) continue
                for(const [id, event] of this.usgsHistoryCache[provider]) {
                    const existing = merged.get(id)
                    if(!existing || event.versionTime >= existing.versionTime) merged.set(id, event)
                }
            }
            this.history.usgsEqlist = [...merged.values()]
                .sort((a, b) => b.originTimeStamp - a.originTimeStamp || b.id.localeCompare(a.id))
                .map(event => {
                    const message = createUsgsMessage(event)
                    return {
                        ...message, source: 'USGS', depth: event.depth, magnitude: event.magnitude,
                        hypocenter: (event.reviewType.toLowerCase() === 'reviewed' ? '' : '(A)') + message.hypocenter,
                    }
                })
            if(prune) {
                for(const id of this.usgsRealtimeCache.keys()) {
                    if(!merged.has(id)) this.usgsRealtimeCache.delete(id)
                }
            }
        },
        async fetchUsgsReports(stamp = Date.now()) {
            const requestId = ++this.usgsHttpRequestId
            const data = await Http.get(eqUrls.usgsEqlist_http + `?time=${stamp}`)
            if(requestId !== this.usgsHttpRequestId || !this.isApiEnabled('usgsEqlist', 'usgs') || !Array.isArray(data?.features)) return
            if(data.features.length > 0) this.setEqMessage('usgsEqlist', data.features[0], 'usgs')
            this.setHistory('usgsEqlist', data.features, 'usgs')
        },
        setEqMessage(source, data, provider) {
            try{
                const type = getSourceType(source, provider)
                if(type === undefined || !Object.hasOwn(this.eqMessage, source)) {
                    console.warn('Unknown earthquake source/provider:', source, provider)
                    return
                }
                // Rejected USGS messages must not mutate even the displayed provider/type.
                if(source === 'usgsEqlist') {
                    this.setUsgsEqMessage(data, provider, type)
                    return
                }
                if(provider === 'lipo' && lipoSourceTypes[source]) {
                    data = {
                        ...data,
                        epicenter: data.epicenter || '',
                        originTime: data.originTime || '',
                        reportTime: data.reportTime || '',
                        latitude: data.latitude ?? null,
                        longitude: data.longitude ?? null,
                    }
                }
                const eqMessage = { ...this.eqMessage[source] }
                switch(source){
                    case 'jmaEew':{
                        eqMessage.isEew = true
                        eqMessage.timeZone = 9
                        eqMessage.useShindo = true
                        eqMessage.intTitle = '推定最大震度'
                        switch(provider) {
                            case 'wolfx': {
                                const trainingText = data.isTraining ? '訓練·' : ''
                                eqMessage.id = data.EventID
                                eqMessage.isCanceled = data.isCancel
                                eqMessage.reportNum = data.Serial
                                eqMessage.reportTime = data.AnnouncedTime.replace(/\//g, '-')
                                eqMessage.isAssumption = data.isAssumption
                                eqMessage.isWarn = data.isWarn
                                eqMessage.isFinal = data.isFinal
                                eqMessage.title = trainingText + data.Title
                                eqMessage.lat = data.Latitude
                                eqMessage.lng = data.Longitude
                                eqMessage.depth = data.Depth
                                eqMessage.depthText = '深さ: ' + data.Depth + 'km'
                                eqMessage.originTime = data.OriginTime.replace(/\//g, '-')
                                eqMessage.originTimeText = '発震時刻: ' + data.OriginTime.replace(/\//g, '-') + ' (JST)'
                                eqMessage.magnitude = data.Magunitude
                                eqMessage.magnitudeText = 'マグニチュード: ' + data.Magunitude.toFixed(1)
                                eqMessage.maxIntensity = data.MaxIntensity
                                if(data.isCancel){
                                    eqMessage.reportNumText = 'キャンセル報'
                                    eqMessage.titleText = trainingText + '緊急地震速報（取消）'
                                    eqMessage.hypocenter = trainingText + '取り消されました'
                                    eqMessage.maxIntensityText = '推定最大震度: なし'
                                    eqMessage.warnArea = '[]'
                                }
                                else{
                                    eqMessage.reportNumText = '第' + data.Serial + '報' + (data.isFinal ? '（最終）' : '')
                                    eqMessage.titleText = trainingText + data.Title
                                    eqMessage.hypocenter = trainingText + data.Hypocenter
                                    eqMessage.maxIntensityText = '推定最大震度: ' + data.MaxIntensity
                                    eqMessage.warnArea = JSON.stringify(data.WarnArea.map(item=>{
                                        return {
                                            name: item.Chiiki,
                                            intensity: item.Shindo1,
                                            className: setClassName(item.Shindo1, true)
                                        }
                                    }))
                                }
                                eqMessage.hypocenterText = '震源地: ' + eqMessage.hypocenter
                                break
                            }
                            case 'lipo': {
                                const infoTypeName = data.isWarn === true ? '警報' : data.isWarn === false ? '予報' : '不明'
                                const trainingText = data.isTraining ? '訓練·' : ''
                                eqMessage.id = data.eventId
                                eqMessage.isCanceled = Boolean(data.isCanceled)
                                eqMessage.reportNum = data.reportNum
                                eqMessage.reportTime = data.reportTime || data.originTime || ''
                                eqMessage.isAssumption = false
                                eqMessage.isWarn = infoTypeName == '警報'
                                eqMessage.isFinal = Boolean(data.isFinal)
                                eqMessage.title = trainingText + `緊急地震速報（${infoTypeName}）`
                                eqMessage.lat = data.latitude ?? null
                                eqMessage.lng = data.longitude ?? null
                                eqMessage.depth = data.depth ?? -1
                                eqMessage.depthText = '深さ: ' + (data.depth == null ? '不明' : data.depth + 'km')
                                eqMessage.originTime = data.originTime || ''
                                eqMessage.originTimeText = '発震時刻: ' + eqMessage.originTime + ' (JST)'
                                eqMessage.magnitude = data.magnitude ?? -1
                                eqMessage.magnitudeText = 'マグニチュード: ' + formatLipoNumber(data.magnitude, 1)
                                eqMessage.maxIntensity = data.maxIntensity || '不明'
                                if(data.isCanceled){
                                    eqMessage.reportNumText = 'キャンセル報'
                                    eqMessage.titleText = trainingText + '緊急地震速報（取消）'
                                    eqMessage.hypocenter = trainingText + '取り消されました'
                                    eqMessage.maxIntensityText = '推定最大震度: なし'
                                }
                                else{
                                    eqMessage.reportNumText = '第' + data.reportNum + '報' + (data.isFinal ? '（最終）' : '')
                                    eqMessage.titleText = trainingText + `緊急地震速報（${infoTypeName}）`
                                    eqMessage.hypocenter = trainingText + (data.epicenter || '不明')
                                    eqMessage.maxIntensityText = '推定最大震度: ' + eqMessage.maxIntensity
                                }
                                eqMessage.hypocenterText = '震源地: ' + eqMessage.hypocenter
                                eqMessage.warnArea = '[]'
                                break
                            }
                        }
                        break
                    }
                    case 'cwaEew':{
                        eqMessage.isEew = true
                        eqMessage.useShindo = true
                        eqMessage.intTitle = '預估最大震度'
                        switch(provider) {
                            case 'wolfx':
                                eqMessage.id = data.ID
                                eqMessage.reportNum = data.ReportNum
                                eqMessage.reportNumText = '第' + data.ReportNum + '報'
                                eqMessage.reportTime = data.ReportTime
                                eqMessage.isCanceled = data.isCancel
                                eqMessage.titleText = '中央氣象署強震即時警報' + (data.isCancel?'（取消）':'')
                                eqMessage.hypocenter = data.HypoCenter
                                eqMessage.hypocenterText = '震央: ' + data.HypoCenter
                                eqMessage.lat = data.Latitude
                                eqMessage.lng = data.Longitude
                                eqMessage.depth = data.Depth
                                eqMessage.depthText = '深度: ' + data.Depth + 'km'
                                eqMessage.originTime = data.OriginTime
                                eqMessage.originTimeText = '時間: ' + data.OriginTime
                                eqMessage.magnitude = data.Magunitude
                                eqMessage.magnitudeText = '規模: ' + data.Magunitude.toFixed(1)
                                eqMessage.maxIntensity = data.MaxIntensity || '不明'
                                eqMessage.maxIntensityText = '預估最大震度: ' + eqMessage.maxIntensity
                                eqMessage.isWarn = getShindoRank(eqMessage.maxIntensity) >= 5
                                break
                        }
                        break
                    }
                    case 'ceaEew':{
                        switch(provider) {
                            case 'wolfx':
                                eqMessage.id = data.EventID
                                eqMessage.isEew = true
                                eqMessage.reportNum = data.ReportNum
                                eqMessage.reportNumText = '第' + data.ReportNum + '报'
                                eqMessage.reportTime = data.ReportTime || data.OriginTime
                                eqMessage.titleText = '中国地震局地震预警'
                                eqMessage.hypocenter = data.HypoCenter
                                eqMessage.hypocenterText = '震中: ' + data.HypoCenter
                                eqMessage.lat = data.Latitude
                                eqMessage.lng = data.Longitude
                                eqMessage.depth = data.Depth ?? 10
                                eqMessage.depthText = '深度: ' + (data.Depth == null ? '不明' : data.Depth + 'km')
                                eqMessage.originTime = data.OriginTime
                                eqMessage.originTimeText = '发震时间: ' + eqMessage.originTime
                                eqMessage.magnitude = data.Magnitude
                                eqMessage.magnitudeText = '震级: ' + eqMessage.magnitude.toFixed(1)
                                eqMessage.maxIntensity = data.MaxIntensity ? data.MaxIntensity.toFixed(0) : calcCsisLevel(eqMessage.magnitude, eqMessage.depth, 0)
                                eqMessage.maxIntensityText = '预估最大烈度: ' + eqMessage.maxIntensity
                                eqMessage.isWarn = Number(eqMessage.maxIntensity) >= 6.5
                                break
                            case 'lipo':
                                eqMessage.id = data.eventId
                                eqMessage.isEew = true
                                eqMessage.reportNum = data.reportNum
                                eqMessage.reportNumText = '第' + data.reportNum + '报'
                                eqMessage.reportTime = data.originTime
                                eqMessage.titleText = '中国地震局地震预警'
                                eqMessage.hypocenter = data.epicenter
                                eqMessage.hypocenterText = '震中: ' + data.epicenter
                                eqMessage.lat = data.latitude
                                eqMessage.lng = data.longitude
                                eqMessage.depth = data.depth ?? 10
                                eqMessage.depthText = '深度: ' + (data.depth == null ? '不明' : data.depth + 'km')
                                eqMessage.originTime = data.originTime
                                eqMessage.originTimeText = '发震时间: ' + eqMessage.originTime
                                eqMessage.magnitude = data.magnitude ?? -1
                                eqMessage.magnitudeText = '震级: ' + formatLipoNumber(data.magnitude, 1)
                                eqMessage.maxIntensity = data.maxIntensity ? data.maxIntensity.toFixed(0) : calcCsisLevel(eqMessage.magnitude, eqMessage.depth, 0)
                                eqMessage.maxIntensityText = '预估最大烈度: ' + eqMessage.maxIntensity
                                eqMessage.isWarn = Number(eqMessage.maxIntensity) >= 6.5
                                break
                        }
                        break
                    }
                    case 'iclEew':{
                        switch(provider) {
                            case 'lipo':
                                eqMessage.id = data.eventId
                                eqMessage.isEew = true
                                eqMessage.reportNum = data.reportNum
                                eqMessage.reportNumText = '第' + data.reportNum + '报'
                                eqMessage.reportTime = data.reportTime
                                eqMessage.titleText = '成都高新减灾研究所地震预警'
                                eqMessage.hypocenter = data.epicenter
                                eqMessage.hypocenterText = '震中: ' + data.epicenter
                                eqMessage.lat = data.latitude
                                eqMessage.lng = data.longitude
                                eqMessage.depth = data.depth || 10
                                eqMessage.depthText = '深度: ' + (data.depth ? data.depth.toFixed(0) + 'km' : '不明')
                                eqMessage.originTime = data.originTime
                                eqMessage.originTimeText = '发震时间: ' + eqMessage.originTime
                                eqMessage.magnitude = data.magnitude ?? -1
                                eqMessage.magnitudeText = '震级: ' + formatLipoNumber(data.magnitude, 1)
                                eqMessage.maxIntensity = data.maxIntensity ? data.maxIntensity.toFixed(0) : calcCsisLevel(eqMessage.magnitude, eqMessage.depth, 0)
                                eqMessage.maxIntensityText = '预估最大烈度: ' + eqMessage.maxIntensity
                                eqMessage.isWarn = Number(eqMessage.maxIntensity) >= 6.5
                                break
                        }
                        break
                    }
                    case 'kmaEew': {
                        eqMessage.id = data.eventId
                        eqMessage.timeZone = 9
                        eqMessage.isEew = true
                        eqMessage.intTitle = '최대예상진도'
                        eqMessage.reportNum = data.reportNum || 1
                        eqMessage.reportNumText = '제' + eqMessage.reportNum + '보'
                        eqMessage.reportTime = data.reportTime
                        eqMessage.titleText = '기상청 지진 조기 경보'
                        eqMessage.hypocenter = data.epicenter
                        eqMessage.hypocenterText = '위치: ' + data.epicenter
                        eqMessage.lat = data.latitude
                        eqMessage.lng = data.longitude
                        eqMessage.depth = data.depth || 10
                        eqMessage.depthText = '깊이: ' + (data.depth ? data.depth + 'km' : '불명')
                        eqMessage.originTime = data.originTime
                        eqMessage.originTimeText = '발생시각: ' + eqMessage.originTime
                        eqMessage.magnitude = data.magnitude ?? -1
                        eqMessage.magnitudeText = '규모: ' + formatLipoNumber(data.magnitude, 1, '불명')
                        eqMessage.maxIntensity = formatLipoNumber(data.maxIntensity, 0, '')
                        eqMessage.maxIntensityText = '최대예상진도: ' + eqMessage.maxIntensity
                        eqMessage.isWarn = Number(eqMessage.maxIntensity) >= 6.5
                        break
                    }
                    case 'gqEew':{
                        const isNewEvent = eqMessage.id != data.Id
                        eqMessage.id = data.Id
                        eqMessage.isEew = true
                        eqMessage.timeZone = systemTimeZone
                        eqMessage.isCanceled = data.RevisionId < 0
                        eqMessage.quality = data.Quality?.QualityLevel
                            ?? (eqMessage.isCanceled && !isNewEvent ? eqMessage.quality : 9)
                        if(!eqMessage.isCanceled || isNewEvent) {
                            eqMessage.reportNum = eqMessage.isCanceled ? Infinity : data.RevisionId
                            eqMessage.titleText = 'GlobalQuake地震预警'
                            eqMessage.lat = data.Latitude
                            eqMessage.lng = data.Longitude
                            eqMessage.depth = data.Depth
                            eqMessage.depthText = '深度: ' + (eqMessage.depth == null ? '不明' : eqMessage.depth.toFixed(0) + 'km')
                            eqMessage.originTime = stampToTime(new Date(data.OriginTime).getTime(), systemTimeZone)
                            eqMessage.originTimeText = '发震时间: ' + eqMessage.originTime
                            eqMessage.magnitude = data.Magnitude
                            eqMessage.magnitudeText = '震级: ' + (eqMessage.magnitude == null ? '不明' : eqMessage.magnitude.toFixed(1))
                            eqMessage.maxIntensity = calcCsisLevel(eqMessage.magnitude, eqMessage.depth, 0)
                            eqMessage.isWarn = Number(eqMessage.maxIntensity) >= 7.5
                        }
                        if(eqMessage.isCanceled) {
                            eqMessage.reportTime = stampToTime(Date.now(), systemTimeZone)
                            eqMessage.reportNumText = '取消报'
                            eqMessage.hypocenter = '已取消'
                            eqMessage.hypocenterText = '震中: 已取消'
                            eqMessage.maxIntensityText = '预估最大烈度: 无'
                        }
                        else{
                            eqMessage.reportTime = stampToTime(new Date(data.LastUpdatedTime).getTime(), systemTimeZone)
                            eqMessage.reportNumText = '第' + data.RevisionId + '报'
                            eqMessage.hypocenter = getFEName(data.Latitude, data.Longitude) || data.Region || '未知区域'
                            eqMessage.hypocenterText = '震中: ' + eqMessage.hypocenter
                            eqMessage.maxIntensityText = '预估最大烈度: ' + eqMessage.maxIntensity
                        }
                        break
                    }
                    case 'mockEew': {
                        Object.assign(eqMessage, data)
                        break
                    }
                    case 'jmaEqlist':{
                        const isNewEvent = eqMessage.id != data.earthquake.time.replace(/\//g, '-')
                        eqMessage.timeZone = 9
                        eqMessage.id = data.earthquake.time.replace(/\//g, '-')
                        eqMessage.useShindo = true
                        eqMessage.originTime = data.earthquake.time.replace(/\//g, '-')
                        eqMessage.originTimeText = '検知時刻: ' + data.earthquake.time.replace(/\//g, '-') + ' (JST)'
                        eqMessage.reportTime = data.issue.time.replace(/\//g, '-')
                        switch(data.issue.type) {
                            case 'ScalePrompt':
                                eqMessage.title = '震度速報'
                                eqMessage.titleText = '震度速報'
                                eqMessage.maxIntensity = getShindoFromInstShindo(data.earthquake.maxScale / 10, false)
                                eqMessage.maxIntensityText = '最大震度: ' + eqMessage.maxIntensity
                                eqMessage.warnArea = JSON.stringify(data.points.map(point => {
                                    const name = point.isArea ? point.addr : jmaSeisIntLoc[point.addr]?.sect
                                    const intensity = getShindoFromInstShindo(point.scale / 10, false)
                                    const className = setClassName(intensity, true)
                                    return {
                                        name,
                                        intensity,
                                        className
                                    }
                                }))
                                if(isNewEvent){
                                    eqMessage.hypocenter = ''
                                    eqMessage.hypocenterText = '震源地: 調査中'
                                    eqMessage.lat = null
                                    eqMessage.lng = null
                                    eqMessage.depth = -1
                                    eqMessage.depthText = '深さ: 調査中'
                                    eqMessage.magnitude = -1
                                    eqMessage.magnitudeText = 'マグニチュード: 調査中'
                                }
                                break
                            case 'Destination':
                                eqMessage.title = '震源に関する情報'
                                eqMessage.titleText = '震源に関する情報'
                                eqMessage.hypocenter = data.earthquake.hypocenter.name
                                eqMessage.hypocenterText = '震源地: ' + eqMessage.hypocenter
                                eqMessage.lat = data.earthquake.hypocenter.latitude
                                eqMessage.lng = data.earthquake.hypocenter.longitude
                                eqMessage.depth = data.earthquake.hypocenter.depth
                                eqMessage.depthText = '深さ: ' + (eqMessage.depth == 0 ? 'ごく浅い' : eqMessage.depth + 'km')
                                eqMessage.magnitude = data.earthquake.hypocenter.magnitude
                                eqMessage.magnitudeText = 'マグニチュード: ' + eqMessage.magnitude.toFixed(1)
                                if(isNewEvent){
                                    eqMessage.maxIntensity = '不明'
                                    eqMessage.maxIntensityText = '最大震度: 不明'
                                    eqMessage.warnArea = JSON.stringify(data.points.map(point => {
                                        const name = point.isArea ? point.addr : jmaSeisIntLoc[point.addr]?.sect
                                        const intensity = getShindoFromInstShindo(point.scale / 10, false)
                                        const className = setClassName(intensity, true)
                                        return {
                                            name,
                                            intensity,
                                            className
                                        }
                                    }))
                                }
                                break
                            default:
                                switch(data.issue.type) {
                                    case 'ScaleAndDestination':
                                        eqMessage.title = '震度・震源に関する情報'
                                        eqMessage.titleText = '震度・震源に関する情報'
                                        break
                                    case 'DetailScale':
                                        eqMessage.title = '各地の震度に関する情報'
                                        eqMessage.titleText = '各地の震度に関する情報'
                                        break
                                    case 'Foreign':
                                        eqMessage.title = '遠地地震に関する情報'
                                        eqMessage.titleText = '遠地地震に関する情報'
                                        break
                                    case 'Other':
                                        eqMessage.title = 'その他の情報'
                                        eqMessage.titleText = 'その他の情報'
                                        break
                                }
                                eqMessage.hypocenter = data.earthquake.hypocenter.name
                                eqMessage.hypocenterText = '震源地: ' + eqMessage.hypocenter
                                eqMessage.lat = data.earthquake.hypocenter.latitude
                                eqMessage.lng = data.earthquake.hypocenter.longitude
                                eqMessage.depth = data.earthquake.hypocenter.depth
                                eqMessage.depthText = '深さ: ' + (eqMessage.depth == -1 ? '不明' : eqMessage.depth == 0 ? 'ごく浅い' : eqMessage.depth + 'km')
                                eqMessage.magnitude = data.earthquake.hypocenter.magnitude
                                eqMessage.magnitudeText = 'マグニチュード: ' + (eqMessage.magnitude == -1 ? '不明' : eqMessage.magnitude.toFixed(1))
                                eqMessage.maxIntensity = data.earthquake.maxScale == -1 ? '不明' : getShindoFromInstShindo(data.earthquake.maxScale / 10, false)
                                eqMessage.maxIntensityText = '最大震度: ' + eqMessage.maxIntensity
                                eqMessage.warnArea = JSON.stringify(data.points.map(point => {
                                    const name = point.isArea ? point.addr : jmaSeisIntLoc[point.addr]?.sect
                                    const intensity = getShindoFromInstShindo(point.scale / 10, false)
                                    const className = setClassName(intensity, true)
                                    return {
                                        name,
                                        intensity,
                                        className
                                    }
                                }))
                                break
                        }
                        break
                    }
                    case 'cwaEqlist':{
                        eqMessage.useShindo = true
                        eqMessage.titleText = '中央氣象署地震報告'
                        switch(provider) {
                            case 'lipo': {
                                eqMessage.id = data.eventId
                                eqMessage.reportTime = data.reportTime || data.originTime
                                const placeName = data.epicenter || ''
                                const start = placeName.indexOf('(位於')
                                const end = placeName.indexOf(')')
                                eqMessage.hypocenter = start == -1 || end == -1 || start + 3 >= end ? placeName : placeName.slice(start + 3, end)
                                eqMessage.hypocenterText = '震央: ' + eqMessage.hypocenter
                                eqMessage.lat = data.latitude
                                eqMessage.lng = data.longitude
                                eqMessage.depth = data.depth ?? -1
                                eqMessage.depthText = '深度: ' + formatLipoNumber(data.depth, 0) + 'km'
                                eqMessage.originTime = data.originTime
                                eqMessage.originTimeText = '時間: ' + eqMessage.originTime
                                eqMessage.magnitude = data.magnitude ?? -1
                                eqMessage.magnitudeText = '規模: ' + formatLipoNumber(data.magnitude, 1)
                                eqMessage.maxIntensity = data.maxIntensity?.replace('級', '') || '不明'
                                eqMessage.maxIntensityText = '最大震度: ' + eqMessage.maxIntensity
                                break
                            }
                        }
                        break
                    }
                    case 'cencEqlist':{
                        switch(provider) {
                            case 'wolfx':
                                if(calcTimeDiff(data.No1.ReportTime, 8, eqMessage.reportTime, 8) < 30000)
                                    return
                                eqMessage.id = data.No1.EventID
                                eqMessage.reportTime = data.No1.ReportTime
                                eqMessage.reviewType = data.No1.type
                                eqMessage.title = `中国地震台网${eqMessage.reviewType === 'reviewed' ? '正式' : '自动'}测定`
                                eqMessage.titleText = eqMessage.title
                                eqMessage.hypocenter = data.No1.placeName
                                eqMessage.hypocenterText = '震中: ' + data.No1.placeName
                                eqMessage.lat = Number(data.No1.latitude)
                                eqMessage.lng = Number(data.No1.longitude)
                                eqMessage.depth = Number(data.No1.depth)
                                eqMessage.depthText = '深度: ' + data.No1.depth + 'km'
                                eqMessage.originTime = data.No1.time
                                eqMessage.originTimeText = '发震时间: ' + data.No1.time
                                eqMessage.magnitude = Number(data.No1.magnitude)
                                eqMessage.magnitudeText = '震级: ' + data.No1.magnitude
                                eqMessage.maxIntensity = calcCsisLevel(eqMessage.magnitude, eqMessage.depth, 0)
                                eqMessage.maxIntensityText = '预估最大烈度: ' + eqMessage.maxIntensity
                                break
                            case 'lipo':
                                if(calcTimeDiff((data.reportTime || data.originTime), 8, eqMessage.reportTime, 8) < 30000)
                                    return
                                eqMessage.id = data.eventId
                                eqMessage.reportTime = (data.reportTime || data.originTime)
                                eqMessage.reviewType = data.reviewType
                                eqMessage.title = `中国地震台网${eqMessage.reviewType === 'reviewed' ? '正式' : '自动'}测定`
                                eqMessage.titleText = eqMessage.title
                                eqMessage.hypocenter = data.epicenter
                                eqMessage.hypocenterText = '震中: ' + data.epicenter
                                eqMessage.lat = data.latitude
                                eqMessage.lng = data.longitude
                                eqMessage.depth = data.depth ?? -1
                                eqMessage.depthText = '深度: ' + (data.depth == null ? '不明' : data.depth + 'km')
                                eqMessage.originTime = data.originTime
                                eqMessage.originTimeText = '发震时间: ' + data.originTime
                                eqMessage.magnitude = data.magnitude ?? -1
                                eqMessage.magnitudeText = '震级: ' + formatLipoNumber(data.magnitude, 1)
                                eqMessage.maxIntensity = calcCsisLevel(eqMessage.magnitude, eqMessage.depth, 0)
                                eqMessage.maxIntensityText = '预估最大烈度: ' + eqMessage.maxIntensity
                                break
                        }
                        break
                    }
                    case 'kmaEqlist':{
                        eqMessage.timeZone = 9
                        eqMessage.intTitle = '최대진도'
                        eqMessage.id = data.eventId
                        eqMessage.reportTime = data.reportTime
                        eqMessage.title = '기상청 지진 정보'
                        eqMessage.titleText = eqMessage.title
                        eqMessage.hypocenter = data.epicenter
                        eqMessage.hypocenterText = '위치: ' + data.epicenter
                        eqMessage.lat = data.latitude
                        eqMessage.lng = data.longitude
                        eqMessage.depth = data.depth ?? 10
                        eqMessage.depthText = '깊이: ' + (data.depth != null ? data.depth + 'km' : '불명')
                        eqMessage.originTime = data.originTime
                        eqMessage.originTimeText = '발생시각: ' + eqMessage.originTime
                        eqMessage.magnitude = data.magnitude ?? -1
                        eqMessage.magnitudeText = '규모: ' + formatLipoNumber(data.magnitude, 1, '불명')
                        eqMessage.maxIntensity = formatLipoNumber(data.maxIntensity, 0, '')
                        eqMessage.maxIntensityText = '최대진도: ' + eqMessage.maxIntensity
                        break
                    }
                }
                eqMessage.className = setClassName(eqMessage.maxIntensity, eqMessage.useShindo, eqMessage.isCanceled)
                Object.assign(this.eqMessage[source], eqMessage, { source, type })
            } catch(err) {
                console.log(err);
            }
        },
        setTsunamiMessage(source, data) {
            try{
                const tsunamiMessage = this.tsunamiMessage[source]
                tsunamiMessage.source = source
                switch(source){
                    case 'jmaTsunami': {
                        const reportTime = data.issue.time.replace(/\//g, '-')
                        if(!tsunamiMessage.reportTime || calcTimeDiff(reportTime, 9, tsunamiMessage.reportTime, 9) > 0) {
                            tsunamiMessage.id = data.issue.time.replace(/[^0-9]/g, '')
                            tsunamiMessage.timeZone = 9
                            tsunamiMessage.reportTime = reportTime
                            if(data.cancelled) {
                                tsunamiMessage.title = '津波警報・注意報なし'
                                tsunamiMessage.titleText = '津波警報・注意報なし'
                                tsunamiMessage.status = 0
                                tsunamiMessage.className = 'gray'
                            }
                            else {
                                switch(data.areas[0].grade) {
                                    case 'Watch':
                                        tsunamiMessage.title = '津波注意報'
                                        tsunamiMessage.titleText = '津波注意報発表中'
                                        tsunamiMessage.status = 1
                                        tsunamiMessage.className = 'yellow'
                                        break
                                    case 'Warning':
                                        tsunamiMessage.title = '津波警報'
                                        tsunamiMessage.titleText = '津波警報発表中'
                                        tsunamiMessage.status = 2
                                        tsunamiMessage.className = 'red'
                                        break
                                    case 'MajorWarning':
                                        tsunamiMessage.title = '大津波警報'
                                        tsunamiMessage.titleText = '大津波警報発表中'
                                        tsunamiMessage.status = 3
                                        tsunamiMessage.className = 'purple'
                                        break
                                }    
                            }
                            tsunamiMessage.warnArea = JSON.stringify(data.areas.map(item => {
                                let className = 'gray'
                                switch(item.grade) {
                                    case 'Watch':
                                        className = 'yellow'
                                        break
                                    case 'Warning':
                                        className = 'red'
                                        break
                                    case 'MajorWarning':
                                        className = 'purple'
                                        break
                                }
                                return {
                                    name: item.name,
                                    grade: item.grade,
                                    height: item.maxHeight?.value,
                                    description: item.maxHeight.description,
                                    arrivalTime: item.firstHeight?.arrivalTime,
                                    condition: item.firstHeight?.condition,
                                    className
                                }
                            }))
                        }
                        this.isActive.jmaTsunami = !!tsunamiMessage.status
                        break
                    }
                    case 'nmefcTsunami': {
                        const reportTime = data.timeInfo.issueTime
                        if(!reportTime) break
                        if(!tsunamiMessage.reportTime || calcTimeDiff(reportTime, 8, tsunamiMessage.reportTime, 8) > 0) {
                            tsunamiMessage.id = data.reportId
                            tsunamiMessage.reportTime = reportTime
                            switch(data.warningInfo.level) {
                                case '黄色':
                                    tsunamiMessage.title = '海啸注意报'
                                    tsunamiMessage.titleText = '现正发布海啸注意报'
                                    tsunamiMessage.status = 1
                                    tsunamiMessage.className = 'yellow'
                                    break
                                case '橙色':
                                    tsunamiMessage.title = '海啸警报'
                                    tsunamiMessage.titleText = '现正发布海啸警报'
                                    tsunamiMessage.status = 2
                                    tsunamiMessage.className = 'red'
                                    break
                                case '红色':
                                    tsunamiMessage.title = '大海啸警报'
                                    tsunamiMessage.titleText = '现正发布大海啸警报'
                                    tsunamiMessage.status = 3
                                    tsunamiMessage.className = 'purple'
                                    break
                                default:
                                    tsunamiMessage.title = '海啸预警已解除'
                                    tsunamiMessage.titleText = '海啸预警已解除'
                                    tsunamiMessage.status = 0
                                    tsunamiMessage.className = 'gray'
                                    break
                            }    
                            tsunamiMessage.warnArea = JSON.stringify(data.forecasts.map(item => {
                                let className = 'gray'
                                let height = 0
                                let description = ''
                                switch(item.warningLevel) {
                                    case '黄色':
                                        className = 'yellow'
                                        height = 1
                                        description = '1m'
                                        break
                                    case '橙色':
                                        className = 'red'
                                        height = 3
                                        description = '3m'
                                        break
                                    case '红色':
                                        className = 'purple'
                                        height = 5
                                        description = '3m超'
                                        break
                                }
                                return {
                                    name: item.forecastArea,
                                    grade: item.warningLevel,
                                    height,
                                    description,
                                    arrivalTime: item.estimatedArrivalTime,
                                    className
                                }
                            }))
                        }
                        this.isActive.nmefcTsunami = !!tsunamiMessage.status
                        break
                    }
                }
            } catch(err) {
                console.log(err);
            }
        },
        setHistory(source, data, api = '') {
            if(source === 'usgsEqlist') {
                this.replaceUsgsHistory(data, api === 'lipo' ? 'lipo' : 'usgs')
                return
            }
            const list = []
            let keys
            switch (source) {
                case 'jmaEqlist':
                    keys = Object.keys(data).filter(key => /^No\d+$/.test(key))
                    break
                case 'cencEqlist':
                    keys = api == 'lipo' ? Object.keys(data) : Object.keys(data).filter(key => /^No\d+$/.test(key))
                    break
                default:
                    keys = Object.keys(data)
                    break
            }
            for (let i = 0; i < keys.length; i++) {
                switch (source) {
                    case 'jmaEqlist': {
                        const item = data[keys[i]]
                        const id = item.EventID
                        const originTime = convertCompactTimeString(id) || item.time_full.replace(/\//g, '-')
                        list[i] = {
                            source: 'JMA',
                            id,
                            timeZone: 9,
                            useShindo: true,
                            originTime,
                            lat: Number(item.latitude),
                            lng: Number(item.longitude),
                            hypocenter: item.location,
                            depth: Number(item.depth.replace('km', '')),
                            magnitude: Number(item.magnitude) || 0,
                            maxIntensity: item.shindo,
                            className: setClassName(item.shindo, true),
                            url: `https://typhoon.yahoo.co.jp/weather/jp/earthquake/${id}.html`
                        }
                        break
                    }
                    case 'cwaEqlist': {
                        const placeName = data[i].epicenter || ''
                        const locStart = placeName.indexOf('(位於')
                        const locEnd = placeName.indexOf(')')
                        const hypocenter = locStart == -1 || locEnd == -1 || locStart + 3 >= locEnd ? placeName : placeName.slice(locStart + 3, locEnd)
                        const maxIntensity = formatShindo(data[i].maxIntensity)
                        list[i] = {
                            source: 'CWA',
                            id: data[i].eventId,
                            timeZone: 8,
                            useShindo: true,
                            originTime: data[i].originTime,
                            lat: data[i].latitude ?? null,
                            lng: data[i].longitude ?? null,
                            hypocenter,
                            depth: data[i].depth ?? -1,
                            magnitude: data[i].magnitude ?? -1,
                            maxIntensity,
                            className: setClassName(maxIntensity, true),
                            url: data[i].url
                        }
                        break
                    }
                    case 'cencEqlist': {
                        const item = data[keys[i]]
                        const isLipo = api == 'lipo'
                        const originTime = isLipo ? item.originTime : item.time
                        const reviewType = isLipo ? item.reviewType : item.type
                        const isReviewed = reviewType === 'reviewed'
                        const depth = isLipo ? item.depth ?? -1 : Number(item.depth)
                        const magnitude = isLipo ? item.magnitude ?? -1 : Number(item.magnitude)
                        const maxIntensity = calcCsisLevel(magnitude, depth)
                        const intReportId = originTime.replace(/[^\d]/g, '')
                        list[i] = {
                            source: 'CENC',
                            id: isLipo ? item.eventId : item.EventID,
                            reviewType,
                            timeZone: 8,
                            useShindo: false,
                            originTime,
                            lat: isLipo ? item.latitude ?? null : Number(item.latitude),
                            lng: isLipo ? item.longitude ?? null : Number(item.longitude),
                            hypocenter: (isReviewed ? '' : '(A)') + (isLipo ? item.epicenter || '' : item.placeName),
                            depth,
                            magnitude,
                            maxIntensity,
                            className: setClassName(maxIntensity, false),
                            url: 'https://www.ceic.ac.cn/',
                            intReportId: this.intReportIds.has(intReportId) ? intReportId : null
                        }
                        break
                    }
                    case 'kmaEqlist': {
                        const item = data[i]
                        const maxIntensity = Number.isFinite(item.maxIntensity) ? String(item.maxIntensity) : ''
                        list[i] = {
                            source: 'KMA',
                            id: item.eventId,
                            timeZone: 9,
                            useShindo: false,
                            intTitle: '최대진도',
                            originTime: item.originTime,
                            lat: item.latitude ?? null,
                            lng: item.longitude ?? null,
                            hypocenter: item.epicenter || '',
                            depth: item.depth ?? null,
                            magnitude: item.magnitude ?? null,
                            maxIntensity,
                            maxIntensityText: '최대진도: ' + maxIntensity,
                            className: setClassName(maxIntensity, false),
                            url: item.url || '',
                        }
                        break
                    }
                }
            }
            if(source == 'cencEqlist') {
                const cacheKey = api == 'lipo' ? 'lipo' : 'wolfx'
                this.cencHistoryCache[cacheKey] = list
                const lipoList = this.cencHistoryCache.lipo
                const merged = [...lipoList]
                this.cencHistoryCache.wolfx.forEach(wolfxEvent => {
                    if(!lipoList.some(lipoEvent => isSameCencHistoryEvent(lipoEvent, wolfxEvent))) {
                        merged.push(wolfxEvent)
                    }
                })
                merged.sort((a, b) => timeToStamp(b.originTime, b.timeZone) - timeToStamp(a.originTime, a.timeZone))
                this.history[source] = merged
            }
            else if(list.length > 0 || api === 'lipo')
                this.history[source] = list
        },        
        connect(protocol){
            if(protocol == 'http'){
                let status = -1
                clearInterval(this.httpRequest)
                this.httpRequest = setInterval(async () => {
                    const stamp = Date.now()
                    status = (status + 1) % 60
                    const promises = this.enabledSource.map(async source=>{
                        if(source == 'jmaEqlist' && this.isApiEnabled(source, 'p2pquake') && status % 2 == 0 && (!this.eqMessage[source].id || status % 10 == 0)) {
                            const data = await Http.get(eqUrls.jmaEqlist_http)
                            if(data && data.length > 0) this.setEqMessage(source, data[0], 'p2pquake')
                        }
                        if(source == 'jmaTsunami' && this.isApiEnabled(source, 'p2pquake') && status % 2 == 1 && (!this.tsunamiMessage[source].id || status % 10 == 1)) {
                            const data = await Http.get(tsunamiUrls.jmaTsunami_http)
                            if(data && data.length > 0) this.setTsunamiMessage(source, data[0])
                        }
                        if(source == 'usgsEqlist' && this.isApiEnabled(source, 'usgs') && status % 10 == 0) {
                            await this.fetchUsgsReports(stamp)
                        }
                    })
                    await Promise.all(promises)
                }, 1000);
            }
            else if(protocol == 'ws'){
                if(this.wolfxSocket) this.wolfxSocket.close()
                if(this.activeWolfxSources.length > 0) {
                    this.wolfxSocket = new WolfxClient(eqUrls.wolfx_ws, this.activeWolfxSources)
                    this.trackWebSocketStatus('wolfx', this.wolfxSocket)
                    this.wolfxSocket.setMessageHandler(data => {
                        const source = wolfx2Source[data.type]
                        if(source && this.activeWolfxSources.includes(source)) {
                            switch(source) {
                                case 'jmaEqlist':
                                    this.setHistory(source, data)
                                    break
                                case 'cencEqlist':
                                    this.setEqMessage(source, data, 'wolfx')
                                    this.setHistory(source, data, 'wolfx')
                                    break
                                default:
                                    this.setEqMessage(source, data, 'wolfx')
                                    break
                            }
                        }
                    })
                }
                if(this.lipoSocket) this.lipoSocket.close()
                this.lipoSocket = null
                this.lipoAuthStatus = -1
                this.lipoError = ''
                if(this.activeLipoSources.length > 0) {
                    const settingsStore = useSettingsStore()
                    const apiKey = settingsStore.mainSettings.apiKeys.lipoApiKey?.trim()
                    if(!apiKey) {
                        ElMessage({ message: '尚未配置Lipo API Key，部分功能受限', type: 'warning', duration: 10000, showClose: true })
                    } else {
                        const reportRequests = []
                        if(this.activeLipoSources.includes('cwaEqlist')) reportRequests.push('cwa_report_list')
                        if(this.activeLipoSources.includes('cencEqlist')) reportRequests.push('cenc_report_list')
                        if(this.activeLipoSources.includes('kmaEqlist')) reportRequests.push('kma_report_list')
                        if(this.activeLipoSources.includes('usgsEqlist')) reportRequests.push('usgs_report_list')
                        const client = new LipoApiClient(eqUrls.lipo_ws, {
                            key: apiKey,
                            reportRequests,
                            autoReconnectOnAuthFail: settingsStore.mainSettings.apiAuthAutoReconnect,
                        })
                        this.lipoSocket = client
                        this.trackWebSocketStatus('lipo', client)
                        client.setCloseHandler(() => {
                            if(this.lipoAuthStatus !== 0) this.lipoAuthStatus = -1
                        })
                        client.setMessageHandler(message => {
                            switch(message.type) {
                                case 'auth_ok':
                                    this.lipoAuthStatus = 1
                                    this.lipoError = ''
                                    ElMessage({ message: 'Lipo API认证成功', type: 'success' })
                                    break
                                case 'error':
                                    this.lipoAuthStatus = 0
                                    this.lipoError = message.data?.message || message.data?.code || '连接失败'
                                    ElMessage({ message: 'Lipo API：' + this.lipoError, type: 'error', duration: 10000, showClose: true })
                                    break
                                case 'init':
                                case 'query_all':
                                    Object.values(message.data).forEach(item => this.receiveLipoMessage(item))
                                    break
                                default:
                                    this.receiveLipoMessage(message)
                                    break
                            }
                        })
                    }
                }
                if(this.p2pquakeSocket) this.p2pquakeSocket.close()
                if(this.activeP2pquakeSources.length > 0) {
                    this.p2pquakeSocket = new P2pQuakeClient(eqUrls.p2pquake_ws)
                    this.trackWebSocketStatus('p2pquake', this.p2pquakeSocket)
                    this.p2pquakeSocket.setMessageHandler(data => {
                        switch(data.code) {
                            case 551:
                                if(this.activeP2pquakeSources.includes('jmaEqlist')) this.setEqMessage('jmaEqlist', data, 'p2pquake')
                                break
                            case 552:
                                if(this.activeP2pquakeSources.includes('jmaTsunami')) this.setTsunamiMessage('jmaTsunami', data)
                                break
                        }
                    })
                }
                if(this.gqSocket) this.gqSocket.close()
                if(this.isApiEnabled('gqEew', 'globalquake') && 'gqEew_ws' in eqUrls) {
                    this.gqSocket = new GlobalQuakeClient(eqUrls.gqEew_ws)
                    this.trackWebSocketStatus('gq', this.gqSocket)
                    this.gqSocket.setMessageHandler(data => {
                        if(data.RevisionId) this.setEqMessage('gqEew', data, 'globalquake')
                    })
                }
            }
            else{
                console.log('Unrecognized protocol type.')
            }
        },
        receiveLipoMessage(message) {
            if(!message || message.data == null) return
            const { type, data } = message
            if(type === 'cenc_ir') {
                if(this.isApiEnabled('cencEqlist', 'lipo')) this.setIntReports(data)
                return
            }
            const listSource = {
                cenc_report_list: 'cencEqlist', cwa_report_list: 'cwaEqlist',
                kma_report_list: 'kmaEqlist', usgs_report_list: 'usgsEqlist',
            }[type]
            if(listSource) {
                if(this.isApiEnabled(listSource, 'lipo') && Array.isArray(data)) this.setHistory(listSource, data, 'lipo')
                return
            }
            const source = lipo2Source[type]
            if(!source || !this.activeLipoSources.includes(source)) return
            if(source === 'nmefcTsunami') this.setTsunamiMessage(source, data)
            else this.setEqMessage(source, data, 'lipo')
        },
        setIntReports(reports) {
            if(!Array.isArray(reports)) return
            const summaries = reports.filter(item => item && typeof item.title === 'string'
                && (typeof item.id === 'string' || Number.isSafeInteger(item.id)))
            const nextIds = new Set(summaries.map(item => String(item.id)))
            const newTitles = summaries.filter(item => !this.intReportIds.has(String(item.id))).map(item => item.title)
            const initialized = this.intReportsInitialized
            this.intReportIds = nextIds
            this.intReportsInitialized = true
            // A summary can arrive independently of the next history-list response.
            for(const item of this.history.cencEqlist) {
                const id = item.originTime.replace(/[^0-9]/g, '')
                item.intReportId = nextIds.has(id) ? id : null
            }
            if(!initialized || newTitles.length === 0) return
            const message = '收到新的CENC烈度速报: ' + newTitles.join(' ')
            ElMessage({ message, type: 'success', duration: 10000, showClose: true })
            const settingsStore = useSettingsStore()
            if(settingsStore.mainSettings.onReport.sound) playSound('detail')
            if(settingsStore.mainSettings.onReport.focus) focusWindow()
            if(settingsStore.mainSettings.onReport.notification) sendMyNotification('CENC烈度速报', message, iconUrls.info)
        },
        async getIrDetail(id) {
            const settingsStore = useSettingsStore()
            const key = settingsStore.mainSettings.apiKeys.lipoApiKey?.trim()
            if(!this.isApiEnabled('cencEqlist', 'lipo') || !key || !id) return
            id = String(id)
            const cacheKey = key + '|' + id
            let pending = irDetailRequests.get(cacheKey)
            if(!pending) {
                pending = (async () => {
                    const cached = irDetailCache.get(cacheKey)
                    const response = await Http.getResponse(eqUrls.cencIr_http, {
                        params: { id, key },
                        headers: cached?.etag ? { 'If-None-Match': cached.etag } : {},
                        validateStatus: status => status === 200 || status === 304 || status === 404,
                    })
                    if(response.status === 304) return cached?.data
                    if(response.status === 404) {
                        irDetailCache.delete(cacheKey)
                        return null
                    }
                    const data = response.data?.data
                    if(!Array.isArray(data)) throw new Error('INVALID_DETAIL')
                    irDetailCache.set(cacheKey, { data, etag: response.headers.etag })
                    while(irDetailCache.size > 25) irDetailCache.delete(irDetailCache.keys().next().value)
                    return data
                })()
                irDetailRequests.set(cacheKey, pending)
            }
            try {
                const data = await pending
                if(settingsStore.mainSettings.apiKeys.lipoApiKey?.trim() !== key || !this.isApiEnabled('cencEqlist', 'lipo')) return
                const event = this.historyList?.find(event => String(event.eqMessage?.intReportId) === id)
                if(data) event?.createStations(data)
                else event?.terminateStations()
            } catch(error) {
                // Axios errors contain the query-string credential; display only the status.
                const status = error.response?.status
                ElMessage({ message: status === 401 ? 'Lipo API Key不可用，无法读取烈度详情' : 'CENC烈度详情读取失败', type: 'error' })
            } finally {
                if(irDetailRequests.get(cacheKey) === pending) irDetailRequests.delete(cacheKey)
            }
        },
        disconnect(){
            this.usgsHttpRequestId++
            clearInterval(this.httpRequest)
            clearTimeout(this.wsConnectTimer)
            this.wsConnectTimer = null
            if(this.wolfxSocket) this.wolfxSocket.close()
            if(this.lipoSocket) this.lipoSocket.close()
            if(this.p2pquakeSocket) this.p2pquakeSocket.close()
            if(this.gqSocket) this.gqSocket.close()
        },
        startUpdatingEqMessage(){
            this.connect('http')
            clearTimeout(this.wsConnectTimer)
            this.wsConnectTimer = setTimeout(() => {
                this.wsConnectTimer = null
                this.connect('ws')
            }, 500)
        },
        setActive(source, isActive){
            this.isActive[source] = isActive
        }
    }
})
