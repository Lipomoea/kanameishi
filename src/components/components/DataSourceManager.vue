<template>
    <el-dialog
        v-model="visible"
        class="data-source-manager"
        title="数据源管理"
        width="min(900px, 94vw)"
        top="6vh"
        :show-close="false"
        append-to-body
    >
        <el-alert
            v-if="!hasLipoApiKey"
            class="api-key-warning"
            type="warning"
            :closable="false"
            show-icon
        >
            <template #title>
                <span>尚未配置Lipo API Key，部分功能受限。</span>
                <el-button type="primary" link @click="emit('manage-api-key')">前往管理API Key</el-button>
            </template>
        </el-alert>
        <el-alert
            v-else-if="statusStore.lipoAuthStatus == 0"
            class="api-key-warning"
            type="error"
            :closable="false"
            show-icon
        >
            <template #title>
                <span>Lipo API：{{ statusStore.lipoError || '认证失败，请检查API Key' }}</span>
                <el-button type="primary" link @click="emit('manage-api-key')">前往管理API Key</el-button>
            </template>
        </el-alert>
        <el-tabs v-model="activeCategory" stretch>
            <el-tab-pane
                v-for="category in dataSourceCategories"
                :key="category.key"
                :label="category.label"
                :name="category.key"
            >
                <div class="source-table-wrap">
                    <table class="source-table">
                        <thead>
                            <tr>
                                <th class="source-name">数据源</th>
                                <th>全部</th>
                                <th
                                    v-for="provider in providersFor(category.key)"
                                    :key="provider"
                                >
                                    {{ dataSourceProviders[provider] }}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="source in sourcesFor(category.key)" :key="source">
                                <td class="source-name">{{ dataSourceCatalog[source].label }}</td>
                                <td>
                                    <el-checkbox
                                        :model-value="settingsStore.isDataSourceFullyEnabled(source)"
                                        :indeterminate="settingsStore.isDataSourcePartiallyEnabled(source)"
                                        :aria-label="`${dataSourceCatalog[source].label}全部API`"
                                        @change="toggleSource(source, $event)"
                                    />
                                </td>
                                <td
                                    v-for="provider in providersFor(category.key)"
                                    :key="provider"
                                >
                                    <div
                                        v-if="dataSourceCatalog[source].apis.includes(provider)"
                                        class="api-control"
                                    >
                                        <el-checkbox
                                            :model-value="settingsStore.mainSettings.dataSources[source]?.[provider]"
                                            :aria-label="`${dataSourceCatalog[source].label} ${dataSourceProviders[provider]}`"
                                            @change="toggleApi(source, provider, $event)"
                                        />
                                    </div>
                                    <span v-else class="unsupported">-</span>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </el-tab-pane>
        </el-tabs>
        <template #footer>
            <el-button type="primary" @click="visible = false">完成</el-button>
        </template>
    </el-dialog>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { useAccessStore } from '@/stores/access';
import { useStatusStore } from '@/stores/status';
import {
    dataSourceCatalog,
    dataSourceCategories,
    dataSourceProviders,
} from '@/utils/DataSources';

const visible = defineModel({ type: Boolean, default: false })
const emit = defineEmits(['change', 'manage-api-key'])
const settingsStore = useSettingsStore()
const accessStore = useAccessStore()
const statusStore = useStatusStore()
const activeCategory = ref(dataSourceCategories[0].key)
const hasLipoApiKey = computed(() => Boolean(settingsStore.mainSettings.apiKeys.lipoApiKey?.trim()))

const visibleSources = computed(() => Object.keys(dataSourceCatalog).filter(source => {
    const requiredCapability = dataSourceCatalog[source].requiredCapability
    return !requiredCapability || accessStore.canUse(requiredCapability)
}))

const sourcesFor = category => visibleSources.value
    .filter(source => dataSourceCatalog[source].category == category)
    .sort((sourceA, sourceB) => dataSourceCatalog[sourceA].displayOrder - dataSourceCatalog[sourceB].displayOrder)
const providersFor = category => [...new Set(
    sourcesFor(category).flatMap(source => dataSourceCatalog[source].apis)
)]

const toggleSource = (source, enabled) => {
    if(enabled && !settingsStore.isDataSourceAvailable(source)) return
    settingsStore.setDataSourceEnabled(source, enabled)
    emit('change')
}

const toggleApi = (source, api, enabled) => {
    if(enabled && !settingsStore.isDataSourceAvailable(source)) return
    settingsStore.mainSettings.dataSources[source][api] = enabled
    emit('change')
}
</script>

<style lang="scss">
.data-source-manager {
    max-height: 88vh;
    display: flex;
    flex-direction: column;

    .el-dialog__body {
        min-height: 0;
        padding-top: 4px;
        overflow: hidden;
    }

    .api-key-warning {
        margin-bottom: 8px;

        .el-alert__title {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 4px;
        }

        .el-button {
            height: auto;
            padding: 0;
        }
    }

    .el-tabs,
    .el-tabs__content,
    .el-tab-pane {
        min-height: 0;
    }

    .source-table-wrap {
        max-height: calc(88vh - 180px);
        overflow: auto;
        border: 1px solid var(--el-border-color);
        border-radius: 6px;
    }

    .source-table {
        width: 100%;
        min-width: 640px;
        border-collapse: collapse;
        table-layout: fixed;

        th,
        td {
            height: 44px;
            padding: 6px 10px;
            border-right: 1px solid var(--el-border-color-lighter);
            border-bottom: 1px solid var(--el-border-color-lighter);
            text-align: center;
            vertical-align: middle;
        }

        th {
            position: sticky;
            top: 0;
            z-index: 1;
            background: var(--el-bg-color);
            font-weight: 600;
        }

        th:last-child,
        td:last-child {
            border-right: 0;
        }

        tbody tr:last-child td {
            border-bottom: 0;
        }

        .source-name {
            width: 250px;
            text-align: left;
        }

        .api-control {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }


        .el-checkbox {
            margin: 0;
            height: 24px;
        }

        .unsupported {
            color: var(--el-text-color-placeholder);
        }
    }
}

@media (max-width: 600px) {
    .data-source-manager {
        margin-top: 3vh;
        max-height: 94vh;

        .el-dialog__header,
        .el-dialog__body,
        .el-dialog__footer {
            padding-left: 12px;
            padding-right: 12px;
        }

        .source-table-wrap {
            max-height: calc(94vh - 170px);
        }
    }
}
</style>
