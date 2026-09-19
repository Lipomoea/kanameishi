<template>
    <div />
</template>

<script setup>
import { reactive, computed, onMounted, onBeforeUnmount, watch, inject } from 'vue';
import { createPalertHypocenterUpdate, mergePalertHypocenterUpdates } from '@/features/stations/PalertHypocenterUpdates';
import Palert from '@/classes/Palert';
import { StationFrameQueue } from '@/features/stations/StationFrameQueue';
import { isNetworkPeriodActive, shouldDisplayInferredHypocenter } from '@/features/eew/EewNetworkRelations';
import { useStatusStore } from '@/stores/status';
import { useSettingsStore } from '@/stores/settings';
import { iconUrls } from '@/utils/Urls';
import { calcDistanceKm, calcBearingDeg, calcWaveDistance, compareFloat, focusWindow, getPalertLevelFromPgaPgv, getShindoFromLevel, playSound, sendMyNotification, stampToTime } from '@/utils/Utils';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { PalertStation, simpleIcon } from '@/classes/StationClasses';
import { TaiwanGridCanvasLayer } from '@/classes/GridCanvasLayer';
import { useTimeStore } from '@/stores/time';
import travelTimes from '@/utils/TravelTimes';
import infHypoIconUrl from '@/assets/icon/hypocenter/infHypo.svg';

const statusStore = useStatusStore()
const settingsStore = useSettingsStore()
const timeStore = useTimeStore()
const useStationCanvasRenderer = computed(() => !settingsStore.advancedSettings.fallbackSvgStationRender)
let hypocenterWorker = null
let hypocenterRequestId = 0
let inFlightHypocenterRequestId = null
let pendingHypocenterUpdate = null
let adjStations4Hypo = {}
let inferredHypocenterMap = null
let inferredHypocenterLayers = null
let inferredHypocenterLabelLayers = []
const infHypoIcon = L.icon({ iconUrl: infHypoIconUrl, iconSize: [40, 40], iconAnchor: [20, 20] })
const inferredHypocenterLabelOffset = 24
const bearingDirections = ['N', 'E', 'S', 'W']
const minHypocenterNeighborsPerDirection = 3
const triggerCompatibilityConfig = {
    waveSpeedKmPerSecond: 3.5,
    fixedToleranceMilliseconds: 2000
}
const isHypocenterEnabled = computed(() => settingsStore.mainSettings.displaySeisNet.palertNet &&
    settingsStore.mainSettings.displaySeisNet.palertHypoInf)

const stationList = reactive([])
const stations = reactive({})
const taiwanSeisNetLayers = inject('taiwanSeisNetLayers')
const unregisterSource = taiwanSeisNetLayers.registerSource('palert', stations, station => station.holdLevel)
let adjStationIds = {}
let triggerDiffToleranceMatrix = {}
let stationVersion = ''
let map
let stopped = false
let requestGeneration = 0
let latestFrameStamp = null
let pendingTimelineSwitch = false
const frameQueue = new StationFrameQueue(
    frame => commitFrame(frame.timestamp, frame.pgaData, frame.pgvData, frame.generation),
    () => settingsStore.mainSettings.displaySeisNet.httpDataPriority === 'complete'
)
const delay = computed(() => statusStore.seisNetReplayDelay * 60000)
const palertMaxShindo = inject('palertMaxShindo')
const palertUpdateTime = inject('palertUpdateTime')
const palertPeriodMaxShindo = inject('palertPeriodMaxShindo')
const palertPeriodBarClass = inject('palertPeriodBarClass')
const handleTempEqlists = inject('handleTempEqlists')
const activeEewList = inject('activeEewList')
let periodMaxLevel = -1
let pendingRender = false

const handleVisibilityChange = () => {
    if(document.visibilityState === 'visible' && pendingRender) {
        pendingRender = false
        renderAll()
    }
}
const activeStations = computed(() => Object.values(stations).filter(station => station.isActive))
const activeLevels = computed(() => activeStations.value.map(station => station.holdLevel))
const currentMaxShindo = computed(() => {
    const currentMaxLevel = Math.max(...activeStations.value.map(station => station.recentMaxLevel), -1)
    if(currentMaxLevel == -1) return -1
    if(currentMaxLevel <= 7) return 0
    if(currentMaxLevel <= 9) return 1
    if(currentMaxLevel <= 11) return 2
    if(currentMaxLevel <= 13) return 3
    if(currentMaxLevel <= 15) return 4
    if(currentMaxLevel <= 17) return 5
    if(currentMaxLevel <= 19) return 6
    return 7
})
const normalizeMeasurement = value => Number.isFinite(value) && value >= 0 ? value : null
const parseTimestamp = value => {
    const numericValue = typeof value == 'number' || typeof value == 'string' && /^\d+(\.\d+)?$/.test(value)
        ? Number(value)
        : NaN
    if(Number.isFinite(numericValue)) return numericValue < 1e12 ? numericValue * 1000 : numericValue
    return Date.parse(value)
}
const parseResponse = (response, allowEmpty = false) => {
    if(!response || !response.dataVals || typeof response.dataVals != 'object' || Array.isArray(response.dataVals)) {
        throw new Error('P-Alert response has invalid dataVals')
    }
    if(!allowEmpty && Object.keys(response.dataVals).length === 0) {
        throw new Error('P-Alert response contains no station data')
    }
    const timestamp = parseTimestamp(response.timestamp)
    if(!Number.isFinite(timestamp)) throw new Error('P-Alert response has an invalid timestamp')
    return { dataVals: response.dataVals, timestamp }
}
const hasValidTriggerStamp = station =>
    Number.isFinite(station.triggerStamp) && station.triggerStamp > 0
const isStationTriggerCompatible = (station1, station2) => {
    if(!hasValidTriggerStamp(station1) || !hasValidTriggerStamp(station2)) return false
    const toleranceMilliseconds = triggerDiffToleranceMatrix[station1.id]?.[station2.id]
    if(!Number.isFinite(toleranceMilliseconds)) return false
    return Math.abs(station1.triggerStamp - station2.triggerStamp) <= toleranceMilliseconds
}
const getCompatibleNearbyStations = (centerStation, nearbyStations) => {
    if(!hasValidTriggerStamp(centerStation)) return []
    return nearbyStations.filter(station =>
        station.activity > 0 && isStationTriggerCompatible(centerStation, station)
    )
}
const chainActivate = (seedStation, activeStations) => {
    if(!hasValidTriggerStamp(seedStation)) return
    const pendingStations = new Set([seedStation])
    while(pendingStations.size > 0) {
        const currentStation = pendingStations.values().next().value
        pendingStations.delete(currentStation)
        activeStations.add(currentStation)
        const nearbyIds = adjStationIds[currentStation.id] ?? []
        nearbyIds.forEach(id => {
            const neighbor = stations[id]
            if(!neighbor || activeStations.has(neighbor) || pendingStations.has(neighbor)) return
            if(neighbor.activity <= 0 || !isStationTriggerCompatible(currentStation, neighbor)) return
            pendingStations.add(neighbor)
        })
    }
}
const detectActiveStations = () => {
    const activeStations = new Set()
    let minActivity, activityPercent
    switch(settingsStore.mainSettings.displaySeisNet.palertSensitivity) {
        case 1:
            minActivity = 3.5
            activityPercent = 12.5
            break
        case 2:
            minActivity = 3
            activityPercent = 10
            break
        case 3:
            minActivity = 2.5
            activityPercent = 8
            break
        default:
            return activeStations
    }
    const possibleStations = Object.values(stations).filter(station => station.activity > 0)
    possibleStations.forEach(station => {
        if(!activeStations.has(station)) {
            if(station.isActive && station.level >= 10 && hasValidTriggerStamp(station)) {
                chainActivate(station, activeStations)
            }
            else {
                const nearbyStations = (adjStationIds[station.id] ?? [])
                    .map(id => stations[id])
                    .filter(Boolean)
                const compatibleNearbyStations = getCompatibleNearbyStations(station, nearbyStations)
                const activitySum = compatibleNearbyStations.reduce((sum, nearbyStation) => sum + nearbyStation.activity, 0)
                // Multiply by the percentage first to keep boundaries such as 33 * 10 / 100 at 3.3.
                if(compareFloat(activitySum, Math.max(nearbyStations.length * activityPercent / 100, minActivity)) >= 0) {
                    chainActivate(station, activeStations)
                }
            }
        }
    })
    return activeStations
}
const updateMaxShindo = () => {
    const maxLevel = Math.max(...Object.values(stations).map(station => station.holdLevel), -1)
    palertMaxShindo.value = getShindoFromLevel(maxLevel)
}
const commitFrame = (frameStamp, pgaData, pgvData, generation) => {
    if(stopped || generation != requestGeneration) return
    const isFirstFrameAfterTimelineSwitch = pendingTimelineSwitch
    if(!isFirstFrameAfterTimelineSwitch && latestFrameStamp !== null && frameStamp <= latestFrameStamp) return

    const render = document.visibilityState === 'visible'
    if(!render) pendingRender = true
    pendingTimelineSwitch = false
    const missingSeconds = latestFrameStamp === null || isFirstFrameAfterTimelineSwitch
        ? 0
        : Math.min(Math.max(Math.round((frameStamp - latestFrameStamp) / 1000) - 1, 0), 60)
    if(isFirstFrameAfterTimelineSwitch) {
        Object.values(stations).forEach(station => {
            station.isActive = false
            clearTimeout(station.activeTimer)
        })
    }

    Object.keys(stations).forEach(id => {
        const pga = normalizeMeasurement(pgaData[id])
        const pgv = pgvData ? normalizeMeasurement(pgvData[id]) : null
        const level = getPalertLevelFromPgaPgv(pga, pgv)
        stations[id].update({ timestamp: frameStamp, pga, pgv, level }, missingSeconds, render)
    })

    latestFrameStamp = frameStamp
    palertUpdateTime.value = stampToTime(frameStamp, 8)
    updateMaxShindo()
    if(render && useStationCanvasRenderer.value) renderAll()

    const detectedStations = detectActiveStations()
    detectedStations.forEach(station => {
        station.setActive()
    })
    updateHypocenters()
}
const updateHypocenters = () => {
    if(!isHypocenterEnabled.value || pendingTimelineSwitch) return
    const currentStations = Object.values(stations)
    updateInferredHypocentersInWorker(createPalertHypocenterUpdate(currentStations))
}
const getHypocenterWorker = () => {
    if(hypocenterWorker) return hypocenterWorker
    const worker = new Worker(new URL('@/workers/FindPalertHypocenterWorker.js', import.meta.url), { type: 'module' })
    hypocenterWorker = worker
    worker.onmessage = ({ data }) => {
        if(hypocenterWorker !== worker || data.requestId !== inFlightHypocenterRequestId) return
        inFlightHypocenterRequestId = null
        if(!isHypocenterEnabled.value) {
            pendingHypocenterUpdate = null
            return
        }
        renderInferredHypocenters(data.results || [])
        postPendingHypocenterUpdate()
    }
    worker.onerror = error => {
        if(hypocenterWorker !== worker) return
        terminateHypocenterWorker()
        clearInferredHypocenters()
        console.error(error)
    }
    worker.postMessage({ type: 'init', adjStations: adjStations4Hypo })
    return worker
}
const resetHypocenterWorker = () => {
    inFlightHypocenterRequestId = null
    pendingHypocenterUpdate = null
    if(!hypocenterWorker) return
    const requestId = ++hypocenterRequestId
    hypocenterWorker.postMessage({ type: 'reset', requestId })
}
const terminateHypocenterWorker = () => {
    hypocenterRequestId++
    inFlightHypocenterRequestId = null
    pendingHypocenterUpdate = null
    hypocenterWorker?.terminate()
    hypocenterWorker = null
}
const updateInferredHypocentersInWorker = update => {
    if(update.activeStations.length === 0) {
        resetHypocenterWorker()
        clearInferredHypocenters()
        return
    }
    if(inFlightHypocenterRequestId !== null) {
        pendingHypocenterUpdate = mergePalertHypocenterUpdates(pendingHypocenterUpdate, update)
        return
    }
    postHypocenterUpdate(update)
}
const postHypocenterUpdate = update => {
    const worker = getHypocenterWorker()
    inFlightHypocenterRequestId = ++hypocenterRequestId
    worker.postMessage({ ...update, type: 'update', requestId: inFlightHypocenterRequestId })
}
const postPendingHypocenterUpdate = () => {
    if(!pendingHypocenterUpdate) return
    const update = pendingHypocenterUpdate
    pendingHypocenterUpdate = null
    postHypocenterUpdate(update)
}
const clearInferredHypocenters = () => {
    inferredHypocenterLayers?.clearLayers()
    inferredHypocenterLabelLayers = []
    statusStore.isActive.palertInfHypo = false
}
const destroyInferredHypocenterLayers = () => {
    inferredHypocenterMap?.off('zoomend moveend', layoutInferredHypocenterLabels)
    clearInferredHypocenters()
    inferredHypocenterLayers?.remove()
    inferredHypocenterLayers = null
    inferredHypocenterMap = null
}
const renderInferredHypocenters = results => {
    if(inferredHypocenterMap !== statusStore.map) {
        destroyInferredHypocenterLayers()
        inferredHypocenterMap = statusStore.map
        if(inferredHypocenterMap) {
            inferredHypocenterLayers = L.layerGroup().addTo(inferredHypocenterMap)
            inferredHypocenterMap.on('zoomend moveend', layoutInferredHypocenterLabels)
        }
    }
    clearInferredHypocenters()
    if(!inferredHypocenterMap || !isHypocenterEnabled.value || !Array.isArray(results)) return
    const visible = results
        .filter(result => result.hypocenter && Number.isFinite(result.score))
        .filter(shouldDisplayHypocenterResult)
    for(const result of visible) {
        const { lat, lng, depth } = result.hypocenter
        const latLng = [lat, lng]
        const pickResults = Array.isArray(result.pickResults) ? result.pickResults : []
        const waveCounts = pickResults.reduce((counts, pickResult) => {
            const wave = getPickDisplayWave(pickResult)
            if(wave) counts[wave] = (counts[wave] || 0) + 1
            return counts
        }, {})
        const clusterStationCount = result.clusterStationCount ?? result.effectiveStationCount ?? 0
        const originTimeTst = Number.isFinite(result.originStamp) ? stampToTime(result.originStamp, 8) : '-'
        createInferredWaveLayers(latLng, result)
        L.marker(latLng, { icon: infHypoIcon, pane: 'eewMarkerPane', interactive: false }).addTo(inferredHypocenterLayers)
        const label = createInfLabelHtml(result, { lat, lng, depth, clusterStationCount, originTimeTst, waveCounts })
        if(!label) continue
        const marker = L.marker(latLng, {
            icon: L.divIcon({ className: '', iconSize: null, iconAnchor: [0, 0], html: label }),
            interactive: false
        }).addTo(inferredHypocenterLayers)
        inferredHypocenterLabelLayers.push(marker)
    }
    layoutInferredHypocenterLabels()
    statusStore.isActive.palertInfHypo = visible.length > 0
}
const createInferredWaveLayers = (latLng, result) => {
    const frameStamp = latestFrameStamp
    const passedTime = (frameStamp - result.originStamp) / 1000
    if(!Number.isFinite(frameStamp) || !Number.isFinite(result.originStamp) || !(passedTime >= 0)) return
    for(const isPWave of [true, false]) {
        let wave = calcWaveDistance(travelTimes.jma2001, isPWave, result.hypocenter.depth, passedTime)
        if(wave.radius > 2000) wave = calcWaveDistance(travelTimes.jb, isPWave, result.hypocenter.depth, passedTime)
        if(!Number.isFinite(wave.radius) || wave.radius <= 0) continue
        L.circle(latLng, {
            radius: wave.radius * 1000, color: isPWave ? '#ffffff' : '#ff9500',
            weight: 2, opacity: 1, fill: false, dashArray: '8 8', interactive: false, pane: 'wavePane'
        }).addTo(inferredHypocenterLayers)
    }
}
const getPickDisplayWave = pickResult => {
    if(pickResult.excludedReason === 'duplicate-phase') return 'D'
    if(pickResult.weight > 0 || pickResult.wave === 'O' || pickResult.wave === 'L') return pickResult.wave
    return null
}
const getFilterStageText = result => {
    const inferenceLevels = Array.isArray(result.inferenceFilterStageLevels) && result.inferenceFilterStageLevels.length > 0
        ? result.inferenceFilterStageLevels
        : [result.filterStageLevel ?? 0]
    return inferenceLevels.join(' -> ')
}
const shouldDisplayHypocenterResult = result => shouldDisplayInferredHypocenter(
    'palertNet', result, activeEewList, settingsStore.mainSettings.displaySeisNet.palertHypoInfAlwaysOn
)
const createInfLabelHtml = (result, labelInfo) => {
    const textInfoMode = settingsStore.effectivePalertHypoInfTextInfo
    if(textInfoMode === 0) return ''
    const { lat, lng, depth, clusterStationCount, originTimeTst, waveCounts } = labelInfo
    const reportText = result.reportNum ?? '-'
    const stableText = result.stable ? '（稳定）' : ''
    const qualityText = result.qualityRank ? `质量${result.qualityRank}` : ''
    const detailedHtml = textInfoMode === 2 ? `
        <div style="opacity: 0.6;">
            latlng: ${lat.toFixed(1)}, ${lng.toFixed(1)}<br>
            clusterId: ${result.clusterId ?? '-'} / updates: ${result.updates ?? '-'}<br>
            effective: ${result.effectiveStationCount} (${result.effectivePickCount ?? '-'}) / qualityScore: ${result.qualityScore.toFixed(2)} / filter: ${getFilterStageText(result)}<br>
            loss: ${result.score.toFixed(2)} / rmse: ${result.rmse.toFixed(2)} / penalty: ${result.inactivePenalty.toFixed(2)} * ${result.inactivePenaltyWeight.toFixed(2)} + ${result.waveCountPenalty.toFixed(2)} + ${result.unexplainedPickPenalty.toFixed(2)}<br>
            scenario: ${result.scenario ?? '-'} / P: ${waveCounts.P || 0} S: ${waveCounts.S || 0} O: ${waveCounts.O || 0} D: ${waveCounts.D || 0}
        </div>
    ` : ''
    return `
        <div style="
            display: inline-block;
            width: max-content;
            max-width: 360px;
            padding: 8px 10px;
            color: #fff;
            -webkit-text-stroke: 0.35px #000000cc;
            paint-order: stroke fill;
            text-shadow: 0 0 2px #000000cc, 0 0 4px #000000aa, 1px 1px 2px #000000cc, -1px -1px 2px #000000cc;
            font-size: 12px;
            line-height: 1.25;
            text-align: center;
            overflow: hidden;
            pointer-events: none;
            white-space: nowrap;
            transform: translate(-50%, ${inferredHypocenterLabelOffset}px);
        ">
            <div style="font-size: 14px; font-weight: 700; line-height: 1.25; opacity: 0.8;">
                P-Alert震源推算 第${reportText}报${stableText}<br>
                ${originTimeTst} (+8)<br>
                深${depth.toFixed(0)}km<br>
                ${clusterStationCount}测站 ${qualityText}
            </div>
            ${detailedHtml}
        </div>
    `
}
const layoutInferredHypocenterLabels = () => {
    if(!inferredHypocenterMap) return
    const placed = []
    const size = inferredHypocenterMap.getSize()
    const labelOffset = inferredHypocenterLabelOffset
    for(const marker of inferredHypocenterLabelLayers) {
        const element = marker.getElement()?.firstElementChild
        if(!element) continue
        const width = element.offsetWidth
        const height = element.offsetHeight
        if(width <= 0 || height <= 0) continue
        const point = inferredHypocenterMap.latLngToContainerPoint(marker.getLatLng())
        const candidates = [
            { left: point.x - width / 2, top: point.y + labelOffset, transform: `translate(-50%, ${labelOffset}px)` },
            { left: point.x - width / 2, top: point.y - labelOffset - height, transform: `translate(-50%, calc(-100% - ${labelOffset}px))` },
            { left: point.x + labelOffset, top: point.y - height / 2, transform: `translate(${labelOffset}px, -50%)` },
            { left: point.x - labelOffset - width, top: point.y - height / 2, transform: `translate(calc(-100% - ${labelOffset}px), -50%)` }
        ].map(box => ({ ...box, right: box.left + width, bottom: box.top + height }))
        const fits = box => box.left >= 8 && box.top >= 8 && box.right <= size.x - 8 && box.bottom <= size.y - 8
        const clear = box => placed.every(other => box.right + 4 <= other.left || box.left >= other.right + 4 ||
            box.bottom + 4 <= other.top || box.top >= other.bottom + 4)
        const chosen = candidates.find(box => fits(box) && clear(box)) ?? candidates.find(clear) ?? candidates.find(fits) ?? candidates[0]
        element.style.transform = chosen.transform
        placed.push(chosen)
    }
}
const fetchRealtimeData = async () => {
    if(stopped) return
    const generation = requestGeneration
    const recordTime = delay.value > 0
        ? Math.round((timeStore.getTimeStamp() - delay.value) / 1000)
        : 0
    const ticket = frameQueue.begin(recordTime ? recordTime * 1000 : null)
    let frame = null
    try {
        const pgaResponse = parseResponse(await Palert.getRealtimeData(0, recordTime))
        if(stopped || generation != requestGeneration || !frameQueue.isPending(ticket)) return
        if(!pendingTimelineSwitch && latestFrameStamp !== null && pgaResponse.timestamp <= latestFrameStamp) return

        const needsPgv = Object.values(pgaResponse.dataVals)
            .some(value => {
                const pga = normalizeMeasurement(value)
                return pga !== null && pga >= 80
            })
        let pgvData = null
        if(needsPgv) {
            try {
                const pgvResponse = parseResponse(await Palert.getRealtimeData(1, pgaResponse.timestamp / 1000), true)
                if(pgvResponse.timestamp != pgaResponse.timestamp) {
                    throw new Error('P-Alert PGA and PGV timestamps do not match')
                }
                pgvData = pgvResponse.dataVals
            }
            catch(err) {
                console.log(err)
            }
        }
        frame = { timestamp: pgaResponse.timestamp, pgaData: pgaResponse.dataVals, pgvData, generation }
    }
    catch(err) {
        console.log(err)
    }
    finally {
        frameQueue.finish(ticket, frame)
    }
}
const clearReactiveObject = obj => {
    Object.keys(obj).forEach(key => delete obj[key])
}
const calcBearingDirection = ([fromLat, fromLng], [toLat, toLng]) => {
    const bearing = calcBearingDeg([fromLat, fromLng], [toLat, toLng])
    return Number.isFinite(bearing)
        ? bearingDirections[Math.floor(((bearing + 45) % 360) / 90)]
        : null
}
const buildAdjStations = () => {
    const stationIds = Object.keys(stations)
    const detectionAdjStations = {}
    const hypocenterAdjStations = {}
    const triggerDiffTolerances = {}
    stationIds.forEach(id => {
        const sortedDistances = stationIds
            .map(stationId => ({
                stationId,
                distance: calcDistanceKm(stations[id].latLng, stations[stationId].latLng)
            }))
            .sort((a, b) => a.distance - b.distance)
        // Keep all local activation neighbors, filling sparse neighborhoods to four within 40 km.
        const nearbyDistances = sortedDistances.filter(({ distance }) => distance <= 30)
        if(nearbyDistances.length < 4) {
            nearbyDistances.push(...sortedDistances
                .filter(({ distance }) => distance > 30 && distance <= 40)
                .slice(0, 4 - nearbyDistances.length))
        }
        detectionAdjStations[id] = nearbyDistances.map(({ stationId }) => stationId)
        triggerDiffTolerances[id] = Object.fromEntries(nearbyDistances.map(({ stationId, distance }) => [
            stationId,
            distance / triggerCompatibilityConfig.waveSpeedKmPerSecond * 1000 +
                triggerCompatibilityConfig.fixedToleranceMilliseconds
        ]))
        const directionCounts = Object.fromEntries(bearingDirections.map(direction => [direction, 0]))
        const nearbyStations = sortedDistances.filter(({ stationId, distance }) => {
            if(distance > 30) return false
            if(stationId === id) return true
            const direction = calcBearingDirection(stations[id].latLng, stations[stationId].latLng)
            if(direction) directionCounts[direction]++
            return true
        })
        sortedDistances
            .filter(({ distance }) => distance > 30 && distance <= 100)
            .some(station => {
                if(bearingDirections.every(direction => directionCounts[direction] >= minHypocenterNeighborsPerDirection)) return true
                const direction = calcBearingDirection(stations[id].latLng, stations[station.stationId].latLng)
                if(!direction || directionCounts[direction] >= minHypocenterNeighborsPerDirection) return false
                nearbyStations.push(station)
                directionCounts[direction]++
                return bearingDirections.every(direction => directionCounts[direction] >= minHypocenterNeighborsPerDirection)
            })
        hypocenterAdjStations[id] = nearbyStations
    })
    return { detectionAdjStations, hypocenterAdjStations, triggerDiffTolerances }
}
const clearTimelineState = (render = true) => {
    frameQueue.reset()
    terminateHypocenterWorker()
    clearInferredHypocenters()
    latestFrameStamp = null
    periodMaxLevel = -1
    palertMaxShindo.value = '?'
    palertPeriodMaxShindo.value = '?'
    palertPeriodBarClass.value = 'gray'
    statusStore.isActive.palertNet = false
    Object.values(stations).forEach(station => station.clearHistory(render))
    if(render && useStationCanvasRenderer.value) renderAll()
}
const scheduleTimelineSwitch = () => {
    resetHypocenterWorker()
    clearInferredHypocenters()
    requestGeneration++
    pendingTimelineSwitch = true
    frameQueue.reset()
    Object.values(stations).forEach(station => station.clearRecentData())
}
let fetchStationTimer, requestInterval
const isValidStationInfo = info => typeof info?.station === 'string' && info.station.length > 0 &&
    Number.isFinite(info.lat) && Math.abs(info.lat) <= 90 &&
    Number.isFinite(info.lon) && Math.abs(info.lon) <= 180
const fetchStationList = async () => {
    if(stopped) return
    try {
        const response = await Palert.getStationList()
        if(stopped || !Array.isArray(response?.staInfos)) return
        const validStations = response.staInfos.filter(isValidStationInfo)
        if(validStations.length === 0) return
        if(response.version == stationVersion && JSON.stringify(validStations) == JSON.stringify(stationList)) return
        stationVersion = response.version
        stationList.splice(0, stationList.length, ...validStations)
    }
    catch(err) {
        console.log(err)
    }
    finally {
        if(!stopped) {
            fetchStationTimer = setTimeout(fetchStationList, stationList.length > 0 ? 10 * 60 * 1000 : 20 * 1000)
        }
    }
}
const renderAll = () => {
    if(useStationCanvasRenderer.value) {
        taiwanSeisNetLayers.redrawStations()
        return
    }
    Object.values(stations).forEach(station => station.render())
}

onMounted(() => {
    fetchStationList()
    requestInterval = setInterval(fetchRealtimeData, 1000)
    fetchRealtimeData()
    document.addEventListener('visibilitychange', handleVisibilityChange)
})

let unwatchMap, unwatchStationList, unwatchActivity, unwatchRender, unwatchHold, unwatchDelay
unwatchMap = watch(() => statusStore.map, newVal => {
    if(newVal === null) return
    map = newVal
    map.on('zoomend', renderAll)
    unwatchStationList = watch(stationList, newVal => {
        if(newVal.length === 0) return
        requestGeneration++
        pendingTimelineSwitch = false
        clearTimelineState(false)
        Object.values(stations).forEach(station => station.terminate())
        clearReactiveObject(stations)
        newVal.forEach(info => {
            if(!isValidStationInfo(info)) return
            stations[info.station] = reactive(new PalertStation(
                map,
                info.station,
                [info.lat, info.lon],
                useStationCanvasRenderer.value
            ))
        })
        const adjacency = buildAdjStations()
        adjStationIds = adjacency.detectionAdjStations
        adjStations4Hypo = adjacency.hypocenterAdjStations
        triggerDiffToleranceMatrix = adjacency.triggerDiffTolerances
        renderAll()
    }, { immediate: true })
    unwatchActivity = watch(activeLevels, newVal => {
        let maxLevel = -1
        newVal.forEach(level => {
            if(level > maxLevel) maxLevel = level
            if(level > periodMaxLevel) periodMaxLevel = level
        })
        palertPeriodMaxShindo.value = getShindoFromLevel(periodMaxLevel)
        palertPeriodBarClass.value = maxLevel >= 0 ? TaiwanGridCanvasLayer.getGridColorByLevel(maxLevel) : 'gray'
        statusStore.isActive.palertNet = newVal.length > 0
    }, { immediate: true })
    unwatchRender = watch(
        () => `${settingsStore.mainSettings.displaySeisNet.style}
        |${settingsStore.mainSettings.displaySeisNet.displayPalertShindo}
        |${settingsStore.mainSettings.displaySeisNet.hideNoData}
        |${simpleIcon.value}
        |${settingsStore.mainSettings.displaySeisNet.displayShindo0}`,
        renderAll
    )
    unwatchHold = watch(() => settingsStore.mainSettings.displaySeisNet.palertLevelHold, () => {
        const render = document.visibilityState === 'visible'
        Object.values(stations).forEach(station => station.updateHoldLevel(render))
        updateMaxShindo()
        if(render && useStationCanvasRenderer.value) renderAll()
    })
}, { immediate: true })
unwatchDelay = watch(delay, scheduleTimelineSwitch)
watch(() => settingsStore.mainSettings.displaySeisNet.httpDataPriority, () => {
    requestGeneration++
    frameQueue.reset(pendingTimelineSwitch ? null : latestFrameStamp)
}, { flush: 'sync' })
watch(isHypocenterEnabled, enabled => {
    if(enabled) return
    terminateHypocenterWorker()
    clearInferredHypocenters()
})
watch(() => isNetworkPeriodActive('palertNet', statusStore.isActive), newVal => {
    if(newVal) {
        if(periodMaxLevel == -1) {
            periodMaxLevel = 0
            palertPeriodMaxShindo.value = getShindoFromLevel(periodMaxLevel)
        }
    }
    else {
        periodMaxLevel = -1
        palertPeriodMaxShindo.value = getShindoFromLevel(periodMaxLevel)
    }
}, { immediate: true })

let shake1Notified = false, shake2Notified = false
let focused = false
watch(currentMaxShindo, (newVal, oldVal) => {
    if(newVal > oldVal) {
        if(settingsStore.mainSettings.onShake.sound) playSound(`shindo${newVal}`)
        if(settingsStore.mainSettings.onShake.notification) {
            if(newVal >= 1 && newVal <= 3 && !shake1Notified) {
                sendMyNotification('檢測到震動', '請注意搖晃。', iconUrls.caution)
                shake1Notified = true
            }
            else if(newVal >= 4 && !shake2Notified) {
                sendMyNotification('檢測到強震動', '請警戒強烈搖晃。', iconUrls.warn)
                shake1Notified = true
                shake2Notified = true
            }
        }
        if(settingsStore.mainSettings.onShake.focus && newVal >= 1 && !focused) {
            focusWindow()
            focused = true
        }
        handleTempEqlists(0)
    }
    else {
        shake1Notified = false
        shake2Notified = false
        focused = false
    }
})

onBeforeUnmount(() => {
    stopped = true
    terminateHypocenterWorker()
    destroyInferredHypocenterLayers()
    requestGeneration++
    frameQueue.reset()
    clearTimeout(fetchStationTimer)
    clearInterval(requestInterval)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    if(unwatchMap) unwatchMap()
    if(unwatchStationList) unwatchStationList()
    if(unwatchActivity) unwatchActivity()
    if(unwatchRender) unwatchRender()
    if(unwatchHold) unwatchHold()
    if(unwatchDelay) unwatchDelay()
    if(map) {
        map.off('zoomend', renderAll)
    }
    unregisterSource()
    Object.values(stations).forEach(station => station.terminate())
    clearReactiveObject(stations)
    palertUpdateTime.value = '1970-01-01 08:00:00'
    palertMaxShindo.value = '?'
    palertPeriodMaxShindo.value = '?'
    palertPeriodBarClass.value = 'gray'
    statusStore.isActive.palertNet = false
})
</script>

<style lang="scss" scoped>

</style>
