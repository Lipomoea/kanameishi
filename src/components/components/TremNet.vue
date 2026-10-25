<template>
    <div>

    </div>
</template>

<script setup>
import { reactive, computed, onMounted, onBeforeUnmount, watch, inject } from 'vue';
import Http from '@/classes/Http';
import { StationFrameQueue } from '@/features/stations/StationFrameQueue';
import { tremConfig, selectTremStationSource } from '@/features/stations/TremConfig';
import { parseTremStationList, readTremFrame, connectTremRts } from '@/features/stations/TremRtsClient';
import { isNetworkPeriodActive } from '@/features/eew/EewNetworkRelations';
import { useStatusStore } from '@/stores/status';
import { useSettingsStore } from '@/stores/settings';
import { iconUrls } from '@/utils/Urls';
import { playSound, sendMyNotification, focusWindow, getShindoFromInstShindo, stampToTime, getShindoFromLevel } from '@/utils/Utils';
import 'leaflet/dist/leaflet.css';
import { simpleIcon, TremStation } from '@/classes/StationClasses';
import { TaiwanGridCanvasLayer } from '@/classes/GridCanvasLayer';
import { useTimeStore } from '@/stores/time';

const statusStore = useStatusStore()
const settingsStore = useSettingsStore()
const timeStore = useTimeStore()
const useStationCanvasRenderer = computed(() => !settingsStore.advancedSettings.fallbackSvgStationRender)

const stationList = reactive({})
let stationData
const stations = reactive({})
const taiwanSeisNetLayers = inject('taiwanSeisNetLayers')
const unregisterSource = taiwanSeisNetLayers.registerSource('trem', stations, station => station.level)
let map
let mounted = false
let stopped = false
let requestGeneration = 0
let latestFrameStamp = null
let pendingTimelineSwitch = false
const frameQueue = new StationFrameQueue(
    frame => commitFrame(frame),
    () => settingsStore.mainSettings.displaySeisNet.httpDataPriority === 'complete'
)
const delay = computed(()=>statusStore.seisNetReplayDelay * 60000)
const stationDataUrl = computed(() => selectTremStationSource(
    tremConfig.value.stationSources, settingsStore.mainSettings.displaySeisNet.tremApi
)?.url)
const tremMaxShindo = inject('tremMaxShindo')
const tremUpdateTime = inject('tremUpdateTime')
const tremPeriodMaxShindo = inject('tremPeriodMaxShindo')
const tremPeriodBarClass = inject('tremPeriodBarClass')
const handleTempEqlists = inject('handleTempEqlists')
let periodMaxLevel = -1
const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible' && pendingRender) {
        pendingRender = false
        renderAll()
    }
}
const currentMaxShindo = computed(()=>{
    const currentMaxLevel = Math.max(...activeLevels.value, -1)
    if(currentMaxLevel == -1) return -1
    else if(currentMaxLevel <= 7) return 0
    else if(currentMaxLevel <= 9) return 1
    else if(currentMaxLevel <= 11) return 2
    else if(currentMaxLevel <= 13) return 3
    else if(currentMaxLevel <= 15) return 4
    else if(currentMaxLevel <= 17) return 5
    else if(currentMaxLevel <= 19) return 6
    else return 7
})
const activeLevels = computed(() => Object.values(stations)
    .filter(station => station.isActive)
    .map(station => station.level))
let pendingRender = false
const update = ()=>{
    const render = document.visibilityState === 'visible'
    if(!render) pendingRender = true
    let maxInst = -3.1
    Object.keys(stations).forEach(id=>{
        const data = stationData[id]
        if(Number.isFinite(data?.i)){
            const alert = !!data.alert
            const intensity = data.i
            stations[id].update(intensity, alert, render)
            if(intensity > maxInst) maxInst = intensity
        }
        else stations[id].update(-3.1, false, render)
    })
    if(render && useStationCanvasRenderer.value) renderAll()
    tremMaxShindo.value = getShindoFromInstShindo(maxInst)
}
const renderAll = ()=>{
    if(useStationCanvasRenderer.value) {
        taiwanSeisNetLayers.redrawStations()
        return
    }
    Object.keys(stations).forEach(id=>{
        stations[id].render()
    })
}
const clearReactiveObject = (obj) => {
    if(obj) for(let key in obj) delete obj[key]
}
let fetchStationTimer, requestInterval
let stationListGeneration = 0
let stationListController, stopRealtime
const replayControllers = new Set()
const fetchStationList = async () => {
    if(stopped || !tremConfig.value.stationList) return
    const generation = stationListGeneration
    const controller = new AbortController()
    stationListController = controller
    try {
        const url = new URL(tremConfig.value.stationList)
        url.searchParams.set('time', Date.now())
        // The server labels the CSV as application/json; always read it as text.
        const res = await Http.get(url.toString(), {
            responseType: 'text', transformResponse: [data => data], timeout: 30000,
            signal: controller.signal
        })
        if(stopped || generation !== stationListGeneration) return
        const validStations = parseTremStationList(res)
        if(Object.keys(validStations).length === 0) return
        if(JSON.stringify(validStations) != JSON.stringify(stationList)){
            clearReactiveObject(stationList)
            Object.assign(stationList, validStations)
        }
    } catch (err) {
        console.log(err);
    }
    finally {
        if(stationListController === controller) stationListController = null
        if(!stopped && generation === stationListGeneration) {
            fetchStationTimer = setTimeout(fetchStationList, Object.keys(stationList).length > 0 ? 10 * 60 * 1000 : 10 * 1000)
        }
    }
}
const commitFrame = ({ timestamp: frameStamp, data, generation }) => {
    if(stopped || generation != requestGeneration) return
    if(!pendingTimelineSwitch && latestFrameStamp !== null && frameStamp <= latestFrameStamp) return
    pendingTimelineSwitch = false
    latestFrameStamp = frameStamp
    stationData = data
    tremUpdateTime.value = stampToTime(frameStamp, 8)
    update()
}
const fetchReplayFrame = async () => {
    if(stopped || delay.value <= 0 || !tremConfig.value.stationReplay) return
    const generation = requestGeneration
    const time = timeStore.getTimeStamp() - delay.value
    const targetTime = Math.round(time / 1000)
    const ticket = frameQueue.begin(targetTime * 1000)
    if(!frameQueue.isPending(ticket)) return
    const controller = new AbortController()
    replayControllers.add(controller)
    let frame = null
    try {
        const url = new URL(tremConfig.value.stationReplay)
        url.pathname = `${url.pathname.replace(/\/+$/, '')}/${targetTime}`
        const res = await Http.get(url.toString(), { timeout: 3000, signal: controller.signal })
        if(stopped || generation !== requestGeneration || !frameQueue.isPending(ticket)) return
        const parsed = readTremFrame(res)
        if(parsed) frame = { ...parsed, generation }
    }
    catch(err) {
        console.log(err)
    }
    finally {
        replayControllers.delete(controller)
        frameQueue.finish(ticket, frame)
    }
}
const stopTransport = () => {
    stopRealtime?.()
    stopRealtime = null
    clearInterval(requestInterval)
    replayControllers.forEach(controller => controller.abort())
    replayControllers.clear()
}
const restartTransport = (timelineSwitch = false) => {
    if(!mounted || stopped) return
    requestGeneration++
    stopTransport()
    if(timelineSwitch) pendingTimelineSwitch = true
    frameQueue.reset(pendingTimelineSwitch ? null : latestFrameStamp)
    if(delay.value > 0) {
        if(!tremConfig.value.stationReplay) return
        fetchReplayFrame()
        requestInterval = setInterval(fetchReplayFrame, 1000)
    }
    else if(stationDataUrl.value) {
        const generation = requestGeneration
        stopRealtime = connectTremRts(stationDataUrl.value, frame => commitFrame({ ...frame, generation }))
    }
}
onMounted(()=>{
    mounted = true
    fetchStationList()
    restartTransport()
    document.addEventListener('visibilitychange', handleVisibilityChange)
})
let unwatchStationList, unwatchActivity, unwatchRender
watch(()=>statusStore.map, newVal=>{
    if(newVal !== null){
        map = newVal
        map.on('zoomend', renderAll)
        unwatchStationList = watch(stationList, newVal=>{
            if(Object.keys(newVal).length > 0){
                Object.keys(stations).forEach(id=>{
                    stations[id].terminate()
                    delete stations[id]
                })
                Object.keys(newVal).forEach(id=>{
                    const info = newVal[id].info.slice(-1)[0]
                    const latLng = [info.lat, info.lon]
                    const station = reactive(new TremStation(map, id, latLng, -3.1, false, useStationCanvasRenderer.value))
                    stations[id] = station
                })
                // Metadata refreshes keep the active connection and its generation.
                if(stationData && !pendingTimelineSwitch) update()
                else renderAll()
            }
        }, { immediate: true })
        unwatchActivity = watch(activeLevels, (newVal)=>{
            let maxLevel = -1
            newVal.forEach(level => {
                if(level > maxLevel) {
                    maxLevel = level
                }
                if(level > periodMaxLevel) periodMaxLevel = level
            })
            tremPeriodMaxShindo.value = getShindoFromLevel(periodMaxLevel)
            tremPeriodBarClass.value = maxLevel >= 0 ? TaiwanGridCanvasLayer.getGridColorByLevel(maxLevel) : 'gray'
            statusStore.isActive.tremNet = newVal.length > 0
        }, { immediate: true })
        unwatchRender = watch(
            ()=>`${settingsStore.mainSettings.displaySeisNet.style}
            |${settingsStore.mainSettings.displaySeisNet.displayTremShindo}
            |${settingsStore.mainSettings.displaySeisNet.hideNoData}
            |${simpleIcon.value}
            |${settingsStore.mainSettings.displaySeisNet.displayShindo0}`, 
            renderAll
        )
    }
}, { immediate: true })
watch([delay, stationDataUrl, () => tremConfig.value.stationReplay], ([newDelay], [oldDelay]) => {
    restartTransport(newDelay !== oldDelay)
}, { flush: 'sync' })
watch(() => tremConfig.value.stationList, () => {
    stationListGeneration++
    clearTimeout(fetchStationTimer)
    stationListController?.abort()
    if(mounted) fetchStationList()
}, { flush: 'sync' })
watch(() => isNetworkPeriodActive('tremNet', statusStore.isActive), newVal=>{
    if(newVal){
        if(periodMaxLevel == -1){
            periodMaxLevel = 0
            tremPeriodMaxShindo.value = getShindoFromLevel(periodMaxLevel)
        }
    }
    else{
        periodMaxLevel = -1
        tremPeriodMaxShindo.value = getShindoFromLevel(periodMaxLevel)
    }
}, { immediate: true })
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
                sendMyNotification('檢測到震動', 
                    '請注意搖晃。', 
                    iconUrls.caution
                )
                shake1Notified = true
            }
            else if(newVal >= 4 && !shake2Notified){
                sendMyNotification('檢測到強震動', 
                    '請警戒強烈搖晃。', 
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
watch(() => settingsStore.mainSettings.displaySeisNet.httpDataPriority, () => {
    if(delay.value > 0) restartTransport()
}, { flush: 'sync' })
onBeforeUnmount(()=>{
    stopped = true
    requestGeneration++
    frameQueue.reset()
    clearTimeout(fetchStationTimer)
    stationListController?.abort()
    stopTransport()
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    if(unwatchStationList) unwatchStationList()
    if(unwatchActivity) unwatchActivity()
    if(unwatchRender) unwatchRender()
    if(map) {
        map.off('zoomend', renderAll)
    }
    unregisterSource()
    Object.keys(stations).forEach(id=>{
        stations[id].terminate()
        delete stations[id]
    })
    statusStore.isActive.tremNet = false
})
</script>

<style lang="scss" scoped>

</style>
