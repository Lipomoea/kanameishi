<template>
    <div class="outer2">
        <div class="container" @click="() => {
            statusStore.showMockDialog = true
            statusStore.showStatusPanel = false
        }">
            <div class="title">新建模拟地震预警</div>
            <Plus class="icon" />
        </div>
    </div>
    <el-dialog v-model="statusStore.showMockDialog" width="35rem" :show-close="false" append-to-body>
        <template #header>
            <div class="flex justify-between items-center">
                <div class="title">模拟地震预警</div>
                <div class="flex items-center">
                    <input ref="fileInput" type="file" accept=".json" style="display: none;" @change="onFileSelected" />
                    <el-button type="primary" @click="importScenario">导入</el-button>
                    <el-button @click="exportScenario">导出</el-button>
                </div>
            </div>
        </template>
        <template #default>
            <div v-if="currentForm">
                <el-form :model="currentForm" label-width="12.5rem">
                    <el-form-item label="预警ID">
                        <el-input v-model="id" placeholder="选填" />
                    </el-form-item>

                    <el-form-item label="标题">
                        <el-input v-model="title" placeholder="选填" />&nbsp;第{{ currentPage + 1 }}报
                    </el-form-item>

                    <el-form-item label="发震延迟 (s)">
                        <el-input-number v-model="currentForm.originDelay" :step="1" />
                    </el-form-item>

                    <el-form-item label="发报延迟 (s)">
                        <el-input-number v-model="currentForm.reportDelay" :min="0" :step="1" />
                    </el-form-item>

                    <el-form-item label="震中地名">
                        <el-input v-model="currentForm.hypocenter" placeholder="选填" />
                    </el-form-item>

                    <el-form-item label="拾取经纬度">
                        <el-button class="pick-latlng" @click="pickLatLng">拾取经纬度</el-button>
                    </el-form-item>

                    <el-form-item label="纬度">
                        <el-input-number v-model="currentForm.lat" :step="0.1" :min="-90" :max="90" />
                    </el-form-item>

                    <el-form-item label="经度">
                        <el-input-number v-model="currentForm.lng" :step="0.1" :min="-180" :max="180" />
                    </el-form-item>

                    <el-form-item label="深度 (km)">
                        <el-input-number v-model="currentForm.depth" :step="10" :min="0" :max="700" />
                    </el-form-item>

                    <el-form-item label="震级">
                        <el-input-number v-model="currentForm.magnitude" :step="0.1" :min="0" :max="10"
                            :precision="1" />
                    </el-form-item>

                    <el-form-item label="使用震度">
                        <el-switch v-model="useShindo" />
                    </el-form-item>

                    <el-form-item :label="useShindo ? '最大震度' : '最大烈度'">
                        <el-select v-model="currentForm.maxIntensity" placeholder="请选择">
                            <el-option v-for="intensity in intensities" :key="intensity" :label="intensity"
                                :value="intensity" />
                        </el-select>
                    </el-form-item>

                    <el-form-item label="假定震源">
                        <el-switch v-model="currentForm.isAssumption" />
                    </el-form-item>

                    <el-form-item label="警报">
                        <el-switch v-model="currentForm.isWarn" v-if="currentForm.maxIntensity != '自动'" />
                        <span v-else>自动判断</span>
                    </el-form-item>

                    <el-form-item label="取消报">
                        <el-switch v-model="currentForm.isCanceled" />
                    </el-form-item>
                </el-form>
            </div>
        </template>

        <template #footer>
            <div class="flex justify-between items-center">
                <div class="flex items-center gap">
                    <el-button @click="prevPage" :disabled="currentPage == 0">上一页</el-button>
                    <div>{{ currentPage + 1 }} / {{ forms.length }}</div>
                    <el-button @click="nextPage">下一页</el-button>
                </div>

                <div class="flex items-center">
                    <el-button type="danger" @click="removePage" :disabled="forms.length === 1">删除</el-button>
                    <el-button @click="addPage">插入</el-button>
                    <el-button @click="statusStore.showMockDialog = false">取消</el-button>
                    <el-button type="primary" @click="submitScenario">提交</el-button>
                </div>
            </div>
        </template>
    </el-dialog>
</template>

<script setup>
import { useStatusStore } from '@/stores/status';
import { useTimeStore } from '@/stores/time';
import dayjs from 'dayjs';
import { ref, reactive, computed, watch } from 'vue';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { getFEName } from '@/utils/FERegions';
import { Plus } from '@element-plus/icons-vue';
import { calcCsisLevel, calcMaxJmaShindoLevel, getShindoRank } from '@/utils/Utils';
dayjs.extend(utc);
dayjs.extend(timezone);

const statusStore = useStatusStore()
const timeStore = useTimeStore()

const currentPage = ref(0)
const forms = reactive([])

const id = ref('')
const title = ref('')
const useShindo = ref(false)

const defaultMessage = {
    originDelay: 0,
    reportDelay: 5,
    isAssumption: false,
    isWarn: false,
    isCanceled: false,
    hypocenter: '',
    lat: 0,
    lng: 0,
    depth: 10,
    magnitude: 5.0,
    maxIntensity: ''
}

const createDefaultMessage = () => ({ ...defaultMessage })

forms.push(createDefaultMessage())

const currentForm = computed(() => forms[currentPage.value])

const intensities = computed(() => useShindo.value
    ? ['自动', '不明', '0', '1', '2', '3', '4', '5弱', '5強', '6弱', '6強', '7']
    : ['自动', '不明', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'])

watch(intensities, () => {
    forms.forEach(message => {
        message.maxIntensity = intensities.value[0]
    })
}, { immediate: true })

const prevPage = () => {
    if (currentPage.value > 0) currentPage.value--
}

const nextPage = () => {
    if (currentPage.value < forms.length - 1) {
        currentPage.value++
    } else {
        addPage()
    }
}

const addPage = () => {
    forms.splice(currentPage.value + 1, 0, { ...currentForm.value, reportDelay: currentForm.value.reportDelay + 2 })
    currentPage.value++
}

const removePage = () => {
    if (forms.length == 1) return
    forms.splice(currentPage.value, 1)
    if (currentPage.value >= forms.length) {
        currentPage.value = forms.length - 1
    }
}

const generateEqMessage = (form, index, id) => {
    form.originDelay = form.originDelay ?? defaultMessage.originDelay
    form.reportDelay = form.reportDelay ?? defaultMessage.reportDelay
    form.lat = form.lat ?? defaultMessage.lat
    form.lng = form.lng ?? defaultMessage.lng
    form.depth = form.depth ?? defaultMessage.depth
    form.magnitude = form.magnitude ?? defaultMessage.magnitude
    const reportNum = index + 1
    const isFinal = reportNum == forms.length
    const reportNumText = `第${reportNum}报${isFinal ? '（最终）' : ''}`
    const hypocenter = '模拟·' + (form.hypocenter || getFEName(form.lat, form.lng))
    const { lat, lng, depth, magnitude, isAssumption, isWarn, isCanceled } = form
    const maxIntensity = form.maxIntensity == '自动' ? (useShindo.value ? calcMaxJmaShindoLevel(magnitude, depth, lat, lng, false) : calcCsisLevel(magnitude, depth)) : form.maxIntensity
    const now = timeStore.getTimeStamp()
    const originTime = dayjs(now).add(form.originDelay, 'seconds').tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm:ss')
    const reportTime = dayjs(now).add(form.reportDelay, 'seconds').tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm:ss')
    const eqMessage = {
        id,
        isEew: true,
        timeZone: 8,
        reportNum,
        reportNumText,
        reportTime,
        isAssumption,
        isWarn: form.maxIntensity == '自动' ? (useShindo.value ? getShindoRank(maxIntensity) >= 5 : maxIntensity >= 6.5) : isWarn,
        isFinal,
        isCanceled,
        title: '模拟·' + (title.value || '地震预警'),
        titleText: '模拟·' + (title.value || '地震预警') + (isCanceled ? '（取消）' : ''),
        hypocenter,
        hypocenterText: '震中: ' + hypocenter,
        lat,
        lng,
        depth,
        depthText: '深度: ' + depth.toFixed(0) + 'km',
        originTime,
        originTimeText: '发震时间: ' + originTime,
        magnitude,
        magnitudeText: '震级: ' + magnitude.toFixed(1),
        useShindo: useShindo.value,
        maxIntensity,
        maxIntensityText: (useShindo.value ? '推定最大震度: ' : '预估最大烈度: ') + maxIntensity
    }
    return eqMessage
}

const submitScenario = () => {
    const staticId = id.value || Date.now().toString()
    forms.forEach((form, index) => {
        const eqMessage = generateEqMessage(form, index, staticId)
        setTimeout(() => {
            statusStore.setEqMessage('mockEew', eqMessage)
        }, form.reportDelay * 1000);
    })
    statusStore.showMockDialog = false
}
const exportScenario = () => {
    const output = {
        id: id.value,
        title: title.value,
        useShindo: useShindo.value,
        forms
    }
    const filename = id.value || dayjs().format('YYYY-MM-DD HH:mm:ss')
    const jsonStr = JSON.stringify(output);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
const fileInput = ref(null);
const importScenario = () => {
    fileInput.value?.click();
}
function onFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const json = JSON.parse(ev.target.result);
            id.value = json?.id
            title.value = json?.title
            useShindo.value = json?.useShindo
            setTimeout(() => {
                forms.splice(0)
                json?.forms?.forEach(form => {
                    forms.push(form)
                })
            }, 0);
            currentPage.value = 0
        } catch (err) {
            ElMessage.error('JSON 格式错误！');
        }
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
}
let map
watch(() => statusStore.map, newVal => {
    map = newVal
}, { immediate: true })
const pickLatLng = () => {
    statusStore.showMockDialog = false
    map?.once('click', e => {
        currentForm.value.lat = Math.round(e.latlng.lat * 1000) / 1000
        currentForm.value.lng = Math.round(e.latlng.lng * 1000) / 1000
        statusStore.showMockDialog = true
    })
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
        justify-content: center;
        align-items: center;
        border-radius: 20px;
        user-select: none;
        box-shadow: 0 4px 10px #0000003f;
        transition: box-shadow 0.3s ease, transform 0.3s ease;
        &:hover {
            box-shadow: 0 2px 5px #0000003f;
            transform: translateY(2px);
        }
        .title {
            position: absolute;
            bottom: 40px;
            margin: 0 auto;
            font-size: 18px;
            font-weight: 700;
        }
        .icon {
            width: 100px;
            height: 100px;
            margin-bottom: 30px;
        }
    }
}


.title {
    font-size: 24px;
    color: var(--el-text-color-regular);
}

.flex {
    display: flex;
}

.justify-between {
    justify-content: space-between;
}

.items-center {
    align-items: center;
}

.gap {
    gap: 1em;
}

.el-input,
.el-select,
.el-input-number,
.pick-latlng {
    width: 10rem;
}
</style>
