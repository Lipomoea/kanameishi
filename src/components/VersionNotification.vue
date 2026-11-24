<template>
    <el-dialog v-model="visible" :title="'欢迎来到' + APP_TITLE"
        width="min(560px, calc(100vw - 32px))" :show-close="false" :close-on-click-modal="false"
        append-to-body align-center>
        <div class="version-notification">
            <p v-if="!lastVersion">如果这是您第一次使用本应用程序，请在右上角菜单点击“<el-icon class="settings-icon" aria-label="设置"><Setting /></el-icon>”，阅读“帮助&关于”并完成应用设置。</p>
            <p v-else-if="versionOrder > 0">您已更新至v{{ APP_VERSION }}。</p>
            <ul v-if="showTsunamiMigration || showTsunamiAudioNotice">
                <li v-if="showTsunamiMigration">由于“日本気象庁: 津波情報”功能调整，已为您自动迁移“数据源管理”-“日本気象庁: 津波情報”功能设置。</li>
                <li v-if="showTsunamiAudioNotice">由于海啸信息相关功能调整，请您调整海啸相关自定义音频文件名称。</li>
            </ul>
        </div>
        <template #footer>
            <el-button type="primary" @click="visible = false">知道了</el-button>
        </template>
    </el-dialog>
</template>

<script>
import { APP_TITLE, APP_VERSION } from '@/utils/AppInfo'
import { compareVersions } from '@/utils/Version'
import { parseSettings } from '@/utils/SettingsRestore'

// 在“旧版本 < 迁移版本 <= 当前版本”时执行；没有版本记录也视为尚未迁移。
// 首次引入 lastVersion 时，旧用户同样没有记录，不能据此跳过迁移；非空但无效的版本仍不参与。
// 使用版本比较而非字符串比较，确保跨版本升级和预发布版本也能正确判断。
export const isUpgradeToVersion = (lastVersion, version) => (!lastVersion || compareVersions(lastVersion, version) === -1)
    && compareVersions(APP_VERSION, version) >= 0

// App.vue 在恢复设置、连接数据源前调用此函数，否则旧字段会先被设置恢复逻辑过滤。
// 此处只转换传入的设置；保存结果由入口负责，异步文件检查和弹窗留到组件挂载后处理。
// 当前只有 2.12.0 的规则。新增规则时应按版本从旧到新逐项判断，调整提前返回，
// 确保跨多个版本升级会执行所有适用规则；每项迁移都应允许重复执行而不覆盖用户的新设置。
export const migrateVersionSettings = (savedSettings, lastVersion) => {
    if(!isUpgradeToVersion(lastVersion, '2.12.0')) return savedSettings
    const settings = parseSettings(savedSettings)
    const tsunami = settings.dataSources?.jmaTsunami
    if(!tsunami || typeof tsunami !== 'object' || Array.isArray(tsunami)) return savedSettings
    if(!Object.hasOwn(tsunami, 'p2pquake')) return savedSettings
    // 2.12.0：将 P2PQuake 的开关迁移给 Wolfx；已有明确的 Wolfx 设置时保留用户选择。
    if(typeof tsunami.wolfx !== 'boolean' && typeof tsunami.p2pquake === 'boolean') {
        tsunami.wolfx = tsunami.p2pquake
    }
    delete tsunami.p2pquake
    return JSON.stringify(settings)
}
</script>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import { appDataDir, join } from '@tauri-apps/api/path'
import { exists, readDir } from '@tauri-apps/plugin-fs'
import { Setting } from '@element-plus/icons-vue'
import { useStatusStore } from '@/stores/status'

const statusStore = useStatusStore()
// 入口传入启动时读取的旧版本快照；写入新的 lastVersion 后，提示条件仍使用这个旧值。
const { lastVersion } = defineProps({ lastVersion: { type: String, default: '' } })
const versionOrder = compareVersions(APP_VERSION, lastVersion)
const visible = ref(false)
const showTsunamiMigration = isUpgradeToVersion(lastVersion, '2.12.0')
const showTsunamiAudioNotice = ref(false)
// 只识别旧版实际使用过的 11 种文件名；新版名称和备份后缀不匹配。
const legacyTsunamiAudioName = /^tsunami(?:[12](?:issue|update|switch|cancel)|3(?:issue|update|cancel))\.mp3$/i
let disposed = false

onMounted(async () => {
    if(statusStore.isResettingApp) return
    let audioCheckSucceeded = true
    if(showTsunamiMigration && isTauri()) {
        // 自定义音频仅桌面版支持；只检查并提示，不改名、不修改文件，也不依赖声音开关。
        try {
            const audioPath = await join(await appDataDir(), 'audio')
            if(await exists(audioPath)) {
                const entries = await readDir(audioPath)
                if(disposed || statusStore.isResettingApp) return
                showTsunamiAudioNotice.value = entries.some(entry => entry.isFile && legacyTsunamiAudioName.test(entry.name))
            }
        } catch(error) {
            console.error('检查旧版海啸自定义音频失败', error)
            audioCheckSucceeded = false
        }
    }
    if(disposed || statusStore.isResettingApp) return
    visible.value = versionOrder === null || versionOrder > 0
    // 文件检查失败时保留旧版本，下次启动重试，因此上面的设置迁移必须可以重复执行。
    // 检查期间若组件卸载或应用重置，则不再弹窗或写回版本记录。
    if(audioCheckSucceeded) statusStore.setLocalStorageItem('lastVersion', APP_VERSION)
})
onBeforeUnmount(() => { disposed = true })
</script>

<style scoped>
.version-notification {
    max-height: 60vh;
    overflow-y: auto;
    font-size: 16px;
    line-height: 1.7;
}
.version-notification ul {
    padding-left: 1.5em;
    list-style-type: disc;
}
.version-notification p + ul,
.version-notification li + li {
    margin-top: 12px;
}
.settings-icon {
    vertical-align: -0.15em;
}
</style>
