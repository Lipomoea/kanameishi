<template>
    <div class="outer">
        <div class="container">
            <div class="info" v-for="(item, index) of eqlists" :key="index" :style="{
                border: `var(--${item.className}) 2px solid`
            }">
                <div class="background" :class="item.className"></div>
                <div v-if="item.useShindo" class="intensity" :class="item.className">
                    <div class="intensity-title">{{ item.intTitle || '最大震度' }}</div>
                    <div :class="formatShindo(item.maxIntensity) != '?' ? 'shindo' : 'csis'">
                        {{ formatShindo(item.maxIntensity) }}
                    </div>
                </div>
                <div v-else class="intensity" :class="item.className">
                    <div class="intensity-title">{{ item.intTitle || '预估烈度' }}</div>
                    <div class="csis" :class="{
                        'roman': settingsStore.mainSettings.useRomanCsis,
                        'scale-75': item.maxIntensity == '8',
                        'scale-9': item.maxIntensity == '7' || item.maxIntensity == '12'
                    }">
                        {{ formatCsis(item.maxIntensity) }}
                    </div>
                </div>
                <div class="right">
                    <div class="location">{{ item.hypocenter || '震源 調査中' }}</div>
                    <div class="time">{{ item.originTime + ` (${formatTimeZone(item.timeZone)})` }}</div>
                    <div class="bottom">
                        <div class="magnitude">M{{ item.magnitude ? item.magnitude.toFixed(1) : '不明' }}</div>
                        <div class="depth">{{ item.depth.toFixed(0) }}km</div>
                        <div class="source">{{ (item.intReportId ? '*' : '') + item.source }}</div>
                    </div>
                </div>
                <div class="buttons" @contextmenu.prevent="handleCopy(item)">
                    <el-button class="button" type="warning" plain @click="openUrl(item.url)">查看网页</el-button>
                    <el-button class="button" :type="isReplaying(item) ? 'danger' : 'primary'" plain @click="toggleReplay(item)">{{ isReplaying(item) ? '停止回放' : '测站回放' }}</el-button>
                    <el-button class="button" :type="displayIds.has(item.id) ? 'danger' : 'success'" plain @click="displayOnMap(item)">{{ displayIds.has(item.id) ? '取消显示' : '地图显示' }}</el-button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import '@/assets/background.css';
import { reactive, computed, inject, nextTick, onBeforeUnmount, watch } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { defaultEqMessage, useStatusStore } from '@/stores/status';
import { openUrl, formatTimeZone, formatCsis, calcTimeDiff, formatShindo, getShindoRank, calcPassedTime, stampToTime, exactRound } from '@/utils/Utils';
import { useTimeStore } from '@/stores/time';
import { HistoryEvent } from '@/classes/EewEqlistClasses';
import { isTauri } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const statusStore = useStatusStore()
const settingsStore = useSettingsStore()
const timeStore = useTimeStore()

const smartSetView = inject('smartSetView')
const historyList = inject('historyList')
const activeEewList = inject('activeEewList')

const maxHistoryNumber = 100
const maxReplayDuration = 10 * 60 * 1000
const replayLeadSeconds = 9
const replayState = reactive({
    itemId: null,
    mockEewId: null,
    mockTimer: null,
    autoStopTimer: null,
    issued: false,
})
const flatted = computed(() => Object.values(statusStore.history).flat())
const sorted = computed(() => flatted.value.sort((a, b) => calcTimeDiff(b.originTime, b.timeZone, a.originTime, a.timeZone)))
const eqlists = computed(() => sorted.value.filter(item => (settingsStore.mainSettings.historyMagThres == 0 || item.magnitude >= settingsStore.mainSettings.historyMagThres) && settingsStore.mainSettings.historySources.includes(item.source)).slice(0, maxHistoryNumber))
onBeforeUnmount(() => {
    stopReplay()
})
watch(() => statusStore.seisNetReplayDelay, newVal => {
    if(replayState.itemId == null) return
    if(Number(newVal) == 0) {
        stopReplay(false)
        return
    }
    resetAutoStopTimer()
})
const isReplaying = (item) => replayState.itemId == item.id
const toggleReplay = (item) => {
    if(isReplaying(item)) {
        stopReplay()
        return
    }
    if(replayState.itemId != null) {
        stopReplay()
    }
    startReplay(item)
}
const startReplay = (item) => {
    const passedTime = exactRound(Math.max(calcPassedTime(item.originTime, item.timeZone) / 60000 + replayLeadSeconds / 60, 0), 2)
    statusStore.seisNetReplayDelay = passedTime
    replayState.itemId = item.id
    if (settingsStore.advancedSettings.mockOnReplay && settingsStore.advancedSettings.mockEew) {
        createMockEew(item)
    }
    resetAutoStopTimer()
}
const resetAutoStopTimer = () => {
    if(replayState.autoStopTimer) {
        clearTimeout(replayState.autoStopTimer)
    }
    replayState.autoStopTimer = setTimeout(() => {
        stopReplay()
    }, maxReplayDuration)
}
const resetReplayState = () => {
    replayState.itemId = null
    replayState.mockEewId = null
    replayState.mockTimer = null
    replayState.autoStopTimer = null
    replayState.issued = false
}
const terminateActiveMockEew = (mockEewId = replayState.mockEewId) => {
    const event = activeEewList?.find(event => event.eqMessage?.source == 'mockEew' && event.eqMessage?.id == mockEewId)
    event?.terminate()
}
const stopReplay = (resetDelay = true) => {
    if(replayState.itemId == null) return
    const mockEewId = replayState.mockEewId
    if(replayState.mockTimer) {
        clearTimeout(replayState.mockTimer)
    }
    if(replayState.autoStopTimer) {
        clearTimeout(replayState.autoStopTimer)
    }
    if(replayState.issued) {
        terminateActiveMockEew(mockEewId)
        nextTick(() => {
            terminateActiveMockEew(mockEewId)
        })
    }
    resetReplayState()
    if(resetDelay) {
        statusStore.seisNetReplayDelay = 0
    }
}
const handleCopy = async (item) => {
    const content = `${item.hypocenter} ${item.originTime} (UTC${formatTimeZone(item.timeZone)}) M${item.magnitude ? item.magnitude.toFixed(1) : '不明'} ${item.depth.toFixed(0)}km ${item.useShindo ? ('最大震度' + formatShindo(item.maxIntensity, false)) : ('预估最大烈度' + item.maxIntensity)}`
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
const displayIds = computed(() => new Set(historyList.map(event => event.eqMessage.id)))
const displayOnMap = (item) => {
    const event = historyList.find(event => event.eqMessage.id == item.id)
    if(event) {
        event.deactivate()
    }
    else {
        const eqMessage = Object.assign({}, defaultEqMessage, item)
        eqMessage.source = 'history'
        eqMessage.title = eqMessage.titleText = '历史地震 ' + `(${item.source})`
        eqMessage.depthText = '深度: ' + eqMessage.depth.toFixed(0) + 'km'
        eqMessage.reportTime = stampToTime(timeStore.getTimeStamp(), eqMessage.timeZone)
        if(!statusStore.map) return
        const newEvent = reactive(new HistoryEvent(statusStore.map, eqMessage, smartSetView, historyList))
        historyList.unshift(newEvent)
        newEvent.update(eqMessage)
    }
}
const createMockEew = (item) => {
    const now = timeStore.getTimeStamp()
    const originTime = dayjs(now).add(replayLeadSeconds, 'seconds').utcOffset(item.timeZone * 60).format('YYYY-MM-DD HH:mm:ss')
    const eqMessage = {
        id: now,
        isEew: true,
        timeZone: item.timeZone,
        reportNum: 1,
        reportNumText: '第1报（最终）',
        reportTime: originTime,
        isAssumption: false,
        isWarn: item.useShindo ? getShindoRank(item.maxIntensity) >= 5 : Number(item.maxIntensity) >= 6.5,
        isFinal: true,
        isCanceled: false,
        title: `模拟回放·${item.source}`,
        titleText: `模拟回放·${item.source}`,
        hypocenter: '模拟·' + item.hypocenter,
        hypocenterText: '震中: 模拟·' + item.hypocenter,
        lat: item.lat,
        lng: item.lng,
        depth: item.depth,
        depthText: '深度: ' + item.depth.toFixed(0) + 'km',
        originTime,
        originTimeText: '发震时间: ' + originTime,
        magnitude: item.magnitude,
        magnitudeText: '震级: ' + item.magnitude.toFixed(1),
        useShindo: item.useShindo,
        maxIntensity: item.maxIntensity,
        maxIntensityText: (item.useShindo ? '推定最大震度: ' : '预估最大烈度: ') + item.maxIntensity
    }
    replayState.mockEewId = eqMessage.id
    replayState.mockTimer = setTimeout(() => {
        replayState.issued = true
        replayState.mockTimer = null
        statusStore.setEqMessage('mockEew', eqMessage)
    }, replayLeadSeconds * 1000);
}
</script>

<style lang="scss" scoped>
.outer {
    width: 100%;
    .container {
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 5px;
        .info{
            width: 100%;
            height: 80px;
            border-radius: 12px;
            overflow: hidden;
            display: flex;
            gap: 7px;
            align-items: center;
            pointer-events: auto;
            position: relative;
            &:hover .buttons {
                display: flex;
            }
            * {
                z-index: 1;
            }
            .background {
                position: absolute;
                width: 100%;
                height: 100%;
                z-index: 0;
                opacity: 0.2;
            }
            .intensity{
                width: 78px;
                flex-shrink: 0;
                height: 100%;
                padding-right: 2px;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                position: relative;
                pointer-events: none;
                .intensity-title{
                    height: 16px;
                    font-size: 13px;
                    line-height: 1;
                    position: absolute;
                    top: 2px;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                }
                .shindo,.csis{
                    height: 64px;
                    text-align: center;
                    letter-spacing: -4px;
                    padding-right: 4px;
                    position: absolute;
                    bottom: 4px;
                }
                .shindo{
                    font-size: 44px;
                }
                .shindo::first-letter{
                    font-size: 64px;
                    vertical-align: top;
                }
                .csis{
                    font-size: 64px;
                }
                .roman.scale-9{
                    transform: scaleX(0.9);
                }
                .roman.scale-75{
                    transform: scaleX(0.75);
                }
            }
            .right{
                flex: 1;
                min-width: 0;
                height: 100%;
                display: flex;
                flex-direction: column;
                justify-content: space-evenly;
                line-height: 1;
                vertical-align: middle;
                padding-top: 2px;
                .location{
                    width: 100%;
                    font-size: 24px;
                    white-space: nowrap;
                    text-overflow: ellipsis;
                    overflow: hidden;
                }
                .time{
                    width: 100%;
                    font-size: 20px;
                    white-space: nowrap;
                    text-overflow: ellipsis;
                    overflow: hidden;
                }
                .bottom{
                    width: 100%;
                    display: flex;
                    align-items: center;
                    gap: 20px;
                    overflow: hidden;
                    white-space: nowrap;
                    .magnitude{
                        font-size: 20px;
                    }
                    .depth{
                        font-size: 20px;
                    }
                    .source {
                        margin-left: auto;
                        margin-right: 4px;
                        font-size: 14px;
                        color: #7f7f7f;
                        align-self: flex-end;
                    }
                }
            }
            .buttons {
                width: 100%;
                height: 100%;
                position: absolute;
                background-color: #ffffff9f;
                backdrop-filter: blur(1px);
                display: none;
                justify-content: space-evenly;
                align-items: center;
                z-index: 2;
                .button {
                    width: 88px;
                    height: 32px;
                }
            }
        }
    }
}
</style>
