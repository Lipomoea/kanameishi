<template>
    <div class="outer">
        <div class="container">
            <div class="mapContainer">
                <div id="mainMap" @wheel.passive="handleManual" @dblclick="handleManual"></div>
                <div class="eewList">
                    <div class="event" v-for="(event, index) of currentEewInfoItems" :key="index" v-show="menuId != 'eqlists'">
                        <div class="eew">
                            <div class="bar" :class="getBarClass(event)">
                                <div><WarnTriangleFilled style="width: 1em; height: 1em; margin-right: 0.25em;" />{{ event.eqMessage.titleText + ' ' + event.eqMessage.reportNumText }}</div>
                                <div v-show="activeEewList.length > 1">{{ activeEewList.findIndex(e => e == event) + 1 }}/{{ activeEewList.length }}</div>
                            </div>
                            <div class="info" @click="() => {
                                event.handleClick();
                                infoPageCounter = infoPageCounter - infoPageCounter % 10;
                            }">
                                <div class="background" :class="event.eqMessage.className"></div>
                                <div v-if="event.eqMessage.useShindo" class="intensity" :class="event.eqMessage.className">
                                    <div class="intensity-title">{{ event.eqMessage.intTitle || '推定最大震度' }}</div>
                                    <div :class="formatShindo(event.eqMessage.maxIntensity) != '?'?'shindo':'csis'">
                                        {{ formatShindo(event.eqMessage.maxIntensity) }}
                                    </div>
                                </div>
                                <div v-else class="intensity" :class="event.eqMessage.className">
                                    <div class="intensity-title">{{ event.eqMessage.intTitle || '预估最大烈度' }}</div>
                                    <div class="csis" :class="{
                                        'roman': settingsStore.mainSettings.useRomanCsis,
                                        'scale-75': event.eqMessage.maxIntensity == '8',
                                        'scale-9': event.eqMessage.maxIntensity == '7' || event.eqMessage.maxIntensity == '12'
                                    }">
                                        {{ formatCsis(event.eqMessage.maxIntensity) }}
                                    </div>
                                </div>
                                <div class="right">
                                    <div class="location">{{ event.eqMessage.hypocenter }}</div>
                                    <div class="time">{{ event.eqMessage.originTime + ` (${formatTimeZone(event.eqMessage.timeZone)})` }}</div>
                                    <div class="bottom">
                                        <div class="magnitude">{{ event.eqMessage.isAssumption?'仮定震源要素':'M' + event.eqMessage.magnitude.toFixed(1) }}</div>
                                        <div class="depth">{{ event.eqMessage.isAssumption?'':event.eqMessage.depthText }}</div>
                                        <div class="type" v-if="settingsStore.advancedSettings.displayApiType">{{ sourceTypes[event.eqMessage.source][event.eqMessage.type] }}</div>
                                    </div>
                                </div>
                                <div class="eew-buttons" v-if="event.showMenu">
                                    <el-button class="eew-button" type="primary" plain @click="event.mute = !event.mute">{{ event.mute ? '取消静默' : '静默' }}</el-button>
                                    <el-button class="eew-button" type="danger" plain @click.stop="event.terminate(true)">关闭预警</el-button>
                                </div>
                            </div>
                        </div>
                        <div class="countdown eew realtime" v-if="settingsStore.mainSettings.displayCountdown">
                            <div class="shindo-bar" @dblclick="event.showPCountdown = !event.showPCountdown"
                            :class="event.showPCountdown ? 'blue' 
                            : event.countdown < 0 || event.eqMessage.isCanceled ? 'gray' 
                            : event.countdown <= 15 ? 'red' 
                            : event.countdown <= 60 ? 'orange' 
                            : 'yellow'">
                                {{ event.countdown == -1 ? '-' : Math.ceil(event.showPCountdown ? event.pCountdown : event.countdown) }}秒
                            </div>
                            <div class="info" v-if="event.nearestJmaLoc">
                                <div class="intensity" :class="setClassName(event.userShindo, true, event.eqMessage.isCanceled)">
                                    <div class="intensity-title">推定本地震度</div>
                                    <div :class="event.userShindo != '?'?'shindo':'csis'">
                                        {{ event.userShindo }}
                                    </div>
                                </div>
                            </div>
                            <div class="info" v-else>
                                <div class="intensity" :class="setClassName(event.userCsis, false, event.eqMessage.isCanceled)">
                                    <div class="intensity-title">预估本地烈度</div>
                                    <div class="csis" :class="{
                                        'roman': settingsStore.mainSettings.useRomanCsis,
                                        'scale-75': event.userCsis == '8',
                                        'scale-9': event.userCsis == '7' || event.userCsis == '12'
                                    }">
                                        {{ formatCsis(event.userCsis) }}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="event" v-for="(event, index) of currentEqlistInfoItems" :key="index" v-show="menuId != 'eews'" :class="{ 'midOpacity': tempEqlists && tempEqlists != event.eqMessage.source }">
                        <div class="eew">
                            <div class="bar" :class="getBarClass(event)">
                                <div><InfoFilled style="width: 1em; height: 1em; margin-right: 0.25em;" />{{ event.eqMessage.titleText }}</div>
                                <div v-show="displayEqlistList.length > 1">{{ displayEqlistList.findIndex(e => e == event) + 1 }}/{{ displayEqlistList.length }}</div>
                            </div>
                            <div class="info" @click="() => {
                                event.handleClick();
                                infoPageCounter = infoPageCounter - infoPageCounter % 10;
                            }">
                                <div class="background" :class="event.eqMessage.className"></div>
                                <div v-if="event.eqMessage.useShindo" class="intensity" :class="event.eqMessage.className">
                                    <div class="intensity-title">{{ event.eqMessage.intTitle || '最大震度' }}</div>
                                    <div :class="formatShindo(event.eqMessage.maxIntensity) != '?'?'shindo':'csis'">
                                        {{ formatShindo(event.eqMessage.maxIntensity) }}
                                    </div>
                                </div>
                                <div v-else class="intensity" :class="event.eqMessage.className">
                                    <div class="intensity-title">{{ event.eqMessage.intTitle || '预估最大烈度' }}</div>
                                    <div class="csis" :class="{
                                        'roman': settingsStore.mainSettings.useRomanCsis,
                                        'scale-75': event.eqMessage.maxIntensity == '8',
                                        'scale-9': event.eqMessage.maxIntensity == '7' || event.eqMessage.maxIntensity == '12'
                                    }">
                                        {{ formatCsis(event.eqMessage.maxIntensity) }}
                                    </div>
                                </div>
                                <div class="right">
                                    <div class="location">{{ event.eqMessage.hypocenter || '震源 調査中' }}</div>
                                    <div class="time">{{ event.eqMessage.originTime + ` (${formatTimeZone(event.eqMessage.timeZone)})` }}</div>
                                    <div class="bottom">
                                        <div class="magnitude">{{ event.eqMessage.magnitude != -1 ? 'M' + event.eqMessage.magnitude.toFixed(1) : '規模 調査中' }}</div>
                                        <div class="depth">{{ event.eqMessage.depth != -1 ? event.eqMessage.depthText : '' }}</div>
                                        <div class="type" v-if="settingsStore.advancedSettings.displayApiType">{{ sourceTypes[event.eqMessage.source][event.eqMessage.type] }}</div>
                                    </div>
                                </div>
                                <div class="eew-buttons" v-if="event.showMenu">
                                    <el-button 
                                    class="eew-button" 
                                    type="danger" 
                                    plain 
                                    :disabled="!event.isActive"
                                    @click.stop="() => {
                                        if(tempEqlists == event.eqMessage.source) {
                                            tempEqlists = ''
                                        }
                                        event.deactivate()
                                    }"
                                    >关闭信息</el-button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="event" v-if="settingsStore.isDataSourceEnabled('nmefcTsunami') && statusStore.isActive.nmefcTsunami">
                        <div class="eew" v-show="menuId != 'eews'" :class="{ 'midOpacity': tempEqlists && tempEqlists != 'nmefcTsunami' }">
                            <div class="bar" :class="statusStore.tsunamiMessage.nmefcTsunami.className">
                                <div><WarnTriangleFilled style="width: 1em; height: 1em; margin-right: 0.25em;" />{{ statusStore.tsunamiMessage.nmefcTsunami.titleText }}</div>
                            </div>
                            <div class="tsunami-info" v-if="cnTsunamiBaseMap">
                                <div class="background" :class="statusStore.tsunamiMessage.nmefcTsunami.className"></div>
                                <div v-show="statusStore.tsunamiMessage.nmefcTsunami.status >= 3" class="legend tsunami-purple"></div>
                                <div v-show="statusStore.tsunamiMessage.nmefcTsunami.status >= 3" class="text">大海啸警报</div>
                                <div v-show="statusStore.tsunamiMessage.nmefcTsunami.status >= 2" class="legend tsunami-red"></div>
                                <div v-show="statusStore.tsunamiMessage.nmefcTsunami.status >= 2" class="text">海啸警报</div>
                                <div v-show="statusStore.tsunamiMessage.nmefcTsunami.status >= 1" class="legend tsunami-yellow"></div>
                                <div v-show="statusStore.tsunamiMessage.nmefcTsunami.status >= 1" class="text">海啸注意报</div>
                            </div>
                            <div class="tsunami-info" v-else>
                                <div class="background" :class="statusStore.tsunamiMessage.nmefcTsunami.className"></div>
                                <div class="text" style="justify-self: end; text-align: right;">无地图显示</div>
                                <div class="text">请查看侧栏信息</div>
                            </div>
                        </div>
                    </div>
                    <div class="event" v-if="settingsStore.isDataSourceEnabled('jmaTsunami') && statusStore.isActive.jmaTsunami">
                        <div class="eew" v-show="menuId != 'eews'" :class="{ 'midOpacity': tempEqlists && tempEqlists != 'jmaTsunami' }">
                            <div class="bar" :class="statusStore.tsunamiMessage.jmaTsunami.className">
                                <div><WarnTriangleFilled style="width: 1em; height: 1em; margin-right: 0.25em;" />{{ statusStore.tsunamiMessage.jmaTsunami.titleText }}</div>
                            </div>
                            <div class="tsunami-info">
                                <div class="background" :class="statusStore.tsunamiMessage.jmaTsunami.className"></div>
                                <div v-show="statusStore.tsunamiMessage.jmaTsunami.status >= 3" class="legend tsunami-purple"></div>
                                <div v-show="statusStore.tsunamiMessage.jmaTsunami.status >= 3" class="text">大津波警報</div>
                                <div v-show="statusStore.tsunamiMessage.jmaTsunami.status >= 2" class="legend tsunami-red"></div>
                                <div v-show="statusStore.tsunamiMessage.jmaTsunami.status >= 2" class="text">津波警報</div>
                                <div v-show="statusStore.tsunamiMessage.jmaTsunami.status >= 1" class="legend tsunami-yellow"></div>
                                <div v-show="statusStore.tsunamiMessage.jmaTsunami.status >= 1" class="text">津波注意報</div>
                            </div>
                        </div>
                    </div>
                    <div class="event">
                        <div class="eew realtime" v-if="settingsStore.mainSettings.displaySeisNet.displayMaxInt && settingsStore.mainSettings.displaySeisNet.palertNet && settingsStore.mainSettings.displaySeisNet.displayPalertShindo && statusStore.isTauri">
                            <div class="shindo-bar gray">P-Alert实时</div>
                            <div class="info">
                                <div class="intensity" :class="setClassName(palertMaxShindo, true)">
                                    <div class="intensity-title">最大震度</div>
                                    <div :class="palertMaxShindo != '?'?'shindo':'csis'">
                                        {{ palertMaxShindo }}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="eew realtime" v-if="settingsStore.mainSettings.displaySeisNet.displayPeriodMaxInt && settingsStore.mainSettings.displaySeisNet.palertNet && settingsStore.mainSettings.displaySeisNet.displayPalertShindo && palertPeriodMaxShindo != '?' && statusStore.isTauri">
                            <div class="shindo-bar" :class="palertPeriodBarClass">P-Alert区间</div>
                            <div class="info">
                                <div class="intensity" :class="setClassName(palertPeriodMaxShindo, true)">
                                    <div class="intensity-title">最大震度</div>
                                    <div :class="palertPeriodMaxShindo != '?'?'shindo':'csis'">
                                        {{ palertPeriodMaxShindo }}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="eew realtime" v-if="settingsStore.mainSettings.displaySeisNet.displayMaxInt && settingsStore.mainSettings.displaySeisNet.tremNet && settingsStore.mainSettings.displaySeisNet.displayTremShindo">
                            <div class="shindo-bar gray">TREM实时</div>
                            <div class="info">
                                <div class="intensity" :class="setClassName(tremMaxShindo, true)">
                                    <div class="intensity-title">最大震度</div>
                                    <div :class="tremMaxShindo != '?'?'shindo':'csis'">
                                        {{ tremMaxShindo }}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="eew realtime" v-if="settingsStore.mainSettings.displaySeisNet.displayPeriodMaxInt && settingsStore.mainSettings.displaySeisNet.tremNet && settingsStore.mainSettings.displaySeisNet.displayTremShindo && tremPeriodMaxShindo != '?'">
                            <div class="shindo-bar" :class="tremPeriodBarClass">TREM区间</div>
                            <div class="info">
                                <div class="intensity" :class="setClassName(tremPeriodMaxShindo, true)">
                                    <div class="intensity-title">最大震度</div>
                                    <div :class="tremPeriodMaxShindo != '?'?'shindo':'csis'">
                                        {{ tremPeriodMaxShindo }}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="eew realtime" v-if="settingsStore.mainSettings.displaySeisNet.displayMaxInt && settingsStore.mainSettings.displaySeisNet.niedNet && settingsStore.mainSettings.displaySeisNet.displayNiedShindo">
                            <div class="shindo-bar gray">NIED实时</div>
                            <div class="info">
                                <div class="intensity" :class="setClassName(niedMaxShindo, true)">
                                    <div class="intensity-title">最大震度</div>
                                    <div :class="niedMaxShindo != '?'?'shindo':'csis'">
                                        {{ niedMaxShindo }}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="eew realtime" v-if="settingsStore.mainSettings.displaySeisNet.displayPeriodMaxInt && settingsStore.mainSettings.displaySeisNet.niedNet && settingsStore.mainSettings.displaySeisNet.displayNiedShindo && niedPeriodMaxShindo != '?'">
                            <div class="shindo-bar" :class="niedPeriodBarClass">NIED区间</div>
                            <div class="info">
                                <div class="intensity" :class="setClassName(niedPeriodMaxShindo, true)">
                                    <div class="intensity-title">最大震度</div>
                                    <div :class="niedPeriodMaxShindo != '?'?'shindo':'csis'">
                                        {{ niedPeriodMaxShindo }}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="eew realtime" v-if="settingsStore.mainSettings.displaySeisNet.displayMaxInt && settingsStore.mainSettings.displaySeisNet.kmaNet && settingsStore.mainSettings.displaySeisNet.displayKmaInt">
                            <div class="shindo-bar gray">KMA实时</div>
                            <div class="info">
                                <div class="intensity" :class="setClassName(kmaMaxInt, false)">
                                    <div class="intensity-title">最大烈度</div>
                                    <div class="csis" :class="{
                                        'roman': settingsStore.mainSettings.useRomanCsis,
                                        'scale-75': kmaMaxInt == '8',
                                        'scale-9': kmaMaxInt == '7' || kmaMaxInt == '12'
                                    }">
                                        {{ formatCsis(kmaMaxInt) }}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="eew realtime" v-if="settingsStore.mainSettings.displaySeisNet.displayPeriodMaxInt && settingsStore.mainSettings.displaySeisNet.kmaNet && settingsStore.mainSettings.displaySeisNet.displayKmaInt && kmaPeriodMaxInt != '?'">
                            <div class="shindo-bar" :class="kmaPeriodBarClass">KMA区间</div>
                            <div class="info">
                                <div class="intensity" :class="setClassName(kmaPeriodMaxInt, false)">
                                    <div class="intensity-title">最大烈度</div>
                                    <div class="csis" :class="{
                                        'roman': settingsStore.mainSettings.useRomanCsis,
                                        'scale-75': kmaPeriodMaxInt == '8',
                                        'scale-9': kmaPeriodMaxInt == '7' || kmaPeriodMaxInt == '12'
                                    }">
                                        {{ formatCsis(kmaPeriodMaxInt) }}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="left-bottom">
                    <div class="legend" v-if="settingsStore.mainSettings.displayLegend && !settingsStore.mainSettings.disableEewBaseMap && (activeEewList.length > 0 || menuId == 'eqlists')">
                        <div class="single-legend" v-for="(className, index) of classNameArray" :key="index">
                            <div class="align-right">{{ settingsStore.mainSettings.useRomanCsis ? csisRomanArray[index] : csisArray[index] }}</div>
                            <div class="color" :class="className"></div>
                            <div class="align-left">{{ shindoArray[index] }}</div>
                        </div>
                        <div class="sub-title single-legend">
                            <div class="align-right">烈度</div>
                            <div class="color"></div>
                            <div class="align-left">震度</div>
                        </div>
                        <div class="legend-title">地图颜色</div>
                    </div>
                    <div class="ws-status">
                        <div>WebSocket状态: </div>
                        <div :class="'s' + webSocketStatus.wolfx.readyState">Wolfx{{ webSocketStatus.wolfx.urlIndex ? '(B)' : '' }}</div>
                        <div :class="fanStatusClass">FAN{{ webSocketStatus.fan.urlIndex ? '(B)' : '' }}</div>
                        <div :class="'s' + webSocketStatus.p2pquake.readyState">P2PQ{{ webSocketStatus.p2pquake.urlIndex ? '(B)' : '' }}</div>
                        <div v-if="accessStore.canUse('gqEew')" :class="'s' + webSocketStatus.gq.readyState">GQ{{ webSocketStatus.gq.urlIndex ? '(B)' : '' }}</div>
                    </div>
                    <div class="update-time" v-if="settingsStore.mainSettings.displayClock" @dblclick="resetSeisNetDelay">
                        当前时间: {{ currentTimeText }} (UTC{{ formatTimeZone(systemTimeZone) }})
                    </div>
                    <div class="update-time" :class="statusStore.seisNetReplayDelay > 0 ? 'replay' : isPalertDelayed ? 'delayed' : ''" v-if="settingsStore.mainSettings.displaySeisNet.palertNet && statusStore.isTauri" @dblclick="resetSeisNetDelay">
                        P-Alert: {{ palertUpdateTime }} (UTC+8)
                    </div>
                    <div class="update-time" :class="statusStore.seisNetReplayDelay > 0 ? 'replay' : isTremDelayed ? 'delayed' : ''" v-if="settingsStore.mainSettings.displaySeisNet.tremNet" @dblclick="resetSeisNetDelay">
                        TREM-Net : {{ tremUpdateTime }} (UTC+8)
                    </div>
                    <div class="update-time" :class="statusStore.seisNetReplayDelay > 0 ? 'replay' : isNiedDelayed ? 'delayed' : ''" v-if="settingsStore.mainSettings.displaySeisNet.niedNet" @dblclick="resetSeisNetDelay">
                        強震モニタ: {{ niedUpdateTime }} (UTC+9)
                    </div>
                    <div class="update-time" :class="isKmaDelayed ? 'delayed' : ''" v-if="settingsStore.mainSettings.displaySeisNet.kmaNet" @dblclick="resetSeisNetDelay">
                        KMA-PEWS: {{ kmaUpdateTime }} (UTC+9)
                    </div>
                </div>
                <div class="int-list" v-if="settingsStore.mainSettings.displayAreaIntensities">
                    <div class="csis-list" v-show="csisList.length">
                        <div class="row" v-for="(item, index) of csisList" :key="index">
                            <div class="name">{{ item.name }}</div>
                            <div class="int" :class="setClassName(item.intensity, false)">
                                <div class="csis" :class="{
                                    'roman': settingsStore.mainSettings.useRomanCsis,
                                    'scale-9': item.intensity == '8'
                                }">{{ formatCsis(item.intensity) }}</div>
                            </div>
                        </div>
                    </div>
                    <div class="shindo-list" v-show="shindoList.length">
                        <div class="row" v-for="(item, index) of shindoList" :key="index">
                            <div class="name">{{ item.name }}</div>
                            <div class="int" :class="setClassName(item.intensity, true)">
                                <div class="shindo">{{ item.intensity }}</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="bottom-right">
                    <div class="mocking" v-if="statusStore.isActive.mockEew" :class="blinkStatus ? 'mock-1' : 'mock-0'">模拟预警中</div>
                    <el-button
                    class="home"
                    :icon="HomeFilled"
                    v-show="!isAutoZoom"
                    @click="handleHome"></el-button>
                </div>
                <el-menu
                class="menu"
                :default-active="menuId"
                :collapse="true"
                @select="handleMenu">
                    <el-menu-item index="main">
                        <el-icon>
                            <FullScreen />
                        </el-icon>
                    </el-menu-item>
                    <el-menu-item index="eews">
                        <el-icon>
                            <WarnTriangleFilled />
                        </el-icon>
                    </el-menu-item>
                    <el-menu-item index="eqlists">
                        <el-icon>
                            <InfoFilled />
                        </el-icon>
                    </el-menu-item>
                    <el-menu-item index="settings">
                        <el-icon>
                            <Setting />
                        </el-icon>
                    </el-menu-item>
                </el-menu>
            </div>
            <div class="drawer" ref="drawer" v-show="menuId == 'eqlists' && !settingsStore.mainSettings.hideDrawer || menuId == 'settings'">
                <EqlistComponent v-show="menuId == 'eqlists'" />
                <SettingsComponent v-show="menuId == 'settings'" />
            </div>
            <transition name="dialog-fade">
                <div class="statusContainer" v-show="statusStore.showStatusPanel">
                    <StatusComponent />
                </div>
            </transition>
        </div>
    </div>
</template>

<script setup>
import L from 'leaflet';
import 'leaflet.vectorgrid';
import 'leaflet/dist/leaflet.css';
import '@/assets/background.css';
import { ref, reactive, computed, onMounted, onBeforeUnmount, onUnmounted, watch, watchEffect, provide } from 'vue';
import { HomeFilled, FullScreen, WarnTriangleFilled, InfoFilled, Setting } from '@element-plus/icons-vue';
import { eewSources, eqlistSources, seisNetSources, sourceTypes, tsunamiSources, useStatusStore } from '@/stores/status';
import { useSettingsStore } from '@/stores/settings';
import { useAccessStore } from '@/stores/access';
import { useTimeStore } from '@/stores/time';
import { getGridNetworkRelation, shouldDisplayNetworkGrid, shouldIncludeEewSWaveBounds } from '@/features/eew/EewNetworkRelations';
import { extendLayerBounds, collectFilledAreaBounds, collectStrokedAreaBounds } from '@/features/map/MapViewBounds';
import EqlistComponent from './EqlistComponent.vue';
import SettingsComponent from './SettingsComponent.vue';
import { verifyUpToDate, setClassName, getShindoRank, classNameArray, pointDistToCnArea, pointDistToKrArea, csisArray, shindoArray, calcCsisLevel, calcJmaShindoLevel, formatTimeZone, simplifyTopoJson, formatCsis, csisRomanArray, formatShindo, stampToTime, systemTimeZone } from '@/utils/Utils';
import { topojsonUrls } from '@/utils/Urls';
import { jmaSeisIntLoc } from '@/utils/JmaSeisIntLoc';
import { isTauri } from '@tauri-apps/api/core';
import { storeToRefs } from 'pinia';
import { simpleIcon } from '@/classes/StationClasses';
import { feature } from 'topojson-client';
import { cnCityLabels, cnProvinceLabels, jpPrefLabels } from '@/utils/Labels';
import terminator from '@joergdietrich/leaflet.terminator';
import StatusComponent from './StatusComponent.vue';

const style = window.getComputedStyle(document.body)
const classNameColors = {}, tsunamiColors = {}
classNameArray.forEach(color => classNameColors[color] = style.getPropertyValue(`--${color}`).trim())
classNameArray.forEach(color => tsunamiColors[color] = style.getPropertyValue(`--tsunami-${color}`).trim())
const statusStore = useStatusStore()
const settingsStore = useSettingsStore()
const accessStore = useAccessStore()
const timeStore = useTimeStore()
const currentTimeText = computed(() => stampToTime(timeStore.currentTimeStamp, systemTimeZone))
let map, jpEewBaseMap, krEewBaseMap, cnEewBaseMap, jpTsunamiBaseMap, cnTsunamiBaseMap, labelLayer1, labelLayer2, terminatorLayer, terminatorFillLayer, cnFaultBaseMap
let eewBaseGroup, tsunamiBaseGroup
let eewMarkerPane, eqlistMarkerPane, eewReachPane, historyMarkerPane, wavePane, waveFillPane, taiwanGridPane, niedGridPane, kmaGridPane, eewBasePane, tsunamiBasePane, labelPane1, labelPane2
let userMarker
const defaultLatLng = [38.1, 104.6]
const { isValidUserLatLng, isValidViewLatLng, isDisplayUser, nearestJmaLoc } = storeToRefs(settingsStore)
const userLatLng = computed(() => settingsStore.mainSettings.userLatLng)
const viewLatLng = computed(() => settingsStore.mainSettings.viewLatLng)
const zoomLevel = ref(settingsStore.mainSettings.defaultZoom)
const resetSeisNetDelay = () => statusStore.seisNetReplayDelay = 0
const tempEqlists = ref('')
let tempEqlistsTimer
const handleTempEqlists = (time, source = '') => {
    clearTimeout(tempEqlistsTimer)
    if(time && source) {
        clearHistoryList()
        tempEqlists.value = source
        tempEqlistsTimer = setTimeout(() => {
            tempEqlists.value = ''
            smartSetView()
        }, time);
    }
    else {
        tempEqlists.value = ''
    }
}
provide('handleTempEqlists', handleTempEqlists)
const defaultMenuId = computed(() => {
    let defaultMenuId = 'main'
    if(tempEqlists.value) {
        defaultMenuId = 'eqlists'
    }
    else {
        const isActive = statusStore.isActive
        const isEewOrNetActive = [...eewSources, ...seisNetSources, 'mockEew'].some(key => isActive[key])
        const isEqlistOrTsunamiActive = [...eqlistSources, ...tsunamiSources].some(key => isActive[key])
        if(isEewOrNetActive && isEqlistOrTsunamiActive) {
            defaultMenuId = 'main'
        }
        else if(isEewOrNetActive) {
            defaultMenuId = 'eews'
        }
        else if(isEqlistOrTsunamiActive && !settingsStore.mainSettings.disableLastingEqlists) {
            defaultMenuId = 'eqlists'
        }
        else {
            defaultMenuId = settingsStore.mainSettings.defaultMenuId
        }
    }
    return defaultMenuId
})
const menuId = ref(defaultMenuId.value)
provide('menuId', menuId)
let autoZoomTimer
let firstMsg = false
const blinkStatus = ref(false)
let tsunamiFlickerCounter = 0
const infoPageCounter = ref(0)
const eventsPerPage = computed(() => (menuId.value == 'main' || menuId.value == 'settings') && (activeEewList.length > 0 && displayEqlistList.value.length > 0) ? 1 : 2)
const eewInfoTotalPages = computed(() => Math.ceil(activeEewList.length / eventsPerPage.value))
const currentEewInfoPage = computed(() => Math.floor(infoPageCounter.value / 10) % eewInfoTotalPages.value)
const currentEewInfoItems = computed(() => activeEewList.slice(eventsPerPage.value * currentEewInfoPage.value, eventsPerPage.value * (currentEewInfoPage.value + 1)))
const eqlistInfoTotalPages = computed(() => Math.ceil(displayEqlistList.value.length / eventsPerPage.value))
const currentEqlistInfoPage = computed(() => Math.floor(infoPageCounter.value / 10) % eqlistInfoTotalPages.value)
const currentEqlistInfoItems = computed(() => displayEqlistList.value.slice(eventsPerPage.value * currentEqlistInfoPage.value, eventsPerPage.value * (currentEqlistInfoPage.value + 1)))
const handleManual = ()=>{
    isAutoZoom.value = false
    clearTimeout(autoZoomTimer)
    autoZoomTimer = setTimeout(() => {
        handleHome()
    }, 60 * 1000);
}
const handleHome = ()=>{
    isAutoZoom.value = true
    setView(true)
}
const handleMenu = (index)=>{
    const shouldHandleHome = menuId.value == index
    if(shouldHandleHome && index == 'eqlists' && isAutoZoom.value) settingsStore.mainSettings.hideDrawer = !settingsStore.mainSettings.hideDrawer
    menuId.value = index
    setTimeout(() => {
        map.invalidateSize()
        if(shouldHandleHome || isAutoZoom.value) handleHome()
    }, 0);  //语句推迟到容器大小变化后再执行
}
provide('handleHome', handleHome)
const drawer = ref(null)
const webSocketStatus = computed(() => statusStore.webSocketStatus)
const fanStatusClass = computed(() => webSocketStatus.value.fan.readyState == 1 && statusStore.fanAuthStatus != 1
    ? 'incomplete'
    : `s${webSocketStatus.value.fan.readyState}`
)
const palertUpdateTime = ref('1970-01-01 08:00:00')
const palertMaxShindo = ref('?')
const palertPeriodMaxShindo = ref('?')
const palertPeriodBarClass = ref('gray')
const isPalertDelayed = ref(true)
provide('palertUpdateTime', palertUpdateTime)
provide('palertMaxShindo', palertMaxShindo)
provide('palertPeriodMaxShindo', palertPeriodMaxShindo)
provide('palertPeriodBarClass', palertPeriodBarClass)
const tremUpdateTime = ref('1970-01-01 08:00:00')
const tremMaxShindo = ref('?')
const tremPeriodMaxShindo = ref('?')
const tremPeriodBarClass = ref('gray')
const isTremDelayed = ref(true)
provide('tremUpdateTime', tremUpdateTime)
provide('tremMaxShindo', tremMaxShindo)
provide('tremPeriodMaxShindo', tremPeriodMaxShindo)
provide('tremPeriodBarClass', tremPeriodBarClass)
const niedUpdateTime = ref('1970-01-01 09:00:00')
const niedMaxShindo = ref('?')
const niedPeriodMaxShindo = ref('?')
const niedPeriodBarClass = ref('gray')
const isNiedDelayed = ref(true)
provide('niedUpdateTime', niedUpdateTime)
provide('niedMaxShindo', niedMaxShindo)
provide('niedPeriodMaxShindo', niedPeriodMaxShindo)
provide('niedPeriodBarClass', niedPeriodBarClass)
const kmaUpdateTime = ref('1970-01-01 09:00:00')
const kmaMaxInt = ref('?')
const kmaPeriodMaxInt = ref('?')
const kmaPeriodBarClass = ref('gray')
const isKmaDelayed = ref(true)
provide('kmaUpdateTime', kmaUpdateTime)
provide('kmaMaxInt', kmaMaxInt)
provide('kmaPeriodMaxInt', kmaPeriodMaxInt)
provide('kmaPeriodBarClass', kmaPeriodBarClass)
const isAutoZoom = ref(true)
const activeEewList = reactive([])
const eqlistList = reactive([])
const historyList = reactive([])
statusStore.historyList = historyList
const activeEqlistList = computed(() => eqlistList.filter(event => event.isActive))
const displayEqlistList = computed(() => historyList.length > 0 ? historyList : eqlistList.filter(event => settingsStore.mainSettings.alwaysDisplayLatestInfo ? event.isActive || event.isLatest : event.isActive))
provide('activeEewList', activeEewList)
provide('eqlistList', eqlistList)
provide('historyList', historyList)
const clearHistoryList = () => {
    while(historyList.length > 0) historyList[0].deactivate()
}
watch(() => `${activeEewList.length}|${displayEqlistList.value.length}|${menuId.value}`, () => {
    infoPageCounter.value = 0
})
const jmaTsunamiWarnArea = computed(() => {
    const warnArea = JSON.parse(statusStore.tsunamiMessage.jmaTsunami.warnArea)
    const jmaTsunamiWarnArea = {}
    warnArea.forEach(item => {
        jmaTsunamiWarnArea[item.name] = item
    })
    return jmaTsunamiWarnArea
})
const nmefcTsunamiWarnArea = computed(() => {
    const warnArea = JSON.parse(statusStore.tsunamiMessage.nmefcTsunami.warnArea)
    const nmefcTsunamiWarnArea = {}
    warnArea.forEach(item => {
        nmefcTsunamiWarnArea[item.name] = item
    })
    return nmefcTsunamiWarnArea
})
const activeSources = computed(() =>
    new Set([...activeEewList.map(event => event.eqMessage.source), ...activeEqlistList.value.map(event => event.eqMessage.source)])
)
watch(activeSources, newVal => {
    [...eewSources, ...eqlistSources, 'mockEew'].forEach(source => {
        statusStore.isActive[source] = newVal.has(source)
    })
})
const getBarClass = (event)=>{
    const eqMessage = event.eqMessage
    if(eqMessage.isEew){
        if(eqMessage.isCanceled) return 'dark-gray'
        else if(eqMessage.isWarn) return 'red'
        else return 'orange'
    }
    else {
        if(event.isActive) return 'gray'
        else return 'dark-gray'
    }
}
let mainInterval, terminatorInterval, terminatorUpdateTimer
let mapLoadMessageTimer, mapLoadRetryTimer
let isDisposed = false
const mapLoadWatchStops = new Set()
const trackMapLoadWatch = stop => mapLoadWatchStops.add(stop)
const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible' && pendingSetView) {
        pendingSetView = false
        setView(true)
    }
}
onMounted(()=>{
    map = L.map('mainMap', {
        attributionControl: false,
        center: defaultLatLng,
        zoom: 4,
        minZoom: 2,
        maxZoom: 12,
        worldCopyJump: true
    })
    //傻逼Leaflet
    L.Marker.prototype._animateZoom = function (opt) {
        if (!this._map) {
            return;
        }
        const pos = this._map._latLngToNewLayerPoint(this._latlng, opt.zoom, opt.center).round();
        this._setPos(pos);
    }
    L.Tooltip.prototype._animateZoom = function (e) {
        if (!this._map) {
            return;
        }
        const pos = this._map._latLngToNewLayerPoint(this._latlng, e.zoom, e.center).round();
        this._setPosition(pos);
    }
    L.Tooltip.prototype._updatePosition = function () {
        if (!this._map) {
            return;
        }
        const pos = this._map.latLngToLayerPoint(this._latlng);
        this._setPosition(pos);
    }
    statusStore.map = map
    eewBaseGroup = L.layerGroup().addTo(map)
    tsunamiBaseGroup = L.layerGroup().addTo(map)
    map.removeControl(map.zoomControl)
    map.createPane('basePane')
    map.getPane('basePane').style.zIndex = 0
    map.createPane('terminatorFillPane')
    map.getPane('terminatorFillPane').style.zIndex = 9
    map.createPane('waveFillPane')
    waveFillPane = map.getPane('waveFillPane')
    waveFillPane.style.zIndex = 10
    map.createPane('eewBasePane')
    eewBasePane = map.getPane('eewBasePane')
    eewBasePane.style.zIndex = 20
    map.createPane('faultBasePane')
    map.getPane('faultBasePane').style.zIndex = 30
    map.createPane('tsunamiBasePane')
    tsunamiBasePane = map.getPane('tsunamiBasePane')
    tsunamiBasePane.style.zIndex = 40
    map.createPane('taiwanStationPane')
    map.getPane('taiwanStationPane').style.zIndex = 50
    for(let i = -1; i <= 20; i++){
        map.createPane(`palertStationPane${i}`)
        map.getPane(`palertStationPane${i}`).style.zIndex = i + 50
        map.createPane(`tremStationPane${i}`)
        map.getPane(`tremStationPane${i}`).style.zIndex = i + 50
        map.createPane(`niedStationPane${i}`)
        map.getPane(`niedStationPane${i}`).style.zIndex = i + 50
    }
    for(let i = -1; i <= 13; i++){
        map.createPane(`kmaStationPane${i}`)
        map.getPane(`kmaStationPane${i}`).style.zIndex = i + 50
    }
    for(let i = 0; i <= 12; i++){
        map.createPane(`intReportStationPane${i}`)
        map.getPane(`intReportStationPane${i}`).style.zIndex = i + 75
    }
    map.createPane('userPane')
    map.getPane('userPane').style.zIndex = 100
    map.createPane('terminatorPane')
    map.getPane('terminatorPane').style.zIndex = 130
    map.createPane('taiwanGridPane')
    taiwanGridPane = map.getPane('taiwanGridPane')
    taiwanGridPane.style.zIndex = 140
    map.createPane('niedGridPane')
    niedGridPane = map.getPane('niedGridPane')
    niedGridPane.style.zIndex = 140
    map.createPane('kmaGridPane')
    kmaGridPane = map.getPane('kmaGridPane')
    kmaGridPane.style.zIndex = 140
    map.createPane('wavePane')
    wavePane = map.getPane('wavePane')
    wavePane.style.zIndex = 150
    map.createPane('labelPane1')
    labelPane1 = map.getPane('labelPane1')
    labelPane1.style.zIndex = 190
    map.createPane('labelPane2')
    labelPane2 = map.getPane('labelPane2')
    labelPane2.style.zIndex = 190
    map.createPane('eqlistMarkerPane')
    eqlistMarkerPane = map.getPane('eqlistMarkerPane')
    eqlistMarkerPane.style.zIndex = 197
    map.createPane('historyMarkerPane')
    historyMarkerPane = map.getPane('historyMarkerPane')
    historyMarkerPane.style.zIndex = 198
    map.createPane('eewReachPane')
    eewReachPane = map.getPane('eewReachPane')
    eewReachPane.style.zIndex = 199
    map.createPane('eewMarkerPane')
    eewMarkerPane = map.getPane('eewMarkerPane')
    eewMarkerPane.style.zIndex = 200
    map.createPane('typhoonWindCirclePane')
    map.getPane('typhoonWindCirclePane').style.zIndex = 201
    map.createPane('typhoonPathLinePane')
    map.getPane('typhoonPathLinePane').style.zIndex = 202
    map.createPane('typhoonPointMarkerPane')
    map.getPane('typhoonPointMarkerPane').style.zIndex = 203
    map.createPane('typhoonIconMarkerPane')
    map.getPane('typhoonIconMarkerPane').style.zIndex = 204
    map.on('dragstart', handleManual)
    map.on('zoomend', () => zoomLevel.value = map.getZoom())
    if(settingsStore.advancedSettings.preventFlickerMode){
        map.on('zoomstart', ()=>{setMapHeight('calc(100% - 1px)');})
        map.on('zoomend', ()=>{setMapHeight('100%');})
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    watchEffect(()=>{
        if(userMarker && map.hasLayer(userMarker)) map.removeLayer(userMarker)
        if(isDisplayUser.value){
            userMarker = L.circleMarker(userLatLng.value, {
                radius: 8,
                fillOpacity: 0.5,
                weight: 2,
                pane: 'userPane',
                interactive: false
            }).addTo(map)
        }
        nearestJmaLoc.value
    })
    watchEffect(() => {
        waveFillPane.style.display = settingsStore.mainSettings.fillSWave ? 'block' : 'none'
    })
    watchEffect(() => {
        eqlistMarkerPane.style.display = historyList.length > 0 ? 'none' : 'block'
        historyMarkerPane.style.display = historyList.length > 0 ? 'block' : 'none'
    })
    watchEffect(() => {
        if(activeEqlistList.value.length > 0) {
            if(tempEqlists.value.endsWith('Eqlist')) {
                eqlistList.forEach(event => {
                    event.hypoMarker?.setOpacity(tempEqlists.value == event.eqMessage.source ? 1 : 0.3)
                })
            }
            else {
                eqlistList.forEach(event => {
                    event.hypoMarker?.setOpacity(event.isActive ? 1 : 0.3)
                })
            }
        }
        else {
            eqlistList.forEach(event => {
                event.hypoMarker?.setOpacity(1)
            })
        }
    })
    labelLayer1 = L.layerGroup().addTo(map);
    labelLayer2 = L.layerGroup().addTo(map);
    loadMaps()
    watch(()=>settingsStore.mainSettings.displayTerminator, newVal => {
        if(terminatorLayer && map.hasLayer(terminatorLayer)) map.removeLayer(terminatorLayer)
        if(terminatorFillLayer && map.hasLayer(terminatorFillLayer)) map.removeLayer(terminatorFillLayer)
        clearTimeout(terminatorUpdateTimer)
        clearInterval(terminatorInterval)
        if(newVal) {
            const update = () => {
                const time = new Date(timeStore.getTimeStamp())
                terminatorLayer?.setTime(time)
                terminatorFillLayer?.setTime(time)
            }
            const time = new Date(timeStore.getTimeStamp())
            terminatorLayer = terminator({
                color: 'black',
                opacity: 0.5,
                weight: 2,
                fill: false,
                pane: 'terminatorPane',
                interactive: false,
                time
            }).addTo(map)
            terminatorFillLayer = terminator({
                fillColor: 'black',
                fillOpacity: 0.25,
                stroke: false,
                pane: 'terminatorFillPane',
                interactive: false,
                time
            }).addTo(map)
            terminatorUpdateTimer = setTimeout(update, 6000);
            terminatorInterval = setInterval(update, 30000);
        }
    }, { immediate: true })
    watch(defaultMenuId, newVal => {
        if(menuId.value != 'settings' && isAutoZoom.value) {
            menuId.value = newVal
            setTimeout(() => {
                map.invalidateSize()
                setView(true)
            }, 0);
        }
    }, { immediate: true })
    watchEffect(() => {
        document.removeEventListener('mousemove', resetDefaultMenuTimer)
        if(menuId.value == defaultMenuId.value){
            clearTimeout(defaultMenuTimer)
        }
        else{
            resetDefaultMenuTimer()
            document.addEventListener('mousemove', resetDefaultMenuTimer)
        }
    })
    watch(menuId, (newVal) => {
        clearHistoryList()
        simpleIcon.value = newVal == 'eqlists'
        drawer.value.scrollTop = 0
        if(newVal == 'eews'){
            eqlistMarkerPane.style.opacity = 0.3
            tsunamiBasePane.style.opacity = 0.3 * (tsunamiFlickerCounter ? 1 : 0)
        }
        else{
            eqlistMarkerPane.style.opacity = 1
            tsunamiBasePane.style.opacity = 1 * (tsunamiFlickerCounter ? 1 : 0)
        }
        if(newVal == 'eqlists'){
            eewReachPane.style.opacity = 0.3
            wavePane.style.opacity = 0.3
            waveFillPane.style.opacity = 0.3
        }
        else{
            eewReachPane.style.opacity = 1
            wavePane.style.opacity = 1
            waveFillPane.style.opacity = 1
        }
    }, { immediate: true })
    intervalEvents()
    mainInterval = setInterval(() => {
        intervalEvents()
    }, 500);
    document.addEventListener('keydown', handleKeydown)
})
function handleKeydown(event) {
    const target = event.target
    const tag = target.tagName.toLowerCase()
    const isInput = tag === 'input' || tag === 'textarea' || target.isContentEditable || tag === 'select'
    if (!isInput) {
        switch (event.key) {
            case 'd':
            case 'D':
                settingsStore.mainSettings.hideDrawer = !settingsStore.mainSettings.hideDrawer
                setTimeout(() => {
                    map.invalidateSize()
                }, 0);
                break
            case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight':
                handleManual()
                break
            case 'Tab':
                event.preventDefault()
                const menuArr = ['main', 'eews', 'eqlists']
                const length = menuArr.length
                const currIndex = menuArr.findIndex(id => id == menuId.value) ?? length
                const nextIndex = event.shiftKey ? (currIndex + length - 1) % length : (currIndex + 1) % length
                const nextMenu = menuArr[nextIndex]
                handleMenu(nextMenu)
                break
            case 'a':
            case 'A':
                if(isAutoZoom.value) {
                    handleManual()
                }
                else {
                    handleHome()
                }
                break
            case 'x':
            case 'X':
                statusStore.showStatusPanel = !statusStore.showStatusPanel
                break
            case 'm':
            case 'M':
                if(settingsStore.advancedSettings.mockEew) {
                    statusStore.showMockDialog = !statusStore.showMockDialog
                }
                break
            case 'c':
            case 'C':
                if(menuId.value == 'eqlists') {
                    clearHistoryList()
                }
                break
            case 'f':
            case 'F':
                handleMenu('main')
                break
            case 'e':
            case 'E':
                handleMenu('eews')
                break
            case 'l':
            case 'L':
                handleMenu('eqlists')
                break
            case 's':
            case 'S':
                handleMenu('settings')
                break
            case ',':
            case '<':
                infoPageCounter.value = (infoPageCounter.value - infoPageCounter.value % 10 + 25200 - 10) % 25200
                break
            case '.':
            case '>':
                infoPageCounter.value = (infoPageCounter.value - infoPageCounter.value % 10 + 10) % 25200
                break
        }
    }
}
const renderers = {}
const panes = ['basePane', 'eewBasePane', 'tsunamiBasePane', 'faultBasePane']
const eewBaseMapDefaultFill = '#39393900'
const eewBaseMapDefaultStroke = '#bbbbbb00'
const eewBaseMapActiveStroke = '#bbbbbb'
const tsunamiBaseMapDefaultStroke = '#ffffff00'
settingsStore.mainSettings.useCanvasRenderer && panes.forEach(pane => renderers[pane] = L.canvas({ pane }))
const loadMaps = async (retries = 0) => {
    if(isDisposed) return
    if(!firstMsg){
        clearTimeout(mapLoadMessageTimer)
        mapLoadMessageTimer = setTimeout(() => {
            ElMessage({
                message: '正在加载地图，请稍候…',
                duration: 5000
            })
            firstMsg = true
        }, 1000);
    }
    let promises, shouldRetry = false
    if(!isTauri() && ('caches' in window)){
        const cache = await caches.open('topojson')
        promises = Object.keys(topojsonUrls).map(key=>cache.match(topojsonUrls[key]).then(res=>res?.json()))
    }
    else{
        promises = Object.keys(topojsonUrls).map(key=>fetch(topojsonUrls[key]).then(res=>res?.json()))
    }
    const resps = await Promise.all(promises)
    if(isDisposed) return
    const [global, cn, cn_eew, cn_fault, jp, jp_eew, jp_tsunami, kr_eew, cn_tsunami] = resps
    if(global && cn && cn_eew && cn_fault && jp && jp_eew && kr_eew && jp_tsunami){
        clearTimeout(mapLoadMessageTimer)
        loadBaseMap(global, 'basePane')
        loadBaseMap(jp, 'basePane')
        loadBaseMap(cn, 'basePane')
        jpEewBaseMap = settingsStore.mainSettings.disableEewBaseMap 
        ? null : loadBaseMap(jp_eew, 'eewBasePane', false, {
            color: eewBaseMapDefaultStroke,
            opacity: 1,
            fillColor: eewBaseMapDefaultFill,
            fillOpacity: 1,
            weight: 1,
        }, eewBaseGroup)
        krEewBaseMap = settingsStore.mainSettings.disableEewBaseMap 
        ? null : loadBaseMap(kr_eew, 'eewBasePane', false, {
            color: eewBaseMapDefaultStroke,
            opacity: 1,
            fillColor: eewBaseMapDefaultFill,
            fillOpacity: 1,
            weight: 1,
        }, eewBaseGroup)
        cnEewBaseMap = settingsStore.mainSettings.disableEewBaseMap 
        ? null : loadBaseMap(cn_eew, 'eewBasePane', false, {
            color: eewBaseMapDefaultStroke,
            opacity: 1,
            fillColor: eewBaseMapDefaultFill,
            fillOpacity: 1,
            weight: 1,
        }, eewBaseGroup)
        trackMapLoadWatch(watch(()=>settingsStore.mainSettings.displayCnFault, newVal => {
            if(cnFaultBaseMap && map.hasLayer(cnFaultBaseMap)) map.removeLayer(cnFaultBaseMap)
            if(newVal) {
                cnFaultBaseMap = loadBaseMap(cn_fault, 'faultBasePane', true, (item) => ({
                    color: (item.properties ?? item).age == 'Qh' ? 'red' : (item.properties ?? item).age == 'Qp3' ? 'orange' : 'green',
                    opacity: 0.5,
                    weight: 1.5,
                }))
            }
        }, { immediate: true }))
        if(settingsStore.mainSettings.displayPlaceName) {
            const createTextIcon = (text, fontSize = 15) => {
                const dpr = 2 * (window.devicePixelRatio || 1);
                const tempCanvas = document.createElement('canvas');
                const tempCtx = tempCanvas.getContext('2d');
                tempCtx.font = `${fontSize}px Arial`;
                const textWidth = tempCtx.measureText(text).width;
                const textHeight = fontSize;

                const canvas = document.createElement('canvas');
                canvas.width = (textWidth + 5) * dpr;
                canvas.height = (textHeight + 5) * dpr;
                const ctx = canvas.getContext('2d');
                ctx.scale(dpr, dpr);
                ctx.font = `${fontSize}px Arial`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#ffffffcc';
                ctx.shadowColor = '#000000aa';
                ctx.shadowBlur = 5;
                ctx.fillText(text, canvas.width / dpr / 2, canvas.height / dpr / 2);

                return L.icon({
                    iconUrl: canvas.toDataURL(),
                    iconSize: [canvas.width / dpr, canvas.height / dpr],
                    iconAnchor: [canvas.width / dpr / 2, canvas.height / dpr / 2]
                });
            };
            cnProvinceLabels.forEach(item => {
                const { name, coord } = item
                const label = L.marker(coord, {
                    icon: createTextIcon(name),
                    pane: "labelPane1",
                    interactive: false
                })
                labelLayer1.addLayer(label)
            })
            cnCityLabels.forEach(item => {
                const { name, coord } = item
                const label = L.marker(coord, {
                    icon: createTextIcon(name),
                    pane: "labelPane2",
                    interactive: false
                })
                labelLayer2.addLayer(label)
            })
            jpPrefLabels.forEach(item => {
                const { name, coord } = item
                const label = L.marker(coord, {
                    icon: createTextIcon(name),
                    pane: "labelPane2",
                    interactive: false
                })
                labelLayer2.addLayer(label)
            })
            trackMapLoadWatch(watchEffect(() => {
                labelPane1.style.display = zoomLevel.value >= 5 && zoomLevel.value < 8 ? 'block' : 'none'
                labelPane2.style.display = zoomLevel.value >= 8 ? 'block' : 'none'
            }))
        }
        trackMapLoadWatch(watch(jmaWarnArea, (newVal)=>{
            jpEewBaseMap?.setStyle(feature => {
                const className = newVal[feature.properties.name]?.className
                return ({
                    color: className ? eewBaseMapActiveStroke : eewBaseMapDefaultStroke,
                    fillColor: classNameColors[className] || eewBaseMapDefaultFill
                })
            })
        }, { deep: true, immediate: true }))
        if(settingsStore.advancedSettings.forceCalcInt){
            trackMapLoadWatch(watch(eewInfoList, newVal=>{
                const newCsisList = {}
                const cnAreaClass = {}, krAreaClass = {}
                cnEewBaseMap?.eachLayer(layer=>{
                    let maxInt = 0
                    newVal.forEach(info=>{
                        const dist = pointDistToCnArea([info.lng, info.lat], layer.feature)
                        const int = Number(calcCsisLevel(info.magnitude, info.depth, dist))
                        if(int > maxInt) maxInt = int
                    })
                    if(maxInt > 0){
                        const className = setClassName(maxInt, false)
                        const layerName = layer.feature.properties.name
                        cnAreaClass[layerName] = className
                        if(!(maxInt in newCsisList)) newCsisList[maxInt] = []
                        newCsisList[maxInt].push(layerName)
                    }
                })
                krEewBaseMap?.eachLayer(layer=>{
                    let maxInt = 0
                    newVal.forEach(info=>{
                        const dist = pointDistToKrArea([info.lng, info.lat], layer.feature)
                        const int = Number(calcCsisLevel(info.magnitude, info.depth, dist))
                        if(int > maxInt) maxInt = int
                    })
                    if(maxInt > 0){
                        const className = setClassName(maxInt, false)
                        const layerName = layer.feature.properties.name
                        krAreaClass[layerName] = className
                        if(!(maxInt in newCsisList)) newCsisList[maxInt] = []
                        newCsisList[maxInt].push(layerName)
                    }
                })
                cnEewBaseMap?.setStyle(feature => {
                    const className = cnAreaClass[feature.properties.name]
                    return ({
                        color: className ? eewBaseMapActiveStroke : eewBaseMapDefaultStroke,
                        fillColor: classNameColors[className] || eewBaseMapDefaultFill
                    })
                })
                krEewBaseMap?.setStyle(feature => {
                    const className = krAreaClass[feature.properties.name]
                    return ({
                        color: className ? eewBaseMapActiveStroke : eewBaseMapDefaultStroke,
                        fillColor: classNameColors[className] || eewBaseMapDefaultFill
                    })
                })
                const newNewCsisList = []
                for(let int = 12; int > 0; int--) {
                    if(newNewCsisList.length >= 50) break
                    newCsisList[int]?.forEach(name => {
                        newNewCsisList.push({
                            name,
                            intensity: int.toString()
                        })
                    })
                }
                csisList.value = newNewCsisList.slice(0, 50)
            }, { deep: true, immediate: true }))
        }
        if(settingsStore.isDataSourceEnabled('jmaTsunami')) {
            jpTsunamiBaseMap = loadBaseMap(jp_tsunami, 'tsunamiBasePane', false, {
                color: tsunamiBaseMapDefaultStroke,
                opacity: 1,
                weight: map.getZoom(),
            }, tsunamiBaseGroup)
            map.on('zoomend', () => {
                jpTsunamiBaseMap.setStyle({
                    weight: map.getZoom()
                })
            })
            trackMapLoadWatch(watch(jmaTsunamiWarnArea, newVal => {
                jpTsunamiBaseMap.setStyle(feature => ({
                    color: tsunamiColors[newVal[feature.properties.name]?.className] || tsunamiBaseMapDefaultStroke
                }))
                smartSetView()
            }, { deep: true, immediate: true }))
        }
        if(settingsStore.isDataSourceEnabled('nmefcTsunami') && accessStore.canUse('nmefcTsunamiMap') && 'cn_tsunami' in topojsonUrls) {
            if(cn_tsunami) {
                cnTsunamiBaseMap = loadBaseMap(cn_tsunami, 'tsunamiBasePane', false, {
                    color: tsunamiBaseMapDefaultStroke,
                    opacity: 1,
                    weight: map.getZoom(),
                }, tsunamiBaseGroup)
                map.on('zoomend', () => {
                    cnTsunamiBaseMap.setStyle({
                        weight: map.getZoom()
                    })
                })
                trackMapLoadWatch(watch(nmefcTsunamiWarnArea, newVal => {
                    cnTsunamiBaseMap.setStyle(feature => ({
                        color: tsunamiColors[newVal[feature.properties.name]?.className] || tsunamiBaseMapDefaultStroke
                    }))
                    smartSetView()
                }, { deep: true, immediate: true }))
            }
            else {
                shouldRetry = true
            }
        }
    }
    else{
        shouldRetry = true
    }
    if(shouldRetry) {
        if(retries < 50) {
            clearTimeout(mapLoadRetryTimer)
            mapLoadRetryTimer = setTimeout(() => {
                loadMaps(retries + 1)
            }, 2000);
        }
        else {
            ElMessage({
                message: '地图加载失败，请稍后重试！',
                type: 'error',
                duration: 5000
            })
        }
    }
}
watchEffect(() => {
    const blinkOpac = blinkStatus.value ? 1 : 0
    const menuOpac = menuId.value == 'eqlists' ? 0.3 : 1
    // 你不许使用可选链符号（不然报错）
    if(eewMarkerPane) eewMarkerPane.style.opacity = blinkOpac * menuOpac
    const alwaysDisplayGrid = settingsStore.mainSettings.displaySeisNet.alwaysDisplayGrid
    if(taiwanGridPane) taiwanGridPane.style.opacity = blinkOpac * menuOpac * (shouldDisplayNetworkGrid('taiwanGridPane', statusStore.isActive, alwaysDisplayGrid) ? 1 : 0)
    if(niedGridPane) niedGridPane.style.opacity = blinkOpac * menuOpac * (shouldDisplayNetworkGrid('niedGridPane', statusStore.isActive, alwaysDisplayGrid) ? 1 : 0)
    if(kmaGridPane) kmaGridPane.style.opacity = blinkOpac * menuOpac * (shouldDisplayNetworkGrid('kmaGridPane', statusStore.isActive, alwaysDisplayGrid) ? 1 : 0)
})
const intervalEvents = ()=>{
    blinkStatus.value = !blinkStatus.value
    tsunamiFlickerCounter = (tsunamiFlickerCounter + 1) % 6
    infoPageCounter.value = (infoPageCounter.value + 1) % 25200
    tsunamiBasePane.style.opacity = (tsunamiFlickerCounter ? 1 : 0) * (menuId.value == 'eews' ? 0.3 : 1)
    isPalertDelayed.value = !verifyUpToDate(palertUpdateTime.value, 8, 20000)
    isTremDelayed.value = !verifyUpToDate(tremUpdateTime.value, 8, 10000)
    isNiedDelayed.value = !verifyUpToDate(niedUpdateTime.value, 9, 10000)
    isKmaDelayed.value = !verifyUpToDate(kmaUpdateTime.value, 9, 10000)
}
const setMapHeight = (height) => {
    const mapElement = map.getContainer()
    mapElement.style.height = height
    setTimeout(() => {
        map.invalidateSize()
    }, 0);
}
let pendingSetView = false
let largeZoomingTimer
const setView = (force = false) => {
    if(!map) return
    if(document.visibilityState === 'visible') {
        const bounds = L.latLngBounds([])
        let stableMode = false
        //临时Eqlist
        if(tempEqlists.value && menuId.value == 'eqlists' && historyList.length == 0) {
            if(tempEqlists.value == 'jmaTsunami') {
                if(statusStore.isActive.jmaTsunami) {
                    bounds.extend(collectStrokedAreaBounds(jpTsunamiBaseMap, tsunamiBaseMapDefaultStroke))
                }
                if(!bounds.isValid()) {
                    extendLayerBounds(bounds, jpTsunamiBaseMap)
                }
            }
            else if(tempEqlists.value == 'nmefcTsunami') {
                if(statusStore.isActive.nmefcTsunami) {
                    bounds.extend(collectStrokedAreaBounds(cnTsunamiBaseMap, tsunamiBaseMapDefaultStroke))
                }
                if(!bounds.isValid()) {
                    extendLayerBounds(bounds, cnTsunamiBaseMap)
                }
            }
            else if(activeEqlistList.value.length > 0) {
                activeEqlistList.value.forEach(event=>{
                    if(event.eqMessage.source == tempEqlists.value && event.isValidHypo) {
                        bounds.extend(event.hypoLatLng)
                    }
                })
                bounds.extend(collectFilledAreaBounds(eewBaseGroup, eewBaseMapDefaultFill))
            }
        }
        else {
            //Eew和SeisNet
            if(menuId.value != 'eqlists') {
                map.eachLayer(layer => {
                    const isDetectionGrid = getGridNetworkRelation(layer.options.pane) &&
                        layer.options.isGridCanvasLayer && layer.hasGrid?.()
                    const shouldExtend = layer.options.pane == 'eewMarkerPane' || isDetectionGrid
                    if(isDetectionGrid) stableMode = true
                    if(shouldExtend) extendLayerBounds(bounds, layer)
                })
                activeEewList.forEach(event => {
                    if(event.sWaveFill && shouldIncludeEewSWaveBounds(event.eqMessage.source, statusStore.isActive)) {
                        extendLayerBounds(bounds, event.sWaveFill)
                    }
                })
            }
            //历史地震
            if(!bounds.isValid() && menuId.value == 'eqlists' && historyList.length > 0) {
                map.eachLayer(layer => {
                    if(layer.options.pane == 'historyMarkerPane' || layer.options.pane?.includes('intReportStationPane')) {
                        extendLayerBounds(bounds, layer)
                    }
                })
                bounds.extend(collectFilledAreaBounds(eewBaseGroup, eewBaseMapDefaultFill))
            }
            //活跃的Eqlist和Tsunami
            if(!bounds.isValid() && menuId.value != 'eews') {
                if(statusStore.isActive.jmaTsunami) {
                    bounds.extend(collectStrokedAreaBounds(jpTsunamiBaseMap, tsunamiBaseMapDefaultStroke))
                }
                if(statusStore.isActive.nmefcTsunami) {
                    bounds.extend(collectStrokedAreaBounds(cnTsunamiBaseMap, tsunamiBaseMapDefaultStroke))
                }
                if(activeEqlistList.value.length > 0) {
                    activeEqlistList.value.forEach(event=>{
                        if(event.isValidHypo){
                            bounds.extend(event.hypoLatLng)
                        }
                    })
                    bounds.extend(collectFilledAreaBounds(eewBaseGroup, eewBaseMapDefaultFill))
                }
            }
            //不活跃的Eqlist
            if(!bounds.isValid() && menuId.value == 'eqlists') {
                const candidates = []
                map.eachLayer(layer => {
                    if(layer.options.pane == 'eqlistMarkerPane'){
                        if(layer.getLatLng){
                            const latLng = layer.getLatLng()
                            const { lat, lng } = latLng
                            if(
                                lat >= 18 && lat <= 54 && lng >= 73 && lng <= 149
                                ||
                                lat >= 3 && lat <= 18 && lng >= 107 && lng <= 120
                            ) {
                                bounds.extend(latLng)
                            }
                            else {
                                candidates.push(latLng)
                            }
                        }
                    }
                })
                bounds.extend(collectFilledAreaBounds(eewBaseGroup, eewBaseMapDefaultFill))
                if(!bounds.isValid()) {
                    candidates.forEach(latLng => bounds.extend(latLng))
                }
            }
        }
        let targetCenter, targetZoom
        //应用bounds
        if(bounds.isValid()){
            const target = map._getBoundsCenterZoom(bounds, {
                padding: [50, 50],
                maxZoom: 8
            })
            targetCenter = target.center
            targetZoom = target.zoom
        }
        //默认视野
        else{
            let centerArr
            if(isValidViewLatLng.value){
                centerArr = viewLatLng.value
            }
            else if(isValidUserLatLng.value){
                centerArr = userLatLng.value
            }
            else{
                centerArr = defaultLatLng
            }
            const [lat, lng] = centerArr
            targetCenter = { lat, lng }
            targetZoom = settingsStore.mainSettings.defaultZoom
        }
        const currCenter = map.getCenter()
        const currZoom = map.getZoom()
        if(!force && stableMode && currZoom == targetZoom && map.getBounds().contains(bounds))
            return
        const err = 1 / 2 ** targetZoom
        if(currZoom != targetZoom || Math.abs(currCenter.lat - targetCenter.lat) >= err || Math.abs(currCenter.lng - targetCenter.lng) >= err) {
            if(Math.abs(currZoom - targetZoom) > 4) {
                clearTimeout(largeZoomingTimer)
                if(map.hasLayer(eewBaseGroup)) map.removeLayer(eewBaseGroup)
                if(map.hasLayer(tsunamiBaseGroup)) map.removeLayer(tsunamiBaseGroup)
                map.once('moveend', () => {
                    largeZoomingTimer = setTimeout(() => {
                        if(map && eewBaseGroup && !map.hasLayer(eewBaseGroup)) eewBaseGroup.addTo(map)
                        if(map && tsunamiBaseGroup && !map.hasLayer(tsunamiBaseGroup)) tsunamiBaseGroup.addTo(map)
                    }, 0);
                })
                map.setView(targetCenter, targetZoom, { animate: false })
            }
            else {
                map.setView(targetCenter, targetZoom, { animate: true })
            }
        }
    }
    else {
        pendingSetView = true
    }
}
const smartSetView = (force = false) => {
    setTimeout(() => {
        if(isAutoZoom.value) setView(force)
    }, 0);
}
provide('smartSetView', smartSetView)
const loadBaseMap = (topojson, pane, isBaseMap = true, style = {
        color: '#ccc',
        fillColor: '#393939',
        fillOpacity: 1,
        weight: 1,
        fill: true
    }, target = map)=>{
    if(Object.keys(topojson).length != 0){
        try {
            if(isBaseMap && !settingsStore.advancedSettings.useClassicMapLoader) {
                const geojson = feature(topojson, topojson.objects.region)
                const vectorGrid = L.vectorGrid.slicer(geojson, {
                    pane,
                    rendererFactory: L.canvas.tile,
                    vectorTileLayerStyles: {
                        sliced: style
                    },
                    interactive: false
                });
                vectorGrid.addTo(target);
                return vectorGrid;
            }
            else {
                const factor = isBaseMap ? 0 : settingsStore.mainSettings.mapSimplifyFactor
                const simplified = simplifyTopoJson(topojson, factor)
                const geojson = feature(simplified, simplified.objects.region)
                const baseMap = L.geoJson(geojson, {
                    pane,
                    renderer: settingsStore.mainSettings.useCanvasRenderer && renderers[pane],
                    style,
                    interactive: settingsStore.mainSettings.placeNameOnHover && !settingsStore.mainSettings.useCanvasRenderer,
                    onEachFeature: settingsStore.mainSettings.placeNameOnHover && !settingsStore.mainSettings.useCanvasRenderer && onEachFeature
                })
                baseMap.addTo(target)
                return baseMap
            }
        } catch (e) {
            console.log(e);
        }
    }
}
const onEachFeature = (feature, layer)=>{
    layer.bindTooltip(feature.properties.name, {
        permanent: false,
        direction: 'top'
    })
}
let defaultMenuTimer
const resetDefaultMenuTimer = ()=>{
    clearTimeout(defaultMenuTimer)
    defaultMenuTimer = setTimeout(() => {
        menuId.value = defaultMenuId.value
        setTimeout(() => {
            map.invalidateSize()
            if(isAutoZoom.value) setView()
        }, 0);
    }, 60 * 1000);
}
let autoZoomInterval
watch(isAutoZoom, (newVal)=>{
    clearInterval(autoZoomInterval)
    if(newVal){
        autoZoomInterval = setInterval(() => {
            setView()
        }, 1000);
    }
}, { immediate: true })
const jmaWarnArea = computed(()=>{
    const jmaWarnArea = {}
    if(menuId.value != 'eqlists') {
        const jmaEewList = activeEewList.filter(event=>event.eqMessage.source == 'jmaEew' && !event.eqMessage.isCanceled)
        jmaEewList.forEach(event=>{
            const warnArea = JSON.parse(event.eqMessage.warnArea)
            warnArea.forEach(item=>{
                if(!jmaWarnArea[item.name] || getShindoRank(item.intensity) > getShindoRank(jmaWarnArea[item.name].intensity)){
                    jmaWarnArea[item.name] = item
                }
            })
        })
        if(settingsStore.advancedSettings.forceCalcInt) {
            for(let id in jmaSeisIntLoc) {
                for(let eew of jpEewInfoList.value) {
                    const { magnitude, depth, lat, lng } = eew
                    const intensity = calcJmaShindoLevel(magnitude, depth, lat, lng, jmaSeisIntLoc[id], false)
                    if(getShindoRank(intensity) < 1) continue
                    const name = jmaSeisIntLoc[id].sect
                    const className = setClassName(intensity, true)
                    if(!jmaWarnArea[name] || getShindoRank(intensity) > getShindoRank(jmaWarnArea[name].intensity)) {
                        jmaWarnArea[name] = {
                            name,
                            intensity,
                            className
                        }
                    }
                }
            }
        }
    }
    else {
        const jmaEqlistEvent = historyList.length > 0
        ? null
        : activeEqlistList.value.length > 0
        ? tempEqlists.value.endsWith('Eqlist')
        ? tempEqlists.value == 'jmaEqlist'
        ? activeEqlistList.value.find(event => event.eqMessage.source == 'jmaEqlist')
        : null
        : activeEqlistList.value.find(event => event.eqMessage.source == 'jmaEqlist')
        : eqlistList.find(event => event.eqMessage.source == 'jmaEqlist')
        if(!jmaEqlistEvent) return {}
        if(settingsStore.mainSettings.eqlistsDisplayMode == 1 && !jmaEqlistEvent.isLatest && !jmaEqlistEvent.isActive) return {}
        const warnArea = JSON.parse(jmaEqlistEvent.eqMessage.warnArea)
        warnArea.forEach(point => {
            const { name, intensity } = point
            if(!name) return
            if(!jmaWarnArea[name] || getShindoRank(intensity) > getShindoRank(jmaWarnArea[name].intensity)) {
                jmaWarnArea[name] = point
            }
        })
    }
    return jmaWarnArea
})
const csisList = ref([])
const shindoList = computed(() => {
    const shindoList = {}
    for(let name in jmaWarnArea.value) {
        const intensity = formatShindo(jmaWarnArea.value[name].intensity)
        if(!(intensity in shindoList)) shindoList[intensity] = []
        shindoList[intensity].push(name)
    }
    const newShindoList = []
    const order = ['7', '6+', '6-', '5+', '5-', '4', '3', '2', '1']
    for(let int of order) {
        if(newShindoList.length >= 50) break
        shindoList[int]?.forEach(name => {
            newShindoList.push({
                name,
                intensity: int
            })
        })
    }
    return newShindoList.slice(0, 50)
})
const jpEewInfoList = computed(()=>{
    const jpEewList = activeEewList.filter(event=>!(event.eqMessage.isCanceled || event.eqMessage.isAssumption))
    const jpEewInfoList = jpEewList.map(event=>{
        const { magnitude, depth, lat, lng } = event.eqMessage
        return { magnitude, depth, lat, lng }
    })
    return jpEewInfoList
})
const eewInfoList = computed(()=>{
    const eewList = menuId.value == 'eqlists'
        ? historyList.length > 0
        ? historyList.filter(event => event.hypoMarker && !event.eqMessage.isCanceled)
        : activeEqlistList.value.length > 0
        ? tempEqlists.value.endsWith('Eqlist')
        ? activeEqlistList.value.filter(event=>event.eqMessage.source == tempEqlists.value && event.hypoMarker && !event.eqMessage.isCanceled)
        : activeEqlistList.value.filter(event=>event.hypoMarker && !event.eqMessage.isCanceled)
        : eqlistList.filter(event=>event.hypoMarker && !event.eqMessage.isCanceled)
        : activeEewList.filter(event=>!(event.eqMessage.isCanceled || event.eqMessage.isAssumption))
    const eewInfoList = eewList.map(event=>{
        const { magnitude, depth, lat, lng } = event.eqMessage
        return { magnitude, depth, lat, lng }
    })
    return eewInfoList
})
onBeforeUnmount(()=>{
    isDisposed = true
    clearInterval(mainInterval)
    clearInterval(terminatorInterval)
    clearInterval(autoZoomInterval)
    clearTimeout(terminatorUpdateTimer)
    clearTimeout(mapLoadMessageTimer)
    clearTimeout(mapLoadRetryTimer)
    clearTimeout(autoZoomTimer)
    clearTimeout(defaultMenuTimer)
    clearTimeout(tempEqlistsTimer)
    clearTimeout(largeZoomingTimer)
    mapLoadWatchStops.forEach(stop => stop())
    mapLoadWatchStops.clear()
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    document.removeEventListener('mousemove', resetDefaultMenuTimer)
    document.removeEventListener('keydown', handleKeydown)
    activeEewList.length = 0
    eqlistList.length = 0
})
onUnmounted(() => {
    const mapToRemove = map
    mapToRemove?.remove()
    if(statusStore.map === mapToRemove) statusStore.map = null
    map = null
})
</script>

<style lang="scss" scoped>
.outer{
    width: 100%;
    height: 100%;
    .container{
        width: 100%;
        height: 100%;
        display: grid;
        grid-template-columns: 1fr auto;
        .mapContainer{
            height: 100%;
            position: relative;
            background-color: var(--map-background);
            #mainMap{
                width: 100%;
                height: 100%;
                *{
                    cursor: default;
                }
            }
            .leaflet-container{
                background-color: var(--map-background);
            }
            .leaflet-grab{
                cursor: default;
            }
            .eewList{
                display: flex;
                flex-direction: column;
                position: absolute;
                top: 0;
                left: 0;
                z-index: 500;   // >=400才会显示在地图上方？
                pointer-events: none;
                .event{
                    display: flex;
                }
                .eew{
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    margin: 5px 0 0 5px;
                    border-radius: 12px;
                    overflow: hidden;
                    box-shadow: 0 0 10px 2px #0000003f;
                    user-select: none;
                    .bar{
                        width: 100%;
                        height: 30px;
                        border-bottom: #00000020 1px solid;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        font-size: 18px;
                        font-weight: 700;
                        padding: 0 0.25em;
                        div{
                            display: flex;
                            justify-content: center;
                            align-items: center;
                        }
                    }
                    .shindo-bar{
                        width: 100px;
                        height: 30px;
                        border-bottom: #00000020 1px solid;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        font-size: 18px;
                        font-weight: 700;
                    }
                    .info{
                        height: 100px;
                        display: flex;
                        gap: 10px;
                        align-items: center;
                        background-color: #ffffff9f;
                        backdrop-filter: blur(1px);
                        pointer-events: auto;
                        position: relative;
                        * {
                            z-index: 1;
                        }
                        .background {
                            position: absolute;
                            width: 100%;
                            height: 100%;
                            z-index: 0;
                            opacity: 0.2;
                        }
                        .intensity{
                            width: 100px;
                            height: 100%;
                            display: flex;
                            flex-direction: column;
                            justify-content: center;
                            align-items: center;
                            position: relative;
                            pointer-events: none;
                            .intensity-title{
                                height: 20px;
                                font-size: 16px;
                                line-height: 1;
                                position: absolute;
                                top: 2px;
                                display: flex;
                                justify-content: center;
                                align-items: center;
                            }
                            .shindo,.csis{
                                height: 80px;
                                text-align: center;
                                letter-spacing: -5px;
                                padding-right: 5px;
                                position: absolute;
                                bottom: 8px;
                            }
                            .shindo{
                                font-size: 55px;
                            }
                            .shindo::first-letter{
                                font-size: 80px;
                                vertical-align: top;
                            }
                            .csis{
                                font-size: 80px;
                            }
                        }
                        .right{
                            width: 305px;
                            height: 100%;
                            display: flex;
                            flex-direction: column;
                            justify-content: space-evenly;
                            line-height: 1;
                            vertical-align: middle;
                            padding-top: 4px;
                            .location{
                                width: 100%;
                                font-size: 28px;
                                white-space: nowrap;
                                text-overflow: ellipsis;
                                overflow: hidden;
                            }
                            .time{
                                width: 100%;
                                font-size: 24px;
                                white-space: nowrap;
                                text-overflow: ellipsis;
                                overflow: hidden;
                            }
                            .bottom{
                                width: 100%;
                                display: flex;
                                align-items: center;
                                gap: 15px;
                                overflow: hidden;
                                white-space: nowrap;
                                .magnitude{
                                    font-size: 24px;
                                }
                                .depth{
                                    font-size: 22px;
                                }
                                .type {
                                    margin-left: auto;
                                    margin-right: 4px;
                                    font-size: 16px;
                                    color: #7f7f7f;
                                    align-self: flex-end;
                                }
                            }
                        }
                        .eew-buttons {
                            width: 100%;
                            height: 100%;
                            position: absolute;
                            background-color: #ffffff9f;
                            backdrop-filter: blur(1px);
                            display: flex;
                            justify-content: space-evenly;
                            align-items: center;
                            z-index: 2;
                            .eew-button {
                                width: 88px;
                                height: 36px;
                            }
                        }
                    }
                    .tsunami-info {
                        width: 415px;
                        height: 100px;
                        padding: 1px 0;
                        display: grid;
                        grid-template-columns: 1fr 1fr;
                        column-gap: 50px;
                        align-content: space-evenly;
                        align-items: center;
                        background-color: #ffffff9f;
                        backdrop-filter: blur(1px);
                        * {
                            z-index: 1;
                        }
                        .background {
                            position: absolute;
                            width: 100%;
                            height: 100%;
                            z-index: 0;
                            opacity: 0.2;
                        }
                        .legend {
                            width: 90px;
                            height: 5px;
                            justify-self: end;
                        }
                        .text {
                            justify-self: start;
                            text-align: left;
                            font-size: 18px;
                        }
                        .tsunami-purple {
                            background-color: var(--tsunami-purple);
                        }
                        .tsunami-red {
                            background-color: var(--tsunami-red);
                        }
                        .tsunami-yellow {
                            background-color: var(--tsunami-yellow);
                        }
                    }
                }
                .countdown .shindo-bar{
                    pointer-events: auto;
                }
                .realtime{
                    width: 100px;
                }
            }
            .left-bottom{
                display: flex;
                flex-direction: column;
                position: absolute;
                bottom: 0;
                left: 0;
                z-index: 499;
                font-size: 18px;
                color: #ffffff;
                pointer-events: none;
                user-select: none;
                .legend{
                    width: 90px;
                    font-size: 16px;
                    display: flex;
                    flex-direction: column-reverse;
                    justify-content: flex-start;
                    padding: 5px 0px;
                    border-radius: 10px;
                    overflow: hidden;
                    box-shadow: inset 0 0 10px #ffffff3f, 0 0 10px #0000003f;
                    backdrop-filter: blur(1px);
                    .align-right{
                        text-align: right;
                        padding-right: 2px;
                    }
                    .align-left{
                        text-align: left;
                        padding-left: 2px;
                    }
                    .color{
                        height: 20px;
                    }
                    .single-legend{
                        display: grid;
                        grid-template-columns: 1fr 0.15fr 1fr;
                        justify-content: center;
                        align-items: center;
                        div{
                            line-height: 1em;
                        }
                    }
                    .legend-title{
                        width: 100%;
                        display: flex;
                        justify-content: center;
                        font-size: 18px;
                        margin-bottom: 5px;
                    }
                }
                .ws-status{
                    display: flex;
                    align-items: center;
                    column-gap: 0.5em;
                    margin-top: 0.25rem;
                    .s0{
                        color: yellow;
                    }
                    .s1{
                        color: green;
                    }
                    .incomplete{
                        color: deepskyblue;
                    }
                    .s2,.s3{
                        color: red;
                    }
                    .s4{
                        color: white;
                    }
                }
                .update-time{
                    pointer-events: auto;
                    cursor: default;
                }
                .delayed{
                    color: red;
                }
                .replay{
                    color: yellow;
                }
            }
            .int-list{
                position: absolute;
                right: 1px;
                top: 236px;
                z-index: 599;
                display: flex;
                flex-direction: column;
                justify-content: center;
                gap: 10px;
                height: calc(100% - 280px);
                user-select: none;
                pointer-events: none;
                .csis-list,.shindo-list{
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                    overflow: hidden;
                    padding: 5px;
                    border-radius: 10px;
                    box-shadow: inset 0 0 10px #ffffff3f, 0 0 10px #0000003f;
                    backdrop-filter: blur(1px);
                    .row{
                        display: flex;
                        justify-content: space-between;
                        gap: 3px;
                        align-items: center;
                        .name{
                            color: #ffffff;
                            width: 120px;
                            white-space: nowrap;
                            overflow: hidden;
                            text-overflow: ellipsis;
                            line-height: 1em;
                        }
                        .int{
                            width: 22px;
                            height: 22px;
                            border-radius: 5px;
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            pointer-events: none;
                            user-select: none;
                            .csis {
                                font-size: 16px;
                            }
                            .shindo {
                                font-size: 11px;
                                letter-spacing: -1px;
                                padding-right: 1px;
                            }
                            .shindo::first-letter {
                                font-size: 16px;
                                vertical-align: top;
                            }
                        }
                    }
                }
            }
            .bottom-right{
                position: absolute;
                right: 1px;
                bottom: 1px;
                z-index: 600;
                display: flex;
                align-items: center;
                gap: 0.25rem;
                .mocking{
                    font-size: 24px;
                    color: yellow;
                }
                .mock-1{
                    opacity: 1;
                }
                .mock-0{
                    opacity: 0;
                }
                .home{
                    border-radius: 8px;
                    overflow: hidden;
                    width: 32px;
                    height: 32px;
                    padding: 0;
                }
            }
            .menu{
                position: absolute;
                right: 1px;
                top: 1px;
                z-index: 600;
                border-radius: 10px 0 0 10px;
                overflow: hidden;
                background-color: #ffffff9f;
                backdrop-filter: blur(4px);
            }
        }
        .drawer{
            height: 100%;
            width: 400px;
            overflow: auto;
            z-index: 600;
            background-color: #fff;
        }
        
        .dialog-fade-enter-active {
            transition: all 0.5s ease-out;
        }
        .dialog-fade-leave-active {
            transition: all 0.75s ease-out;
        }

        .dialog-fade-enter-from,
        .dialog-fade-leave-to {
            opacity: 0;
            transform: scale(0.7);
        }

        .dialog-fade-enter-to,
        .dialog-fade-leave-from {
            opacity: 1;
            transform: scale(1);
        }

        .statusContainer {
            z-index: 10000;
            position: fixed;
            width: 100%;
            height: 100%;
            display: flex;
            justify-content: center;
            align-items: center;
        }
        .roman.scale-9{
            transform: scaleX(0.9);
        }
        .roman.scale-75{
            transform: scaleX(0.75);
        }
    }
}
</style>
