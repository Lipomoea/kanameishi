<template>
    <el-dialog
        v-model="visible"
        title="按震级筛选"
        width="min(420px, 92vw)"
        align-center
        :show-close="false"
        append-to-body
    >
        <div class="filter-controls">
            <MagnitudeSlider
                :model-value="settingsStore.mainSettings.historyMagThres"
                :disabled="!settingsStore.mainSettings.historyMagUnified"
                @update:model-value="settingsStore.setHistoryMagThres"
            >
                <template #label>
                    <el-checkbox
                        :model-value="settingsStore.mainSettings.historyMagUnified"
                        @update:model-value="settingsStore.setHistoryMagUnified"
                    >统一筛选阈值</el-checkbox>
                </template>
            </MagnitudeSlider>
            <div class="source-filters">
                <MagnitudeSlider
                    v-for="source in sources"
                    :key="source"
                    :model-value="settingsStore.mainSettings.historyMagThresBySource[source]"
                    :disabled="settingsStore.mainSettings.historyMagUnified"
                    @update:model-value="settingsStore.setHistorySourceMagThres(source, $event)"
                >
                    <template #label>{{ source }}</template>
                </MagnitudeSlider>
            </div>
            <p class="hint">“0”表示不按震级筛选。</p>
        </div>
        <template #footer>
            <el-button type="primary" @click="visible = false">完成</el-button>
        </template>
    </el-dialog>
</template>

<script setup>
import { computed } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import MagnitudeSlider from './MagnitudeSlider.vue'

const visible = defineModel({ type: Boolean, default: false })
const settingsStore = useSettingsStore()
const sources = computed(() => Object.keys(settingsStore.mainSettings.historyMagThresBySource))
</script>

<style scoped>
.filter-controls {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-height: 60vh;
    overflow-y: auto;
}
.source-filters {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-top: 1px solid var(--el-border-color-lighter);
    padding-top: 12px;
}
.el-checkbox {
    height: 24px;
    margin: 0;
}
.hint {
    color: var(--el-text-color-secondary);
    font-size: 12px;
    margin: 0;
}
</style>
