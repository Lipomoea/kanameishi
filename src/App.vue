<template>
  <div class="container" ref="container">
    <RouterView v-slot="{ Component }">
      <keep-alive include="HomeView">
        <component :is="Component"></component>
      </keep-alive>
    </RouterView>
  </div>
</template>

<script setup>
import { RouterLink, RouterView } from 'vue-router'
import { computed, onBeforeMount, onMounted, onBeforeUnmount, watch } from 'vue'
import { useTimeStore } from './stores/time';
import { useStatusStore } from '@/stores/status';
import { useSettingsStore } from './stores/settings';
import { useAccessStore } from './stores/access';
import { eqUrls, topojsonUrls } from './utils/Urls';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { platform } from '@tauri-apps/plugin-os';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import Http from './classes/Http';
import { APP_TITLE } from '@/utils/AppInfo';

const timeStore = useTimeStore()
const statusStore = useStatusStore()
const settingsStore = useSettingsStore()
const accessStore = useAccessStore()
const inTauri = isTauri()

const container = ref()
const TRAY_GAME_MODE_EVENT = 'tray-game-mode-changed'
let unlistenTrayGameMode

async function syncTrayGameModeMenu(enabled) {
  if(!inTauri) return
  try {
    await invoke('set_tray_game_mode', { enabled })
  } catch (err) {
    console.error('failed to sync tray game mode state', err)
  }
}

async function getGeojson(retries = 0){
  if(!inTauri && ('caches' in window)){
    try {
      const promises = Object.keys(topojsonUrls).map(async name => {
        const data = await Http.get(topojsonUrls[name], { timeout: 0 })
        const cache = await caches.open('topojson')
        await cache.put(topojsonUrls[name], new Response(JSON.stringify(data)))
      })
      await Promise.all(promises)
    } catch (err) {
      console.log(err);
      if(retries < 3) {
        setTimeout(() => {
          getGeojson(retries + 1)
        }, 2000);
      }
    }
  }
}
const autoScale = ref(1)
let resizeTimer
const calcAutoScale = () => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    autoScale.value = Math.min(window.innerWidth / 1800, window.innerHeight / 1000)
  }, 20);
}
const scale = computed(() => settingsStore.mainSettings.uiScale > 0 ? settingsStore.mainSettings.uiScale : autoScale.value)

const history2Eqlist = {
  'CENC': 'cencEqlist',
  'CWA': 'cwaEqlist',
  'JMA': 'jmaEqlist',
  'KMA': 'kmaEqlist',
  'USGS': 'usgsEqlist',
}

onBeforeMount(async () => {
  document.title = APP_TITLE
  settingsStore.setMainSettings(localStorage.getItem('mainSettings'))
  accessStore.setAccessSettings(localStorage.getItem('accessSettings'))
  settingsStore.setAdvancedSettings(localStorage.getItem('advancedSettings'))
  settingsStore.resetUnauthorizedFeatureSettings()
  if(accessStore.canUse('gqEew')) Object.assign(eqUrls, JSON.parse(localStorage.getItem('gqUrl')))
  if(accessStore.canUse('nmefcTsunamiMap')) Object.assign(topojsonUrls, JSON.parse(localStorage.getItem('nmefcTsunami')))
  timeStore.startUpdatingTime()
  statusStore.configureDataSources(settingsStore.effectiveDataSources)
  settingsStore.mainSettings.historySources = settingsStore.mainSettings.historySources.filter(source => statusStore.enabledSource.includes(history2Eqlist[source]))
  statusStore.startUpdatingEqMessage()
  autoScale.value = Math.min(window.innerWidth / 1800, window.innerHeight / 1100)
  getGeojson()
  if('Notification' in window){
    if (Notification.permission !== 'granted') {
      Notification.requestPermission()
    }
  }
  if(inTauri) {
    unlistenTrayGameMode = await listen(TRAY_GAME_MODE_EVENT, event => {
      settingsStore.mainSettings.gameMode = Boolean(event.payload)
    })
    await syncTrayGameModeMenu(settingsStore.mainSettings.gameMode)
    const thisPlatform = platform()
    if(thisPlatform == 'windows' && settingsStore.mainSettings.minimizeOnLaunch) {
      await getCurrentWindow().hide()
    }
  }
})
onMounted(() => {
  window.addEventListener('resize', calcAutoScale)
  watch(scale, scale => {
    container.value.style.transform = `scale(${scale})`
    container.value.style.width = `${100 / scale}vw`
    container.value.style.height = `${100 / scale}vh`
    statusStore.map?.invalidateSize()
  }, { immediate: true })
})
onBeforeUnmount(() => {
  clearTimeout(resizeTimer)
  window.removeEventListener('resize', calcAutoScale)
  timeStore.stopUpdatingTime()
  statusStore.disconnect()
  unlistenTrayGameMode?.()
})
watch(() => settingsStore.mainSettings, (newValue) => {
  statusStore.setLocalStorageItem('mainSettings', JSON.stringify(newValue))
}, { deep: true })
watch(() => settingsStore.advancedSettings, (newValue) => {
  statusStore.setLocalStorageItem('advancedSettings', JSON.stringify(newValue))
}, { deep: true })
watch(() => accessStore.capabilities, (newValue) => {
  statusStore.setLocalStorageItem('accessSettings', JSON.stringify(newValue))
}, { deep: true })
watch(() => settingsStore.mainSettings.gameMode, (enabled) => {
  void syncTrayGameModeMenu(enabled)
})

</script>

<style lang="scss" scoped>
.container {
  width: 100vw;
  height: 100vh;
  position: absolute;
  transform-origin: top left;
}
</style>
