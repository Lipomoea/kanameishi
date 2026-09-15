<template>
    <div>

    </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch, inject } from 'vue';
import { useStatusStore } from '@/stores/status';
import { useSettingsStore } from '@/stores/settings';
import { FAN_API_APP_ID, iconUrls, seisNetUrls } from '@/utils/Urls';
import { playSound, sendMyNotification, calcTimeDiff, focusWindow, getMmiFromKmaLevel, exactRound, calcDistanceKm } from '@/utils/Utils';
import 'leaflet/dist/leaflet.css';
import { KmaStation, simpleIcon } from '@/classes/StationClasses';
import { KmaStationCanvasLayer } from '@/classes/StationCanvasLayer';
import { KmaGridCanvasLayer } from '@/classes/GridCanvasLayer';
import WebSocketObj from '@/classes/WebSocket';

const statusStore = useStatusStore()
const settingsStore = useSettingsStore()
const useStationCanvasRenderer = computed(() => !settingsStore.advancedSettings.fallbackSvgStationRender)

const kmaUpdateTime = inject('kmaUpdateTime')
const kmaMaxInt = inject('kmaMaxInt')
const kmaPeriodMaxInt = inject('kmaPeriodMaxInt')
const kmaPeriodBarClass = inject('kmaPeriodBarClass')
const handleTempEqlists = inject('handleTempEqlists')
const smartSetView = inject('smartSetView')
let periodMaxLevel = -1
const stationList = reactive([])
const stations = reactive([])
let stationCanvasLayer = null
let gridCanvasLayer = null
let distMatrix = [[]]
let adjStationIds = {}
let map
let stopped = false
let pendingRender = false
const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible' && pendingRender) {
        pendingRender = false
        renderAll()
    }
}
let decimal = [0, 0]
const activeStations = computed(() => stations.filter(station => station.isActive))
const grids = computed(()=>{
    const gridMap = {}
    activeStations.value.forEach(station=>{
        const latLng = station.latLng.map((l, index) => Math.round(exactRound(l - decimal[index], 10)) + decimal[index])
        const level = station.activityLevel
        const key = JSON.stringify(latLng)
        if(key in gridMap){
            if(level > gridMap[key].level) gridMap[key].level = level
        }
        else {
            gridMap[key] = {
                latLng,
                level
            }
        }
    })
    return Object.values(gridMap)
})
const currentMaxShindo = computed(()=>{
    const currentMaxLevel = Math.max(...activeStations.value.map(station => station.recentMaxLevel), -1)
    if(currentMaxLevel == -1) return -1
    else if(currentMaxLevel <= 3) return 0
    else if(currentMaxLevel <= 4) return 1
    else if(currentMaxLevel <= 6) return 2
    else if(currentMaxLevel <= 7) return 3
    else if(currentMaxLevel <= 8) return 4
    else if(currentMaxLevel <= 10) return 5
    else if(currentMaxLevel <= 11) return 6
    else return 7
})
// Percent is an integer (60 means 60%); compare integer products to avoid floating-point rounding.
const meetsStationThreshold = (count, totalCount, percent, minCount) =>
    count >= minCount && count * 100 >= totalCount * percent
const update = (intensities) => {
    const render = document.visibilityState === 'visible'
    if(!render) pendingRender = true
    let maxLevel = -1
    stations.forEach((station, index) => {
        station.update(intensities[index], render)
        if(station.holdLevel > maxLevel) maxLevel = station.holdLevel
    })
    if(render && useStationCanvasRenderer.value) renderAll()
    kmaMaxInt.value = getMmiFromKmaLevel(maxLevel)
    const activeStations = new Set()
    let first = null
    for(let i = 0; i < stationList.length; i++) {
        const station = stations[i]
        const nearbyStations = adjStationIds[i].map(id => stations[id])
        let flag = false
        if(station.isActive && station.ascend > 0) {
            flag = true
        }
        else if(station.isActive || station.ascend > 0) {
            const nearbyLevels = nearbyStations.filter(station => station.isActive || station.ascend > 0).map(station => station.activityLevel)
            const nearbyAscends = nearbyStations.map(station => station.ascend)
            const nearbyNum = nearbyStations.length
            const countInt1 = nearbyLevels.filter(level => level >= 3).length
            const countInt2 = nearbyLevels.filter(level => level >= 4).length
            const countAsc1 = nearbyAscends.filter(ascend => ascend >= 1).length
            const countAsc2 = nearbyAscends.filter(ascend => ascend >= 2).length
            switch(settingsStore.mainSettings.displaySeisNet.kmaSensitivity) {
                case 1: 
                    flag = meetsStationThreshold(countInt1, nearbyNum, 60, 4) ||
                        meetsStationThreshold(countInt2, nearbyNum, 20, 2) ||
                        meetsStationThreshold(countAsc2, nearbyNum, 70, 4)
                    break
                case 2: 
                    flag = meetsStationThreshold(countInt1, nearbyNum, 50, 3) ||
                        meetsStationThreshold(countInt2, nearbyNum, 15, 2) ||
                        meetsStationThreshold(countAsc2, nearbyNum, 60, 4)
                    break
                case 3: 
                    flag = meetsStationThreshold(countInt1, nearbyNum, 50, 3) ||
                        meetsStationThreshold(countInt2, nearbyNum, 15, 2) ||
                        meetsStationThreshold(countAsc2, nearbyNum, 60, 4) ||
                        meetsStationThreshold(countAsc1, nearbyNum, 80, 5)
                    break
                default:
                    return
            }
        }
        if(flag) {
            nearbyStations.forEach(station => {
                if((station.isActive || station.ascend > 0) && !activeStations.has(station)) {
                    station.setActive()
                    activeStations.add(station)
                    if(!statusStore.isActive.kmaNet && (!first || station.activityLevel > first.activityLevel))
                        first = station
                }
            })
        }
    }
    if(first) decimal = first.latLng.map(val => exactRound((val + 180) % 1, 2))
}
const renderAll = ()=>{
    if(useStationCanvasRenderer.value) {
        stationCanvasLayer?.redraw()
        return
    }
    stations.forEach(station=>{
        station.render()
    })
}
const initStationCanvasLayer = () => {
    if(!useStationCanvasRenderer.value) return
    if(!map || stationCanvasLayer || stations.length === 0) return
    stationCanvasLayer = new KmaStationCanvasLayer(stations).addTo(map)
}
const initGridCanvasLayer = () => {
    if(!map || gridCanvasLayer) return
    gridCanvasLayer = new KmaGridCanvasLayer(grids.value).addTo(map)
}
let kmaSocket = null
onMounted(()=>{
    const apiKey = settingsStore.mainSettings.apiKeys.fanApiKey?.trim()
    if(!apiKey) {
        ElMessage({
            message: '未填写FAN Studio API Key, KMA-PEWS不可用',
            type: 'error'
        })
        settingsStore.mainSettings.displaySeisNet.kmaNet = false
        return
    }
    const authMessage = JSON.stringify({
        type: 'auth',
        appId: FAN_API_APP_ID,
        key: apiKey
    })
    const url = [...seisNetUrls.kma]
    const defaultId = settingsStore.advancedSettings.defaultFanServer
    url.unshift(...url.splice(defaultId, 1))
    const autoReconnectOnAuthFail = settingsStore.mainSettings.apiAuthAutoReconnect
    kmaSocket = new WebSocketObj(url, ['ping'], [authMessage], {
        resetRetryOnOpen: !autoReconnectOnAuthFail
    })
    kmaSocket.setMessageHandler(e => {
        if(stopped) return
        const data = JSON.parse(e.data)
        const type = data?.type
        switch(type) {
            case 'auth_success': {
                kmaSocket.resetRetryInterval()
                ElMessage({
                    message: 'FAN Studio API (KMA-PEWS)认证成功',
                    type: 'success'
                })
                break
            }
            case 'auth_fail': {
                ElMessage({
                    message: data.message
                        ? `FAN Studio API (KMA-PEWS)认证失败：${data.message}`
                        : 'FAN Studio API (KMA-PEWS)认证失败，请检查API Key',
                    type: 'error',
                    duration: 10000,
                    showClose: true
                })
                if(autoReconnectOnAuthFail) kmaSocket.retryAfterFailure()
                else settingsStore.mainSettings.displaySeisNet.kmaNet = false
                break
            }
            case 'initial_stations': case 'kma_stations_update': {
                const list = data.stations
                if(list && JSON.stringify(list) != JSON.stringify(stationList)) {
                    stationList.length = 0
                    stationList.push(...list)
                }
                break
            }
            case 'initial': case 'update': {
                const Data = data.Data
                const { timestamp, mmi } = Data
                const timeDiff = calcTimeDiff(timestamp, 9, kmaUpdateTime.value, 9)
                if(timeDiff > 0) {
                    if(mmi.length != stations.length || mmi.some(int => int == -3)) return
                    if(timeDiff > 1000) {
                        const popNum = Math.min(Math.round(timeDiff / 1000) - 1, 60)
                        const noDataArr = Array(popNum).fill(-1)
                        stations.forEach(station => {
                            station.recentLevel.unshift(...noDataArr)
                            station.recentLevel.splice(station.recentSeconds)
                        })
                    }
                    kmaUpdateTime.value = timestamp
                    update(mmi)
                }
                break
            }
        }
    })
    document.addEventListener('visibilitychange', handleVisibilityChange)
})
let unwatchGrids, unwatchStationList, unwatchRender
watch(()=>statusStore.map, newVal=>{
    if(newVal !== null){
        map = newVal
        initStationCanvasLayer()
        initGridCanvasLayer()
        map.on('zoomend', renderAll)
        unwatchStationList = watch(stationList, newVal=>{
            if(newVal.length > 0){
                stations.forEach(station=>{
                    station.terminate()
                })
                stations.length = 0
                map.eachLayer(layer=>{
                    if(layer.options.pane?.includes('kmaStationPane')){
                        map.removeLayer(layer)
                    }
                })
                distMatrix = [[]]
                adjStationIds = {}
                let latLngs = []
                for(let i = 0; i < newVal.length; i++){
                    const { latitude, longitude } = newVal[i]
                    latLngs[i] = [latitude, longitude]
                }
                for(let i = 0; i < stationList.length; i++){
                    const distances = []
                    distMatrix[i] = []
                    for(let j = 0; j < stationList.length; j++){
                        let distance
                        if(j < i) distance = distMatrix[j][i]
                        else if(j == i) distance = 0
                        else distance = calcDistanceKm(latLngs[i], latLngs[j])
                        distMatrix[i][j] = distance
                        if(distance <= 30) distances.push({ id: j, distance })
                    }
                    distances.sort((a, b) => a.distance - b.distance)
                    adjStationIds[i] = distances.map(obj => obj.id)
                }
                newVal.forEach((item, index)=>{
                    const latLng = [item.latitude, item.longitude]
                    const station = reactive(new KmaStation(map, index, latLng, -3, false, useStationCanvasRenderer.value))
                    stations.push(station)
                })
                initStationCanvasLayer()
                renderAll()
            }
        }, { immediate: true })
        unwatchGrids = watch(grids, (newVal)=>{
            let maxLevel = -1
            gridCanvasLayer?.setGrids(newVal)
            newVal.forEach(item => {
                if(item.level > maxLevel) maxLevel = item.level
                if(item.level > periodMaxLevel) periodMaxLevel = item.level
            })
            kmaPeriodMaxInt.value = getMmiFromKmaLevel(periodMaxLevel)
            kmaPeriodBarClass.value = maxLevel >= 0 ? KmaGridCanvasLayer.getGridColorByLevel(maxLevel) : 'gray'
            statusStore.isActive.kmaNet = newVal.length > 0
        }, { immediate: true })
        unwatchRender = watch(
            ()=>`${settingsStore.mainSettings.displaySeisNet.style}
            |${settingsStore.mainSettings.displaySeisNet.displayKmaInt}
            |${settingsStore.mainSettings.displaySeisNet.hideNoData}
            |${simpleIcon.value}
            |${settingsStore.mainSettings.displaySeisNet.displayShindo0}`, 
            renderAll
        )
    }
}, { immediate: true })
watch(()=>(statusStore.isActive.kmaEew || statusStore.isActive.kmaNet), newVal=>{
    if(newVal){
        if(periodMaxLevel == -1){
            periodMaxLevel = 0
            kmaPeriodMaxInt.value = getMmiFromKmaLevel(periodMaxLevel)
        }
    }
    else{
        periodMaxLevel = -1
        kmaPeriodMaxInt.value = getMmiFromKmaLevel(periodMaxLevel)
    }
}, { immediate: true })
watch(() => grids.value.length, () => smartSetView())
let shake1Notified = false, shake2Notified = false
let focused = false
watch(currentMaxShindo, (newVal, oldVal)=>{
    if(newVal > oldVal){
        if(settingsStore.mainSettings.onShake.sound){
            const type = `shindo${newVal}`
            playSound(type)
        }
        if(settingsStore.mainSettings.onShake.notification){
            if(newVal >= 1 && newVal <= 3 && !shake1Notified){
                sendMyNotification('흔들림을 감지하다', 
                    '흔들림에 주의하세요.', 
                    iconUrls.caution
                )
                shake1Notified = true
            }
            else if(newVal >= 4 && !shake2Notified){
                sendMyNotification('강한 흔들림을 감지했습니다', 
                    '강한 흔들림에 주의하세요.', 
                    iconUrls.warn
                )
                shake1Notified = true
                shake2Notified = true
            }
        }
        if(settingsStore.mainSettings.onShake.focus){
            if(newVal >= 1 && !focused){
                focusWindow()
                focused = true
            }
        }
        handleTempEqlists(0)
    }
    else{
        shake1Notified = false
        shake2Notified = false
        focused = false
    }
})
onBeforeUnmount(()=>{
    stopped = true
    kmaSocket?.close()
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    if(unwatchGrids) unwatchGrids()
    if(unwatchStationList) unwatchStationList()
    if(unwatchRender) unwatchRender()
    if(map) {
        map.off('zoomend', renderAll)
        if(stationCanvasLayer && map.hasLayer(stationCanvasLayer)) map.removeLayer(stationCanvasLayer)
        if(gridCanvasLayer && map.hasLayer(gridCanvasLayer)) map.removeLayer(gridCanvasLayer)
        map.eachLayer(layer=>{
            if(layer.options.pane == 'kmaGridPane' || layer.options.pane?.includes('kmaStationPane')){
                map.removeLayer(layer)
            }
        })
    }
    stationCanvasLayer = null
    gridCanvasLayer = null
    stations.forEach((station, index)=>{
        station.terminate()
        stations[index] = null
    })
    stations.length = 0
    statusStore.isActive.kmaNet = false
})
</script>

<style lang="scss" scoped>

</style>
