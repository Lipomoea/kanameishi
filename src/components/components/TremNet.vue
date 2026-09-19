<template>
    <div>

    </div>
</template>

<script setup>
import { reactive, computed, onMounted, onBeforeUnmount, watch, inject } from 'vue';
import Http from '@/classes/Http';
import { StationFrameQueue } from '@/features/stations/StationFrameQueue';
import { isNetworkPeriodActive } from '@/features/eew/EewNetworkRelations';
import { useStatusStore } from '@/stores/status';
import { useSettingsStore } from '@/stores/settings';
import { seisNetUrls, iconUrls } from '@/utils/Urls';
import { playSound, sendMyNotification, focusWindow, getShindoFromInstShindo, stampToTime, getShindoFromLevel } from '@/utils/Utils';
import 'leaflet/dist/leaflet.css';
import { simpleIcon, TremStation } from '@/classes/StationClasses';
import { TaiwanGridCanvasLayer } from '@/classes/GridCanvasLayer';
import { useTimeStore } from '@/stores/time';

const statusStore = useStatusStore()
const settingsStore = useSettingsStore()
const timeStore = useTimeStore()
const useStationCanvasRenderer = computed(() => !settingsStore.advancedSettings.fallbackSvgStationRender)

Object.assign(seisNetUrls, JSON.parse(localStorage.getItem('tremUrl'))?.seisNetUrls)
const stationList = reactive({})
let stationData
const stations = reactive({})
const taiwanSeisNetLayers = inject('taiwanSeisNetLayers')
const unregisterSource = taiwanSeisNetLayers.registerSource('trem', stations, station => station.level)
let map
let stopped = false
let requestGeneration = 0
let latestFrameStamp = null
let pendingTimelineSwitch = false
const frameQueue = new StationFrameQueue(
    frame => commitFrame(frame),
    () => settingsStore.mainSettings.displaySeisNet.httpDataPriority === 'complete'
)
const delay = computed(()=>statusStore.seisNetReplayDelay * 60000)
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
        if(id in stationData){
            const alert = !!stationData[id].alert
            const intensity = alert ? stationData[id].I : stationData[id].i
            stations[id].update(intensity, alert, render)
            if(intensity > maxInst) maxInst = intensity
        }
        else stations[id].update(-3.1, false)
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
const isValidStationInfo = ([id, station]) => {
    const info = Array.isArray(station?.info) ? station.info.at(-1) : null
    return id.length > 0 && Number.isFinite(info?.lat) && Math.abs(info.lat) <= 90 &&
        Number.isFinite(info?.lon) && Math.abs(info.lon) <= 180
}
const fetchStationList = async () => {
    if(stopped) return
    try {
        const res = await Http.get(seisNetUrls?.trem.stationList + `?time=${Date.now()}`)
        if(stopped || !res || typeof res !== 'object' || Array.isArray(res)) return
        const validStations = Object.fromEntries(Object.entries(res).filter(isValidStationInfo))
        if(Object.keys(validStations).length === 0) return
        if(JSON.stringify(validStations) != JSON.stringify(stationList)){
            clearReactiveObject(stationList)
            Object.assign(stationList, validStations)
        }
    } catch (err) {
        console.log(err);
    }
    finally {
        if(!stopped) {
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
onMounted(()=>{
    fetchStationList()
    requestInterval = setInterval(async () => {
        if(stopped) return
        const generation = requestGeneration
        const time = timeStore.getTimeStamp() - delay.value
        const targetTime = delay.value > 0 ? Math.round(time / 1000) : null
        const ticket = frameQueue.begin(targetTime === null ? null : targetTime * 1000)
        let frame = null
        try {
            const res = await Http.get(stationDataUrl.value + (targetTime !== null ? `/${targetTime}` : `?time=${time}`), { timeout: 3000 })
            if(stopped || generation != requestGeneration || !frameQueue.isPending(ticket)) return
            if(res && Object.keys(res).length > 0){
                const frameStamp = Number(res.time)
                if(!Number.isFinite(frameStamp) || !res.station || typeof res.station !== 'object' || Array.isArray(res.station)) return
                const isFirstFrameAfterTimelineSwitch = pendingTimelineSwitch
                if(!isFirstFrameAfterTimelineSwitch && latestFrameStamp !== null && frameStamp <= latestFrameStamp) return

                frame = { timestamp: frameStamp, data: res.station, generation }
            }
        } catch (err) {
            console.log(err);
        }
        finally {
            frameQueue.finish(ticket, frame)
        }
    }, 1000);
    document.addEventListener('visibilitychange', handleVisibilityChange)
})
const scheduleTimelineSwitch = () => {
    requestGeneration++
    frameQueue.reset()
    pendingTimelineSwitch = true
}
let unwatchStationList, unwatchActivity, unwatchRender, unwatchDelay
watch(()=>statusStore.map, newVal=>{
    if(newVal !== null){
        map = newVal
        map.on('zoomend', renderAll)
        unwatchStationList = watch(stationList, newVal=>{
            if(Object.keys(newVal).length > 0){
                requestGeneration++
                frameQueue.reset(pendingTimelineSwitch ? null : latestFrameStamp)
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
                renderAll()
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
unwatchDelay = watch(delay, scheduleTimelineSwitch)
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
const stationDataUrl = computed(() => delay.value > 0 ? seisNetUrls?.trem.stationData : seisNetUrls?.trem.stationData.replace(/api-\d/, settingsStore.mainSettings.displaySeisNet.tremApi))
watch([() => settingsStore.mainSettings.displaySeisNet.httpDataPriority, stationDataUrl], () => {
    requestGeneration++
    frameQueue.reset(pendingTimelineSwitch ? null : latestFrameStamp)
}, { flush: 'sync' })
onBeforeUnmount(()=>{
    stopped = true
    requestGeneration++
    frameQueue.reset()
    clearTimeout(fetchStationTimer)
    clearInterval(requestInterval)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    if(unwatchStationList) unwatchStationList()
    if(unwatchActivity) unwatchActivity()
    if(unwatchRender) unwatchRender()
    if(unwatchDelay) unwatchDelay()
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
