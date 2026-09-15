import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { compareFloat, getCsisLevelFromCsis, getLevelFromInstShindo, getMmiFromKmaLevel, getShindoFromChar, getShindoFromInstShindo, getShindoFromLevel, intScale, shindoScale } from '@/utils/Utils';
import { useSettingsStore } from '@/stores/settings';
import { markRaw, ref } from 'vue';
import '@/assets/background.css';
import shindo0 from '@/assets/icon/shindo/0.svg';
import shindo1 from '@/assets/icon/shindo/1.svg';
import shindo2 from '@/assets/icon/shindo/2.svg';
import shindo3 from '@/assets/icon/shindo/3.svg';
import shindo4 from '@/assets/icon/shindo/4.svg';
import shindo5l from '@/assets/icon/shindo/5-.svg';
import shindo5u from '@/assets/icon/shindo/5+.svg';
import shindo6l from '@/assets/icon/shindo/6-.svg';
import shindo6u from '@/assets/icon/shindo/6+.svg';
import shindo7 from '@/assets/icon/shindo/7.svg';
import int0 from '@/assets/icon/intensity/0.svg';
import int1 from '@/assets/icon/intensity/1.svg';
import int2 from '@/assets/icon/intensity/2.svg';
import int3 from '@/assets/icon/intensity/3.svg';
import int4 from '@/assets/icon/intensity/4.svg';
import int5 from '@/assets/icon/intensity/5.svg';
import int6 from '@/assets/icon/intensity/6.svg';
import int7 from '@/assets/icon/intensity/7.svg';
import int8 from '@/assets/icon/intensity/8.svg';
import int9 from '@/assets/icon/intensity/9.svg';
import int10 from '@/assets/icon/intensity/10.svg';
import int11 from '@/assets/icon/intensity/11.svg';
import int12 from '@/assets/icon/intensity/12.svg';

export const shindoIconUrls = {
    '0': shindo0,
    '1': shindo1,
    '2': shindo2,
    '3': shindo3,
    '4': shindo4,
    '5-': shindo5l,
    '5+': shindo5u,
    '6-': shindo6l,
    '6+': shindo6u,
    '7': shindo7,
}

export const intIconUrls = {
    '0': int0,
    '1': int1,
    '2': int2,
    '3': int3,
    '4': int4,
    '5': int5,
    '6': int6,
    '7': int7,
    '8': int8,
    '9': int9,
    '10': int10,
    '11': int11,
    '12': int12,
}

const colorBand = {
    nied: [
        '#0003cf', 
        '#0014da', '#0037f0', '#006cdc', '#00b3a2', '#12dc72', 
        '#31f049', '#64fb2a', '#9dfe17', '#ccff09', '#ebff03', 
        '#fff500', '#ffe500', '#ffca00', '#ffa600', '#ff7e00', 
        '#ff5900', '#fd3500', '#f81100', '#e50000', '#bd0000'
    ],
    srev: [
        '#ffffff00', 
        '#ffffff11', '#ffffff33', '#ffffff66', '#ffffffaa', '#ffffffff', 
        '#31f049', '#64fb2a', '#9dfe17', '#ccff09', '#ebff03', 
        '#fff500', '#ffe500', '#ffca00', '#ffa600', '#ff7e00', 
        '#ff5900', '#fd3500', '#f81100', '#e50000', '#bd0000'
    ],
    mix: [
        '#0003cf00', 
        '#0014da11', '#0037f033', '#006cdc66', '#00b3a2aa', '#12dc72ff', 
        '#31f049', '#64fb2a', '#9dfe17', '#ccff09', '#ebff03', 
        '#fff500', '#ffe500', '#ffca00', '#ffa600', '#ff7e00', 
        '#ff5900', '#fd3500', '#f81100', '#e50000', '#bd0000'
    ]
}

const kmaColorBand = {
    nied: [
        '#0003cf', '#004ff4', '#05d384', '#50fb30', '#ccff09', 
        '#fdfc00', '#ffca00', '#ff7900', '#ff4700', '#f91900', 
        '#e10000', '#af0000', '#ae0000', '#ad0000'
    ],
    srev: [
        '#ffffff00', '#ffffff44', '#ffffff99', '#ffffffff', '#ccff09', 
        '#fdfc00', '#ffca00', '#ff7900', '#ff4700', '#f91900', 
        '#e10000', '#af0000', '#ae0000', '#ad0000'
    ],
    mix: [
        '#0003cf00', '#004ff444', '#05d38499', '#50fb30ff', '#ccff09', 
        '#fdfc00', '#ffca00', '#ff7900', '#ff4700', '#f91900', 
        '#e10000', '#af0000', '#ae0000', '#ad0000'
    ]
}

export const shindoColorBand = [
    'var(--dark-gray)', 'var(--dark-gray)', 'var(--dark-gray)', 'var(--dark-gray)', 'var(--dark-gray)', 'var(--dark-gray)', 
    'var(--dark-gray)', 'var(--dark-gray)', 
    'var(--gray)', 'var(--gray)', 
    'var(--blue)', 'var(--blue)', 
    'var(--green)', 'var(--green)', 
    'var(--yellow)', 'var(--yellow)', 
    'var(--orange)', 'var(--dark-orange)', 
    'var(--red)', 'var(--dark-red)', 
    'var(--purple)'
]

export const kmaIntColorBand = [
    'var(--dark-gray)', 'var(--dark-gray)', 'var(--dark-gray)', 'var(--dark-gray)', 
    'var(--gray)', 
    'var(--sky-blue)', 
    'var(--blue)', 
    'var(--green)', 
    'var(--yellow)', 
    'var(--orange)', 
    'var(--dark-orange)', 
    'var(--red)', 
    'var(--purple)',
    'var(--purple)'
]

export const simpleIcon = ref(false)

const shindoIcons = {}, intIcons = {}
for(let zoom = 6; zoom <= 10; zoom ++) {
    let icons = {}
    const radius = 8 * 1.5 ** (zoom / 2 - 3)
    shindoScale.forEach(shindo => {
        const shindoIcon = L.icon({
            iconUrl: shindoIconUrls[shindo],
            iconSize: [radius * 2, radius * 2],
            iconAnchor: [radius, radius]
        })
        icons[shindo] = shindoIcon
    })
    shindoIcons[zoom] = icons
    icons = {}
    intScale.forEach(int => {
        const intIcon = L.icon({
            iconUrl: intIconUrls[int],
            iconSize: [radius * 2, radius * 2],
            iconAnchor: [radius, radius]
        })
        icons[int] = intIcon
    })
    intIcons[zoom] = icons
}

let settingsStore
export const abnormalNiedStations = {}

const getNiedColorRadius = (level, zoom) => {
    const style = settingsStore.mainSettings.displaySeisNet.style
    let color, radius
    switch(style) {
        case 'nied':
            if(level < 0 || level >= colorBand.nied.length){
                if(settingsStore.mainSettings.displaySeisNet.hideNoData) color = '#cfcfcf00'
                else color = '#cfcfcf'
            }
            else{
                color = colorBand.nied[level]
            }
            radius = (level <= 5 ? 2 : 2.5) * 1.8 ** (Math.min(Math.max(zoom, 4), 10) / 2 - 3)
            break
        case 'srev':
            if(level < 0 || level >= colorBand.srev.length){
                color = colorBand.srev[0]
            }
            else{
                color = colorBand.srev[level]
            }
            radius = 2.5 * 1.8 ** (Math.min(Math.max(zoom, 4), 10) / 2 - 3)
            break
        case 'mix':
            if(level < 0 || level >= colorBand.mix.length){
                color = colorBand.mix[0]
            }
            else{
                color = colorBand.mix[level]
            }
            radius = 2.5 * 1.8 ** (Math.min(Math.max(zoom, 4), 10) / 2 - 3)
            break
    }
    return { color, radius }
}
const getKmaColorRadius = (holdLevel, zoom) => {
    const style = settingsStore.mainSettings.displaySeisNet.style
    let color, radius
    switch(style) {
        case 'nied':
            if(holdLevel < 0 || holdLevel >= kmaColorBand.nied.length){
                if(settingsStore.mainSettings.displaySeisNet.hideNoData) color = '#cfcfcf00'
                else color = '#cfcfcf'
            }
            else{
                color = kmaColorBand.nied[holdLevel]
            }
            radius = (holdLevel <= 2 ? 2 : 2.5) * 1.8 ** (Math.min(Math.max(zoom, 4), 10) / 2 - 3)
            break
        case 'srev':
            if(holdLevel < 0 || holdLevel >= kmaColorBand.srev.length){
                color = kmaColorBand.srev[0]
            }
            else{
                color = kmaColorBand.srev[holdLevel]
            }
            radius = 2.5 * 1.8 ** (Math.min(Math.max(zoom, 4), 10) / 2 - 3)
            break
        case 'mix':
            if(holdLevel < 0 || holdLevel >= kmaColorBand.mix.length){
                color = kmaColorBand.mix[0]
            }
            else{
                color = kmaColorBand.mix[holdLevel]
            }
            radius = 2.5 * 1.8 ** (Math.min(Math.max(zoom, 4), 10) / 2 - 3)
            break
    }
    return { color, radius }
}
const getPalertMarkerType = (level, zoom) => {
    if(settingsStore.mainSettings.displaySeisNet.displayPalertShindo && level >= (settingsStore.mainSettings.displaySeisNet.displayShindo0 ? 6 : 8) && zoom >= 4){
        return simpleIcon.value ? 1 : 2
    }
    return 0
}
const getTremMarkerType = (level, zoom) => {
    if(settingsStore.mainSettings.displaySeisNet.displayTremShindo && level >= (settingsStore.mainSettings.displaySeisNet.displayShindo0 ? 6 : 8) && zoom >= 4){
        return simpleIcon.value ? 1 : 2
    }
    return 0
}
const getNiedMarkerType = (level, zoom) => {
    if(settingsStore.mainSettings.displaySeisNet.displayNiedShindo && level >= (settingsStore.mainSettings.displaySeisNet.displayShindo0 ? 6 : 8) && zoom >= 4){
        return simpleIcon.value ? 1 : 2
    }
    return 0
}
const getKmaMarkerType = (holdLevel, zoom) => {
    if(settingsStore.mainSettings.displaySeisNet.displayKmaInt && holdLevel >= (settingsStore.mainSettings.displaySeisNet.displayShindo0 ? 3 : 4) && zoom >= 4){
        return simpleIcon.value ? 1 : 2
    }
    return 0
}

export class PalertStation {
    constructor(map, id, latLng, useCanvasLayer = false){
        if(!settingsStore) settingsStore = useSettingsStore()
        this.map = markRaw(map)
        this.id = id
        this.latLng = latLng
        this.useCanvasLayer = useCanvasLayer
        this.pga = null
        this.pgv = null
        this.level = -1
        this.recentData = []
        this.recentSeconds = 60
        this.recentMaxLevel = -1
        this.updateStamp = null
        this.nonQuietBoundaryStamp = null
        this.missingCountSinceBoundary = 0
        this.consecutiveMissingCount = 0
        this.triggerStamp = null
        this.maxLevel = -1
        this.secondMaxLevel = -1
        this.triggerMaxPga = null
        this.triggerSecondMaxPga = null
        this.noNewPeakCount = 0
        this.completedPick = null
        this.activity = 0
        this.activitySeconds = 12
        this.holdLevel = -1
        this.shindo = getShindoFromLevel(this.holdLevel)
        this.isActive = false
        this.markerType = null
        if(!this.useCanvasLayer) this.render()
    }
    update(data, missingSeconds = 0, render = true){
        if(!Number.isFinite(data.timestamp) || data.timestamp <= 0 ||
            (this.updateStamp !== null && data.timestamp <= this.updateStamp)) return
        const previousUpdateStamp = this.updateStamp
        this.updateStamp = data.timestamp
        this.updatePenaltyState(data, previousUpdateStamp)
        this.pga = data.pga
        this.pgv = data.pgv
        this.level = data.level
        const missingData = Array.from({ length: Math.min(missingSeconds, this.recentSeconds) }, (_, index) => ({
            timestamp: data.timestamp - (index + 1) * 1000,
            pga: null,
            pgv: null,
            level: -1,
        }))
        this.recentData.unshift({ ...data }, ...missingData)
        this.recentData.splice(this.recentSeconds)
        this.recentMaxLevel = Math.max(...this.recentData.map(data => data.level).filter(Number.isFinite), -1)
        this.activity = this.calcActivity()
        this.completedPick = null
        // Advance missing seconds before the current sample, so a gap cannot revive a closed pick.
        for(let i = 0; this.triggerStamp !== null && i < missingSeconds; i++) {
            this.updateTrigger({ timestamp: previousUpdateStamp + (i + 1) * 1000, level: -1, pga: null })
        }
        this.updateTrigger(data)
        this.updateHoldLevel(render)
    }
    calcActivity(){
        const recentData = this.recentData.slice(0, this.activitySeconds)
        const maxLevel = Math.max(...recentData.map(data => data.level), -1)
        if(maxLevel >= 10) return 2
        if(maxLevel >= 9) return 1.5
        if(maxLevel >= 8) return 1
        if(maxLevel >= 7) return 0.5
        if(maxLevel >= 6) return 0.2
        return 0
    }
    updateTrigger(sample){
        const { timestamp, level, pga } = sample
        const isValid = Number.isFinite(level) && level >= 0 && Number.isFinite(pga) && pga >= 0
        if(this.triggerStamp === null) {
            if(!isValid) return
            let backgroundMaxPga = 0
            for(let offset = 1; offset <= 8; offset++) {
                const before = this.recentData[offset]
                if(!before || before.timestamp !== timestamp - offset * 1000 ||
                    !Number.isFinite(before.level) || before.level < 0 ||
                    !Number.isFinite(before.pga) || before.pga < 0) return
                if(offset >= 2) backgroundMaxPga = Math.max(backgroundMaxPga, before.pga)
            }
            const previous = this.recentData[1]
            // Either sample may reach level six; prefer the preceding sample as onset, including a completed pick's final sample.
            if((level >= 6 || previous.level >= 6) && previous.pga > 0 &&
                compareFloat(pga, backgroundMaxPga * 1.5) >= 0 && compareFloat(previous.pga, backgroundMaxPga * 1.5) >= 0) {
                this.triggerStamp = previous.timestamp
                this.maxLevel = previous.level
                this.triggerMaxPga = previous.pga
            }
            else {
                if(level < 6 || pga <= 0 || !(compareFloat(pga, Math.max(backgroundMaxPga, previous.pga) * 2) >= 0)) return
                this.triggerStamp = timestamp
            }
        }

        const oldMaxPga = this.triggerMaxPga
        const oldSecondMaxPga = this.triggerSecondMaxPga
        if(isValid) {
            if(level >= this.maxLevel) {
                this.secondMaxLevel = this.maxLevel
                this.maxLevel = level
            }
            else if(level > this.secondMaxLevel) this.secondMaxLevel = level
            if(this.triggerMaxPga === null || pga >= this.triggerMaxPga) {
                this.triggerSecondMaxPga = this.triggerMaxPga
                this.triggerMaxPga = pga
            }
            else if(this.triggerSecondMaxPga === null || pga > this.triggerSecondMaxPga) this.triggerSecondMaxPga = pga
        }
        // Equal values at distinct times count toward the top two, but only a value change renews the pick.
        this.noNewPeakCount = oldMaxPga !== this.triggerMaxPga || oldSecondMaxPga !== this.triggerSecondMaxPga
            ? 0 : this.noNewPeakCount + 1
        if(this.noNewPeakCount < 8) return
        this.completedPick = {
            triggerStamp: this.triggerStamp,
            updateStamp: timestamp,
            level,
            maxLevel: this.maxLevel,
            secondMaxLevel: this.secondMaxLevel
        }
        this.clearTrigger()
    }
    clearTrigger(){
        this.triggerStamp = null
        this.maxLevel = -1
        this.secondMaxLevel = -1
        this.triggerMaxPga = null
        this.triggerSecondMaxPga = null
        this.noNewPeakCount = 0
    }
    updatePenaltyState(sample, previousUpdateStamp){
        const missingSeconds = previousUpdateStamp === null ? 0
            : Math.max(Math.round((sample.timestamp - previousUpdateStamp) / 1000) - 1, 0)
        if(missingSeconds >= 3) {
            // From the third missing frame onward, every missing frame advances the boundary.
            this.nonQuietBoundaryStamp = sample.timestamp - 1000
            this.missingCountSinceBoundary = 0
            this.consecutiveMissingCount += missingSeconds
        }
        else {
            for(let offset = missingSeconds; offset > 0; offset--) {
                this.updatePenaltySample({ timestamp: sample.timestamp - offset * 1000, level: -1 })
            }
        }
        this.updatePenaltySample(sample)
    }
    updatePenaltySample({ timestamp, level }){
        this.nonQuietBoundaryStamp ??= timestamp - 1000
        if(Number.isFinite(level) && level >= 0) {
            this.consecutiveMissingCount = 0
            if(level <= 5) return
        }
        else {
            this.missingCountSinceBoundary++
            this.consecutiveMissingCount++
            const elapsedSeconds = (timestamp - this.nonQuietBoundaryStamp) / 1000
            if(this.consecutiveMissingCount < 3 && this.missingCountSinceBoundary / elapsedSeconds <= 0.05) return
        }
        this.nonQuietBoundaryStamp = timestamp
        this.missingCountSinceBoundary = 0
    }
    isPenaltyStation(){
        if(!Number.isFinite(this.nonQuietBoundaryStamp) || !Number.isFinite(this.updateStamp)) return false
        const elapsedSeconds = (this.updateStamp - this.nonQuietBoundaryStamp) / 1000
        return elapsedSeconds >= 10 && this.missingCountSinceBoundary / elapsedSeconds <= 0.05 &&
            this.consecutiveMissingCount < 3
    }
    updateHoldLevel(render = true){
        const holdSeconds = settingsStore.mainSettings.displaySeisNet.palertLevelHold
        const latestTimestamp = this.recentData[0]?.timestamp
        const earliestTimestamp = latestTimestamp - (holdSeconds - 1) * 1000
        const holdLevel = Math.max(
            ...this.recentData
                .filter(data => data.timestamp >= earliestTimestamp && data.timestamp <= latestTimestamp)
                .map(data => data.level),
            -1
        )
        if(holdLevel == this.holdLevel) return
        this.holdLevel = holdLevel
        this.shindo = getShindoFromLevel(this.holdLevel)
        render && !this.useCanvasLayer && this.render()
    }
    clearHistory(render = true){
        this.pga = null
        this.pgv = null
        this.level = -1
        this.clearRecentData()
        this.isActive = false
        clearTimeout(this.activeTimer)
        this.updateHoldLevel(render)
    }
    clearRecentData(){
        this.recentData.length = 0
        this.recentMaxLevel = -1
        this.activity = 0
        this.updateStamp = null
        this.nonQuietBoundaryStamp = null
        this.missingCountSinceBoundary = 0
        this.consecutiveMissingCount = 0
        this.clearTrigger()
        this.completedPick = null
    }
    render(){
        if(this.useCanvasLayer) return
        const oldMarkerType = this.markerType
        const oldColor = this.color
        const oldRadius = this.radius
        this.setColorRadius()
        const zoom = this.map.getZoom()
        this.markerType = getPalertMarkerType(this.holdLevel, zoom)
        if(this.markerType == oldMarkerType && this.color == oldColor && this.radius == oldRadius) return
        if((this.markerType == 2) != (oldMarkerType == 2) || this.color != oldColor) {
            if(this.marker && this.map.hasLayer(this.marker)) this.map.removeLayer(this.marker)
            switch(this.markerType) {
                case 2: {
                    const iconZoom = Math.min(Math.max(zoom, 6), 10)
                    const shindoIcon = shindoIcons[iconZoom][this.shindo]
                    this.marker = markRaw(L.marker(this.latLng, {
                        icon: shindoIcon,
                        pane: `palertStationPane${this.holdLevel}`,
                        interactive: false
                    }))
                    break
                }
                case 1: {
                    const color = shindoColorBand[this.holdLevel]
                    const radius = Math.max(this.radius, 2)
                    this.marker = markRaw(L.circleMarker(this.latLng, {
                        radius: radius * 1.8,
                        opacity: 1,
                        fillOpacity: 1,
                        color: '#ffffff',
                        fillColor: color,
                        weight: radius * 0.4,
                        pane: `palertStationPane${this.holdLevel}`,
                        interactive: false
                    }))
                    break
                }
                case 0:
                    this.marker = markRaw(L.circleMarker(this.latLng, {
                        radius: this.radius,
                        opacity: 1,
                        fillOpacity: 1,
                        color: this.color,
                        fillColor: this.color,
                        weight: 0,
                        pane: `palertStationPane${this.holdLevel}`,
                        interactive: false
                    }))
                    break
            }
            this.marker.addTo(this.map)
        }
        else {
            switch(this.markerType) {
                case 2: {
                    const iconZoom = Math.min(Math.max(zoom, 6), 10)
                    const shindoIcon = shindoIcons[iconZoom][this.shindo]
                    this.marker.setIcon(shindoIcon)
                    break
                }
                case 1: {
                    const color = shindoColorBand[this.holdLevel]
                    const radius = Math.max(this.radius, 2)
                    this.marker.setStyle({
                        color: '#ffffff',
                        fillColor: color,
                        weight: radius * 0.4,
                    }).setRadius(radius * 1.8)
                    break
                }
                case 0:
                    this.marker.setStyle({
                        color: this.color,
                        fillColor: this.color,
                        weight: 0,
                    }).setRadius(this.radius)
                    break
            }
        }
    }
    setColorRadius(){
        const zoom = this.map.getZoom()
        const { color, radius } = getNiedColorRadius(this.holdLevel, zoom)
        this.color = color
        this.radius = radius
    }
    getCanvasDrawInfo(zoom = this.map.getZoom()){
        if(!settingsStore) settingsStore = useSettingsStore()
        const { color, radius } = getNiedColorRadius(this.holdLevel, zoom)
        return {
            latLng: this.latLng,
            level: this.holdLevel,
            drawOrder: this.holdLevel,
            simpleColorLevel: this.holdLevel,
            shindo: this.shindo,
            iconKey: this.shindo,
            color,
            radius,
            markerType: getPalertMarkerType(this.holdLevel, zoom)
        }
    }
    setActive(){
        this.isActive = true
        clearTimeout(this.activeTimer)
        this.activeTimer = setTimeout(() => {
            this.isActive = false
        }, 12500)
    }
    terminate(){
        if(this.marker && this.map.hasLayer(this.marker)) this.map.removeLayer(this.marker)
        this.map = null
        this.marker = null
        clearTimeout(this.activeTimer)
    }
}
export class TremStation {
    constructor(map, id, latLng, intensity, isActive, useCanvasLayer = false){
        if(!settingsStore) settingsStore = useSettingsStore()
        this.map = markRaw(map)
        this.id = id
        this.latLng = latLng
        this.useCanvasLayer = useCanvasLayer
        this.intensity = intensity
        this.shindo = getShindoFromInstShindo(intensity)
        this.level = getLevelFromInstShindo(intensity)
        this.isActive = isActive
        this.markerType = null
        if(!this.useCanvasLayer) this.render()
    }
    update(intensity, isActive, render = true){
        this.intensity = intensity
        const level = getLevelFromInstShindo(intensity)
        if(level != this.level){
            this.shindo = getShindoFromInstShindo(intensity)
            this.level = level
            render && !this.useCanvasLayer && this.render()
        }
        this.isActive = isActive
    }
    render(){
        if(this.useCanvasLayer) return
        const oldMarkerType = this.markerType
        const oldColor = this.color
        const oldRadius = this.radius
        this.setColorRadius()
        const zoom = this.map.getZoom()
        this.markerType = getTremMarkerType(this.level, zoom)
        if(this.markerType == oldMarkerType && this.color == oldColor && this.radius == oldRadius) return
        if((this.markerType == 2) != (oldMarkerType == 2) || this.color != oldColor) {
            if(this.marker && this.map.hasLayer(this.marker)) this.map.removeLayer(this.marker)
            switch(this.markerType) {
                case 2:
                    const iconZoom = Math.min(Math.max(zoom, 6), 10)
                    const shindoIcon = shindoIcons[iconZoom][this.shindo]
                    this.marker = markRaw(L.marker(this.latLng, {
                        icon: shindoIcon,
                        pane: `tremStationPane${this.level}`,
                        interactive: false
                    }))
                    break
                case 1:
                    const color = shindoColorBand[this.level]
                    const radius = Math.max(this.radius, 2)
                    this.marker = markRaw(L.circleMarker(this.latLng, {
                        radius: radius * 1.8,
                        opacity: 1,
                        fillOpacity: 1,
                        color: '#ffffff',
                        fillColor: color,
                        weight: radius * 0.4,
                        pane: `tremStationPane${this.level}`,
                        interactive: false
                    }))
                    break
                case 0:
                    this.marker = markRaw(L.circleMarker(this.latLng, {
                        radius: this.radius,
                        opacity: 1,
                        fillOpacity: 1,
                        color: this.color,
                        fillColor: this.color,
                        weight: 0,
                        pane: `tremStationPane${this.level}`,
                        interactive: false
                    }))
                    break
            }
            this.marker.addTo(this.map)
        }
        else {
            switch(this.markerType) {
                case 2:
                    const iconZoom = Math.min(Math.max(zoom, 6), 10)
                    const shindoIcon = shindoIcons[iconZoom][this.shindo]
                    this.marker.setIcon(shindoIcon)
                    break
                case 1:
                    const color = shindoColorBand[this.level]
                    const radius = Math.max(this.radius, 2)
                    this.marker.setStyle({
                        color: '#ffffff',
                        fillColor: color,
                        weight: radius * 0.4,
                    }).setRadius(radius * 1.8)
                    break
                case 0:
                    this.marker.setStyle({
                        color: this.color,
                        fillColor: this.color,
                        weight: 0,
                    }).setRadius(this.radius)
                    break
            }
        }
    }
    setColorRadius(){
        const zoom = this.map.getZoom()
        const { color, radius } = getNiedColorRadius(this.level, zoom)
        this.color = color
        this.radius = radius
    }
    getCanvasDrawInfo(zoom = this.map.getZoom()){
        if(!settingsStore) settingsStore = useSettingsStore()
        const { color, radius } = getNiedColorRadius(this.level, zoom)
        return {
            latLng: this.latLng,
            level: this.level,
            drawOrder: this.intensity,
            simpleColorLevel: this.level,
            intensity: this.intensity,
            shindo: this.shindo,
            iconKey: this.shindo,
            color,
            radius,
            markerType: getTremMarkerType(this.level, zoom)
        }
    }
    terminate(){
        if(this.marker && this.map.hasLayer(this.marker)) this.map.removeLayer(this.marker)
        this.map = null
        this.marker = null
    }
}
export class NiedStation {
    constructor(map, id, latLng, intensity, expireSeconds, useCanvasLayer = false){
        if(!settingsStore) settingsStore = useSettingsStore()
        this.map = markRaw(map)
        this.id = id
        this.latLng = latLng
        this.expireSeconds = expireSeconds
        this.useCanvasLayer = useCanvasLayer
        this.maxRecentLength = 60
        this.shindo = getShindoFromChar(intensity)
        this.level = intensity.charCodeAt(0) - 100
        this.updateStamp = 0
        this.triggerStamp = 0
        this.ascend = 0
        this.recentLevel = []
        this.activity = 0
        this.isActive = false
        this.markerType = null
        if(!this.useCanvasLayer) this.render()
    }
    update(intensity, updateStamp, render = true){
        this.updateStamp = updateStamp
        const originLevel = intensity.charCodeAt(0) - 100
        const level = originLevel == -1 ? this.recentLevel.slice(0, 4).find(val => val != -1) ?? -1 : originLevel
        if(level != this.level){
            this.shindo = getShindoFromChar(intensity)
            this.level = level
            render && !this.useCanvasLayer && this.render()
        }
        this.recentLevel.unshift(originLevel)
        this.recentLevel.splice(this.maxRecentLength)
        let ascend = 0
        let triggerStamp = 0
        if(this.isAbnormalStation()) {
            if(!(this.id in abnormalNiedStations))
                console.log(`已忽略异常NIED测站: id: ${this.id}, latLng: ${this.latLng}`);
            abnormalNiedStations[this.id] = 0
        }
        else {
            if(this.id in abnormalNiedStations) {
                abnormalNiedStations[this.id]++
                if(abnormalNiedStations[this.id] >= 600) {
                    delete abnormalNiedStations[this.id]
                }
            }
            else {
                const ascendResult = this.calcAscend()
                ascend = ascendResult.ascend
                triggerStamp = ascendResult.triggerStamp
            }
        }
        this.ascend = ascend
        this.triggerStamp = ascend > 0 ? triggerStamp : 0
        this.activity = this.calcActivity(level, ascend)
    }
    calcAscend() {
        const arr = [...this.recentLevel];
        if (arr.length === 0) {
            return { ascend: 0, triggerStamp: 0 };
        }
        const triggerSourceIndexes = this.recentLevel.map((level, index) => level === -1 ? -1 : index);
        const maxShortValleyLength = 2;
        // Resolve missing values before measuring short valleys.
        let segmentStartIndex = 0;
        while(segmentStartIndex < arr.length) {
            if(this.recentLevel[segmentStartIndex] > 0) {
                segmentStartIndex++;
                continue;
            }
            let segmentEndIndex = segmentStartIndex + 1;
            while(segmentEndIndex < arr.length && this.recentLevel[segmentEndIndex] <= 0) {
                segmentEndIndex++;
            }

            let missingStartIndex = segmentStartIndex;
            let truncated = false;
            while(missingStartIndex < segmentEndIndex) {
                if(this.recentLevel[missingStartIndex] !== -1) {
                    missingStartIndex++;
                    continue;
                }
                let missingEndIndex = missingStartIndex + 1;
                while(missingEndIndex < segmentEndIndex && this.recentLevel[missingEndIndex] === -1) {
                    missingEndIndex++;
                }
                const missingLength = missingEndIndex - missingStartIndex;
                if(missingLength > this.expireSeconds || missingEndIndex >= arr.length) {
                    arr.splice(missingStartIndex);
                    triggerSourceIndexes.splice(missingStartIndex);
                    truncated = true;
                    break;
                }
                arr.fill(this.recentLevel[missingEndIndex], missingStartIndex, missingEndIndex);
                missingStartIndex = missingEndIndex;
            }
            if(truncated) break;
            segmentStartIndex = segmentEndIndex;
        }
        if (arr.length === 0) {
            return { ascend: 0, triggerStamp: 0 };
        }

        let levelSegmentStartIndex = 0;
        while(levelSegmentStartIndex < arr.length) {
            const segmentLevel = arr[levelSegmentStartIndex];
            let levelSegmentEndIndex = levelSegmentStartIndex + 1;
            while(levelSegmentEndIndex < arr.length && arr[levelSegmentEndIndex] === segmentLevel) {
                levelSegmentEndIndex++;
            }
            const segmentLength = levelSegmentEndIndex - levelSegmentStartIndex;
            const newerSideLevel = arr[levelSegmentStartIndex - 1];
            const olderSideLevel = arr[levelSegmentEndIndex];
            const isShortDeepValley =
                levelSegmentStartIndex > 0 &&
                levelSegmentEndIndex < arr.length &&
                segmentLength <= maxShortValleyLength &&
                segmentLevel <= Math.min(newerSideLevel, olderSideLevel) - 2;
            if(isShortDeepValley) {
                arr.fill(olderSideLevel, levelSegmentStartIndex, levelSegmentEndIndex);
                triggerSourceIndexes.fill(-1, levelSegmentStartIndex, levelSegmentEndIndex);
            }
            levelSegmentStartIndex = levelSegmentEndIndex;
        }

        let latestMinVal = arr[0];
        let latestMinIndex = 0;
        let identicalCount = 1;
        let shallowValleyMinVal = null;
        let shallowValleyMinIndex = -1;
        for (let i = 0; i < arr.length - 1; i++) {
            const current = arr[i];
            const next = arr[i + 1];
            if (next < current) {
                if(shallowValleyMinVal === null || next < shallowValleyMinVal) {
                    latestMinVal = next;
                    latestMinIndex = i + 1;
                    shallowValleyMinVal = null;
                    shallowValleyMinIndex = -1;
                }
                identicalCount = 1;
            } else if (next > current) {
                if(shallowValleyMinVal === null) {
                    shallowValleyMinVal = latestMinVal;
                    shallowValleyMinIndex = latestMinIndex;
                }
                if(next - shallowValleyMinVal > 1) {
                    latestMinVal = shallowValleyMinVal;
                    latestMinIndex = shallowValleyMinIndex;
                    break;
                }
                identicalCount = 1;
            } else {
                identicalCount++;
                if (identicalCount > this.expireSeconds) {
                    break;
                }
            }
        }
        const ascend = Math.max(this.level - latestMinVal, 0);
        const triggerSourceIndex = triggerSourceIndexes[latestMinIndex];
        const triggerStamp = ascend > 0 && triggerSourceIndex >= 0
            ? this.updateStamp - triggerSourceIndex * 1000
            : 0;
        return { ascend, triggerStamp };
    }
    isAbnormalStation() {
        // 如果近期数据出现3个及以上的高峰视为异常数据
        const recentFilter = this.recentLevel.filter(val => val != -1);
        if (recentFilter.length < 3) {
            return false;
        }
        let peakCount = 0;
        let i = 1;
        const n = recentFilter.length;
        while (i < n) {
            while (i < n && recentFilter[i] <= recentFilter[i - 1]) {
                i++;
            }
            if (i >= n) break; 
            let leftBottom = recentFilter[i - 1]; 
            let top = recentFilter[i];
            while (i < n && recentFilter[i] >= recentFilter[i - 1]) {
                top = recentFilter[i];
                i++;
            }
            if (i >= n) break; 
            let rightBottom = recentFilter[i];
            while (i < n && recentFilter[i] <= recentFilter[i - 1]) {
                rightBottom = recentFilter[i];
                i++;
            }
            if (top - leftBottom >= 3 && top - rightBottom >= 3) {
                peakCount++;
            }
        }
        return peakCount >= 3;
    }
    calcActivity(level, ascend){
        let levelActivity, ascendActivity
        if(ascend > 0 || this.isActive) {
            if(level <= 5) levelActivity = 0
            else if(level <= 7) {
                if(this.isActive) levelActivity = 0.5 * (level - 5)
                else levelActivity = 0.25 * (level - 5)
            }
            else if(level <= 11) levelActivity = 2 * (level - 7)
            else levelActivity = 6 * (level - 10)
        }
        else {
            levelActivity = 0
        }
        if(ascend <= 0) ascendActivity = 0
        else if(ascend <= 1) {
            if(this.isActive) ascendActivity = 0.5
            else ascendActivity = 0.25
        }
        else if(ascend <= 6) ascendActivity = 2 * (ascend - 2) + 1
        else ascendActivity = 6 * (ascend - 5)
        return levelActivity + ascendActivity
    }
    render(){
        if(this.useCanvasLayer) return
        const oldMarkerType = this.markerType
        const oldColor = this.color
        const oldRadius = this.radius
        this.setColorRadius()
        const zoom = this.map.getZoom()
        this.markerType = getNiedMarkerType(this.level, zoom)
        if(this.markerType == oldMarkerType && this.color == oldColor && this.radius == oldRadius) return
        if((this.markerType == 2) != (oldMarkerType == 2) || this.color != oldColor) {
            if(this.marker && this.map.hasLayer(this.marker)) this.map.removeLayer(this.marker)
            switch(this.markerType) {
                case 2:
                    const iconZoom = Math.min(Math.max(zoom, 6), 10)
                    const shindoIcon = shindoIcons[iconZoom][this.shindo]
                    this.marker = markRaw(L.marker(this.latLng, {
                        icon: shindoIcon,
                        pane: `niedStationPane${this.level}`,
                        interactive: false
                    }))
                    break
                case 1:
                    const color = shindoColorBand[this.level]
                    const radius = Math.max(this.radius, 2)
                    this.marker = markRaw(L.circleMarker(this.latLng, {
                        radius: radius * 1.8,
                        opacity: 1,
                        fillOpacity: 1,
                        color: '#ffffff',
                        fillColor: color,
                        weight: radius * 0.4,
                        pane: `niedStationPane${this.level}`,
                        interactive: false
                    }))
                    break
                case 0:
                    this.marker = markRaw(L.circleMarker(this.latLng, {
                        radius: this.radius,
                        opacity: 1,
                        fillOpacity: 1,
                        color: this.color,
                        fillColor: this.color,
                        weight: 0,
                        pane: `niedStationPane${this.level}`,
                        interactive: false
                    }))
                    break
            }
            this.marker.addTo(this.map)
        }
        else {
            switch(this.markerType) {
                case 2:
                    const iconZoom = Math.min(Math.max(zoom, 6), 10)
                    const shindoIcon = shindoIcons[iconZoom][this.shindo]
                    this.marker.setIcon(shindoIcon)
                    break
                case 1:
                    const color = shindoColorBand[this.level]
                    const radius = Math.max(this.radius, 2)
                    this.marker.setStyle({
                        color: '#ffffff',
                        fillColor: color,
                        weight: radius * 0.4,
                    }).setRadius(radius * 1.8)
                    break
                case 0:
                    this.marker.setStyle({
                        color: this.color,
                        fillColor: this.color,
                        weight: 0,
                    }).setRadius(this.radius)
                    break
            }
        }
    }
    setColorRadius(){
        const zoom = this.map.getZoom()
        const { color, radius } = getNiedColorRadius(this.level, zoom)
        this.color = color
        this.radius = radius
    }
    getCanvasDrawInfo(zoom = this.map.getZoom()){
        if(!settingsStore) settingsStore = useSettingsStore()
        const { color, radius } = getNiedColorRadius(this.level, zoom)
        return {
            latLng: this.latLng,
            level: this.level,
            drawOrder: this.level,
            simpleColorLevel: this.level,
            shindo: this.shindo,
            iconKey: this.shindo,
            color,
            radius,
            markerType: getNiedMarkerType(this.level, zoom)
        }
    }
    setActive(){
        this.isActive = true
        clearTimeout(this.activeTimer)
        this.activeTimer = setTimeout(() => {
            this.isActive = false
        }, 12500);
    }
    terminate(){
        if(this.marker && this.map.hasLayer(this.marker)) this.map.removeLayer(this.marker)
        this.map = null
        this.marker = null
        clearTimeout(this.activeTimer)
    }
}
export class KmaStation {
    constructor(map, id, latLng, intensity, isActive, useCanvasLayer = false){
        if(!settingsStore) settingsStore = useSettingsStore()
        this.map = markRaw(map)
        this.id = id
        this.latLng = latLng
        this.useCanvasLayer = useCanvasLayer
        this.level = intensity + 2
        this.recentLevel = []
        this.recentSeconds = 60
        this.recentMaxLevel = -1
        this.activityLevel = this.level
        this.activitySeconds = 12
        this.holdLevel = this.level
        this.ascend = false
        this.intensity = getMmiFromKmaLevel(this.holdLevel)
        this.isActive = isActive
        this.markerType = null
        if(!this.useCanvasLayer) this.render()
    }
    update(intensity, render = true){
        this.level = intensity + 2
        this.recentLevel.unshift(this.level)
        this.recentLevel.splice(this.recentSeconds)
        this.recentMaxLevel = Math.max(...this.recentLevel.filter(Number.isFinite), -1)
        const activityArr = this.recentLevel.slice(0, this.activitySeconds)
        const pastArr = this.recentLevel.slice(this.activitySeconds)
        this.activityLevel = Math.max(...activityArr, -1)
        const pastLevel = pastArr.filter(level => level >= 0).length >= this.activitySeconds * 3 ? Math.max(...pastArr, -1) : -1
        this.ascend = pastLevel >= 0 ? activityArr.filter(level => level > pastLevel).length : 0
        const holdLevel = Math.max(...this.recentLevel.slice(0, settingsStore.mainSettings.displaySeisNet.kmaIntHold), -1)
        if(holdLevel != this.holdLevel) {
            this.holdLevel = holdLevel
            this.intensity = getMmiFromKmaLevel(this.holdLevel)
            render && !this.useCanvasLayer && this.render()
        }
    }
    render(){
        if(this.useCanvasLayer) return
        const oldMarkerType = this.markerType
        const oldColor = this.color
        const oldRadius = this.radius
        this.setColorRadius()
        const zoom = this.map.getZoom()
        this.markerType = getKmaMarkerType(this.holdLevel, zoom)
        if(this.markerType == oldMarkerType && this.color == oldColor && this.radius == oldRadius) return
        if((this.markerType == 2) != (oldMarkerType == 2) || this.color != oldColor) {
            if(this.marker && this.map.hasLayer(this.marker)) this.map.removeLayer(this.marker)
            switch(this.markerType) {
                case 2:
                    const iconZoom = Math.min(Math.max(zoom, 6), 10)
                    const intIcon = intIcons[iconZoom][this.intensity]
                    this.marker = markRaw(L.marker(this.latLng, {
                        icon: intIcon,
                        pane: `kmaStationPane${this.holdLevel}`,
                        interactive: false
                    }))
                    break
                case 1:
                    const color = kmaIntColorBand[this.holdLevel]
                    const radius = Math.max(this.radius, 2)
                    this.marker = markRaw(L.circleMarker(this.latLng, {
                        radius: radius * 1.8,
                        opacity: 1,
                        fillOpacity: 1,
                        color: '#ffffff',
                        fillColor: color,
                        weight: radius * 0.4,
                        pane: `kmaStationPane${this.holdLevel}`,
                        interactive: false
                    }))
                    break
                case 0:
                    this.marker = markRaw(L.circleMarker(this.latLng, {
                        radius: this.radius,
                        opacity: 1,
                        fillOpacity: 1,
                        color: this.color,
                        fillColor: this.color,
                        weight: 0,
                        pane: `kmaStationPane${this.holdLevel}`,
                        interactive: false
                    }))
                    break
            }
            this.marker.addTo(this.map)
        }
        else {
            switch(this.markerType) {
                case 2:
                    const iconZoom = Math.min(Math.max(zoom, 6), 10)
                    const intIcon = intIcons[iconZoom][this.intensity]
                    this.marker.setIcon(intIcon)
                    break
                case 1:
                    const color = kmaIntColorBand[this.holdLevel]
                    const radius = Math.max(this.radius, 2)
                    this.marker.setStyle({
                        color: '#ffffff',
                        fillColor: color,
                        weight: radius * 0.4,
                    }).setRadius(radius * 1.8)
                    break
                case 0:
                    this.marker.setStyle({
                        color: this.color,
                        fillColor: this.color,
                        weight: 0,
                    }).setRadius(this.radius)
                    break
            }
        }
    }
    getCanvasDrawInfo(zoom = this.map.getZoom()){
        if(!settingsStore) settingsStore = useSettingsStore()
        const { color, radius } = getKmaColorRadius(this.holdLevel, zoom)
        return {
            latLng: this.latLng,
            level: this.holdLevel,
            drawOrder: this.holdLevel,
            simpleColorLevel: this.holdLevel,
            iconKey: this.intensity,
            color,
            radius,
            markerType: getKmaMarkerType(this.holdLevel, zoom)
        }
    }
    setColorRadius(){
        const zoom = this.map.getZoom()
        const { color, radius } = getKmaColorRadius(this.holdLevel, zoom)
        this.color = color
        this.radius = radius
    }
    setActive(){
        this.isActive = true
        clearTimeout(this.activeTimer)
        this.activeTimer = setTimeout(() => {
            this.isActive = false
        }, 12500);
    }
    terminate(){
        if(this.marker && this.map.hasLayer(this.marker)) this.map.removeLayer(this.marker)
        this.map = null
        this.marker = null
        clearTimeout(this.activeTimer)
    }
}
export class intReportStation {
    constructor(map, id, latLng, detail){
        if(!settingsStore) settingsStore = useSettingsStore()
        this.map = markRaw(map)
        this.id = id
        this.latLng = latLng
        this.detail = detail
        this.intensity = getCsisLevelFromCsis(detail.INT)
        this.render()
    }
    render(){
        const zoom = this.map.getZoom()
        const iconZoom = Math.min(Math.max(zoom, 6), 10)
        const intIcon = intIcons[iconZoom][this.intensity]
        if(this.marker) {
            this.marker.setIcon(intIcon)
        }
        else {
            this.marker = markRaw(L.marker(this.latLng, {
                icon: intIcon,
                pane: `intReportStationPane${this.intensity}`,
                interactive: true
            }))
            this.marker.bindTooltip(`
                <strong>${this.detail.stName} (${this.detail.stID})</strong>
                <br>
                地点: ${this.detail.Province + this.detail.City + this.detail.County + this.detail.Town}
                <br>
                经纬度: ${this.detail.stla.toFixed(2)}°N, ${this.detail.stlo.toFixed(2)}°E
                <br>
                震中距: ${this.detail.Dist.toFixed(2)} km
                <br>
                仪器烈度: ${this.detail.INT.toFixed(1)} (I_PGA: ${this.detail.IPGA.toFixed(1)}, I_PGV: ${this.detail.IPGV.toFixed(1)})
                <br>
                PGA: ${this.detail.PGA.toFixed(1)} gal
                <br>
                PGV: ${this.detail.PGV.toFixed(1)} kine
            `, { permanent: false, direction: 'top', className: 'custom-tooltip' })
            this.marker.addTo(this.map)
        }
    }
    terminate(){
        if(this.marker && this.map.hasLayer(this.marker)) this.map.removeLayer(this.marker)
        this.map = null
        this.marker = null
    }
}
