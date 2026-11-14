<template>
    <div class="ui-scale-control">
        <div class="ui-scale-row">
            <span>UI缩放比例</span>
            <el-select
                :model-value="selectedScale"
                :disabled="confirmVisible"
                aria-label="UI缩放比例"
                size="small"
                style="width: 144px;"
                @change="selectScale"
            >
                <el-option v-for="option in presets" :key="option.value" :label="option.label" :value="option.value" />
                <el-option :label="customLabel" value="custom" />
            </el-select>
        </div>
        <div v-if="selectedScale === 'custom'" class="ui-scale-row">
            <span>自定义比例</span>
            <div class="ui-scale-input">
                <el-input-number
                    v-model="customPercent"
                    :min="MIN_UI_SCALE * 100"
                    :max="MAX_UI_SCALE * 100"
                    :step="1"
                    :precision="0"
                    :disabled="confirmVisible"
                    aria-label="自定义UI缩放百分比"
                    size="small"
                    style="width: 128px;"
                />
                <span>%</span>
                <el-button size="small" :disabled="confirmVisible || !validCustomPercent" @click="tryCustomScale">应用</el-button>
            </div>
        </div>
        <el-dialog
            v-model="confirmVisible"
            title="保留新的 UI 缩放比例？"
            width="min(420px, 92vw)"
            align-center
            append-to-body
            :show-close="false"
            :close-on-click-modal="false"
            @close="cancelPreview"
        >
            <p>当前正在试用{{ previewLabel }}，将在 {{ remainingSeconds }} 秒后恢复原设置。</p>
            <template #footer>
                <el-button @click="cancelPreview">还原</el-button>
                <el-button type="primary" @click="confirmPreview">保留更改</el-button>
            </template>
        </el-dialog>
    </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { isValidUiScale, MIN_UI_SCALE, MAX_UI_SCALE } from '@/utils/UiScale'

const settingsStore = useSettingsStore()
const presets = [
    { label: '自动', value: -1 },
    { label: '50%', value: 0.5 },
    { label: '75%', value: 0.75 },
    { label: '100%（推荐）', value: 1 },
    { label: '125%', value: 1.25 },
    { label: '150%', value: 1.5 },
    { label: '200%', value: 2 },
]
const isPreset = value => presets.some(option => option.value === value)
const formatPercent = value => `${Number((value * 100).toFixed(2))}%`
const selectedScale = ref(1)
const customPercent = ref(100)
const confirmVisible = ref(false)
const previewLabel = ref('')
const remainingSeconds = ref(15)
const customLabel = computed(() => isPreset(settingsStore.effectiveUiScale)
    ? '自定义…' : `${formatPercent(settingsStore.effectiveUiScale)}（自定义）`)
const validCustomPercent = computed(() => Number.isInteger(customPercent.value)
    && customPercent.value >= MIN_UI_SCALE * 100 && customPercent.value <= MAX_UI_SCALE * 100)
let expiresAt = 0
let countdownTimer

function syncSelection() {
    const value = settingsStore.mainSettings.uiScale
    selectedScale.value = isPreset(value) ? value : 'custom'
    customPercent.value = value > 0 ? Math.round(value * 100) : 100
}

function cancelPreview() {
    clearInterval(countdownTimer)
    countdownTimer = undefined
    confirmVisible.value = false
    settingsStore.uiScalePreview = null
    syncSelection()
}

function updateCountdown() {
    if(!confirmVisible.value) return
    remainingSeconds.value = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
    if(remainingSeconds.value === 0) cancelPreview()
}

function startPreview(value) {
    if(confirmVisible.value || !isValidUiScale(value)) return
    if(value === settingsStore.mainSettings.uiScale) {
        syncSelection()
        return
    }
    settingsStore.uiScalePreview = value
    previewLabel.value = value === -1 ? '自动缩放' : formatPercent(value)
    expiresAt = Date.now() + 15000
    remainingSeconds.value = 15
    confirmVisible.value = true
    countdownTimer = setInterval(updateCountdown, 250)
}

function selectScale(value) {
    if(confirmVisible.value) return
    selectedScale.value = value
    if(value !== 'custom') startPreview(value)
}

function tryCustomScale() {
    if(validCustomPercent.value) startPreview(customPercent.value / 100)
}

function confirmPreview() {
    if(!confirmVisible.value) return
    // Check the deadline again in case timers were suspended in the background.
    if(Date.now() < expiresAt) settingsStore.mainSettings.uiScale = settingsStore.uiScalePreview
    cancelPreview()
}

watch(() => settingsStore.mainSettings.uiScale, cancelPreview, { immediate: true })
onMounted(() => {
    window.addEventListener('focus', updateCountdown)
    document.addEventListener('visibilitychange', updateCountdown)
})
onDeactivated(cancelPreview)
onBeforeUnmount(() => {
    cancelPreview()
    window.removeEventListener('focus', updateCountdown)
    document.removeEventListener('visibilitychange', updateCountdown)
})
</script>

<style scoped>
.ui-scale-control {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
}
.ui-scale-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
}
.ui-scale-input {
    display: flex;
    align-items: center;
    gap: 6px;
}
</style>
