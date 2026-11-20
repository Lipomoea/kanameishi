<template>
    <div class="threshold-slider">
        <div class="threshold-slider__label" :style="{ width: labelWidth }">
            <span class="threshold-slider__label-text"><slot name="label" /></span>
            <div class="threshold-slider__value" :class="setClassName(shindoScale[value], true)">
                <div class="shindo">{{ shindoScale[value] }}</div>
            </div>
        </div>
        <el-slider
            v-model="value"
            :disabled="disabled"
            :min="0" :max="9"
            :step="1"
            size="small"
            show-stops
            :format-tooltip="value => shindoScale[value]"
        />
    </div>
</template>

<script setup>
import '@/assets/background.css'
import { setClassName, shindoScale } from '@/utils/Utils'

const value = defineModel({ type: Number, required: true })
defineProps({
    disabled: { type: Boolean, default: false },
    labelWidth: { type: String, default: '10rem' },
})
</script>

<style scoped src="../../assets/threshold-slider.css"></style>
<style scoped>
.shindo {
    font-size: 11px;
    letter-spacing: -1px;
    padding-right: 1px;
}
.shindo::first-letter {
    font-size: 16px;
    vertical-align: top;
}
</style>
