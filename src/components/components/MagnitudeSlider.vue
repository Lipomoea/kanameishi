<template>
    <div class="threshold-slider">
        <div class="threshold-slider__label" :style="{ width: labelWidth }">
            <span class="threshold-slider__label-text"><slot name="label" /></span>
            <div class="threshold-slider__value" :class="setClassName(calcCsisLevel(value, 10, 0), false)">
                {{ value.toFixed(1) }}
            </div>
        </div>
        <el-slider
            v-model="value"
            :disabled="disabled"
            :min="0" :max="9"
            :step="0.1"
            size="small"
        />
    </div>
</template>

<script setup>
import '@/assets/background.css'
import { calcCsisLevel, setClassName } from '@/utils/Utils'

const value = defineModel({ type: Number, required: true })
defineProps({
    disabled: { type: Boolean, default: false },
    labelWidth: { type: String, default: '10rem' },
})
</script>

<style scoped src="../../assets/threshold-slider.css"></style>
<style scoped>
.threshold-slider__value {
    width: 28px;
}
</style>
