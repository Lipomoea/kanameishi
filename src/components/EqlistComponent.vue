<template>
  <div class="outer1">
    <div class="container">
      <div class="bar" @click="smoothScrollToTop">
        <div class="title">地震/海啸信息</div>
        <div class="switch">
          <el-select
            style="width: 90px;"
            v-model="settingsStore.mainSettings.historySources"
            size="small"
            multiple
            placeholder=""
            @click.stop
          >
            <template #tag>
              <span class="el-select__placeholder custom-tag">
                {{ settingsStore.mainSettings.historySources.length }}个数据源
              </span>
            </template>
            <el-option label="CENC" value="CENC" :disabled="!statusStore.enabledSource.includes('cencEqlist')" />
            <el-option label="CWA" value="CWA" :disabled="!statusStore.enabledSource.includes('cwaEqlist')" />
            <el-option label="JMA" value="JMA" :disabled="!statusStore.enabledSource.includes('jmaEqlist')" />
            <el-option label="KMA" value="KMA" :disabled="!statusStore.enabledSource.includes('kmaEqlist')" />
            <el-option label="USGS" value="USGS" :disabled="!statusStore.enabledSource.includes('usgsEqlist')" />
          </el-select>
          <el-button style="width: 90px;" size="small" @click.stop="showMagnitudeFilter = true">按震级筛选</el-button>
        </div>
      </div>
      <div class="content" ref="content">
        <div class="wrap">
          <NmefcTsunami v-if="settingsStore.isDataSourceEnabled('nmefcTsunami')" v-show="statusStore.isActive.nmefcTsunami" />
          <JmaTsunami v-if="settingsStore.isDataSourceEnabled('jmaTsunami')" v-show="statusStore.isActive.jmaTsunami" />
          <EqlistHistoryComponent />
        </div>
      </div>
    </div>
    <HistoryMagnitudeFilter v-model="showMagnitudeFilter" />
  </div>
</template>

<script setup>
import NmefcTsunami from './components/NmefcTsunami.vue';
import JmaTsunami from './components/JmaTsunami.vue';
import { useSettingsStore } from '@/stores/settings';
import { useStatusStore } from '@/stores/status';
import EqlistHistoryComponent from './components/EqlistHistory.vue';
import HistoryMagnitudeFilter from './components/HistoryMagnitudeFilter.vue';
import { ref, watch, inject } from 'vue';

const settingsStore = useSettingsStore()
const statusStore = useStatusStore()

const content = ref(null)
const showMagnitudeFilter = ref(false)
const menuId = inject('menuId')
const scrollToTop = () => content.value.scrollTop = 0
const smoothScrollToTop = () => {
  content.value.scrollTo({
    top: 0,
    behavior: 'smooth'
  })
}
watch(() => menuId.value == 'eqlists', scrollToTop)

</script>

<style lang="scss" scoped>
.outer1 {
  width: 100%;
  height: 100%;
  .container {
    width: 100%;
    height: 100%;
    padding: 5px;
    padding-right: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
    user-select: none;
    .bar {
      width: 100%;
      height: 28px;
      display: flex;
      align-items: center;
      .title {
        font-size: 24px;
        font-weight: 700;
      }
      .switch {
        width: 200px;
        margin-left: 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        :deep(.custom-tag) {
          display: flex;
          justify-content: center;
          align-items: center;
        }
        :deep(.el-select__input) {
          cursor: pointer;
        }
      }
    }
    .content {
      width: 100%;
      height: 100%;
      overflow: auto;
      .wrap {
        padding-right: calc(100% - 390px);
      }
    }
  }
}
</style>
