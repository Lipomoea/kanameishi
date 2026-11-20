<template>
    <div class="threshold-slider">
        <div class="threshold-slider__label" :style="{ width: labelWidth }">
            <span class="threshold-slider__label-text"><slot name="label" /></span>
            <div class="threshold-slider__value" :class="setClassName(value, false)">
                <div class="csis" :class="{
                    roman: settingsStore.mainSettings.useRomanCsis,
                    'scale-9': value == 8,
                }">{{ formatCsis(value.toString()) }}</div>
            </div>
        </div>
        <el-slider
            v-model="value"
            :disabled="disabled"
            :min="0" :max="12"
            :step="1"
            size="small"
            show-stops
        />
    </div>
</template>

<script setup>
import '@/assets/background.css'
import { useSettingsStore } from '@/stores/settings'
import { formatCsis, setClassName } from '@/utils/Utils'

const settingsStore = useSettingsStore()
const value = defineModel({ type: Number, required: true })
defineProps({
    disabled: { type: Boolean, default: false },
    labelWidth: { type: String, default: '10rem' },
})
</script>

<style scoped src="../../assets/threshold-slider.css"></style>
<style scoped>
.csis {
    font-size: 16px;
}
.roman.scale-9 {
    transform: scaleX(0.9);
}
</style>
