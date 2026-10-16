<template>
    <div class="outer2">
        <div class="container" @contextmenu.prevent="handleCopy">
            <div class="bg" :class="className"></div>
            <div class="intensity" :class="fontClass">{{ eqMessage.useShindo ? eqMessage.maxIntensity : formatCsis(eqMessage.maxIntensity) }}</div>
            <div class="text title" :class="fontClass">{{ formatText(eqMessage.titleText) }}</div>
            <div class="text" :class="fontClass" v-if="eqMessage.isEew">{{ formatText(eqMessage.reportNumText) }}</div>
            <div class="text" :class="fontClass">{{ formatText(eqMessage.hypocenterText) }}</div>
            <div class="text" :class="fontClass">{{ formatText(eqMessage.depthText) }}</div>
            <div class="text" :class="fontClass">{{ formatText(originTimeText) }}</div>
            <div class="text" :class="fontClass">{{ formatText(eqMessage.magnitudeText) }}</div>
            <div class="text" :class="fontClass">{{ formatText(eqMessage.maxIntensityText) }}</div>
            <div class="text" :class="fontClass">经过时间: {{ formatText(msToTime(passedTimeFromOrigin)) }}</div>
        </div>
    </div>
</template>

<script setup>
import { onBeforeUnmount, ref, reactive, computed, watch, inject } from 'vue';
import { formatText, msToTime, calcPassedTime, judgeSameEvent, calcTimeDiff, formatCsis, formatTimeZone } from '@/utils/Utils';
import { EewEvent, EqlistEvent, ignoredIds } from '@/classes/EewEqlistClasses';
import { useTimeStore } from '@/stores/time';
import { useStatusStore } from '@/stores/status';
import { useSettingsStore } from '@/stores/settings';
import { isTauri } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import '@/assets/background.css';
import '@/assets/opacity.css';

const props = defineProps({
    source: String,
})

const activeEewList = inject('activeEewList')
const eqlistList = inject('eqlistList')
const smartSetView = inject('smartSetView')
const handleTempEqlists = inject('handleTempEqlists')
const timeStore = useTimeStore()
const statusStore = useStatusStore()
const settingsStore = useSettingsStore()
const eqMessage = computed(()=>statusStore.eqMessage[props.source])
const originTimeText = computed(() => {
    const text = eqMessage.value.originTimeText.replace(/ \(JST\)$/, '')
    return text ? `${text} (UTC${formatTimeZone(eqMessage.value.timeZone)})` : ''
})

onBeforeUnmount(()=>{
    clearTimeout(timer)
})

const className = ref('white midOpacity')
const fontClass = computed(() => className.value.includes('dark-orange') || className.value.includes('red') || className.value.includes('purple') ? 'font-white' : 'font-black')
let timer

watch(eqMessage, (newVal)=>{
    className.value = newVal.className + ' midOpacity'
    const passedTime = Math.max(calcPassedTime(newVal.reportTime, newVal.timeZone) ?? Infinity, 0)
    let time
    if(newVal.isEew){
        if(newVal.isCanceled) time = 20 * 1000
        else if(newVal.isWarn) time = Math.max(newVal.magnitude, 6) * 60 * 1000
        else time = Math.max(newVal.magnitude, 3) * 60 * 1000
    }
    else{
        time = 300 * 1000
        if(newVal.className.includes('orange') || newVal.magnitude >= 6.0){
            time = 600 * 1000
        }
        if(newVal.className.includes('red') || newVal.magnitude >= 7.0){
            time = 900 * 1000
        }
        if(newVal.className == 'purple' || newVal.magnitude >= 7.5){
            time = 1200 * 1000
        }
        if(newVal.isCanceled) time = 60 * 1000
    }
    time -= passedTime
    if(newVal.isEew){
        const ignoredMessage = ignoredIds[`${newVal.source}|${newVal.id}`]
        if(!ignoredMessage || newVal.reportNum > ignoredMessage.reportNum ||
        newVal.reportNum == ignoredMessage.reportNum && newVal.isCanceled > ignoredMessage.isCanceled) {
            let i = 0
            while(i < activeEewList.length){
                if(judgeSameEvent(newVal, activeEewList[i].eqMessage)){
                    activeEewList[i].update(Object.assign({}, newVal), time)
                    break
                }
                i++
            }
            if(i == activeEewList.length){
                if(statusStore.map){
                    if(time > 0 && (settingsStore.actionWhiteListArr.some(key => newVal.hypocenter.includes(key)) || props.source != 'gqEew' 
                        || (settingsStore.mainSettings.gqActionMag == 0 || newVal.magnitude >= settingsStore.mainSettings.gqActionMag)
                    )) {
                        const newEvent = reactive(new EewEvent(statusStore.map, Object.assign({}, newVal), activeEewList, handleTempEqlists, smartSetView))
                        activeEewList.unshift(newEvent)
                        newEvent.update(Object.assign({}, newVal), time, true)
                    }
                }
            }
        }
    }
    else {
        let i = 0
        const shouldUpdate = settingsStore.actionWhiteListArr.some(key => newVal.hypocenter.includes(key)) || newVal.source != 'fssnEqlist' && newVal.source != 'usgsEqlist'
            || newVal.source == 'fssnEqlist'
            && (newVal.title == 'FSSN正式测定' || newVal.title == 'FSSN自动测定' && settingsStore.mainSettings.fssnActionType == 0)
            && (settingsStore.mainSettings.fssnActionMag == 0 || newVal.magnitude >= settingsStore.mainSettings.fssnActionMag)
            || newVal.source == 'usgsEqlist'
            && (settingsStore.mainSettings.usgsActionMag == 0 || newVal.magnitude >= settingsStore.mainSettings.usgsActionMag)
        while(i < eqlistList.length){
            if(newVal.source == eqlistList[i].eqMessage.source){
                if(shouldUpdate) {
                    eqlistList[i].update(Object.assign({}, newVal), time)
                }
                break
            }
            i++
        }
        if(i == eqlistList.length){
            if(statusStore.map){
                if(shouldUpdate) {
                    const newEvent = reactive(new EqlistEvent(statusStore.map, Object.assign({}, newVal), handleTempEqlists, smartSetView))
                    eqlistList.unshift(newEvent)
                    newEvent.update(Object.assign({}, newVal), time, true)
                }
            }
        }
        eqlistList.sort((a, b) => calcTimeDiff(b.eqMessage.reportTime, b.eqMessage.timeZone, a.eqMessage.reportTime, a.eqMessage.timeZone) + (b.eqMessage.source == props.source) - (a.eqMessage.source == props.source))
        eqlistList.forEach((event, index) => {
            if(index == 0) {
                event.isLatest = true
            }
            else {
                event.isLatest = false
                if(settingsStore.mainSettings.eqlistsDisplayMode == 1 && !event.isActive) event.removeMark()
            }
        })
    }
    if(time > 0) {
        className.value = newVal.className + ' highOpacity'
        clearTimeout(timer)
        timer = setTimeout(() => {
            className.value = newVal.className + ' midOpacity'
        }, time);
    }
}, { deep: true })
const passedTimeFromOrigin = ref(0)
watch(()=>timeStore.currentTimeStamp, ()=>{
    passedTimeFromOrigin.value = calcPassedTime(eqMessage.value.originTime, eqMessage.value.timeZone)
})

const handleCopy = async () => {
    const content = JSON.stringify(eqMessage.value)
    try {
        if(isTauri()) {
            await writeText(content)
        }
        else {
            await navigator.clipboard.writeText(content)
        }
        ElMessage({
            message: '复制成功',
            type: 'success'
        })
    } catch (e) {
        console.log(e)
        ElMessage({
            message: '复制失败',
            type: 'error'
        })
    }
}
</script>

<style lang="scss" scoped>
.outer2{
    width: 100%;
    max-width: 500px;
    .container{
        position: relative;
        overflow: hidden;
        width: 100%;
        height: 270px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: space-evenly;
        border-radius: 20px;
        user-select: none;
        box-shadow: 0 4px 10px #0000003f;
        transition: box-shadow 0.3s ease, transform 0.3s ease;
        &:hover {
            box-shadow: 0 2px 5px #0000003f;
            transform: translateY(2px);
        }
        *{
            z-index: 10;
            pointer-events: none;
        }
        .bg{
            position: absolute;
            width: 100%;
            height: 100%;
            z-index: 0;
            pointer-events: auto;
        }
        .intensity{
            position: absolute;
            z-index: 5;
            display: flex;
            justify-content: center;
            align-items: center;
            font-size: 180px;
            font-weight: 700;
        }
        .text{
            text-align: center;
            max-width: 90%;
        }
        .title{
            font-size: 18px;
            font-weight: 700;
        }
        .font-black {
            color: #000000;
        }
        .font-white {
            color: #ffffff;
        }
        .intensity.font-black {
            color: #0000003f;
        }
        .intensity.font-white {
            color: #ffffff3f;
        }
    }
}
</style>
