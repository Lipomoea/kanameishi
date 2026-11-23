<template>
    <div class="outer">
        <div class="container" @click="handleClick">
            <div class="title">自然资源部海啸预警</div>
            <div class="receive">{{ statusStore.tsunamiMessage.nmefcTsunami.reportTime }} (UTC+8) 更新</div>
            <div class="details">
                <template v-for="group in groups" :key="group.grade">
                    <div class="group" v-if="warnAreaByGrade[group.grade]">
                        <div class="sub-title info">
                            <div :class="group.className">{{ group.title }}</div>
                            <div :class="group.className">预计到达</div>
                            <div :class="group.className">最大波</div>
                        </div>
                        <div class="info" v-for="item in warnAreaByGrade[group.grade]" :key="item.name">
                            <div class="name" :class="item.name.length > 8 ? 'small' : ''">{{ item.name }}</div>
                            <div class="arrival-time">{{ item.arrivalTime }}</div>
                            <div class="description" :class="group.fontClass">{{ item.description }}</div>
                        </div>
                    </div>
                </template>
            </div>
        </div>
    </div>
</template>

<script setup>
import { defaultTsunamiMessage, useStatusStore } from '@/stores/status';
import { useSettingsStore } from '@/stores/settings';
import { computed, watch, inject, onBeforeUnmount } from 'vue';
import { focusWindow, openUrl, playSound, sendMyNotification } from '@/utils/Utils';
import { iconUrls } from '@/utils/Urls';
import { getTsunamiAction, getTsunamiSound, nmefcTsunamiTitles } from '@/utils/Tsunami';

const statusStore = useStatusStore()
const settingsStore = useSettingsStore()
const handleTempEqlists = inject('handleTempEqlists')
const groups = [
    { grade: '红色', title: nmefcTsunamiTitles[4], className: 'purple', fontClass: 'font-purple' },
    { grade: '橙色', title: nmefcTsunamiTitles[3], className: 'red', fontClass: 'font-red' },
    { grade: '黄色', title: nmefcTsunamiTitles[2], className: 'yellow', fontClass: 'font-black' },
    { grade: '蓝色', title: '轻微海面变动', className: 'blue', fontClass: 'font-black' },
]
const warnAreaByGrade = computed(() => {
    const result = {}
    for (const area of JSON.parse(statusStore.tsunamiMessage.nmefcTsunami.warnArea)) {
        (result[area.grade] ||= []).push(area)
    }
    return result
})

const handleClick = () => openUrl('https://www.nmefc.cn/zhyj/hx')

const oldMessage = { ...defaultTsunamiMessage }
const soundTimers = new Set()
const clearSounds = () => {
    soundTimers.forEach(timer => clearTimeout(timer))
    soundTimers.clear()
}
const scheduleSound = (sound, delay) => {
    const timer = setTimeout(() => {
        soundTimers.delete(timer)
        playSound(sound)
    }, delay)
    soundTimers.add(timer)
}
watch(
    [() => statusStore.map, () => statusStore.tsunamiMessage.nmefcTsunami],
    ([map, newMessage]) => {
        if (map === null) return
        const event = getTsunamiAction(oldMessage, newMessage)
        Object.assign(oldMessage, newMessage)
        if (!event) return
        const { action, status, title: reportTitle } = event
        const urgent = status >= 3
        let title, body = urgent ? '请立即避难！' : status === 2 ? '请从海岸边撤离！' : '请留意后续情报。'
        let icon = urgent ? iconUrls.warn : status === 2 ? iconUrls.caution : iconUrls.info
        if (action === 'issue') title = '现正发布' + reportTitle
        else if (action === 'update') title = reportTitle + '更新了'
        else {
            title = action === 'clear' ? reportTitle + '已解除' : '已切换到' + reportTitle
            body = '请留意后续情报。'
            icon = iconUrls.info
        }
        const { notification, sound, focus } = settingsStore.mainSettings.onTsunami
        if (notification) sendMyNotification(title, body, icon)
        if (sound) {
            const speech = getTsunamiSound(status, action)
            if (action === 'issue' && urgent) {
                scheduleSound('ews', 1500)
                scheduleSound(speech, 12000)
            } else playSound(speech)
        }
        if (focus) focusWindow()
        handleTempEqlists(settingsStore.mainSettings.tempTsunamiDuration * 1000, 'nmefcTsunami')
    },
    { immediate: true, deep: true }
)
onBeforeUnmount(clearSounds)
</script>

<style lang="scss" scoped>
.outer{
    width: 100%;
    .container{
        position: relative;
        overflow: hidden;
        width: 100%;
        padding: 10px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
        background-color: #dfdfdf;
        border-radius: 10px;
        user-select: none;
        .title {
            font-size: 24px;
            font-weight: 700;
        }
        .receive {
            color: #7f7f7f;
            font-size: 14px;
        }
        .details {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            width: 100%;
            border-radius: 8px;
            overflow: hidden;
            gap: 5px;
            .group {
                width: 100%;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 2px;
                .sub-title {
                    font-size: 20px;
                }
                .info {
                    width: 100%;
                    height: 30px;
                    display: grid;
                    grid-template-columns: 5fr 3fr 2fr;
                    gap: 2px;
                    :nth-child(1) {
                        justify-content: flex-start;
                        padding-left: 5px;
                    }
                    div {
                        width: 100%;
                        height: 100%;
                        justify-self: center;
                        align-self: center;
                        font-size: 18px;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                    }
                    .name,.arrival-time {
                        background-color: #0000007f;
                    }
                    .name {
                        color: white;
                    }
                    .arrival-time {
                        color: var(--yellow);
                    }
                    .description {
                        background-color: #ffffff7f;
                    }
                    .font-purple {
                        color: var(--purple);
                    }
                    .font-red {
                        color: var(--red);
                    }
                    .font-black {
                        color: black;
                    }
                    .small {
                        font-size: 16px;
                    }
                }
            }
        }
    }
}
</style>
