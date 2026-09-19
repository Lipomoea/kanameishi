import { defineStore } from 'pinia';
import Http from '@/classes/Http';
import WebSocketObj from '@/classes/WebSocket';
import { eqUrls, FAN_API_APP_ID, iconUrls, tsunamiUrls } from '@/utils/Urls';
import { setClassName, calcCsisLevel, stampToTime, getShindoFromInstShindo, shindoScaleKanji, calcTimeDiff, playSound, sendMyNotification, focusWindow, formatShindo, timeToStamp, systemTimeZone, convertTimeString, convertCompactTimeString } from '@/utils/Utils';
import { jmaSeisIntLoc } from '@/utils/JmaSeisIntLoc';
import { useSettingsStore } from './settings';
import { isTauri } from '@tauri-apps/api/core';
import { getFEName } from '@/utils/FERegions';
import isEqual from 'lodash/isEqual';
import dayjs from "dayjs";
import {
    eewSources,
    eqlistSources,
    tsunamiSources,
    wolfxSocketSources,
    fanSocketSources,
    p2pquakeSocketSources,
} from '@/utils/DataSources';
// import utc from "dayjs/plugin/utc";
// import timezone from "dayjs/plugin/timezone";
// dayjs.extend(utc);
// dayjs.extend(timezone);

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

const wolfx2Source = {
    'jma_eew': 'jmaEew',
    'cwa_eew': 'cwaEew',
    'cenc_eew': 'ceaEew',
    'sc_eew': 'scEew',
    'fj_eew': 'fjEew',
    'jma_eqlist': 'jmaEqlist',
    'cenc_eqlist': 'cencEqlist',
}
const source2Fan = {
    'jmaEew': 'jma',
    'cwaEew': 'cwa-eew',
    'iclEew': 'icl',
    'scEew': 'sichuan',
    'fjEew': 'fujian',
    'kmaEew': 'kma-eew',
    'cwaEqlist': 'cwa',
    'cencEqlist': 'cenc',
    'kmaEqlist': 'kma',
    'usgsEqlist': 'usgs',
    'fssnEqlist': 'fssn',
    'nmefcTsunami': 'tsunami',
}
const fan2Source = {
    'jma': 'jmaEew',
    'cwa-eew': 'cwaEew',
    'icl': 'iclEew',
    'sichuan': 'scEew',
    'fujian': 'fjEew',
    'kma-eew': 'kmaEew',
    'cwa': 'cwaEqlist',
    'cenc': 'cencEqlist',
    'kma': 'kmaEqlist',
    'usgs': 'usgsEqlist',
    'fssn': 'fssnEqlist',
    'tsunami': 'nmefcTsunami',
}

export const sourceTypes = {
    jmaEew: {
        0: 'Wolfx',
        1: 'FAN',
        2: 'NIED'
    },
    cwaEew: {
        0: 'Wolfx',
        1: 'FAN'
    },
    ceaEew: {
        0: 'Wolfx',
        1: 'FAN'
    },
    iclEew: {
        1: 'FAN'
    },
    scEew: {
        0: 'Wolfx',
        1: 'FAN'
    },
    fjEew: {
        0: 'Wolfx',
        1: 'FAN'
    },
    kmaEew: {
        1: 'FAN'
    },
    gqEew: {
        0: 'S',
        1: 'A',
        2: 'B',
        3: 'C',
        4: 'D',
        5: 'E',
        6: 'F'
    },
    mockEew: {
        0: 'MOCK'
    },
    jmaEqlist: {
        0: 'P2PQ'
    },
    cwaEqlist: {
        1: 'FAN'
    },
    cencEqlist: {
        0: 'Wolfx',
        1: 'FAN'
    },
    kmaEqlist: {
        1: 'FAN'
    },
    usgsEqlist: {
        0: 'USGS',
        1: 'FAN'
    },
    fssnEqlist: {
        1: 'FAN'
    },
    history: {
        0: ''
    }
}

let usgsCache = null

const maxIntReportNum = 50
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
        fanSocket: null,
        fanAuthStatus: -1,
        p2pquakeSocket: null,
        gqSocket: null,
        webSocketStatus: {
            wolfx: { readyState: 4, urlIndex: 0 },
            fan: { readyState: 4, urlIndex: 0 },
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
            scEew: Object.assign({}, defaultEqMessage),
            fjEew: Object.assign({}, defaultEqMessage),
            kmaEew: Object.assign({}, defaultEqMessage),
            gqEew: Object.assign({}, defaultEqMessage),
            mockEew: Object.assign({}, defaultEqMessage),
            jmaEqlist: Object.assign({}, defaultEqMessage),
            cwaEqlist: Object.assign({}, defaultEqMessage),
            cencEqlist: Object.assign({}, defaultEqMessage),
            kmaEqlist: Object.assign({}, defaultEqMessage),
            usgsEqlist: Object.assign({}, defaultEqMessage),
            fssnEqlist: Object.assign({}, defaultEqMessage),
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
            scEew: false,
            fjEew: false,
            kmaEew: false,
            gqEew: false,
            mockEew: false,
            jmaEqlist: false,
            cwaEqlist: false,
            cencEqlist: false,
            kmaEqlist: false,
            usgsEqlist: false,
            fssnEqlist: false,
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
            usgsEqlist: [],
            fssnEqlist: [],
        },
        cencHistoryCache: {
            wolfx: [],
            fan: [],
        },
        intReportIds: new Set(),
        historyList: null,
    }),
    getters: {
        activeWolfxSources: state => wolfxSocketSources.filter(source => state.sourceRoutes[source]?.wolfx),
        activeFanSources: state => fanSocketSources.filter(source => state.sourceRoutes[source]?.fan),
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
        },
        isApiEnabled(source, api) {
            return Boolean(this.sourceRoutes[source]?.[api])
        },
        trackWebSocketStatus(source, socket) {
            socket.setStateHandler((readyState, urlIndex) => {
                Object.assign(this.webSocketStatus[source], { readyState, urlIndex })
            })
        },
        setEqMessage(source, data, type = 0) {
            try{
                const eqMessage = this.eqMessage[source]
                const oldType = eqMessage.type
                eqMessage.source = source
                eqMessage.type = type
                switch(source){
                    case 'jmaEew':{
                        eqMessage.isEew = true
                        eqMessage.timeZone = 9
                        eqMessage.useShindo = true
                        eqMessage.intTitle = '推定最大震度'
                        switch(type) {
                            case 0: {
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
                            case 1: {
                                const trainingText = data.training ? '訓練·' : ''
                                eqMessage.id = data.id
                                eqMessage.isCanceled = data.cancel
                                eqMessage.reportNum = data.updates
                                eqMessage.reportTime = data.createTime
                                eqMessage.isAssumption = false
                                eqMessage.isWarn = data.infoTypeName == '警報'
                                eqMessage.isFinal = data.final
                                eqMessage.title = trainingText + `緊急地震速報（${data.infoTypeName}）`
                                eqMessage.lat = data.latitude
                                eqMessage.lng = data.longitude
                                eqMessage.depth = data.depth
                                eqMessage.depthText = '深さ: ' + data.depth + 'km'
                                eqMessage.originTime = data.shockTime
                                eqMessage.originTimeText = '発震時刻: ' + eqMessage.originTime + ' (JST)'
                                eqMessage.magnitude = data.magnitude
                                eqMessage.magnitudeText = 'マグニチュード: ' + eqMessage.magnitude.toFixed(1)
                                eqMessage.maxIntensity = data.epiIntensity
                                if(data.cancel){
                                    eqMessage.reportNumText = 'キャンセル報'
                                    eqMessage.titleText = trainingText + '緊急地震速報（取消）'
                                    eqMessage.hypocenter = trainingText + '取り消されました'
                                    eqMessage.maxIntensityText = '推定最大震度: なし'
                                }
                                else{
                                    eqMessage.reportNumText = '第' + data.updates + '報' + (data.final ? '（最終）' : '')
                                    eqMessage.titleText = trainingText + `緊急地震速報（${data.infoTypeName}）`
                                    eqMessage.hypocenter = trainingText + data.placeName
                                    eqMessage.maxIntensityText = '推定最大震度: ' + data.epiIntensity
                                }
                                eqMessage.hypocenterText = '震源地: ' + eqMessage.hypocenter
                                eqMessage.warnArea = '[]'
                                break
                            }
                            case 2: {
                                const trainingText = data.is_training ? '訓練·' : ''
                                eqMessage.id = data.report_id
                                eqMessage.isCanceled = data.is_cancel
                                eqMessage.reportNum = Number(data.report_num)
                                eqMessage.reportTime = data.report_time.replace(/\//g, '-')
                                eqMessage.isAssumption = false
                                eqMessage.isWarn = data.alertflg == '警報'
                                eqMessage.isFinal = data.is_final
                                eqMessage.title = trainingText + `緊急地震速報（${data.alertflg}）`
                                eqMessage.lat = Number(data.latitude)
                                eqMessage.lng = Number(data.longitude)
                                eqMessage.depth = Number(data.depth.replace('km', ''))
                                eqMessage.depthText = '深さ: ' + data.depth
                                eqMessage.originTime = data.origin_time.replace(
                                    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/,
                                    '$1-$2-$3 $4:$5:$6'
                                )
                                eqMessage.originTimeText = '発震時刻: ' + eqMessage.originTime + ' (JST)'
                                eqMessage.magnitude = Number(data.magunitude)
                                eqMessage.magnitudeText = 'マグニチュード: ' + eqMessage.magnitude.toFixed(1)
                                eqMessage.maxIntensity = data.calcintensity
                                if(data.is_cancel){
                                    eqMessage.reportNumText = 'キャンセル報'
                                    eqMessage.titleText = trainingText + '緊急地震速報（取消）'
                                    eqMessage.hypocenter = trainingText + '取り消されました'
                                    eqMessage.maxIntensityText = '推定最大震度: なし'
                                }
                                else{
                                    eqMessage.reportNumText = '第' + data.report_num + '報' + (data.is_final ? '（最終）' : '')
                                    eqMessage.titleText = trainingText + `緊急地震速報（${data.alertflg}）`
                                    eqMessage.hypocenter = trainingText + data.region_name
                                    eqMessage.maxIntensityText = '推定最大震度: ' + data.calcintensity
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
                        switch(type) {
                            case 0:
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
                                eqMessage.isWarn = eqMessage.maxIntensity >= '5' && eqMessage.maxIntensity != '不明'
                                break
                            case 1:
                                if(data.id == eqMessage.id && oldType == 0) {
                                    eqMessage.type = oldType
                                    break
                                }
                                eqMessage.id = data.id
                                eqMessage.reportNum = data.updates
                                eqMessage.reportNumText = '第' + data.updates + '報'
                                eqMessage.reportTime = data.createTime || data.shockTime
                                eqMessage.isCanceled = false
                                eqMessage.titleText = '中央氣象署強震即時警報'
                                eqMessage.hypocenter = data.placeName?.replace(/ 外海 \([^)]*\)/g, "外海") || getFEName(data.latitude, data.longitude)
                                eqMessage.hypocenterText = '震央: ' + eqMessage.hypocenter
                                eqMessage.lat = data.latitude
                                eqMessage.lng = data.longitude
                                eqMessage.depth = data.depth
                                eqMessage.depthText = '深度: ' + data.depth + 'km'
                                eqMessage.originTime = data.shockTime
                                eqMessage.originTimeText = '時間: ' + eqMessage.originTime
                                eqMessage.magnitude = data.magnitude
                                eqMessage.magnitudeText = '規模: ' + eqMessage.magnitude.toFixed(1)
                                eqMessage.maxIntensity = formatShindo(data.maxIntensity, false) || '不明'
                                eqMessage.maxIntensityText = '預估最大震度: ' + eqMessage.maxIntensity
                                eqMessage.isWarn = eqMessage.maxIntensity >= '5' && eqMessage.maxIntensity != '不明'
                                break
                        }
                        break
                    }
                    case 'ceaEew':{
                        switch(type) {
                            case 0:
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
                            case 1:
                                eqMessage.id = data.eventId
                                eqMessage.isEew = true
                                eqMessage.reportNum = data.updates
                                eqMessage.reportNumText = '第' + data.updates + '报'
                                eqMessage.reportTime = data.updateTime || data.shockTime
                                eqMessage.titleText = '中国地震局地震预警'
                                eqMessage.hypocenter = data.placeName
                                eqMessage.hypocenterText = '震中: ' + data.placeName
                                eqMessage.lat = data.latitude
                                eqMessage.lng = data.longitude
                                eqMessage.depth = data.depth ?? 10
                                eqMessage.depthText = '深度: ' + (data.depth == null ? '不明' : data.depth + 'km')
                                eqMessage.originTime = data.shockTime
                                eqMessage.originTimeText = '发震时间: ' + eqMessage.originTime
                                eqMessage.magnitude = data.magnitude
                                eqMessage.magnitudeText = '震级: ' + eqMessage.magnitude.toFixed(1)
                                eqMessage.maxIntensity = data.epiIntensity ? data.epiIntensity.toFixed(0) : calcCsisLevel(eqMessage.magnitude, eqMessage.depth, 0)
                                eqMessage.maxIntensityText = '预估最大烈度: ' + eqMessage.maxIntensity
                                eqMessage.isWarn = Number(eqMessage.maxIntensity) >= 6.5
                                break
                        }
                        break
                    }
                    case 'iclEew':{
                        switch(type) {
                            case 1:
                                eqMessage.id = data.eventId
                                eqMessage.isEew = true
                                eqMessage.reportNum = data.updates
                                eqMessage.reportNumText = '第' + data.updates + '报'
                                eqMessage.reportTime = data.updateTime
                                eqMessage.titleText = '成都高新减灾研究所地震预警'
                                eqMessage.hypocenter = data.placeName
                                eqMessage.hypocenterText = '震中: ' + data.placeName
                                eqMessage.lat = data.latitude
                                eqMessage.lng = data.longitude
                                eqMessage.depth = data.depth || 10
                                eqMessage.depthText = '深度: ' + (data.depth ? data.depth.toFixed(0) + 'km' : '不明')
                                eqMessage.originTime = data.shockTime
                                eqMessage.originTimeText = '发震时间: ' + eqMessage.originTime
                                eqMessage.magnitude = data.magnitude
                                eqMessage.magnitudeText = '震级: ' + eqMessage.magnitude.toFixed(1)
                                eqMessage.maxIntensity = data.epiIntensity ? data.epiIntensity.toFixed(0) : calcCsisLevel(eqMessage.magnitude, eqMessage.depth, 0)
                                eqMessage.maxIntensityText = '预估最大烈度: ' + eqMessage.maxIntensity
                                eqMessage.isWarn = Number(eqMessage.maxIntensity) >= 6.5
                                break
                        }
                        break
                    }
                    case 'scEew':{
                        switch(type) {
                            case 0:
                                eqMessage.id = data.EventID.split('_')[0]
                                eqMessage.isEew = true
                                eqMessage.reportNum = data.ReportNum
                                eqMessage.reportNumText = '第' + data.ReportNum + '报'
                                eqMessage.reportTime = data.ReportTime
                                eqMessage.titleText = '四川地震局地震预警'
                                eqMessage.hypocenter = data.HypoCenter
                                eqMessage.hypocenterText = '震中: ' + data.HypoCenter
                                eqMessage.lat = data.Latitude
                                eqMessage.lng = data.Longitude
                                eqMessage.depth = data.Depth || 10
                                eqMessage.depthText = '深度: ' + (data.Depth ? data.Depth + 'km' : '不明')
                                eqMessage.originTime = data.OriginTime
                                eqMessage.originTimeText = '发震时间: ' + data.OriginTime
                                eqMessage.magnitude = data.Magunitude
                                eqMessage.magnitudeText = '震级: ' + data.Magunitude.toFixed(1)
                                eqMessage.maxIntensity = data.MaxIntensity ? data.MaxIntensity.toFixed(0) : calcCsisLevel(eqMessage.magnitude, eqMessage.depth, 0)
                                eqMessage.maxIntensityText = '预估最大烈度: ' + eqMessage.maxIntensity
                                eqMessage.isWarn = Number(eqMessage.maxIntensity) >= 6.5
                                break
                            case 1:
                                eqMessage.id = data.eventId.split('_')[0]
                                eqMessage.isEew = true
                                eqMessage.reportNum = data.updates
                                eqMessage.reportNumText = '第' + eqMessage.reportNum + '报'
                                eqMessage.reportTime = data.createTime
                                eqMessage.titleText = '四川地震局地震预警'
                                eqMessage.hypocenter = data.placeName
                                eqMessage.hypocenterText = '震中: ' + data.placeName
                                eqMessage.lat = data.latitude
                                eqMessage.lng = data.longitude
                                eqMessage.depth = 10
                                eqMessage.depthText = '深度: 不明'
                                eqMessage.originTime = data.shockTime
                                eqMessage.originTimeText = '发震时间: ' + data.shockTime
                                eqMessage.magnitude = data.magnitude
                                eqMessage.magnitudeText = '震级: ' + eqMessage.magnitude.toFixed(1)
                                eqMessage.maxIntensity = data.epiIntensity ? data.epiIntensity.toFixed(0) : calcCsisLevel(eqMessage.magnitude, eqMessage.depth, 0)
                                eqMessage.maxIntensityText = '预估最大烈度: ' + eqMessage.maxIntensity
                                eqMessage.isWarn = Number(eqMessage.maxIntensity) >= 6.5
                                break
                        }
                        break
                    }
                    case 'fjEew':{
                        switch(type) {
                            case 0:
                                eqMessage.id = data.EventID.split('_')[0]
                                eqMessage.isEew = true
                                eqMessage.reportNum = data.ReportNum
                                eqMessage.reportNumText = '第' + data.ReportNum + '报'
                                eqMessage.reportTime = data.ReportTime
                                eqMessage.titleText = '福建地震局地震预警'
                                eqMessage.hypocenter = data.HypoCenter
                                eqMessage.hypocenterText = '震中: ' + data.HypoCenter
                                eqMessage.lat = data.Latitude
                                eqMessage.lng = data.Longitude
                                eqMessage.depth = 10
                                eqMessage.depthText = '深度: 不明'
                                eqMessage.originTime = data.OriginTime
                                eqMessage.originTimeText = '发震时间: ' + data.OriginTime
                                eqMessage.magnitude = data.Magunitude
                                eqMessage.magnitudeText = '震级: ' + data.Magunitude.toFixed(1)
                                eqMessage.maxIntensity = calcCsisLevel(eqMessage.magnitude, eqMessage.depth, 0)
                                eqMessage.maxIntensityText = '预估最大烈度: ' + eqMessage.maxIntensity
                                eqMessage.isWarn = Number(eqMessage.maxIntensity) >= 6.5
                                break
                            case 1:
                                eqMessage.id = data.eventId.split('_')[0]
                                eqMessage.isEew = true
                                eqMessage.reportNum = data.updates
                                eqMessage.reportNumText = '第' + eqMessage.reportNum + '报'
                                eqMessage.reportTime = data.sendtime.slice(0, 19)
                                eqMessage.titleText = '福建地震局地震预警'
                                eqMessage.hypocenter = data.placeName
                                eqMessage.hypocenterText = '震中: ' + data.placeName
                                eqMessage.lat = data.latitude
                                eqMessage.lng = data.longitude
                                eqMessage.depth = 10
                                eqMessage.depthText = '深度: 不明'
                                eqMessage.originTime = data.shockTime.slice(0, 19)
                                eqMessage.originTimeText = '发震时间: ' + eqMessage.originTime
                                eqMessage.magnitude = data.magnitude
                                eqMessage.magnitudeText = '震级: ' + data.magnitude.toFixed(1)
                                eqMessage.maxIntensity = calcCsisLevel(eqMessage.magnitude, eqMessage.depth, 0)
                                eqMessage.maxIntensityText = '预估最大烈度: ' + eqMessage.maxIntensity
                                eqMessage.isWarn = Number(eqMessage.maxIntensity) >= 6.5
                                break
                        }
                        break
                    }
                    case 'kmaEew': {
                        eqMessage.id = data.id
                        eqMessage.isEew = true
                        eqMessage.intTitle = '최대예상진도'
                        eqMessage.reportNum = data.updates || 1
                        eqMessage.reportNumText = '제' + eqMessage.reportNum + '보'
                        eqMessage.reportTime = data.createTime
                        eqMessage.titleText = '기상청 지진 조기 경보'
                        eqMessage.hypocenter = data.placeName
                        eqMessage.hypocenterText = '위치: ' + data.placeName
                        eqMessage.lat = data.latitude
                        eqMessage.lng = data.longitude
                        eqMessage.depth = data.depth || 10
                        eqMessage.depthText = '깊이: ' + (data.depth ? data.depth + 'km' : '불명')
                        eqMessage.originTime = data.shockTime
                        eqMessage.originTimeText = '발생시각: ' + eqMessage.originTime
                        eqMessage.magnitude = data.magnitude
                        eqMessage.magnitudeText = '규모: ' + eqMessage.magnitude.toFixed(1)
                        eqMessage.maxIntensity = data.epiIntensity.toFixed(0)
                        eqMessage.maxIntensityText = '최대예상진도: ' + eqMessage.maxIntensity
                        eqMessage.isWarn = Number(eqMessage.maxIntensity) >= 6.5
                        break
                    }
                    case 'gqEew':{
                        const isNewEvent = eqMessage.id != data.Id
                        eqMessage.id = data.Id
                        eqMessage.type = data.Quality?.QualityLevel ?? 9
                        eqMessage.isEew = true
                        eqMessage.timeZone = systemTimeZone
                        eqMessage.isCanceled = data.RevisionId < 0
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
                        switch(type) {
                            case 1: {
                                eqMessage.id = data.id
                                eqMessage.reportTime = dayjs(data.shockTime, 'YYYY-MM-DD HH:mm:ss').add(5, 'minutes').format('YYYY-MM-DD HH:mm:ss')
                                const start = data.placeName.indexOf('(位於')
                                const end = data.placeName.indexOf(')')
                                eqMessage.hypocenter = start == -1 || end == -1 || start + 3 >= end ? data.placeName : data.placeName.slice(start + 3, end)
                                eqMessage.hypocenterText = '震央: ' + eqMessage.hypocenter
                                eqMessage.lat = data.latitude
                                eqMessage.lng = data.longitude
                                eqMessage.depth = data.depth
                                eqMessage.depthText = '深度: ' + data.depth.toFixed(0) + 'km'
                                eqMessage.originTime = data.shockTime
                                eqMessage.originTimeText = '時間: ' + eqMessage.originTime
                                eqMessage.magnitude = data.magnitude
                                eqMessage.magnitudeText = '規模: ' + data.magnitude.toFixed(1)
                                eqMessage.maxIntensity = data.maxIntensity?.replace('級', '') || '不明'
                                eqMessage.maxIntensityText = '最大震度: ' + eqMessage.maxIntensity
                                break
                            }
                        }
                        break
                    }
                    case 'cencEqlist':{
                        switch(type) {
                            case 0: 
                                if(calcTimeDiff(data.No1.ReportTime, 8, eqMessage.reportTime, 8) < 30000)
                                    break
                                eqMessage.id = data.No1.EventID
                                eqMessage.reportTime = data.No1.ReportTime
                                eqMessage.title = `中国地震台网${data.No1.type == 'reviewed' ? '正式' : '自动'}测定`
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
                            case 1:
                                if(calcTimeDiff(data.createTime, 8, eqMessage.reportTime, 8) < 30000)
                                    break
                                eqMessage.id = data.eventId
                                eqMessage.reportTime = data.createTime
                                const cedingIndex = data.infoTypeName.indexOf('测定')
                                eqMessage.title = `中国地震台网${data.infoTypeName.slice(cedingIndex - 2, cedingIndex)}测定`
                                eqMessage.titleText = eqMessage.title
                                eqMessage.hypocenter = data.placeName
                                eqMessage.hypocenterText = '震中: ' + data.placeName
                                eqMessage.lat = data.latitude
                                eqMessage.lng = data.longitude
                                eqMessage.depth = data.depth
                                eqMessage.depthText = '深度: ' + data.depth + 'km'
                                eqMessage.originTime = data.shockTime
                                eqMessage.originTimeText = '发震时间: ' + data.shockTime
                                eqMessage.magnitude = data.magnitude
                                eqMessage.magnitudeText = '震级: ' + data.magnitude.toFixed(1)
                                eqMessage.maxIntensity = calcCsisLevel(eqMessage.magnitude, eqMessage.depth, 0)
                                eqMessage.maxIntensityText = '预估最大烈度: ' + eqMessage.maxIntensity
                                break
                        }
                        break
                    }
                    case 'kmaEqlist':{
                        eqMessage.timeZone = 9
                        eqMessage.intTitle = '최대진도'
                        eqMessage.id = data.id
                        eqMessage.reportTime = data.createTime
                        eqMessage.title = '기상청 지진 정보'
                        eqMessage.titleText = eqMessage.title
                        eqMessage.hypocenter = data.placeName
                        eqMessage.hypocenterText = '위치: ' + data.placeName
                        eqMessage.lat = data.latitude
                        eqMessage.lng = data.longitude
                        eqMessage.depth = data.depth || 10
                        eqMessage.depthText = '깊이: ' + (data.depth ? data.depth + 'km' : '불명')
                        eqMessage.originTime = data.shockTime
                        eqMessage.originTimeText = '발생시각: ' + eqMessage.originTime
                        eqMessage.magnitude = data.magnitude
                        eqMessage.magnitudeText = '규모: ' + data.magnitude.toFixed(1)
                        eqMessage.maxIntensity = data.epiIntensity?.toFixed(0) || '불명'
                        eqMessage.maxIntensityText = '최대진도: ' + eqMessage.maxIntensity
                        break
                    }
                    case 'usgsEqlist': {
                        const tempMsg = {}
                        eqMessage.timeZone = systemTimeZone
                        switch(type) {
                            case 0:
                                const { geometry, properties } = data
                                const [lng, lat, depth] = geometry.coordinates
                                tempMsg.id = properties.code
                                tempMsg.title = 'USGS' + (properties.status.toLowerCase() == 'reviewed' ? '正式' : '自动') + '测定'
                                tempMsg.titleText = tempMsg.title
                                tempMsg.hypocenter = getFEName(lat, lng) || properties.place
                                tempMsg.hypocenterText = '震中: ' + tempMsg.hypocenter
                                tempMsg.lat = lat
                                tempMsg.lng = lng
                                tempMsg.depth = depth
                                tempMsg.depthText = '深度: ' + tempMsg.depth.toFixed(0) + 'km'
                                tempMsg.originTime = stampToTime(properties.time, systemTimeZone)
                                tempMsg.originTimeText = '发震时间: ' + tempMsg.originTime
                                tempMsg.magnitude = properties.mag
                                tempMsg.magnitudeText = '震级: ' + tempMsg.magnitude.toFixed(1)
                                tempMsg.maxIntensity = calcCsisLevel(tempMsg.magnitude, tempMsg.depth, 0)
                                tempMsg.maxIntensityText = '预估最大烈度: ' + tempMsg.maxIntensity
                                if(isEqual(tempMsg, usgsCache))
                                    break
                                usgsCache = tempMsg
                                Object.assign(eqMessage, tempMsg)
                                eqMessage.reportTime = stampToTime(properties.updated, systemTimeZone)
                                break
                            case 1:
                                tempMsg.id = data.id
                                tempMsg.title = 'USGS' + (data.infoTypeName.toLowerCase() == 'reviewed' ? '正式' : '自动') + '测定'
                                tempMsg.titleText = tempMsg.title
                                tempMsg.hypocenter = getFEName(data.latitude, data.longitude) || data.placeName
                                tempMsg.hypocenterText = '震中: ' + tempMsg.hypocenter
                                tempMsg.lat = data.latitude
                                tempMsg.lng = data.longitude
                                tempMsg.depth = data.depth
                                tempMsg.depthText = '深度: ' + tempMsg.depth.toFixed(0) + 'km'
                                tempMsg.originTime = convertTimeString(data.shockTime, 8)
                                tempMsg.originTimeText = '发震时间: ' + tempMsg.originTime
                                tempMsg.magnitude = data.magnitude
                                tempMsg.magnitudeText = '震级: ' + tempMsg.magnitude.toFixed(1)
                                tempMsg.maxIntensity = calcCsisLevel(tempMsg.magnitude, tempMsg.depth, 0)
                                tempMsg.maxIntensityText = '预估最大烈度: ' + tempMsg.maxIntensity
                                if(isEqual(tempMsg, usgsCache))
                                    break
                                usgsCache = tempMsg
                                Object.assign(eqMessage, tempMsg)
                                eqMessage.reportTime = convertTimeString(data.updateTime, 8)
                                break
                        }
                        break
                    }
                    case 'fssnEqlist': {
                        eqMessage.id = data.id
                        eqMessage.timeZone = systemTimeZone
                        eqMessage.reportTime = convertTimeString(data.createTime, 8)
                        let infoType
                        switch(data.infoTypeName) {
                            case '已确认':
                                infoType = '自动'
                                break
                            case '正式(已核实)':
                                infoType = '正式'
                                break
                            default:
                                infoType = data.infoTypeName
                                break
                        }
                        eqMessage.isCanceled = infoType == '取消'
                        eqMessage.title = `FSSN${infoType}测定`
                        eqMessage.titleText = eqMessage.title
                        eqMessage.hypocenter = getFEName(data.latitude, data.longitude) || data.placeName_zh || data.placeName
                        eqMessage.hypocenterText = '震中: ' + eqMessage.hypocenter
                        eqMessage.lat = data.latitude
                        eqMessage.lng = data.longitude
                        eqMessage.depth = data.depth
                        eqMessage.depthText = '深度: ' + eqMessage.depth.toFixed(0) + 'km'
                        eqMessage.originTime = convertTimeString(data.shockTime, 8)
                        eqMessage.originTimeText = '发震时间: ' + eqMessage.originTime
                        eqMessage.magnitude = data.magnitude || -1
                        eqMessage.magnitudeText = '震级: ' + (eqMessage.magnitude == -1 ? '不明' : eqMessage.magnitude.toFixed(1))
                        eqMessage.maxIntensity = eqMessage.magnitude == -1 ? '不明' : calcCsisLevel(eqMessage.magnitude, eqMessage.depth, 0)
                        eqMessage.maxIntensityText = '预估最大烈度: ' + eqMessage.maxIntensity
                        break
                    }
                }
                eqMessage.className = setClassName(eqMessage.maxIntensity, eqMessage.useShindo, eqMessage.isCanceled)
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
                        const reportTime = data.timeInfo.updateDate
                        if(!tsunamiMessage.reportTime || calcTimeDiff(reportTime, 8, tsunamiMessage.reportTime, 8) > 0) {
                            tsunamiMessage.id = data.timeInfo.updateDate.replace(/[^0-9]/g, '')
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
            const list = []
            let keys
            switch (source) {
                case 'jmaEqlist':
                    keys = Object.keys(data).filter(key => /^No\d+$/.test(key))
                    break
                case 'cencEqlist':
                    keys = api == 'fan' ? Object.keys(data) : Object.keys(data).filter(key => /^No\d+$/.test(key))
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
                        const placeName = data[i].placeName
                        const locStart = placeName.indexOf('(位於')
                        const locEnd = placeName.indexOf(')')
                        const hypocenter = locStart == -1 || locEnd == -1 || locStart + 3 >= locEnd ? placeName : placeName.slice(locStart + 3, locEnd)
                        const maxIntensity = formatShindo(data[i].maxIntensity)
                        list[i] = {
                            source: 'CWA',
                            id: `${data[i].id}${dayjs.utc(data[i].shockTime, 'YYYY-MM-DD HH:mm:ss').format('YYYYMMDDHHmmss')}`,
                            timeZone: 8,
                            useShindo: true,
                            originTime: data[i].shockTime,
                            lat: data[i].latitude,
                            lng: data[i].longitude,
                            hypocenter,
                            depth: data[i].depth,
                            magnitude: data[i].magnitude,
                            maxIntensity,
                            className: setClassName(maxIntensity, true),
                            url: 'https://scweb.cwa.gov.tw/zh-tw/earthquake/data'
                        }
                        break
                    }
                    case 'cencEqlist': {
                        const item = data[keys[i]]
                        const isFan = api == 'fan'
                        const originTime = isFan ? item.shockTime : item.time
                        const isReviewed = isFan ? item.infoTypeName.includes('正式') : item.type == 'reviewed'
                        const depth = Number(item.depth)
                        const magnitude = Number(item.magnitude)
                        const maxIntensity = calcCsisLevel(magnitude, depth)
                        const intReportId = originTime.replace(/[^\d]/g, '')
                        list[i] = {
                            source: 'CENC',
                            id: isFan ? item.id : item.EventID,
                            timeZone: 8,
                            useShindo: false,
                            originTime,
                            lat: Number(item.latitude),
                            lng: Number(item.longitude),
                            hypocenter: (isReviewed ? '' : '(A)') + item.placeName,
                            depth,
                            magnitude,
                            maxIntensity,
                            className: setClassName(maxIntensity, false),
                            url: 'https://www.ceic.ac.cn/',
                            intReportId: this.intReportIds.has(intReportId) ? intReportId : null
                        }
                        break
                    }
                    case 'usgsEqlist': {
                        const feature = data[i]
                        const { properties, geometry } = feature
                        const [lng, lat, depth] = geometry.coordinates
                        const magnitude = properties.mag
                        const maxIntensity = calcCsisLevel(magnitude, depth)
                        list[i] = {
                            source: 'USGS',
                            id: feature.id,
                            timeZone: systemTimeZone,
                            useShindo: false,
                            originTime: stampToTime(properties.time, systemTimeZone),
                            lat,
                            lng,
                            hypocenter: (properties.status.toLowerCase() == 'reviewed' ? '' : '(A)') + (getFEName(lat, lng) || properties.place),
                            depth,
                            magnitude,
                            maxIntensity,
                            className: setClassName(maxIntensity, false),
                            url: properties.url
                        }
                        break
                    }
                    case 'fssnEqlist': {
                        let infoType
                        switch (data[i].infoTypeName) {
                            case '已确认':
                                infoType = '(A)'
                                break
                            case '正式(已核实)':
                                infoType = ''
                                break
                            case '取消':
                                infoType = '(X)'
                                break
                            default:
                                infoType = data[i].infoTypeName
                                break
                        }
                        const lat = Number(data[i].latitude)
                        const lng = Number(data[i].longitude)
                        const depth = Number(data[i].depth)
                        const magnitude = Number(data[i].magnitude)
                        const isCanceled = data[i].infoTypeName == '取消'
                        const maxIntensity = magnitude ? calcCsisLevel(magnitude, depth) : '不明'
                        list[i] = {
                            source: 'FSSN',
                            id: data[i].id,
                            timeZone: systemTimeZone,
                            useShindo: false,
                            originTime: convertTimeString(data[i].shockTime, 8),
                            lat,
                            lng,
                            hypocenter: infoType + (getFEName(lat, lng) || data[i].placeName_zh || data[i].placeName),
                            depth,
                            magnitude,
                            maxIntensity,
                            isCanceled,
                            className: setClassName(maxIntensity, false, isCanceled),
                            url: 'https://seismic.fanstudio.tech/'
                        }
                        break
                    }
                }
            }
            if(source == 'cencEqlist') {
                const cacheKey = api == 'fan' ? 'fan' : 'wolfx'
                this.cencHistoryCache[cacheKey] = list
                const fanList = this.cencHistoryCache.fan
                const merged = [...fanList]
                this.cencHistoryCache.wolfx.forEach(wolfxEvent => {
                    if(!fanList.some(fanEvent => isSameCencHistoryEvent(fanEvent, wolfxEvent))) {
                        merged.push(wolfxEvent)
                    }
                })
                merged.sort((a, b) => timeToStamp(b.originTime, b.timeZone) - timeToStamp(a.originTime, a.timeZone))
                this.history[source] = merged
            }
            else if(list.length > 0)
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
                            if(data && data.length > 0) this.setEqMessage(source, data[0])
                        }
                        if(source == 'jmaTsunami' && this.isApiEnabled(source, 'p2pquake') && status % 2 == 1 && (!this.tsunamiMessage[source].id || status % 10 == 1)) {
                            const data = await Http.get(tsunamiUrls.jmaTsunami_http)
                            if(data && data.length > 0) this.setTsunamiMessage(source, data[0])
                        }
                        if(source == 'usgsEqlist' && this.isApiEnabled(source, 'usgs') && status % 10 == 0) {
                            const data = await Http.get(eqUrls.usgsEqlist_http + `?time=${stamp}`)
                            if(data) {
                                this.setEqMessage(source, data.features[0])
                                this.setHistory(source, data.features)
                            }
                        }
                    })
                    await Promise.all(promises)
                }, 1000);
            }
            else if(protocol == 'ws'){
                if(this.wolfxSocket) this.wolfxSocket.close()
                if(this.activeWolfxSources.length > 0) {
                    this.wolfxSocket = new WebSocketObj(eqUrls.wolfx_ws, this.activeWolfxSources.map(source => {
                        if(source == 'ceaEew') return 'query_cenceew'
                        else return `query_${source.toLowerCase()}`
                    }))
                    this.trackWebSocketStatus('wolfx', this.wolfxSocket)
                    this.wolfxSocket.setMessageHandler((e)=>{
                        const data = JSON.parse(e.data)
                        const source = wolfx2Source[data.type]
                        if(source && this.activeWolfxSources.includes(source)) {
                            switch(source) {
                                case 'jmaEqlist':
                                    this.setHistory(source, data)
                                    break
                                case 'cencEqlist':
                                    this.setEqMessage(source, data)
                                    this.setHistory(source, data, 'wolfx')
                                    break
                                default:
                                    this.setEqMessage(source, data)
                                    break
                            }
                        }
                    })
                }
                if(this.fanSocket) this.fanSocket.close()
                if(this.activeFanSources.length > 0) {
                    const settingsStore = useSettingsStore()
                    if(settingsStore.mainSettings.provinceCeaEew) {
                        source2Fan['ceaEew'] = 'cea-pr'
                        fan2Source['cea'] = 'ceaEew'
                        fan2Source['cea-pr'] = 'ceaEew'
                    }
                    else {
                        source2Fan['ceaEew'] = 'cea'
                        fan2Source['cea'] = 'ceaEew'
                        delete fan2Source['cea-pr']
                    }
                    const initMsg = []
                    const apiKey = settingsStore.mainSettings.apiKeys.fanApiKey?.trim()
                    if(apiKey) {
                        initMsg.push(JSON.stringify({
                            type: 'auth',
                            appId: FAN_API_APP_ID,
                            key: apiKey
                        }))
                    }
                    else {
                        ElMessage({
                            message: '尚未配置FAN Studio API Key，部分功能受限',
                            type: 'warning',
                            duration: 10000,
                            showClose: true
                        })
                    }
                    const autoMsg = ['query']
                    if(this.activeFanSources.includes('cwaEqlist')) {
                        autoMsg.push('cwalist')
                        initMsg.push('cwalist')
                    }
                    if(this.activeFanSources.includes('cencEqlist')) {
                        autoMsg.push('cencirlist', 'cenclist')
                        initMsg.push('cencirlist', 'cenclist')
                    }
                    if(this.activeFanSources.includes('fssnEqlist')) {
                        autoMsg.push('fssnlist')
                        initMsg.push('fssnlist')
                    }
                    const fanUrls = [...eqUrls.fan_ws]
                    const defaultId = settingsStore.advancedSettings.defaultFanServer
                    fanUrls.unshift(...fanUrls.splice(defaultId, 1))
                    const autoReconnectOnAuthFail = Boolean(apiKey) && settingsStore.mainSettings.apiAuthAutoReconnect
                    this.fanSocket = new WebSocketObj(fanUrls, autoMsg, initMsg, {
                        resetRetryOnOpen: !autoReconnectOnAuthFail
                    })
                    this.trackWebSocketStatus('fan', this.fanSocket)
                    this.fanSocket.setCloseHandler(() => {
                        if(autoReconnectOnAuthFail && this.fanSocket.shouldConnect && this.fanAuthStatus == 0) return
                        this.fanAuthStatus = -1
                    })
                    this.fanSocket.setMessageHandler((e)=>{
                        const data = JSON.parse(e.data)
                        switch(data.type) {
                            case 'auth_success': {
                                this.fanAuthStatus = 1
                                this.fanSocket.resetRetryInterval()
                                ElMessage({
                                    message: 'FAN Studio API认证成功',
                                    type: 'success'
                                })
                                break
                            }
                            case 'auth_fail': {
                                this.fanAuthStatus = 0
                                ElMessage({
                                    message: data.message
                                        ? `FAN Studio API认证失败：${data.message}`
                                        : 'FAN Studio API认证失败，请检查API Key',
                                    type: 'error',
                                    duration: 10000,
                                    showClose: true
                                })
                                if(autoReconnectOnAuthFail) this.fanSocket.retryAfterFailure()
                                break
                            }
                            case 'initial_all': case 'query_response': {
                                this.activeFanSources.forEach(source => {
                                    const Data = data[source2Fan[source]]?.Data
                                    if(Data) {
                                        if (source == 'nmefcTsunami') {
                                            if (Data.warningInfo.level != '信息') {
                                                this.setTsunamiMessage(source, Data)
                                            }
                                        }
                                        else {
                                            this.setEqMessage(source, Data, 1)
                                        }
                                    }
                                })
                                break
                            }
                            case 'update': {
                                const source = fan2Source[data.source]
                                const Data = data?.Data
                                if(source && this.activeFanSources.includes(source) && Data)
                                    source.endsWith('Tsunami') ? this.setTsunamiMessage(source, Data) : this.setEqMessage(source, Data, 1)
                                break
                            }
                            case 'cwalist_response': {
                                const source = 'cwaEqlist'
                                const Data = data?.Data
                                if(this.isApiEnabled(source, 'fan')) this.setHistory(source, Data)
                                break
                            }
                            case 'cenclist_response': {
                                const source = 'cencEqlist'
                                const Data = data?.Data
                                if(this.isApiEnabled(source, 'fan')) this.setHistory(source, Data, 'fan')
                                break
                            }
                            case 'fssnlist_response': {
                                const source = 'fssnEqlist'
                                const Data = data?.Data
                                if(this.isApiEnabled(source, 'fan')) this.setHistory(source, Data)
                                break
                            }
                            case 'cencirlist_response': {
                                if(!this.isApiEnabled('cencEqlist', 'fan')) break
                                const isEmpty = this.intReportIds.size == 0
                                const arr = data.Data?.map(item => ({
                                    id: String(item.id),
                                    msg: `${item.locName}M${item.magnitude}`
                                }))
                                const newMsgs = []
                                arr?.forEach(item => {
                                    if(!this.intReportIds.has(item.id)) {
                                        this.intReportIds.add(item.id)
                                        newMsgs.push(item.msg)
                                    }
                                })
                                if(!isEmpty && newMsgs.length > 0) {
                                    const message = '收到新的CENC烈度速报: ' + newMsgs.join(' ')
                                    ElMessage({
                                        message,
                                        type: 'success',
                                        duration: 10000,
                                        showClose: true,
                                    })
                                    const settingsStore = useSettingsStore()
                                    if(settingsStore.mainSettings.onReport.sound) {
                                        playSound('detail')
                                    }
                                    if(settingsStore.mainSettings.onReport.focus) focusWindow()
                                    if(settingsStore.mainSettings.onReport.notification) {
                                        sendMyNotification('CENC烈度速报', message, iconUrls.info)
                                    }
                                }
                                while(this.intReportIds.size > maxIntReportNum) {
                                    const first = this.intReportIds.values().next().value
                                    this.intReportIds.delete(first)
                                }
                                break
                            }
                            case 'cencirdetail_response': {
                                const Data = data?.Data
                                this.historyList?.find(event => event.eqMessage.intReportId == Data.id)?.createStations(Data)
                                break
                            }
                        }
                    })
                }
                if(this.p2pquakeSocket) this.p2pquakeSocket.close()
                if(this.activeP2pquakeSources.length > 0) {
                    this.p2pquakeSocket = new WebSocketObj(eqUrls.p2pquake_ws, ['ping'])
                    this.trackWebSocketStatus('p2pquake', this.p2pquakeSocket)
                    this.p2pquakeSocket.setMessageHandler((e)=>{
                        const data = JSON.parse(e.data)
                        switch(data.code) {
                            case 551:
                                if(this.activeP2pquakeSources.includes('jmaEqlist')) this.setEqMessage('jmaEqlist', data)
                                break
                            case 552:
                                if(this.activeP2pquakeSources.includes('jmaTsunami')) this.setTsunamiMessage('jmaTsunami', data)
                                break
                        }
                    })
                }
                if(this.gqSocket) this.gqSocket.close()
                if(this.isApiEnabled('gqEew', 'globalquake') && 'gqEew_ws' in eqUrls) {
                    this.gqSocket = new WebSocketObj(eqUrls.gqEew_ws, ['ping'])
                    this.trackWebSocketStatus('gq', this.gqSocket)
                    this.gqSocket.setMessageHandler((e)=>{
                        const data = JSON.parse(e.data)
                        if(data.RevisionId) this.setEqMessage('gqEew', data)
                    })
                }
            }
            else{
                console.log('Unrecognized protocol type.')
            }
        },
        getIrDetail(id) {
            if(this.fanSocket && this.isApiEnabled('cencEqlist', 'fan') && id) {
                const msg = {
                    type: 'cencirdetail',
                    id
                }
                this.fanSocket.send(JSON.stringify(msg))
            }
        },
        disconnect(){
            clearInterval(this.httpRequest)
            clearTimeout(this.wsConnectTimer)
            this.wsConnectTimer = null
            if(this.wolfxSocket) this.wolfxSocket.close()
            if(this.fanSocket) this.fanSocket.close()
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
