import { calcPassedTime, calcWaveDistance, calcReachTime, playSound, sendMyNotification, getClassLevel, focusWindow, calcCsisLevel, calcJmaShindoLevel, getShindoRank, timeToStamp, formatTimeZone, calcDistanceKm } from '@/utils/Utils';
import travelTimes from '@/utils/TravelTimes';
import { chimeUrls, iconUrls } from '@/utils/Urls';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@/assets/background.css';
import { useSettingsStore } from '@/stores/settings';
import eewCross from '@/assets/icon/hypocenter/eewCross.svg';
import cancelCross from '@/assets/icon/hypocenter/cancelCross.svg';
import eqlistCross from '@/assets/icon/hypocenter/eqlistCross.svg';
import eewCircle from '@/assets/icon/hypocenter/eewCircle.svg';
import cancelCircle from '@/assets/icon/hypocenter/cancelCircle.svg';
import { intReportStation } from './StationClasses';
import { useStatusStore } from '@/stores/status';
import { markRaw } from 'vue';

const iconRadius = 20

const eewCrossIcon = L.icon({
    iconUrl: eewCross,
    iconSize: [iconRadius * 2, iconRadius * 2],
    iconAnchor: [iconRadius, iconRadius]
})

const cancelCrossIcon = L.icon({
    iconUrl: cancelCross,
    iconSize: [iconRadius * 2, iconRadius * 2],
    iconAnchor: [iconRadius, iconRadius]
})

const eqlistCrossIcon = L.icon({
    iconUrl: eqlistCross,
    iconSize: [iconRadius * 2, iconRadius * 2],
    iconAnchor: [iconRadius, iconRadius]
})

const eewCircleIcon = L.icon({
    iconUrl: eewCircle,
    iconSize: [iconRadius * 2, iconRadius * 2],
    iconAnchor: [iconRadius, iconRadius]
})

const cancelCircleIcon = L.icon({
    iconUrl: cancelCircle,
    iconSize: [iconRadius * 2, iconRadius * 2],
    iconAnchor: [iconRadius, iconRadius]
})

let settingsStore, statusStore
export const ignoredIds = {}

export class EewEvent {
    constructor(map, eqMessage, activeEewList, handleTempEqlists, smartSetView){
        this.map = markRaw(map)
        if(!settingsStore) settingsStore = useSettingsStore()
        this.eqMessage = eqMessage
        this.activeEewList = activeEewList
        this.userLatLng = settingsStore.mainSettings.userLatLng
        this.isValidUserLatLng = settingsStore.isValidUserLatLng
        this.userCsis = '?'
        this.userShindo = '?'
        this.nearestJmaLoc = settingsStore.nearestJmaLoc
        this.countdown = -1
        this.pCountdown = -1
        this.shouldAction = false
        this.isIntense = false
        this.mute = false
        this.showMenu = false
        this.showPCountdown = false
        this.flags = {
            firstSound: false,
            cautionSound: false,
            warnSound: false,
            intenseSound: false,
            focused: false,
            lastSecondsCount: settingsStore.mainSettings.countdownStart + 1
        }
        this.hypoMarker = null
        this.maxRadius1 = 2000
        this.maxRadius2 = 10000
        this.maxWaveRadius = 2000
        this.gradId = `sWaveGradient-${this.eqMessage.id}`
        this.handleTempEqlists = handleTempEqlists
        this.smartSetView = smartSetView
    }
    removeMark(){
        if(this.hypoMarker && this.map.hasLayer(this.hypoMarker)) this.map.removeLayer(this.hypoMarker)
        this.hypoMarker = null
    }
    setMark(){
        this.removeMark()
        if(this.hypoLatLng) {
            if(this.eqMessage.isCanceled){
                this.hypoMarker = markRaw(L.marker(this.hypoLatLng, { icon: this.eqMessage.isAssumption?cancelCircleIcon:cancelCrossIcon, pane: 'eewMarkerPane' }))
            }
            else{
                this.hypoMarker = markRaw(L.marker(this.hypoLatLng, { icon: this.eqMessage.isAssumption?eewCircleIcon:eewCrossIcon, pane: 'eewMarkerPane' }))
            }
            this.hypoMarker.bindTooltip(`
                <strong>${this.eqMessage.titleText}</strong><br>
                ${this.eqMessage.reportNumText}<br>
                ${this.eqMessage.hypocenter}(${this.eqMessage.lat},${this.eqMessage.lng})<br>
                ${this.eqMessage.depthText}<br>
                ${this.eqMessage.originTime} (${formatTimeZone(this.eqMessage.timeZone)})<br>
                M${this.eqMessage.magnitude.toFixed(1)}<br>
                ${this.eqMessage.maxIntensityText}
                `, { permanent: false, direction: 'top', className: 'custom-tooltip' })
            this.hypoMarker.addTo(this.map)
        }
    }
    clearReachBar() {
        if(this.reachBarMarker && this.map.hasLayer(this.reachBarMarker)) this.map.removeLayer(this.reachBarMarker)
        this.reachBarMarker = null
    }
    drawReachBar(p_reach, s_reach, updated) {
        if(updated) {
            this.clearReachBar()
        }
        if(p_reach >= 1 && s_reach >= 1) {
            this.clearReachBar()
        }
        else {
            const size = 54
            const radius = 24
            const pStrokeWidth = 6
            const sStrokeWidth = 4
            const perimeter = 2 * Math.PI * radius
            const dasharray1 = perimeter * p_reach
            const dasharray2 = perimeter * (1 - p_reach)
            const dasharray3 = perimeter * s_reach
            const dasharray4 = perimeter * (1 - s_reach)
            if(!this.reachBarMarker) {
                const html = `
                    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
                    <circle
                        cx="${size / 2}"
                        cy="${size / 2}"
                        r="${radius}"
                        fill="none"
                        stroke="white"
                        stroke-linecap="round"
                        stroke-width="${pStrokeWidth}"
                        stroke-dasharray="var(--dasharray1) var(--dasharray2)"
                        transform="rotate(-90 ${size / 2} ${size / 2})"
                    />
                    <circle
                        cx="${size / 2}"
                        cy="${size / 2}"
                        r="${radius}"
                        fill="none"
                        stroke="currentColor"
                        stroke-linecap="round"
                        stroke-width="${sStrokeWidth}"
                        stroke-dasharray="var(--dasharray3) var(--dasharray4)"
                        transform="rotate(-90 ${size / 2} ${size / 2})"
                    />
                    </svg>
                `
                this.reachBarMarker = markRaw(L.marker(this.hypoLatLng, {
                    icon: L.divIcon({
                        html,
                        className: '',
                        iconSize: [size, size],
                        iconAnchor: [size / 2, size / 2]
                    }),
                    pane: 'eewReachPane',
                    interactive: false
                })).addTo(this.map)
            }
            const el = this.reachBarMarker.getElement()
            el.style.setProperty('--dasharray1', dasharray1)
            el.style.setProperty('--dasharray2', dasharray2)
            el.style.setProperty('--dasharray3', dasharray3)
            el.style.setProperty('--dasharray4', dasharray4)
            el.style.color = this.eqMessage.isWarn ? 'var(--swave-red)' : 'var(--swave-orange)'
        }
    }
    clearWaves() {
        if(this.pWave && this.map.hasLayer(this.pWave)) {
            this.map.removeLayer(this.pWave)
            this.pWave = null
        }
        if(this.sWave && this.map.hasLayer(this.sWave)) {
            this.map.removeLayer(this.sWave)
            this.sWave = null
        }
        if(this.sWaveFill && this.map.hasLayer(this.sWaveFill)) {
            this.map.removeLayer(this.sWaveFill)
            this.sWaveFill = null
        }
    }
    drawWaves(updated = false){
        const start = performance.now()
        const passedTime = calcPassedTime(this.eqMessage.originTime, this.eqMessage.timeZone) / 1000
        this.handleCountdown(passedTime)
        if(this.hypoLatLng && !this.eqMessage.isAssumption){
            this.switchDrawWaves(passedTime, updated)
        }
        else{
            this.clearWaves()
        }
        clearTimeout(this.drawWavesTimer)
        const end = performance.now()
        const used = Math.max(end - start, 0)
        this.drawWavesTimer = setTimeout(() => {
            this.drawWaves()
        }, 1000 / settingsStore.mainSettings.maxWaveRenderRate - used);
    }
    switchDrawWaves(passedTime, updated){
        let p_reach, p_radius, s_reach, s_radius
        let p_info = calcWaveDistance(travelTimes.jma2001, true, this.eqMessage.depth, passedTime)
        if(p_info.radius > this.maxRadius1) p_info = calcWaveDistance(travelTimes.jb, true, this.eqMessage.depth, passedTime)
        p_reach = p_info.reach
        p_radius = p_info.radius
        let s_info = calcWaveDistance(travelTimes.jma2001, false, this.eqMessage.depth, passedTime)
        if(s_info.radius > this.maxRadius1) s_info = calcWaveDistance(travelTimes.jb, false, this.eqMessage.depth, passedTime)
        s_reach = s_info.reach
        s_radius = s_info.radius
        if(updated) this.clearWaves()
        if(p_radius > 0 && p_radius <= this.maxRadius2) {
            const opacity = p_radius <= this.maxWaveRadius ? this.calcOpacity(p_radius, 0, this.maxWaveRadius, 0.25, 1) : this.calcOpacity(p_radius, this.maxWaveRadius, this.maxRadius2, 0, 0.25)
            if(!this.pWave) {
                this.pWave = markRaw(L.circle(this.hypoLatLng, {
                    color: 'white',
                    opacity,
                    weight: 2,
                    fill: false,
                    radius: p_radius * 1000,
                    pane: 'wavePane',
                    interactive: false
                })).addTo(this.map)
            }
            else {
                this.pWave.setRadius(p_radius * 1000)
                this.pWave.setStyle({
                    opacity
                })
            }
        }
        else {
            if(this.pWave && this.map.hasLayer(this.pWave)) {
                this.map.removeLayer(this.pWave)
                this.pWave = null
            }
        }
        let color
        switch(settingsStore.mainSettings.sWaveColorMode) {
            case 0:
                color = this.eqMessage.isWarn ? 'var(--swave-red)' : 'var(--swave-orange)'
                break
            case 1:
                const mag = this.eqMessage.magnitude
                color = 
                    mag < 2 ? 'var(--swave-gray)' :
                    mag < 3 ? 'var(--swave-blue)' :
                    mag < 4 ? 'var(--swave-green)' :
                    mag < 5 ? 'var(--swave-yellow)' :
                    mag < 6 ? 'var(--swave-orange)' :
                    mag < 7 ? 'var(--swave-red)' :
                    'var(--swave-purple)'
                break
            case 2:
                switch(this.eqMessage.className) {
                    case 'white':
                    case 'dark-gray':
                    case 'gray':
                        color = 'var(--swave-gray)'
                        break
                    case 'sky-blue':
                    case 'blue':
                        color = 'var(--swave-blue)'
                        break
                    case 'green':
                        color = 'var(--swave-green)'
                        break
                    case 'yellow':
                        color = 'var(--swave-yellow)'
                        break
                    case 'orange':
                    case 'dark-orange':
                        color = 'var(--swave-orange)'
                        break
                    case 'red':
                    case 'dark-red':
                        color = 'var(--swave-red)'
                        break
                    case 'purple':
                        color = 'var(--swave-purple)'
                        break
                }
                break
        }
        if(s_radius > 0 && s_radius <= this.maxRadius2) {
            const opacity = s_radius <= this.maxWaveRadius ? this.calcOpacity(s_radius, 0, this.maxWaveRadius, 0.25, 1) : this.calcOpacity(s_radius, this.maxWaveRadius, this.maxRadius2, 0, 0.25)
            if(!this.sWave) {
                this.sWave = markRaw(L.circle(this.hypoLatLng, {
                    color,
                    opacity,
                    weight: 2,
                    fill: false,
                    radius: s_radius * 1000,
                    pane: 'wavePane',
                    interactive: false
                })).addTo(this.map)
            }
            else {
                this.sWave.setRadius(s_radius * 1000)
                this.sWave.setStyle({
                    opacity
                })
            }
        }
        else {
            if(this.sWave && this.map.hasLayer(this.sWave)) {
                this.map.removeLayer(this.sWave)
                this.sWave = null
            }
        }
        if(s_radius > 0 && s_radius <= this.maxWaveRadius) {
            const fillOpacity = this.calcOpacity(s_radius, 0, this.maxWaveRadius, 0, 0.25)
            if(!this.sWaveFill) {
                const svg = document.querySelector('svg.leaflet-zoom-animated');
                if (!svg) return;
                let defs = svg.querySelector('defs');
                if (!defs) {
                    defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                    svg.insertBefore(defs, svg.firstChild);
                }
                const oldGrad = document.getElementById(this.gradId);
                if(oldGrad) oldGrad.remove();
                const grad = document.createElementNS('http://www.w3.org/2000/svg', 'radialGradient');
                grad.setAttribute('id', this.gradId);
                grad.innerHTML = `
                    <stop offset="0" stop-color="${color}" stop-opacity="0" />
                    <stop offset="1" stop-color="${color}" stop-opacity="1" />
                `;
                defs.appendChild(grad);

                this.sWaveFill = markRaw(L.circle(this.hypoLatLng, {
                    fillColor: `url(#${this.gradId})`,
                    fillOpacity,
                    stroke: false,
                    radius: s_radius * 1000,
                    pane: 'waveFillPane',
                    interactive: false
                })).addTo(this.map)
            }
            else {
                this.sWaveFill.setRadius(s_radius * 1000)
                this.sWaveFill.setStyle({
                    fillOpacity
                })
            }
        }
        else {
            if(this.sWaveFill && this.map.hasLayer(this.sWaveFill)) {
                this.map.removeLayer(this.sWaveFill)
                this.sWaveFill = null
            }
        }
        this.drawReachBar(p_reach, s_reach, updated)
    }
    calcOpacity(radius, minRadius, maxRadius, minOpacity = 0, maxOpacity = 1){
        if(radius <= minRadius * 0.2 + maxRadius * 0.8) return maxOpacity
        else if(radius >= maxRadius) return minOpacity
        else {
            const k = 5 * (minOpacity - maxOpacity) / (maxRadius - minRadius)
            const b = (5 * maxOpacity * maxRadius - 4 * minOpacity * maxRadius - minOpacity * minRadius) / (maxRadius - minRadius)
            return k * radius + b
        }
    }
    renderStop(){
        clearTimeout(this.drawWavesTimer)
        this.removeMark()
        this.clearWaves()
        this.clearReachBar()
    }
    update(eqMessage, time, isFirst = false){
        if(isFirst || eqMessage.reportNum > this.eqMessage.reportNum || 
        eqMessage.reportNum == this.eqMessage.reportNum && eqMessage.isCanceled > this.eqMessage.isCanceled || 
        eqMessage.reportNum == this.eqMessage.reportNum && eqMessage.isCanceled == this.eqMessage.isCanceled && eqMessage.type < this.eqMessage.type) {
            const isAddition = eqMessage.reportNum == this.eqMessage.reportNum && eqMessage.isCanceled == this.eqMessage.isCanceled && eqMessage.type < this.eqMessage.type
            if(eqMessage.isCanceled) {
                const { isCanceled, title, titleText, reportNum, reportNumText, reportTime, className } = eqMessage
                Object.assign(this.eqMessage, { isCanceled, title, titleText, reportNum, reportNumText, reportTime, className })
                this.renderStop()
            }
            else {
                Object.assign(this.eqMessage, eqMessage)
                this.hypoLatLng = [this.eqMessage.lat, this.eqMessage.lng]
                this.maxWaveRadius = Math.min(Math.max(50 * this.eqMessage.magnitude ** 2, 200), 2000)
                if(this.isValidUserLatLng) {
                    this.userDist = calcDistanceKm(this.hypoLatLng, this.userLatLng)
                    this.pReachTime = calcReachTime(this.userDist <= this.maxRadius1 ? travelTimes.jma2001 : travelTimes.jb, true, this.eqMessage.depth, this.userDist)
                    this.sReachTime = calcReachTime(this.userDist <= this.maxRadius1 ? travelTimes.jma2001 : travelTimes.jb, false, this.eqMessage.depth, this.userDist)
                    this.userCsis = settingsStore.advancedSettings.forceCalcInt && !this.eqMessage.isAssumption ? 
                        calcCsisLevel(this.eqMessage.magnitude, this.eqMessage.depth, this.userDist) : '?'
                    this.userShindo = 
                    this.nearestJmaLoc
                    ?
                        JSON.parse(this.eqMessage.warnArea).find(item => item.name == this.nearestJmaLoc.sect)?.intensity.replace('強', '+').replace('弱', '-')
                        ||
                        (settingsStore.advancedSettings.forceCalcInt && !this.eqMessage.isAssumption
                        ? calcJmaShindoLevel(this.eqMessage.magnitude, this.eqMessage.depth, this.eqMessage.lat, this.eqMessage.lng, this.nearestJmaLoc)
                        : '?')
                    :
                        '?'
                }
                else {
                    this.userDist = undefined
                    this.pReachTime = -1
                    this.sReachTime = -1
                    this.userCsis = '?'
                    this.userShindo = '?'
                }
                this.drawWaves(true)
            }
            this.setMark()
            this.smartSetView()
            if(
                settingsStore.actionWhiteListArr.some(key => this.eqMessage.hypocenter.includes(key))
                ||
                (
                    !settingsStore.advancedSettings.forceCalcInt
                    ||
                    (
                        this.nearestJmaLoc
                        ? (settingsStore.mainSettings.actionLocalShindo == 0 || getShindoRank(this.userShindo) >= settingsStore.mainSettings.actionLocalShindo)
                        : (settingsStore.mainSettings.actionLocalCsis == 0 || Number(this.userCsis) >= settingsStore.mainSettings.actionLocalCsis)
                    )
                )
                &&
                (settingsStore.mainSettings.actionMag == 0 || this.eqMessage.magnitude >= settingsStore.mainSettings.actionMag)
            ) this.shouldAction = true
            if(
                this.nearestJmaLoc
                ? (getShindoRank(this.userShindo) >= settingsStore.mainSettings.intenseLocalShindo)
                : (Number(this.userCsis) >= settingsStore.mainSettings.intenseLocalCsis)
            ) this.isIntense = true
            if(this.shouldAction && !isAddition && !this.mute) this.handleActions(isFirst)
            clearTimeout(this.terminateTimer)
            this.terminateTimer = setTimeout(() => {
                this.terminate()
            }, time);
        }
    }
    handleActions(isFirst = false){
        const eqMessage = this.eqMessage
        let icon = ''
        //是Warn
        if(eqMessage.isWarn){
            //通知
            if(settingsStore.mainSettings.onEew.notification || settingsStore.mainSettings.onEewWarn.notification){
                if(eqMessage.isCanceled) icon = iconUrls.info
                else icon = iconUrls.warn
            }
            //声音
            if(settingsStore.mainSettings.onEew.sound || settingsStore.mainSettings.onEewWarn.sound){
                if(eqMessage.isCanceled) playSound("cancel")
                else{
                    if(!this.flags.firstSound){
                        playSound("issue")
                        this.flags.firstSound = true
                    }
                    else if(eqMessage.isFinal) playSound("final")
                    else playSound("update")
                    if(!this.flags.warnSound){
                        playSound("warn")
                        this.flags.cautionSound = true
                        this.flags.warnSound = true
                    }
                }
            }
            //弹窗
            if(settingsStore.mainSettings.onEew.focus || settingsStore.mainSettings.onEewWarn.focus){
                if(!this.flags.focused){
                    focusWindow()
                    this.flags.focused = true
                }
            }
        }
        //不是Warn
        else{
            //通知
            if(settingsStore.mainSettings.onEew.notification){
                if(eqMessage.isCanceled) icon = iconUrls.info
                else icon = iconUrls.caution
            }
            //声音
            if(settingsStore.mainSettings.onEew.sound){
                if(eqMessage.isCanceled) playSound("cancel")
                else{
                    if(!this.flags.firstSound){
                        playSound("issue")
                        this.flags.firstSound = true
                    }
                    else if(eqMessage.isFinal) playSound("final")
                    else playSound("update")
                    if(getClassLevel(eqMessage.className) >= getClassLevel('green')){
                        if(!this.flags.cautionSound){
                            playSound("caution")
                            this.flags.cautionSound = true
                        }
                    }
                }
            }
            //弹窗
            if(settingsStore.mainSettings.onEew.focus){
                if(!this.flags.focused){
                    focusWindow()
                    this.flags.focused = true
                }
            }
        }
        if(settingsStore.mainSettings.playIntenseSound) {
            if(this.isIntense) {
                if(!this.flags.intenseSound) {
                    playSound("intense")
                    this.flags.intenseSound = true
                }
            }
        }
        if(icon){
            sendMyNotification(`${eqMessage.titleText} ${eqMessage.reportNumText}`, 
                `${eqMessage.hypocenterText}\n${eqMessage.depthText}\n${eqMessage.magnitudeText}\n${eqMessage.maxIntensityText}`, 
                icon
            )
        }
        if(isFirst) this.handleTempEqlists(0)
    }
    handleCountdown(passedTime){
        if(settingsStore.mainSettings.displayCountdown && this.isValidUserLatLng && (this.userDist <= this.maxRadius2 && !this.eqMessage.isAssumption || settingsStore.mainSettings.forceDisplayCountdown)){
            this.countdown = Math.max(this.sReachTime - passedTime, 0)
            this.pCountdown = Math.max(this.pReachTime - passedTime, 0)
            if(settingsStore.mainSettings.playCountdownSound && this.shouldAction && !this.mute && (
                this.isIntense
                || !settingsStore.advancedSettings.forceCalcInt
                || !settingsStore.mainSettings.playIntenseSound
                || !settingsStore.mainSettings.countdownOnlyIntense
            )) {
                const secondsCount = Math.ceil(this.countdown)
                if(secondsCount < this.flags.lastSecondsCount) {
                    playSound(settingsStore.mainSettings.countdownSpeech && (`${secondsCount}s` in chimeUrls.general) ? `${secondsCount}s` : "countdown")
                    this.flags.lastSecondsCount = secondsCount
                }
            }
        }
        else{
            this.countdown = -1
            this.pCountdown = -1
        }
    }
    handleClick() {
        this.showMenu = !this.showMenu
        if(this.showMenu) {
            this.showMenuTimer = setTimeout(() => {
                this.showMenu = false
            }, 5000);
        }
        else {
            clearTimeout(this.showMenuTimer)
        }
    }
    terminate(force = false){
        ignoredIds[`${this.eqMessage.source}|${this.eqMessage.id}`] = force ? Infinity : this.eqMessage.reportNum
        const keys = Object.keys(ignoredIds)
        if(keys.length > 10) delete ignoredIds[keys[0]]
        clearTimeout(this.terminateTimer)
        clearTimeout(this.showMenuTimer)
        this.renderStop()
        this.smartSetView()
        const index = this.activeEewList.indexOf(this)
        if(index >= 0) this.activeEewList.splice(index, 1)
        document.getElementById(this.gradId)?.remove()
        this.map = null
        this.eqMessage = null
        this.activeEewList = null
        this.handleTempEqlists = null
        this.smartSetView = null
    }
}
export class EqlistEvent {
    constructor(map, eqMessage, handleTempEqlists, smartSetView){
        this.map = markRaw(map)
        if(!settingsStore) settingsStore = useSettingsStore()
        this.eqMessage = eqMessage
        this.isActive = false
        this.isLatest = false
        this.showMenu = false
        this.hypoMarker = null
        this.handleTempEqlists = handleTempEqlists
        this.smartSetView = smartSetView
    }
    update(eqMessage, time, isFirst = false){
        if(isFirst || timeToStamp(eqMessage.reportTime, 0) > timeToStamp(this.eqMessage.reportTime, 0)
        || timeToStamp(eqMessage.reportTime, 0) == timeToStamp(this.eqMessage.reportTime, 0) && timeToStamp(eqMessage.originTime, 0) > timeToStamp(this.eqMessage.originTime, 0)) {
            Object.assign(this.eqMessage, eqMessage)
            this.hypoLatLng = [this.eqMessage.lat, this.eqMessage.lng]
            this.isValidHypo = this.hypoLatLng.some(item => !!item)
            this.setMark()
            this.smartSetView()
            if(time > 0){
                this.handleActions()
                this.isActive = true
                clearTimeout(this.deactivateTimer)
                this.deactivateTimer = setTimeout(() => {
                    this.deactivate()
                }, time);
            }
        }
    }
    setMark(){
        this.removeMark()
        if(this.isValidHypo){
            this.hypoMarker = markRaw(L.marker(this.hypoLatLng, { icon: this.eqMessage.isCanceled ? cancelCrossIcon : eqlistCrossIcon, pane: 'eqlistMarkerPane' }))
            this.hypoMarker.bindTooltip(`
                <strong>${this.eqMessage.titleText}</strong><br>
                ${this.eqMessage.hypocenter}(${this.eqMessage.lat},${this.eqMessage.lng})<br>
                ${this.eqMessage.depthText}<br>
                ${this.eqMessage.originTime} (${formatTimeZone(this.eqMessage.timeZone)})<br>
                M${this.eqMessage.magnitude == -1 ? '不明' : this.eqMessage.magnitude.toFixed(1)}<br>
                ${this.eqMessage.maxIntensityText}
                `, { permanent: false, direction: 'top', className: 'custom-tooltip' })
            this.hypoMarker.addTo(this.map)    
        }
    }
    removeMark(){
        if(this.hypoMarker && this.map.hasLayer(this.hypoMarker)) this.map.removeLayer(this.hypoMarker)
        this.hypoMarker = null
    }
    handleActions(){
        const eqMessage = this.eqMessage
        if(settingsStore.mainSettings.onReport.sound){
            switch(eqMessage.source){
                case 'jmaEqlist':{
                    switch(eqMessage.title){
                        case '震度速報': {
                            playSound("prompt")
                            break
                        }
                        case '震源に関する情報': {
                            playSound("hypocenter")
                            break
                        }
                        default: {
                            playSound("detail")
                            break
                        }
                    }
                    break
                }
                case 'cencEqlist':{
                    if(eqMessage.title == '中国地震台网自动测定'){
                        playSound("hypocenter")
                    }
                    else{
                        playSound("detail")
                    }
                    break
                }
                case 'usgsEqlist': {
                    if(eqMessage.title == 'USGS自动测定'){
                        playSound("hypocenter")
                    }
                    else{
                        playSound("detail")
                    }
                    break
                }
                case 'fssnEqlist': {
                    switch(eqMessage.title) {
                        case 'FSSN自动测定': 
                            playSound("hypocenter")
                            break
                        case 'FSSN正式测定':
                            playSound("detail")
                            break
                        case 'FSSN取消测定':
                            playSound("cancel")
                            break
                    }
                    break
                }
                default: {
                    playSound("detail")
                    break
                }
            }
        }
        if(settingsStore.mainSettings.onReport.focus) focusWindow()
        if(settingsStore.mainSettings.onReport.notification){
            sendMyNotification(`${eqMessage.titleText}`, 
                `${eqMessage.hypocenterText}\n${eqMessage.depthText}\n${eqMessage.magnitudeText}\n${eqMessage.maxIntensityText}`, 
                iconUrls.info
            )
        }
        this.handleTempEqlists(settingsStore.mainSettings.tempEqlistDuration * 1000, eqMessage.source)
    }
    handleClick() {
        this.showMenu = !this.showMenu
        if(this.showMenu) {
            this.showMenuTimer = setTimeout(() => {
                this.showMenu = false
            }, 5000);
        }
        else {
            clearTimeout(this.showMenuTimer)
        }
    }
    deactivate() {
        clearTimeout(this.deactivateTimer)
        clearTimeout(this.showMenuTimer)
        this.isActive = false
        this.showMenu = false
        if(settingsStore.mainSettings.eqlistsDisplayMode == 1 && !this.isLatest) this.removeMark()
        this.smartSetView()
    }
}
export class HistoryEvent extends EqlistEvent {
    constructor(map, eqMessage, smartSetView, historyList){
        super(map, eqMessage, null, smartSetView)
        if(!statusStore) statusStore = useStatusStore()
        this.historyList = historyList
        this.renderAllStations = this.renderAllStations.bind(this)
    }
    setMark(){
        this.removeMark()
        if(this.isValidHypo){
            this.hypoMarker = markRaw(L.marker(this.hypoLatLng, { icon: this.eqMessage.isCanceled ? cancelCrossIcon : eqlistCrossIcon, pane: 'historyMarkerPane' }))
            this.hypoMarker.bindTooltip(`
                <strong>${this.eqMessage.titleText}</strong><br>
                ${this.eqMessage.hypocenter}(${this.eqMessage.lat},${this.eqMessage.lng})<br>
                ${this.eqMessage.depthText}<br>
                ${this.eqMessage.originTime} (${formatTimeZone(this.eqMessage.timeZone)})<br>
                M${this.eqMessage.magnitude == -1 ? '不明' : this.eqMessage.magnitude.toFixed(1)}<br>
                ${this.eqMessage.maxIntensityText}
                `, { permanent: false, direction: 'top', className: 'custom-tooltip' })
            this.hypoMarker.addTo(this.map)    
        }
    }
    update(eqMessage){
        Object.assign(this.eqMessage, eqMessage)
        this.hypoLatLng = [this.eqMessage.lat, this.eqMessage.lng]
        this.isValidHypo = this.hypoLatLng.some(item => !!item)
        this.setMark()
        this.smartSetView()
        this.isActive = true
        statusStore.getIrDetail(this.eqMessage?.intReportId)
    }
    renderAllStations() {
        this.stations?.forEach(station => station.render())
    }
    createStations(data) {
        this.terminateStations()
        this.stations = markRaw([])
        const stationData = data.instrument_intensity_json
        stationData.forEach(item => {
            const station = markRaw(new intReportStation(this.map, item.stID, [item.stla, item.stlo], item))
            this.stations.push(station)
        })
        this.map.on('zoomend', this.renderAllStations)
        this.smartSetView()
    }
    terminateStations() {
        this.map.off('zoomend', this.renderAllStations)
        this.stations?.forEach(station => station.terminate())
        this.stations = null
    }
    handleActions() {
        return
    }
    deactivate() {
        clearTimeout(this.showMenuTimer)
        this.terminateStations()
        this.isActive = false
        this.showMenu = false
        this.removeMark()
        this.smartSetView()
        const index = this.historyList.indexOf(this)
        if(index >= 0) this.historyList.splice(index, 1)
        this.map = null
        this.eqMessage = null
        this.smartSetView = null
        this.historyList = null
    }
}
