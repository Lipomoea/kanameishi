<template>
    <div class="outer1">
        <div class="container">
            <div class="title">设置</div>
            <div class="settings">
                <span class="sub-title">预警/信息数据源</span>
                <div class="group data-source-actions">
                    <el-button type="primary" plain @click="showDataSourceManager = true">
                        <el-icon><Setting /></el-icon>
                        <span>数据源管理</span>
                    </el-button>
                    <el-button type="primary" plain @click="showApiKeyManager = true">
                        <el-icon><Key /></el-icon>
                        <span>管理 API Key</span>
                    </el-button>
                </div>
                <span class="sub-title">地震监测网</span>
                <div class="group">
                    <span class="font-bold w-full">数据源</span>
                    <div class="switch-group">
                        <div class="w-full" v-if="isTauri">
                            <div class="switch-full">
                                <span>P-Alert・中央气象署震度（台湾）</span>
                                <el-switch v-model="settingsStore.mainSettings.displaySeisNet.palertNet" />
                            </div>
                            <div class="switch-full pl-4">
                                <span>显示震度阶</span>
                                <el-switch v-model="settingsStore.mainSettings.displaySeisNet.displayPalertShindo" :disabled="!settingsStore.mainSettings.displaySeisNet.palertNet" />
                            </div>
                            <div class="switch-full pl-4">
                                <span>
                                    检知灵敏度
                                    <el-popover
                                        placement="top"
                                        :width="300"
                                        trigger="hover"
                                    >
                                        <template #reference>
                                            <question-filled width="1em" height="1em" />
                                        </template>
                                        <p>越高灵敏度，越容易检测到地震，但越容易误检测。</p>
                                    </el-popover>
                                </span>
                                <el-select
                                    v-model="settingsStore.mainSettings.displaySeisNet.palertSensitivity"
                                    size="small"
                                    :disabled="!settingsStore.mainSettings.displaySeisNet.palertNet"
                                    style="width: 72px;"
                                >
                                    <el-option label="关闭" :value="0" />
                                    <el-option label="标准" :value="1" />
                                    <el-option label="高" :value="2" />
                                    <el-option label="极高" :value="3" />
                                </el-select>
                            </div>
                            <div class="switch-full pl-4">
                                <span>震度显示保持</span>
                                <el-select
                                    v-model="settingsStore.mainSettings.displaySeisNet.palertLevelHold"
                                    size="small"
                                    :disabled="!settingsStore.mainSettings.displaySeisNet.palertNet"
                                    style="width: 72px;"
                                >
                                    <el-option label="实时" :value="1" />
                                    <el-option label="5秒" :value="5" />
                                    <el-option label="10秒" :value="10" />
                                    <el-option label="30秒" :value="30" />
                                    <el-option label="60秒" :value="60" />
                                </el-select>
                            </div>
                            <div class="switch-full pl-4">
                                <span>
                                    本地推算震源
                                    <el-popover
                                        placement="top"
                                        :width="310"
                                        trigger="hover"
                                    >
                                        <template #reference>
                                            <question-filled width="1em" height="1em" />
                                        </template>
                                        <p>启用后，会在软件内部通过测站信息自行推算可能的震源。</p>
                                        <strong>
                                            <p>实验性功能，精度低，不代表任何权威信息来源，仅供参考。</p>
                                            <p>此功能会消耗较多计算机资源。</p>
                                        </strong>
                                    </el-popover>
                                </span>
                                <el-switch v-model="settingsStore.mainSettings.displaySeisNet.palertHypoInf" :disabled="!settingsStore.mainSettings.displaySeisNet.palertNet" />
                            </div>
                            <div class="switch-full pl-8">
                                <span>不自动隐藏推算震源</span>
                                <el-switch v-model="settingsStore.mainSettings.displaySeisNet.palertHypoInfAlwaysOn" :disabled="!settingsStore.mainSettings.displaySeisNet.palertNet || !settingsStore.mainSettings.displaySeisNet.palertHypoInf" />
                            </div>
                            <div class="switch-full pl-8">
                                <span>震源推算文字信息</span>
                                <el-select
                                    v-model="settingsStore.mainSettings.displaySeisNet.palertHypoInfTextInfo"
                                    size="small"
                                    :disabled="!settingsStore.mainSettings.displaySeisNet.palertNet || !settingsStore.mainSettings.displaySeisNet.palertHypoInf"
                                    style="width: 72px;"
                                >
                                    <el-option label="关闭" :value="0" />
                                    <el-option label="打开" :value="1" />
                                    <el-option label="详细" :value="2" v-show="accessStore.canUse('advancedHypoInf')" />
                                </el-select>
                            </div>
                        </div>
                        <div class="w-full" v-if="accessStore.canUse('tremFunctions')">
                            <div class="switch-full">
                                <span>TREM-Net・中央气象署震度（台湾）</span>
                                <el-switch v-model="settingsStore.mainSettings.displaySeisNet.tremNet" />
                            </div>
                            <div class="switch-full pl-4">
                                <span>显示震度阶</span>
                                <el-switch v-model="settingsStore.mainSettings.displaySeisNet.displayTremShindo" :disabled="!settingsStore.mainSettings.displaySeisNet.tremNet" />
                            </div>
                            <div class="switch-full pl-4">
                                <span>API</span>
                                <el-select
                                    v-model="settingsStore.mainSettings.displaySeisNet.tremApi"
                                    size="small"
                                    :disabled="!settingsStore.mainSettings.displaySeisNet.tremNet"
                                    style="width: 72px;"
                                >
                                    <el-option label="api-1" value="api-1" />
                                    <el-option label="api-2" value="api-2" />
                                    <el-option label="lb-1" value="lb-1" />
                                    <el-option label="lb-2" value="lb-2" />
                                    <el-option label="lb-3" value="lb-3" />
                                    <el-option label="lb-4" value="lb-4" />
                                </el-select>
                            </div>
                        </div>
                        <div class="w-full">
                            <div class="switch-full">
                                <span>強震モニタ・日本气象厅震度（日本）</span>
                                <el-switch v-model="settingsStore.mainSettings.displaySeisNet.niedNet" :disabled="statusStore.isNiedUpdating" />
                            </div>
                            <div class="switch-full pl-4">
                                <span>显示震度阶</span>
                                <el-switch v-model="settingsStore.mainSettings.displaySeisNet.displayNiedShindo" :disabled="!settingsStore.mainSettings.displaySeisNet.niedNet" />
                            </div>
                            <div class="switch-full pl-4">
                                <span>
                                    检知灵敏度
                                    <el-popover
                                        placement="top"
                                        :width="300"
                                        trigger="hover"
                                    >
                                        <template #reference>
                                            <question-filled width="1em" height="1em" />
                                        </template>
                                        <p>越高灵敏度，越容易检测到地震，但越容易误检测。</p>
                                    </el-popover>
                                </span>
                                <el-select 
                                    v-model="settingsStore.mainSettings.displaySeisNet.niedSensitivity"
                                    size="small"
                                    :disabled="!settingsStore.mainSettings.displaySeisNet.niedNet"
                                    style="width: 72px;"
                                >
                                    <el-option label="关闭" :value=0 />
                                    <el-option label="标准" :value=1 />
                                    <el-option label="高" :value=2 />
                                    <el-option label="极高" :value=3 />
                                </el-select>
                            </div>
                            <div class="switch-full pl-4">
                                <span>
                                    本地推算震源
                                    <el-popover
                                        placement="top"
                                        :width="310"
                                        trigger="hover"
                                    >
                                        <template #reference>
                                            <question-filled width="1em" height="1em" />
                                        </template>
                                        <p>启用后，会在软件内部通过测站信息自行推算可能的震源。</p>
                                        <strong>
                                            <p>实验性功能，精度低，不代表任何权威信息来源，仅供参考。</p>
                                            <p>启用更高检测灵敏度能够略微提升推算精度。</p>
                                            <p>此功能会消耗较多计算机资源。</p>
                                        </strong>
                                    </el-popover>
                                </span>
                                <el-switch v-model="settingsStore.mainSettings.displaySeisNet.niedHypoInf" :disabled="!settingsStore.mainSettings.displaySeisNet.niedNet" />
                            </div>
                            <div class="switch-full pl-8">
                                <span>不自动隐藏推算震源</span>
                                <el-switch v-model="settingsStore.mainSettings.displaySeisNet.niedHypoInfAlwaysOn" :disabled="!settingsStore.mainSettings.displaySeisNet.niedNet || !settingsStore.mainSettings.displaySeisNet.niedHypoInf" />
                            </div>
                            <div class="switch-full pl-8">
                                <span>震源推算文字信息</span>
                                <el-select 
                                    v-model="settingsStore.mainSettings.displaySeisNet.niedHypoInfTextInfo"
                                    size="small"
                                    :disabled="!settingsStore.mainSettings.displaySeisNet.niedNet || !settingsStore.mainSettings.displaySeisNet.niedHypoInf"
                                    style="width: 72px;"
                                >
                                    <el-option label="关闭" :value="0" />
                                    <el-option label="打开" :value="1" />
                                    <el-option label="详细" :value="2" v-show="accessStore.canUse('advancedHypoInf')" />
                                </el-select>
                            </div>
                        </div>
                        <div class="w-full">
                            <div class="switch-full">
                                <span>KMA-PEWS・修正麦加利烈度（韩国）</span>
                                <el-switch v-model="settingsStore.mainSettings.displaySeisNet.kmaNet" />
                            </div>
                            <div class="switch-full pl-4">
                                <span>显示烈度阶</span>
                                <el-switch v-model="settingsStore.mainSettings.displaySeisNet.displayKmaInt" :disabled="!settingsStore.mainSettings.displaySeisNet.kmaNet" />
                            </div>
                            <div class="switch-full pl-4">
                                <span>
                                    检知灵敏度
                                    <el-popover
                                        placement="top"
                                        :width="300"
                                        trigger="hover"
                                    >
                                        <template #reference>
                                            <question-filled width="1em" height="1em" />
                                        </template>
                                        <p>越高灵敏度，越容易检测到地震，但越容易误检测。</p>
                                    </el-popover>
                                </span>
                                <el-select 
                                    v-model="settingsStore.mainSettings.displaySeisNet.kmaSensitivity"
                                    size="small"
                                    :disabled="!settingsStore.mainSettings.displaySeisNet.kmaNet"
                                    style="width: 72px;"
                                >
                                    <el-option label="关闭" :value=0 />
                                    <el-option label="标准" :value=1 />
                                    <el-option label="高" :value=2 />
                                    <el-option label="极高" :value=3 />
                                </el-select>
                            </div>
                            <div class="switch-full pl-4">
                                <span>烈度显示保持</span>
                                <el-select 
                                    v-model="settingsStore.mainSettings.displaySeisNet.kmaIntHold"
                                    size="small"
                                    :disabled="!settingsStore.mainSettings.displaySeisNet.kmaNet"
                                    style="width: 72px;"
                                >
                                    <el-option label="实时" :value="1" />
                                    <el-option label="5秒" :value="5" />
                                    <el-option label="10秒" :value="10" />
                                    <el-option label="30秒" :value="30" />
                                    <el-option label="60秒" :value="60" />
                                </el-select>
                            </div>
                        </div>
                    </div>
                    <div class="font-bold w-full">通用设置</div>
                    <div class="switch-group">
                        <div class="w-full">
                            <div class="switch-full">
                                <span>测站数据更新偏好
                                    <el-popover placement="right" :width="300" trigger="hover">
                                        <template #reference><el-icon><QuestionFilled /></el-icon></template>
                                        <p><strong>实时性优先：</strong>测站数据将尽可能保持最新，但是会增加过往数据丢失的风险。可能影响测站检出、震源推理准确度。</p>
                                        <p><strong>完整性优先：</strong>请求不稳定时，新的测站数据会短暂等待较早的数据以保持数据序列完整。测站数据可能短暂延迟。</p>
                                    </el-popover>
                                </span>
                                <el-select v-model="settingsStore.mainSettings.displaySeisNet.httpDataPriority" size="small" style="width: 108px;">
                                    <el-option label="实时性优先" value="realtime" />
                                    <el-option label="完整性优先" value="complete" />
                                </el-select>
                            </div>
                        </div>
                        <div class="w-full">
                            <div class="switch-full">
                                <span>测站回放(min)</span>
                                <div class="flex gap-2">
                                    <el-input-number
                                        v-model="statusStore.seisNetReplayDelay"
                                        size="small"
                                        :min="0"
                                        style="width: 108px;"
                                    />
                                    <el-button
                                        size="small"
                                        @click="statusStore.seisNetReplayDelay = 0"
                                        :disabled="statusStore.seisNetReplayDelay == 0"
                                    >还原</el-button>
                                </div>
                            </div>
                            <div class="switch-full pl-4">
                                <span>选择时间回放</span>
                                <div class="flex gap-2">
                                    <el-date-picker
                                        v-model="replayDateTime"
                                        type="datetime"
                                        size="small"
                                        style="width: 156px;"
                                        :placeholder="`选择日期时间(UTC${formatTimeZone(systemTimeZone)})`"
                                        format="YYYY-MM-DD HH:mm:ss"
                                        value-format="YYYY-MM-DD HH:mm:ss"
                                    />
                                    <el-button
                                        size="small"
                                        @click="setReplayDateTime"
                                        :disabled="!replayDateTime"
                                    >回放</el-button>
                                </div>
                            </div>
                        </div>
                        <div class="w-full">
                            <div class="switch-full">
                                <span>测站风格</span>
                                <el-select
                                    style="width: 72px;"
                                    v-model="settingsStore.mainSettings.displaySeisNet.style"
                                    size="small"
                                >
                                    <el-option label="NIED" value="nied" />
                                    <el-option label="SREV" value="srev" />
                                    <el-option label="混合" value="mix" />
                                </el-select>
                            </div>
                            <div class="switch-full pl-4" v-show="settingsStore.mainSettings.displaySeisNet.style == 'nied'">
                                <span>隐藏无数据测站</span>
                                <el-switch v-model="settingsStore.mainSettings.displaySeisNet.hideNoData" />
                            </div>
                            <div class="switch-full">
                                <span>显示震度0/烈度1图标</span>
                                <el-switch v-model="settingsStore.mainSettings.displaySeisNet.displayShindo0" />
                            </div>
                            <div class="switch-full">
                                <span>不自动隐藏摇晃检知框</span>
                                <el-switch v-model="settingsStore.mainSettings.displaySeisNet.alwaysDisplayGrid" />
                            </div>
                            <div class="switch-full">
                                <span>显示最大实时烈度/震度</span>
                                <el-switch v-model="settingsStore.mainSettings.displaySeisNet.displayMaxInt" />
                            </div>
                            <div class="switch-full">
                                <span>显示最大区间烈度/震度</span>
                                <el-switch v-model="settingsStore.mainSettings.displaySeisNet.displayPeriodMaxInt" />
                            </div>
                        </div>
                    </div>
                </div>
                <span class="sub-title">行为</span>
                <div class="group">
                    <div class="switch-group">
                        <div class="switch-full">
                            <span>
                                游戏模式
                                <el-popover
                                    placement="top"
                                    :width="280"
                                    trigger="hover"
                                >
                                    <template #reference>
                                        <question-filled width="1em" height="1em" />
                                    </template>
                                    <p>游戏模式下将不会发送通知和弹出窗口。</p>
                                    <p v-if="isTauri">可在托盘图标菜单快速切换。</p>
                                </el-popover>
                            </span>
                            <el-switch v-model="settingsStore.mainSettings.gameMode" />
                        </div>
                    </div>
                    <span class="font-bold w-full">
                        过滤设置
                        <el-popover
                            placement="top"
                            :width="200"
                            trigger="hover"
                        >
                            <template #reference>
                                <question-filled width="1em" height="1em" />
                            </template>
                            <p><strong>以下所有条件关系为“与”。</strong></p>
                            <p><strong>从下一个事件开始生效。</strong></p>
                        </el-popover>
                    </span>
                    <div class="switch-group">
                        <div class="switch-full">
                            <div class="justify-between" style="width: 10rem;">
                                <span>
                                    震级阈值
                                    <el-popover
                                        placement="top"
                                        :width="310"
                                        trigger="hover"
                                    >
                                        <template #reference>
                                            <question-filled width="1em" height="1em" />
                                        </template>
                                        <p>地震预警事件中，仅在预估震级达到阈值时进行提醒。</p>
                                        <p>设置为“0”表示不作筛选。</p>
                                    </el-popover>
                                </span>
                                <div class="mag" :class="setClassName(calcCsisLevel(settingsStore.mainSettings.actionMag, 10, 0), false)">
                                    {{ settingsStore.mainSettings.actionMag.toFixed(1) }}
                                </div>
                            </div>
                            <el-slider
                                v-model="settingsStore.mainSettings.actionMag"
                                :min="0" :max="9"
                                :step="0.1"
                                size="small"
                            />
                        </div>
                        <div class="switch-full" v-if="!settingsStore.nearestJmaLoc">
                            <div class="justify-between" style="width: 10rem;">
                                <span>
                                    本地烈度阈值
                                    <el-popover
                                        placement="top"
                                        :width="310"
                                        trigger="hover"
                                    >
                                        <template #reference>
                                            <question-filled width="1em" height="1em" />
                                        </template>
                                        <p><strong>需要启用“强制估算烈度/震度（低精度）”。</strong></p>
                                        <p>地震预警事件中，仅在预估本地烈度达到阈值时进行提醒。</p>
                                        <p>对日本以外地区生效。</p>
                                        <p>设置为“0”表示不作筛选。</p>
                                        <p>参考：</p>
                                        <p> - 1度及以下：低层基本无感，高层轻微有感。</p>
                                        <p> - 2~3度：低层轻微有感，高层轻微或显著有感；悬挂物轻微晃动。</p>
                                        <p> - 4~5度：所有人群静止时有感，睡眠中的一部分人被摇醒；悬挂物显著晃动。</p>
                                        <p> - 6~7度：令人感到恐惧，睡眠中的大部分人被摇醒；部分物件倾倒；抗震性差的房屋可能出现破坏。</p>
                                        <p> - 8~9度：行走困难；家具倾倒；抗震性差的房屋可能倒塌，抗震性好的房屋可能损坏。</p>
                                        <p> - 10度及以上：难以站立，有抛起感；房屋大规模倒塌；山河易形。</p>
                                    </el-popover>
                                </span>
                                <div class="int" :class="setClassName(settingsStore.mainSettings.actionLocalCsis, false)">
                                    <div class="csis" :class="{
                                        'roman': settingsStore.mainSettings.useRomanCsis,
                                        'scale-9': settingsStore.mainSettings.actionLocalCsis == 8
                                    }">{{ formatCsis(settingsStore.mainSettings.actionLocalCsis.toString()) }}</div>
                                </div>
                            </div>
                            <el-slider
                                v-model="settingsStore.mainSettings.actionLocalCsis"
                                :disabled="!settingsStore.advancedSettings.forceCalcInt"
                                :min="0" :max="12"
                                :step="1"
                                size="small"
                                show-stops
                            />
                        </div>
                        <div class="switch-full" v-else>
                            <div class="justify-between" style="width: 10rem;">
                                <span>
                                    本地震度阈值
                                    <el-popover
                                        placement="top"
                                        :width="310"
                                        trigger="hover"
                                    >
                                        <template #reference>
                                            <question-filled width="1em" height="1em" />
                                        </template>
                                        <p><strong>需要启用“强制估算烈度/震度（低精度）”。</strong></p>
                                        <p>地震预警事件中，仅在预估本地震度达到阈值时进行提醒。</p>
                                        <p>对附近包含震度观测点的日本地区生效。</p>
                                        <p>设置为“0”表示不作筛选。</p>
                                        <p>参考：</p>
                                        <p> - 震度0：基本无感。</p>
                                        <p> - 震度1：少数人群静止时有感。</p>
                                        <p> - 震度2：大部分人群静止时有感；悬挂物轻微晃动。</p>
                                        <p> - 震度3：所有人静止时有感；睡眠中的一部分人被摇醒；悬挂物显著晃动。</p>
                                        <p> - 震度4：令人感到恐惧，睡眠中的大部分人被摇醒；部分物件倾倒。</p>
                                        <p> - 震度5弱~5强：行走出现障碍；部分家具倾倒。</p>
                                        <p> - 震度6弱~6强：行走困难；家具大规模倾倒；抗震性差的房屋出现损坏甚至倒塌。</p>
                                        <p> - 震度7：难以站立，有抛起感；房屋大规模倒塌；山河易形。</p>
                                    </el-popover>
                                </span>
                                <div class="int" :class="setClassName(shindoScale[settingsStore.mainSettings.actionLocalShindo], true)">
                                    <div class="shindo">{{ shindoScale[settingsStore.mainSettings.actionLocalShindo] }}</div>
                                </div>
                            </div>
                            <el-slider
                                v-model="settingsStore.mainSettings.actionLocalShindo"
                                :disabled="!settingsStore.advancedSettings.forceCalcInt"
                                :min="0" :max="9"
                                :step="1"
                                size="small"
                                show-stops
                                :format-tooltip="(value) => shindoScale[value]"
                            />
                        </div>
                        <div class="switch-full pl-4">
                            <div class="justify-between" style="width: 9rem;">
                                <el-checkbox 
                                    v-model="settingsStore.mainSettings.playIntenseSound" 
                                    :disabled="!settingsStore.advancedSettings.forceCalcInt"
                                >强有感提示音</el-checkbox>
                                <div v-if="!settingsStore.nearestJmaLoc" class="int" :class="setClassName(settingsStore.mainSettings.intenseLocalCsis, false)">
                                    <div class="csis" :class="{
                                        'roman': settingsStore.mainSettings.useRomanCsis,
                                        'scale-9': settingsStore.mainSettings.intenseLocalCsis == 8
                                    }">{{ formatCsis(settingsStore.mainSettings.intenseLocalCsis.toString()) }}</div>
                                </div>
                                <div v-else class="int" :class="setClassName(shindoScale[settingsStore.mainSettings.intenseLocalShindo], true)">
                                    <div class="shindo">{{ shindoScale[settingsStore.mainSettings.intenseLocalShindo] }}</div>
                                </div>
                            </div>
                            <el-slider
                                v-if="!settingsStore.nearestJmaLoc"
                                v-model="settingsStore.mainSettings.intenseLocalCsis"
                                :disabled="!settingsStore.advancedSettings.forceCalcInt || !settingsStore.mainSettings.playIntenseSound"
                                :min="0" :max="12"
                                :step="1"
                                size="small"
                                show-stops
                            />
                            <el-slider
                                v-else
                                v-model="settingsStore.mainSettings.intenseLocalShindo"
                                :disabled="!settingsStore.advancedSettings.forceCalcInt || !settingsStore.mainSettings.playIntenseSound"
                                :min="0" :max="9"
                                :step="1"
                                size="small"
                                show-stops
                                :format-tooltip="(value) => shindoScale[value]"
                            />
                        </div>
                        <div class="switch-full" v-if="accessStore.canUse('gqEew')">
                            <div class="justify-between" style="width: 10rem;">
                                <span>GQ预警震级阈值</span>
                                <div class="mag" :class="setClassName(calcCsisLevel(settingsStore.mainSettings.gqActionMag, 10, 0), false)">
                                    {{ settingsStore.mainSettings.gqActionMag.toFixed(1) }}
                                </div>
                            </div>
                            <el-slider
                                v-model="settingsStore.mainSettings.gqActionMag"
                                :min="0" :max="9"
                                :step="0.1"
                                size="small"
                            />
                        </div>
                        <div class="switch-full">
                            <div class="justify-between" style="width: 10rem;">
                                <span>USGS震级阈值</span>
                                <div class="mag" :class="setClassName(calcCsisLevel(settingsStore.mainSettings.usgsActionMag, 10, 0), false)">
                                    {{ settingsStore.mainSettings.usgsActionMag.toFixed(1) }}
                                </div>
                            </div>
                            <el-slider
                                v-model="settingsStore.mainSettings.usgsActionMag"
                                :min="0" :max="9"
                                :step="0.1"
                                size="small"
                            />
                        </div>
                        <div class="switch-full">
                            <span>FSSN事件接收类型</span>
                            <el-select
                                style="width: 120px;"
                                v-model="settingsStore.mainSettings.fssnActionType"
                                size="small"
                            >
                                <el-option label="自动和正式测定" :value=0 />
                                <el-option label="仅正式测定" :value=1 />
                            </el-select>
                        </div>
                        <div class="switch-full">
                            <div class="justify-between" style="width: 10rem;">
                                <span>FSSN震级阈值</span>
                                <div class="mag" :class="setClassName(calcCsisLevel(settingsStore.mainSettings.fssnActionMag, 10, 0), false)">
                                    {{ settingsStore.mainSettings.fssnActionMag.toFixed(1) }}
                                </div>
                            </div>
                            <el-slider
                                v-model="settingsStore.mainSettings.fssnActionMag"
                                :min="0" :max="9"
                                :step="0.1"
                                size="small"
                            />
                        </div>
                        <div class="switch-full">
                            <span>
                                地名白名单
                                <el-popover
                                    placement="top"
                                    :width="310"
                                    trigger="hover"
                                >
                                    <template #reference>
                                        <question-filled width="1em" height="1em" />
                                    </template>
                                    <p>地名包含关键词的事件，始终通过过滤。</p>
                                    <p>使用“|”对多个关键词进行分隔。</p>
                                </el-popover>
                            </span>
                            <el-input 
                                class="text-right"
                                v-model="settingsStore.mainSettings.actionWhiteList"
                                style="width: 180px;"
                                size="small"
                                placeholder="使用“|”对多个关键词进行分隔"
                            />
                        </div>
                    </div>
                    <span class="font-bold w-full">收到地震预警（警报）时</span>
                    <div class="switch-group justify-between">
                        <div class="switch" v-if="showNotifButton">
                            <span>发送通知</span>
                            <el-switch v-model="settingsStore.mainSettings.onEewWarn.notification" :disabled="settingsStore.mainSettings.onEew.notification" />
                        </div>
                        <div class="switch">
                            <span>播放声音</span>
                            <el-switch v-model="settingsStore.mainSettings.onEewWarn.sound" :disabled="settingsStore.mainSettings.onEew.sound" />
                        </div>
                        <div class="switch" v-if="isTauri">
                            <span>弹出窗口</span>
                            <el-switch v-model="settingsStore.mainSettings.onEewWarn.focus" :disabled="settingsStore.mainSettings.onEew.focus" />
                        </div>
                    </div>
                    <span class="font-bold w-full">收到任意地震预警时</span>
                    <div class="switch-group justify-between">
                        <div class="switch" v-if="showNotifButton">
                            <span>发送通知</span>
                            <el-switch v-model="settingsStore.mainSettings.onEew.notification" />
                        </div>
                        <div class="switch">
                            <span>播放声音</span>
                            <el-switch v-model="settingsStore.mainSettings.onEew.sound" />
                        </div>
                        <div class="switch" v-if="isTauri">
                            <span>弹出窗口</span>
                            <el-switch v-model="settingsStore.mainSettings.onEew.focus" />
                        </div>
                    </div>
                    <span class="font-bold w-full">收到地震信息时</span>
                    <div class="switch-group justify-between">
                        <div class="switch" v-if="showNotifButton">
                            <span>发送通知</span>
                            <el-switch v-model="settingsStore.mainSettings.onReport.notification" />
                        </div>
                        <div class="switch">
                            <span>播放声音</span>
                            <el-switch v-model="settingsStore.mainSettings.onReport.sound" />
                        </div>
                        <div class="switch" v-if="isTauri">
                            <span>弹出窗口</span>
                            <el-switch v-model="settingsStore.mainSettings.onReport.focus" />
                        </div>
                    </div>
                    <span class="font-bold w-full">地震监测网检测到摇晃时</span>
                    <div class="switch-group justify-between">
                        <div class="switch" v-if="showNotifButton">
                            <span>发送通知</span>
                            <el-switch v-model="settingsStore.mainSettings.onShake.notification" />
                        </div>
                        <div class="switch">
                            <span>播放声音</span>
                            <el-switch v-model="settingsStore.mainSettings.onShake.sound" />
                        </div>
                        <div class="switch" v-if="isTauri">
                            <span>弹出窗口</span>
                            <el-switch v-model="settingsStore.mainSettings.onShake.focus" />
                        </div>
                    </div>
                    <span class="font-bold w-full">收到海啸信息时</span>
                    <div class="switch-group justify-between">
                        <div class="switch" v-if="showNotifButton">
                            <span>发送通知</span>
                            <el-switch v-model="settingsStore.mainSettings.onTsunami.notification" />
                        </div>
                        <div class="switch">
                            <span>播放声音</span>
                            <el-switch v-model="settingsStore.mainSettings.onTsunami.sound" />
                        </div>
                        <div class="switch" v-if="isTauri">
                            <span>弹出窗口</span>
                            <el-switch v-model="settingsStore.mainSettings.onTsunami.focus" />
                        </div>
                    </div>
                </div>
                <span class="sub-title">音效</span>
                <div class="group">
                    <div class="switch-group">
                        <div class="switch-full">
                            <span style="width: 7rem;">主音量：{{ settingsStore.mainSettings.masterVolume }}%</span>
                            <el-slider
                                v-model="settingsStore.mainSettings.masterVolume"
                                :min="0" :max="100"
                                :step="5"
                                size="small"
                            />
                        </div>
                        <div class="switch-full">
                            <span>关闭默认通知音</span>
                            <el-switch v-model="settingsStore.mainSettings.muteNotification" />
                        </div>
                        <div class="switch-full">
                            <span>选择音效</span>
                            <el-select 
                                v-model="settingsStore.mainSettings.soundEffect"
                                size="small"
                                style="width: 72px;"
                            >
                                <el-option label="SREV" value="srev" />
                            </el-select>
                        </div>
                        <div class="switch-full">
                            <span>{{ isTauri ? '自定义音效' : '试听音效' }}</span>
                            <el-button size="small" @click="customizeAudio = true">{{ isTauri ? '自定义' : '试听' }}</el-button>
                        </div>
                    </div>
                </div>
                <span class="sub-title">显示</span>
                <div class="group">
                    <span class="font-bold w-full">
                        所在地设置
                        <el-popover
                            placement="top"
                            :width="300"
                            trigger="hover"
                        >
                            <template #reference>
                                <question-filled width="1em" height="1em" />
                            </template>
                            <strong>
                                <p>设置为(0,0)表示不生效。</p>
                                <p>地震预警事件中更新位置不会立即生效。</p>
                            </strong>
                        </el-popover>
                    </span>
                    <div class="switch-group">
                        <div class="switch-full">
                            <span>纬度</span>
                            <el-input-number
                                class="lat-lng"
                                v-model="settingsStore.mainSettings.userLatLng[0]"
                                size="small"
                                :step="0.1"
                                :min="-90"
                                :max="90"
                                @change="val => setLat('userLatLng')(val)"
                            />
                        </div>
                        <div class="switch-full">
                            <span>经度</span>
                            <el-input-number
                                class="lat-lng"
                                v-model="settingsStore.mainSettings.userLatLng[1]"
                                size="small"
                                :step="0.1"
                                :min="-180"
                                :max="180"
                                @change="val => setLng('userLatLng')(val)"
                            />
                        </div>
                        <div class="switch-full">
                            <span>使用IP地址定位</span>
                            <el-button
                                size="small"
                                @click="autoLocate"
                            >自动定位</el-button>
                        </div>
                        <div class="switch-full">
                            <span>清除所在地经纬度</span>
                            <el-button
                                size="small"
                                @click="clearUserLatLng"
                            >清除</el-button>
                        </div>
                        <div class="switch-full">
                            <span>显示所在地</span>
                            <el-switch v-model="settingsStore.mainSettings.displayUser" />
                        </div>
                    </div>
                    <span class="font-bold w-full">主震动倒计时</span>
                    <div class="switch-group">
                        <div class="w-full">
                            <div class="switch-full">
                                <span>显示本地预估烈度和横波抵达倒计时</span>
                                <el-switch v-model="settingsStore.mainSettings.displayCountdown" />
                            </div>
                            <div class="switch-full pl-4">
                                <span>强制计算倒计时（即使低精度）</span>
                                <el-switch v-model="settingsStore.mainSettings.forceDisplayCountdown" :disabled="!settingsStore.mainSettings.displayCountdown" />
                            </div>
                            <div class="switch-full pl-4">
                                <span>播放倒计时音效</span>
                                <el-switch v-model="settingsStore.mainSettings.playCountdownSound" :disabled="!settingsStore.mainSettings.displayCountdown" />
                            </div>
                            <div class="switch-full pl-8">
                                <span>仅强有感时播放音效</span>
                                <el-switch v-model="settingsStore.mainSettings.countdownOnlyIntense" :disabled="!(settingsStore.mainSettings.displayCountdown && settingsStore.mainSettings.playCountdownSound && settingsStore.advancedSettings.forceCalcInt && settingsStore.mainSettings.playIntenseSound)" />
                            </div>
                            <div class="switch-full pl-8">
                                <span>中文播报倒计时</span>
                                <el-switch v-model="settingsStore.mainSettings.countdownSpeech" :disabled="!(settingsStore.mainSettings.displayCountdown && settingsStore.mainSettings.playCountdownSound)" />
                            </div>
                            <div class="switch-full pl-8">
                                <span style="width: 10rem;">剩余{{ settingsStore.mainSettings.countdownStart }}秒时开始播放</span>
                                <el-slider
                                    v-model="settingsStore.mainSettings.countdownStart"
                                    :disabled="!(settingsStore.mainSettings.displayCountdown && settingsStore.mainSettings.playCountdownSound)"
                                    :min="5" :max="60"
                                    :step="5"
                                    size="small"
                                    show-stops
                                />
                            </div>
                        </div>
                    </div>
                    <span class="font-bold w-full">
                        默认视野设置
                        <el-popover
                            placement="top"
                            :width="300"
                            trigger="hover"
                        >
                            <template #reference>
                                <question-filled width="1em" height="1em" />
                            </template>
                            <strong>
                                <p>设置无可聚焦事件时地图的视野范围。</p>
                                <p>设置为(0,0)表示不生效。</p>
                                <p>若不设置默认使用所在地经纬度。</p>
                            </strong>
                        </el-popover>
                    </span>
                    <div class="switch-group">
                        <div class="switch-full">
                            <span>纬度</span>
                            <el-input-number
                                class="lat-lng"
                                v-model="settingsStore.mainSettings.viewLatLng[0]"
                                size="small"
                                :step="0.1"
                                :min="-90"
                                :max="90"
                                @change="val => setLat('viewLatLng')(val)"
                            />
                        </div>
                        <div class="switch-full">
                            <span>经度</span>
                            <el-input-number
                                class="lat-lng"
                                v-model="settingsStore.mainSettings.viewLatLng[1]"
                                size="small"
                                :step="0.1"
                                :min="-180"
                                :max="180"
                                @change="val => setLng('viewLatLng')(val)"
                            />
                        </div>
                        <div class="switch-full">
                            <span>缩放</span>
                            <el-input-number
                                v-model="settingsStore.mainSettings.defaultZoom"
                                size="small"
                                :min="2"
                                :max="12"
                                :precision="0"
                                style="width: 84px;"
                            />
                        </div>
                        <div class="switch-full">
                            <span>设置为当前地图视野</span>
                            <el-button
                                size="small"
                                @click="setCurrentViewAsDefault"
                            >设置</el-button>
                        </div>
                        <div class="switch-full">
                            <span>清除视野经纬度</span>
                            <el-button
                                size="small"
                                @click="clearViewLatLng"
                            >清除</el-button>
                        </div>
                    </div>
                    <span class="font-bold w-full">烈度/震度</span>
                    <div class="switch-group">
                        <div class="switch-full">
                            <span>使用罗马数字显示烈度</span>
                            <el-switch v-model="settingsStore.mainSettings.useRomanCsis" />
                        </div>
                        <div class="switch-full">
                            <span>显示地图烈度/震度图例</span>
                            <el-switch v-model="settingsStore.mainSettings.displayLegend" :disabled="settingsStore.mainSettings.disableEewBaseMap" />
                        </div>
                        <div class="switch-full">
                            <span>显示区域烈度/震度列表</span>
                            <el-switch v-model="settingsStore.mainSettings.displayAreaIntensities" />
                        </div>
                    </div>
                    <span class="font-bold w-full">地名</span>
                    <div class="switch-group">
                        <div class="switch-full">
                            <span>地图显示地名</span>
                            <el-switch v-model="settingsStore.mainSettings.displayPlaceName"
                            @change="handleNeedReload" />
                        </div>
                        <div class="switch-full">
                            <span>
                                鼠标悬浮地图时显示地名
                                <el-popover
                                    placement="top"
                                    :width="300"
                                    trigger="hover"
                                >
                                    <template #reference>
                                        <question-filled width="1em" height="1em" />
                                    </template>
                                    <p>此功能与“启用位图渲染”冲突。</p>
                                </el-popover>
                            </span>
                            <el-switch v-model="settingsStore.mainSettings.placeNameOnHover"
                            :disabled="settingsStore.mainSettings.useCanvasRenderer"
                            @change="handleNeedReload" />
                        </div>
                    </div>
                    <span class="font-bold w-full">地震波</span>
                    <div class="switch-group">
                        <div class="switch-full">
                            <span>横波颜色模式</span>
                            <el-select
                                style="width: 168px;"
                                v-model="settingsStore.mainSettings.sWaveColorMode"
                                size="small"
                            >
                                <el-option label="根据是否为警报填色" :value=0 />
                                <el-option label="根据震级填色" :value=1 />
                                <el-option label="根据最大烈度/震度填色" :value=2 />
                            </el-select>
                        </div>
                        <div class="switch-full">
                            <span>填充横波</span>
                            <el-switch v-model="settingsStore.mainSettings.fillSWave" />
                        </div>
                    </div>
                    <span class="font-bold w-full">UI</span>
                    <div class="switch-group">
                        <div class="switch-full">
                            <span>UI缩放比例</span>
                            <el-select
                                style="width: 120px;"
                                v-model="settingsStore.mainSettings.uiScale"
                                size="small"
                            >
                                <el-option label="自动" :value=-1 />
                                <el-option label="50%" :value=0.5 />
                                <el-option label="75%" :value=0.75 />
                                <el-option label="100%（推荐）" :value=1 />
                                <el-option label="125%" :value=1.25 />
                                <el-option label="150%" :value=1.5 />
                                <el-option label="200%" :value=2 />
                            </el-select>
                        </div>
                    </div>
                    <span class="font-bold w-full">个性化</span>
                    <div class="switch-group">
                        <div class="switch-full">
                            <span>默认页面</span>
                            <el-select
                                style="width: 120px;"
                                v-model="settingsStore.mainSettings.defaultMenuId"
                                size="small"
                            >
                                <el-option label="主页(全部显示)" value="main" />
                                <el-option label="地震预警" value="eews" />
                                <el-option label="地震/海啸信息" value="eqlists" />
                            </el-select>
                        </div>
                        <div class="switch-full">
                            <span>禁用地震/海啸页面持续显示</span>
                            <el-switch
                                v-model="settingsStore.mainSettings.disableLastingEqlists"
                                :disabled="settingsStore.mainSettings.defaultMenuId == 'eqlists'"
                            />
                        </div>
                        <div class="switch-full">
                            <span style="width: 12rem;">地震信息临时显示：{{ settingsStore.mainSettings.tempEqlistDuration > 0 ? settingsStore.mainSettings.tempEqlistDuration + '秒' : '关闭' }}</span>
                            <el-slider
                                v-model="settingsStore.mainSettings.tempEqlistDuration"
                                :min="0" :max="10"
                                :step="0.5"
                                size="small"
                            />
                        </div>
                        <div class="switch-full">
                            <span style="width: 12rem;">海啸信息临时显示：{{ settingsStore.mainSettings.tempTsunamiDuration > 0 ? settingsStore.mainSettings.tempTsunamiDuration + '秒' : '关闭' }}</span>
                            <el-slider
                                v-model="settingsStore.mainSettings.tempTsunamiDuration"
                                :min="0" :max="20"
                                :step="1"
                                size="small"
                            />
                        </div>
                        <div class="switch-full">
                            <span>地震信息显示模式</span>
                            <el-select
                                style="width: 192px;"
                                v-model="settingsStore.mainSettings.eqlistsDisplayMode"
                                size="small"
                                @change="handleNeedReload"
                            >
                                <el-option label="显示每个数据源的最新地震" :value=0 />
                                <el-option label="显示全部数据源中的最新地震" :value=1 />
                            </el-select>
                        </div>
                        <div class="switch-full">
                            <span>总是显示最新的地震信息框</span>
                            <el-switch v-model="settingsStore.mainSettings.alwaysDisplayLatestInfo" />
                        </div>
                        <div class="switch-full">
                            <span>
                                隐藏地震/海啸信息页侧栏
                                <el-popover
                                    placement="top"
                                    :width="300"
                                    trigger="hover"
                                >
                                    <template #reference>
                                        <question-filled width="1em" height="1em" />
                                    </template>
                                    <p>处于地震/海啸信息页且地图处于自动视野状态时，可再次点击当前菜单快速切换。</p>
                                </el-popover>
                            </span>
                            <el-switch v-model="settingsStore.mainSettings.hideDrawer" />
                        </div>
                    </div>
                    <span class="font-bold w-full">附加功能</span>
                    <div class="switch-group">
                        <div class="switch-full">
                            <span>显示时钟</span>
                            <el-switch v-model="settingsStore.mainSettings.displayClock" />
                        </div>
                        <div class="switch-full">
                            <span>显示中国断层</span>
                            <el-switch v-model="settingsStore.mainSettings.displayCnFault" />
                        </div>
                        <div class="switch-full">
                            <span>显示晨昏线</span>
                            <el-switch v-model="settingsStore.mainSettings.displayTerminator" />
                        </div>
                        <div class="switch-full">
                            <span>显示台风信息</span>
                            <el-switch v-model="settingsStore.mainSettings.displayTyphoon" />
                        </div>
                    </div>
                </div>
                <span class="sub-title">性能</span>
                <div class="group">
                    <div class="switch-group">
                        <div class="switch-full">
                            <span style="width: 14rem;">地震波最大渲染速率：{{ settingsStore.mainSettings.maxWaveRenderRate }}次/秒</span>
                            <el-slider
                                v-model="settingsStore.mainSettings.maxWaveRenderRate"
                                :min="1" :max="20"
                                :step="1"
                                size="small"
                            />
                        </div>
                        <div class="switch-full">
                            <span>
                                启用位图渲染
                                <el-popover
                                    placement="top"
                                    :width="300"
                                    trigger="hover"
                                >
                                    <template #reference>
                                        <question-filled width="1em" height="1em" />
                                    </template>
                                    <p>部分图层使用Canvas渲染器加载。</p>
                                    <p>可轻微提升性能，但少部分情况下图形边缘可能模糊。</p>
                                    <p>开启后无法使用“鼠标悬浮地图时显示地名”功能。</p>
                                    <p><strong>需重新加载页面后生效。</strong></p>
                                </el-popover>
                            </span>
                            <el-switch v-model="settingsStore.mainSettings.useCanvasRenderer"
                            @change="handleNeedReload" />
                        </div>
                        <div class="switch-full">
                            <span>
                                禁用烈度图层
                                <el-popover
                                    placement="top"
                                    :width="300"
                                    trigger="hover"
                                >
                                    <template #reference>
                                        <question-filled width="1em" height="1em" />
                                    </template>
                                    <p>完全移除烈度/震度图层。</p>
                                    <p>不影响本地烈度计算。</p>
                                    <p>可极大幅度提升性能。</p>
                                    <p><strong>需重新加载页面后生效。</strong></p>
                                </el-popover>
                            </span>
                            <el-switch v-model="settingsStore.mainSettings.disableEewBaseMap"
                            @change="handleNeedReload" />
                        </div>
                        <div class="switch-full">
                            <span>
                                烈度/海啸图层简化
                                <el-popover
                                    placement="top"
                                    :width="350"
                                    trigger="hover"
                                >
                                    <template #reference>
                                        <question-filled width="1em" height="1em" />
                                    </template>
                                    <p>通过简化烈度/震度/海啸图层的形状来提升性能。</p>
                                    <p>简化程度越高，渲染压力越小，但图形失真越严重。</p>
                                    <p><strong>需重新加载页面后生效。</strong></p>
                                </el-popover>
                            </span>
                            <el-slider
                                v-model="settingsStore.mainSettings.mapSimplifyFactor"
                                :min="0" :max="4"
                                :step="1"
                                size="small"
                                show-stops
                                :show-tooltip="false"
                                :marks="simplifyMarks"
                                @change="handleNeedReload"
                            />
                        </div>
                    </div>
                </div>
                <span class="sub-title">高级</span>
                <div class="group">
                    <div class="switch-group">
                        <div class="switch-full">
                            <span>首选FAN Studio API服务器</span>
                            <el-select 
                                v-model="settingsStore.advancedSettings.defaultFanServer"
                                size="small"
                                style="width: 72px;"
                                @change="handleNeedReload"
                            >
                                <el-option label=".tech" :value="0" />
                                <el-option label=".hk" :value="1" />
                            </el-select>
                        </div>
                        <div class="switch-full">
                            <span>显示API名称</span>
                            <el-switch v-model="settingsStore.advancedSettings.displayApiType" />
                        </div>
                        <div class="switch-full">
                            <span>
                                强制估算烈度/震度（低精度）
                                <el-popover
                                    placement="top"
                                    :width="300"
                                    trigger="hover"
                                >
                                    <template #reference>
                                        <question-filled width="1em" height="1em" />
                                    </template>
                                    <p>软件自行估算以下数据：</p>
                                    <p> - 本地烈度/震度</p>
                                    <p> - 中国/韩国各区划地震预警和地震信息时的最大烈度</p>
                                    <p> - 日本各区划地震预警时的最大震度（与数据源信息合并）</p>
                                    <p> - 部分数据源显示的最大烈度</p>
                                    <p>估算结果与数据源显示可能有差异。</p>
                                    <strong>
                                        <p>低精度（尤其是深源地震）。</p>
                                        <p>此功能会消耗较多计算机资源。</p>
                                        <p>部分功能需重新加载页面后生效。</p>
                                    </strong>
                                </el-popover>
                            </span>
                            <el-switch 
                            v-model="settingsStore.advancedSettings.forceCalcInt"
                            @change="handleNeedReload" />
                        </div>
                        <div class="switch-full">
                            <span>
                                使用经典地图加载器
                                <el-popover
                                    placement="top"
                                    :width="300"
                                    trigger="hover"
                                >
                                    <template #reference>
                                        <question-filled width="1em" height="1em" />
                                    </template>
                                    <p>开启后：可解决部分情况下地图出现网格状的问题；不支持拖动时加载，不支持循环显示地图。</p>
                                    <p>关闭后：支持拖动时加载，支持循环显示地图，但部分情况下地图可能出现网格状。</p>
                                    <p><strong>此功能需重新加载页面后生效。</strong></p>
                                </el-popover>
                            </span>
                            <el-switch 
                            v-model="settingsStore.advancedSettings.useClassicMapLoader"
                            @change="handleNeedReload" />
                        </div>
                        <div class="switch-full">
                            <span>
                                防闪烁模式
                                <el-popover
                                    placement="top"
                                    :width="300"
                                    trigger="hover"
                                >
                                    <template #reference>
                                        <question-filled width="1em" height="1em" />
                                    </template>
                                    <p><strong>如无异常，无需开启。</strong></p>
                                    <p>解决一部分因未知原因导致的频繁闪烁问题。</p>
                                    <p><strong>此功能需重新加载页面后生效。</strong></p>
                                </el-popover>
                            </span>
                            <el-switch 
                            v-model="settingsStore.advancedSettings.preventFlickerMode"
                            @change="handleNeedReload" />
                        </div>
                        <div class="switch-full">
                            <span>
                                模拟地震预警
                                <el-popover
                                    placement="top"
                                    :width="300"
                                    trigger="hover"
                                >
                                    <template #reference>
                                        <question-filled width="1em" height="1em" />
                                    </template>
                                    <p>开启后，可通过“状态面板”或快捷键[M]打开模拟地震预警面板。</p>
                                    <p><strong>此功能仅作为教育功能，因滥用此功能造成的不良后果由您本人承担。</strong></p>
                                    <p><strong>此功能需重新加载页面后生效。</strong></p>
                                </el-popover>
                            </span>
                            <el-switch 
                            v-model="settingsStore.advancedSettings.mockEew"
                            @change="handleMockEew" />
                        </div>
                        <div class="switch-full pl-4">
                            <span>
                                回放测站时创建模拟预警
                                <el-popover
                                    placement="top"
                                    :width="300"
                                    trigger="hover"
                                >
                                    <template #reference>
                                        <question-filled width="1em" height="1em" />
                                    </template>
                                    <p>开启后，在历史地震列表中点击“测站回放”时自动创建一个对应参数的模拟地震预警。</p>
                                    <p><strong>部分机构提供的地震时间与实际发震时间有偏差（如日本气象厅采用检出时间），此时模拟预警无法正确还原发震时间。</strong></p>
                                    <p><strong>此功能创建的地震预警发震时间为虚拟时间。</strong></p>
                                    <p><strong>由此功能创建的地震预警不会自动更新。</strong></p>
                                </el-popover>
                            </span>
                            <el-switch 
                            v-model="settingsStore.advancedSettings.mockOnReplay"
                            :disabled="!settingsStore.advancedSettings.mockEew" />
                        </div>
                        <div class="switch-full">
                            <span>状态面板</span>
                            <el-button size="small" @click="statusStore.showStatusPanel = true">打开</el-button>
                        </div>
                        <div class="switch-full">
                            <span>输入指令</span>
                            <el-input
                                type="password"
                                v-model="advancedInput"
                                size="small"
                                style="width: 192px;"
                                @change="handleAdvance" 
                            />
                        </div>
                    </div>
                </div>
                <span class="sub-title">关于</span>
                <div class="group">
                    <span class="font-bold w-full" v-if="isTauri">自启动</span>
                    <div class="switch-group" v-if="isTauri">
                        <div class="switch-full">
                            <span>开机自启动</span>
                            <el-switch v-model="isAutoStart" @change="handleAutoStart" />
                        </div>
                        <div class="switch-full" v-if="thisPlatform == 'windows'">
                            <span>最小化启动</span>
                            <el-switch v-model="settingsStore.mainSettings.minimizeOnLaunch" />
                        </div>
                    </div>
                    <span class="font-bold w-full">更新</span>
                    <div class="switch-group">
                        <div class="switch-full">
                            <span>自动检查更新</span>
                            <el-switch v-model="settingsStore.mainSettings.autoCheckNewVersion" @change="handleAutoCheckVersion" />
                        </div>
                        <div class="switch-full" v-if="isTauri">
                            <span>检查预发布版本</span>
                            <el-switch v-model="settingsStore.mainSettings.checkPrerelease" />
                        </div>
                        <div class="switch-full" v-if="!isTauri">
                            <span>自动应用更新</span>
                            <el-switch v-model="settingsStore.mainSettings.autoRefresh" />
                        </div>
                        <div class="switch-full">
                            <span>立即检查更新</span>
                            <el-button
                                type="primary"
                                size="small"
                                @click="checkNewVersion(false)"
                            >检查更新</el-button>
                        </div>
                    </div>
                    <span class="font-bold w-full">帮助&关于</span>
                    <div class="switch-group">
                        <el-button @click="showAbout = true">帮助&关于</el-button>
                        <el-button
                            type="danger"
                            style="margin-left: 0;"
                            :disabled="isResetConfirming"
                            :loading="statusStore.isResettingApp"
                            @click="handleResetApp"
                        >重置应用设置</el-button>
                    </div>
                </div>
                <span class="sub-title" v-if="needReload">需要重载</span>
                <div class="group">
                    <el-button 
                        type="warning"
                        v-if="needReload"
                        @click="handleReload"
                    >重载以应用变更</el-button>
                </div>
            </div>
        </div>
        <DataSourceManager
            v-model="showDataSourceManager"
            @change="handleNeedReload"
            @manage-api-key="openApiKeyManager"
        />
        <el-dialog v-model="verifyDialog" width="300px" top="20vh" :show-close="false" append-to-body>
            <el-form :model="idForm">
                <el-form-item label="用户名" label-width="60px">
                    <el-input v-model="idForm.username" @keyup.enter="postVerify()" />
                </el-form-item>
                <el-form-item label="密码" label-width="60px">
                    <el-input type="password" v-model="idForm.password" @keyup.enter="postVerify()" />
                </el-form-item>
            </el-form>
            <template #footer>
                <el-button type="default" @click="verifyDialog = false">取消</el-button>
                <el-button type="primary" @click="postVerify()">确定</el-button>
            </template>
        </el-dialog>
        <el-dialog class="customize-audio" v-model="customizeAudio" width="60%" :show-close="false" append-to-body>
            <div class="explanation" v-if="isTauri">
                <div class="text">
                    <p><strong>应用程序版本支持自定义音效，请参考下列步骤。</strong></p>
                    <p>1. 点击“打开音频文件夹”按钮，系统的文件管理器会打开该应用程序的音频文件夹。</p>
                    <p>2. 将你想替换的音频文件（需要为mp3格式）放入该文件夹并重命名为“xxx.mp3”，具体名称请参照下方按钮显示的名称。</p>
                    <p>3. 点击“重新加载音频”按钮，或右键刷新页面即完成替换。</p>
                    <p>替换完成后可点击下方按钮进行音效测试。如需恢复默认，删除对应的mp3文件并重载音频即可。</p>
                    <p>Tips. 如需关闭某个音效，可以创建一个空白文本文件并重命名为“xxx.mp3”即可。</p>
                    <p><strong>如因此功能产生任何侵权行为将由您自行承担，开发者不承担任何责任。</strong></p>
                </div>
                <div class="buttons">
                    <el-button @click="openDataFolder">打开音频文件夹</el-button>
                    <el-button @click="loadAudio">重新加载音频</el-button>
                </div>
            </div>
            <div class="test">
                <div class="text">
                    <strong>点击下方按钮进行音效试听</strong>
                </div>
                <div class="buttons">
                    <el-button v-for="(type, index) of audioTypes" :key="index" @click="playSound(type)">{{ type }}</el-button>
                </div>
            </div>
            <template #footer>
                <el-button type="default" @click="customizeAudio = false">关闭</el-button>
            </template>
        </el-dialog>
        <el-dialog v-model="showApiKeyManager" title="管理 API Key" width="min(460px, 92vw)" top="20vh" :show-close="false" append-to-body>
            <el-form :model="settingsStore.mainSettings.apiKeys">
                <el-form-item label="FAN Studio API" label-width="110px">
                    <div class="api-key-field">
                        <el-input v-model="settingsStore.mainSettings.apiKeys.fanApiKey" @change="handleNeedReload" />
                        <el-button type="primary" @click="openUrl('https://api.fanstudio.tech/dev-platform/')">
                            <el-icon><TopRight /></el-icon>
                            <span>前往申请</span>
                        </el-button>
                    </div>
                </el-form-item>
            </el-form>
            <template #footer>
                <el-button type="primary" @click="showApiKeyManager = false">完成</el-button>
            </template>
        </el-dialog>
        <el-dialog class="about-box" v-model="showAbout" width="60%" :show-close="false" append-to-body>
            <div class="header">{{ APP_TITLE }}</div>
            <div class="title">注意事项</div>
            <div class="about">
                <p>本应用程序仅作为学习使用。</p>
                <p class="font-red">本应用程序使用非官方数据源，可能出现错误。一切信息请以官方发布为准。</p>
                <p class="font-red">本应用程序为永久免费的公益性项目，不接受任何形式的捐赠。任何以本应用程序为名义索取费用的行为均属诈骗。严禁将本应用用于商业场合。</p>
                <p>首次使用本应用程序时，请点击主界面右上角<el-icon><Setting /></el-icon>图标进行个性化设置。</p>
            </div>
            <div class="title">使用方法</div>
            <div class="about">
                <p>Windows 10、macOS 11、Ubuntu 22.04及以上64位系统用户推荐使用应用程序：<a href="https://github.com/Lipomoea/kanameishi/releases" target="_blank">应用程序下载</a>&nbsp;<a href="https://gitee.com/lipomoea/kanameishi/releases" target="_blank">备用链接</a></p>
                <p>主要功能：接收中国、日本、韩国地震预警速报，接收中国、日本、韩国等区域性地震信息以及美国地质调查局（USGS）、FAN Studio地震网络（FSSN）等机构的全球性地震信息，接收日本的海啸信息，显示日本、韩国部分机构的实时地震监测网络并提示可能的地震事件。</p>
                <p>通知推送：需授予通知权限。Chrome：点击网页链接左侧按钮-网站设置-通知-允许，刷新页面。</p>
                <p>播放声音：需开启声音权限。Chrome：点击网页链接左侧按钮-网站设置-声音-允许，刷新页面。</p>
            </div>
            <div class="title">快捷键</div>
            <div class="about">
                <ul>
                    <li>[A]uto：打开/关闭自动视野</li>
                    <li>[D]rawer：显示/隐藏侧边栏</li>
                    <li>[F]ull：切换到主菜单</li>
                    <li>[E]EW：切换到地震预警菜单</li>
                    <li>[L]ist：切换到地震信息菜单</li>
                    <li>[S]ettings：切换到设置菜单</li>
                    <li>[C]lear：清除地图上的历史地震</li>
                    <li v-if="settingsStore.advancedSettings.mockEew">[M]ock：打开/关闭模拟地震预警面板</li>
                    <li>[X]：打开/关闭状态面板</li>
                    <li>[Tab] / [Enter + Tab]：轮询菜单</li>
                    <li>[,] / [.]：存在多页信息框时轮询信息框</li>
                </ul>
            </div>
            <div class="title">常见问题</div>
            <div class="about">
                <p>关于烈度：中国大陆及港澳、韩国使用烈度制（12度表，I ~ XII），日本、中国台湾地区使用震度制（10度表，0 ~ 7，其中震度5、6两级分为强/弱）。部分数值为预估值，非实测值。</p>
                <p>关于时间：除全球性台网（USGS、FSSN）显示为中国标准时间，其他均显示为发报机构当地时间。</p>
                <p>关于延迟：受API及服务器限制，部分资料具有延迟是正常现象。</p>
                <p>关于地图：由于服务器带宽限制，进入页面后需要一定时间加载地图。如长时间未加载地图，请刷新页面。</p>
            </div>
            <div class="title">关于</div>
            <div class="about">
                <p>联系我：<a href="https://space.bilibili.com/316757498" target="_blank">リッポミャ</a>（哔哩哔哩）</p>
                <p>Github：<a href="https://github.com/Lipomoea/kanameishi" target="_blank">https://github.com/Lipomoea/kanameishi</a></p>
                <p>特别鸣谢：</p>
                <p>Wolfx Open API、FAN Studio API、P2P地震情報：接口支持。</p>
                <p>kotoho7：SREV音效支持。音效遵循<a href="https://creativecommons.org/licenses/by-sa/2.0/deed.zh-hans" target="_blank">CC BY-SA 2.0 DEED</a>许可协议，未进行二次加工。</p>
                <p>地牛WakeUp：中文倒计时播报素材。台湾地区欢迎下载<a href="https://eew.earthquake.tw/" target="_blank">地牛Wake Up！</a>获得更稳定的预警体验。</p>
            </div>
            <template #footer>
                <el-button type="default" @click="showAbout = false">关闭</el-button>
            </template>
        </el-dialog>
    </div>
</template>

<script setup>
import { useSettingsStore } from '@/stores/settings';
import { useAccessStore } from '@/stores/access';
import { useStatusStore } from '@/stores/status';
import { chimeUrls, utilUrls } from '@/utils/Urls';
import { APP_TITLE, APP_VERSION } from '@/utils/AppInfo';
import Http from '@/classes/Http';
import { h, ref, reactive, onMounted, onBeforeUnmount } from 'vue'
import { Key, QuestionFilled, Setting, TopRight } from '@element-plus/icons-vue';
import { calcPassedTime, formatCsis, openUrl, playSound, setClassName, shindoScale, calcCsisLevel, formatTimeZone, systemTimeZone } from '@/utils/Utils';
import { join, appDataDir } from "@tauri-apps/api/path";
import { convertFileSrc } from "@tauri-apps/api/core";
import { exists, mkdir } from "@tauri-apps/plugin-fs";
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';
import { platform, arch } from '@tauri-apps/plugin-os';
import { isTauri as getIsTauri } from '@tauri-apps/api/core';
import MarkdownIt from 'markdown-it';
import DataSourceManager from './components/DataSourceManager.vue';

const SHOW_ABOUT_FLG = '20260313.00'

const showNotifButton = 'Notification' in window
const isTauri = getIsTauri()
const thisPlatform = isTauri ? platform() : ''
const thisArch = isTauri ? arch() : ''
const simplifyMarks = {
    0: '关闭',
    1: '轻微',
    2: '中等',
    3: '显著',
    4: '极致'
}
const settingsStore = useSettingsStore()
const accessStore = useAccessStore()
const statusStore = useStatusStore()
const showDataSourceManager = ref(false)
const replayDateTime = ref('')
const setReplayDateTime = () => {
    const passedTime = Math.max(Math.round(calcPassedTime(replayDateTime.value, systemTimeZone) / 600) / 100, 0)
    statusStore.seisNetReplayDelay = passedTime
}
const setLat = (type)=>(val)=>{
    if(!val) {
        settingsStore.mainSettings[type][0] = 0
        return
    }
    let number = Number(val)
    if(isNaN(number)){
        settingsStore.mainSettings[type][0] = 0
    }
    else{
        if(number > 90) number = 90
        if(number < -90) number = -90
        settingsStore.mainSettings[type][0] = number
    }
}
const setLng = (type)=>(val)=>{
    if(!val) {
        settingsStore.mainSettings[type][1] = 0
        return
    }
    let number = Number(val)
    if(isNaN(number)){
        settingsStore.mainSettings[type][1] = 0
    }
    else{
        if(number > 180) number = 180
        if(number < -180) number = -180
        settingsStore.mainSettings[type][1] = number
    }
}
const autoLocate = async ()=>{
    let location = null
    for(const source of utilUrls.geoIp){
        try{
            const res = await Http.get(source.url)
            if(!res) continue

            const parsed = source.func(res)
            const lat = Number(parsed?.lat)
            const lng = Number(parsed?.lng)
            const place = typeof parsed?.place === 'string' ? parsed.place.trim() : ''
            if(!place || !Number.isFinite(lat) || !Number.isFinite(lng)
                || lat < -90 || lat > 90 || lng < -180 || lng > 180) continue

            location = { lat, lng, place }
            break
        }
        catch(err){
            console.log(err)
        }
    }
    if(!location){
        ElMessage({
            message: '获取位置失败',
            type: 'error',
        })
    }
    else{
        ElMessageBox.confirm(
            `你的IP定位地址是${location.place}，参考经纬度(${location.lat}, ${location.lng})。是否更新设置？`,
            '自动定位',
            {
                confirmButtonText: '确定',
                cancelButtonText: '取消',
                type: 'info',
                showClose: false,
            }
        ).then(()=>{
            setLat('userLatLng')(location.lat)
            setLng('userLatLng')(location.lng)
            ElMessage({
                message: '位置更新成功',
                type: 'success',
            })
        }).catch(()=>{
            ElMessage({
                message: '取消设置',
                type: 'info',
            })
        })
    }
}
const setDefaultZoom = (val)=>{
    settingsStore.mainSettings.defaultZoom = Math.min(Math.max(val, 2), 12)
}
const setCurrentViewAsDefault = ()=>{
    const map = statusStore.map
    if(map == null){
        ElMessage({
            message: '地图未加载',
            type: 'error',
        })
    }
    else{
        ElMessageBox.confirm(
            '是否设定当前视野为默认视野？',
            '设定当前视野',
            {
                confirmButtonText: '确定',
                cancelButtonText: '取消',
                type: 'info',
                showClose: false,
            }
        ).then(()=>{
            const { lat, lng } = map.getCenter()
            const zoom = map.getZoom()
            setLat('viewLatLng')(lat)
            setLng('viewLatLng')(lng)
            setDefaultZoom(zoom)
            ElMessage({
                message: '设定成功',
                type: 'success',
            })
        }).catch(()=>{
            ElMessage({
                message: '取消设置',
                type: 'info',
            })
        })
    }
}
const clearViewLatLng = ()=>{
    settingsStore.mainSettings.viewLatLng[0] = 0
    settingsStore.mainSettings.viewLatLng[1] = 0
    ElMessage({
        message: '清除完成',
        type: 'success',
    })
}
const clearUserLatLng = ()=>{
    settingsStore.mainSettings.userLatLng[0] = 0
    settingsStore.mainSettings.userLatLng[1] = 0
    ElMessage({
        message: '清除完成',
        type: 'success',
    })
}
const needReload = ref(false)
const handleReload = () => {
    window.location.reload()
}
const isResetConfirming = ref(false)
const handleResetApp = async () => {
    if(isResetConfirming.value || statusStore.isResettingApp) return
    isResetConfirming.value = true
    try {
        await ElMessageBox.confirm(
            `重置将清除本地保存的设置、API 密钥和功能授权信息，并立即重新加载应用程序。${isTauri ? '自定义音效文件将不受影响。' : ''}\n此操作无法撤销，是否继续？`,
            '重置应用设置',
            {
                customClass: 'reset-settings-message-box',
                confirmButtonText: '重置并重新加载',
                confirmButtonClass: 'el-button--danger',
                cancelButtonText: '取消',
                type: 'warning',
                showClose: false,
                closeOnClickModal: false,
            }
        )
    } catch {
        return
    } finally {
        isResetConfirming.value = false
    }

    // Block pending settings watchers and authorization responses until the page reloads.
    statusStore.isResettingApp = true
    try {
        localStorage.clear()
    } catch(error) {
        statusStore.isResettingApp = false
        console.error('清空本地存储失败', error)
        ElMessage({ message: '重置失败，无法清空本地存储', type: 'error' })
        return
    }
    window.location.reload()
}
const handleMockEew = newVal => {
    if(newVal) {
        ElMessageBox.confirm(
            '此功能意在通过重现或模拟将来可能发生的地震，起到防灾减灾教育效果。因滥用此功能造成的任何后果均由您本人承担。',
            '启用模拟地震预警',
            {
                confirmButtonText: '同意',
                cancelButtonText: '不同意',
                type: 'warning',
                showClose: false,
            }
        ).then(()=>{
            handleNeedReload()
        }).catch(()=>{
            settingsStore.advancedSettings.mockEew = false
        })
    }
    else {
        handleNeedReload()
    }
}
const showApiKeyManager = ref(false)
const openApiKeyManager = () => {
    showDataSourceManager.value = false
    showApiKeyManager.value = true
}
const advancedInput = ref('')
const verifyDialog = ref(false)
let verifyType = ''
const idForm = reactive({
    username: '',
    password: '',
})
const handleAdvance = (val)=>{
    switch(val){
        case 'enableIclEew':
        case 'enableTremFunctions':
        case 'enableGqEew':
        case 'enableNmefcTsunami':
        case 'verifyAdmin': {
            verifyType = val
            verifyDialog.value = true
            break
        }
        case 'enableAdvancedHypoInf': {
            accessStore.grant('advancedHypoInf')
            ElMessage({
                message: '功能已开启',
                type: 'success'
            })
            break
        }
        case 'disableAdvancedHypoInf': {
            accessStore.revoke('advancedHypoInf')
            if (settingsStore.mainSettings.displaySeisNet.niedHypoInfTextInfo == 2)
                settingsStore.mainSettings.displaySeisNet.niedHypoInfTextInfo = 1
            if (settingsStore.mainSettings.displaySeisNet.palertHypoInfTextInfo == 2)
                settingsStore.mainSettings.displaySeisNet.palertHypoInfTextInfo = 1
            ElMessage({
                message: '功能已关闭',
                type: 'success'
            })
            break
        }
        case 'disableIclEew': {
            if(settingsStore.isDataSourceEnabled('iclEew')) handleNeedReload()
            accessStore.revoke('iclEew')
            settingsStore.setDataSourceEnabled('iclEew', false)
            localStorage.removeItem('iclUrl')
            ElMessage({
                message: '功能已关闭',
                type: 'success'
            })
            break
        }
        case 'disableTremFunctions': {
            accessStore.revoke('tremFunctions')
            settingsStore.mainSettings.displaySeisNet.tremNet = false
            localStorage.removeItem('tremUrl')
            handleNeedReload()
            ElMessage({
                message: '功能已关闭',
                type: 'success'
            })
            break
        }
        case 'disableGqEew': {
            if(settingsStore.isDataSourceEnabled('gqEew')) handleNeedReload()
            accessStore.revoke('gqEew')
            settingsStore.setDataSourceEnabled('gqEew', false)
            localStorage.removeItem('gqUrl')
            ElMessage({
                message: '功能已关闭',
                type: 'success'
            })
            break
        }
        case 'disableNmefcTsunami': {
            accessStore.revoke('nmefcTsunamiMap')
            localStorage.removeItem('nmefcTsunami')
            handleNeedReload()
            ElMessage({
                message: '功能已关闭',
                type: 'success'
            })
            break
        }
    }
    advancedInput.value = ''
}
const postVerify = async (type = verifyType)=>{
    switch(type){
        case 'enableIclEew': {
            const res = await Http.post('https://api.lipomoea.tech/icl_url', idForm)
            if(statusStore.isResettingApp) return
            if(res && res.success){
                statusStore.setLocalStorageItem('iclUrl', JSON.stringify(res.data))
                accessStore.grant('iclEew')
                if(settingsStore.isDataSourceEnabled('iclEew')) handleNeedReload()
                verifyDialog.value = false
                ElMessage({
                    message: '认证成功',
                    type: 'success'
                })
            }
            else{
                ElMessage({
                    message: '认证失败',
                    type: 'error'
                })
            }
            break
        }
        case 'enableTremFunctions': {
            const res = await Http.post('https://api.lipomoea.tech/trem_url', idForm)
            if(statusStore.isResettingApp) return
            if(res && res.success){
                statusStore.setLocalStorageItem('tremUrl', JSON.stringify(res.data))
                accessStore.grant('tremFunctions')
                handleNeedReload()
                verifyDialog.value = false
                ElMessage({
                    message: '认证成功',
                    type: 'success'
                })
            }
            else{
                ElMessage({
                    message: '认证失败',
                    type: 'error'
                })
            }
            break
        }
        case 'enableGqEew': {
            const res = await Http.post('https://api.lipomoea.tech/gq_url', idForm)
            if(statusStore.isResettingApp) return
            if(res && res.success){
                statusStore.setLocalStorageItem('gqUrl', JSON.stringify(res.data))
                accessStore.grant('gqEew')
                if(settingsStore.isDataSourceEnabled('gqEew')) handleNeedReload()
                verifyDialog.value = false
                ElMessage({
                    message: '认证成功',
                    type: 'success'
                })
            }
            else{
                ElMessage({
                    message: '认证失败',
                    type: 'error'
                })
            }
            break
        }
        case 'enableNmefcTsunami': {
            const res = await Http.post('https://api.lipomoea.tech/cn_tsunami_topo_json_url', idForm)
            if(statusStore.isResettingApp) return
            if(res && res.success){
                statusStore.setLocalStorageItem('nmefcTsunami', JSON.stringify(res.data))
                accessStore.grant('nmefcTsunamiMap')
                handleNeedReload()
                verifyDialog.value = false
                ElMessage({
                    message: '认证成功',
                    type: 'success'
                })
            }
            else{
                ElMessage({
                    message: '认证失败',
                    type: 'error'
                })
            }
            break
        }
        case 'verifyAdmin': {
            postVerify('enableIclEew')
            postVerify('enableTremFunctions')
            postVerify('enableGqEew')
            postVerify('enableNmefcTsunami')
        }
    }
}
const handleNeedReload = () => {
    if(!needReload.value) {
        needReload.value = true
        ElMessage({
            message: '需要重载应用后生效！点击右侧关闭按钮立即重载',
            type: 'warning',
            duration: 0,
            showClose: true,
            onClose: handleReload
        })
    }
}
const showAbout = ref(false)
let hasNewVersion = false
const checkNewVersion = async (silent = false) => {
    const currentVersion = APP_VERSION
    try {
        const versionInfo = await Http.get('https://api.github.com/repos/Lipomoea/kanameishi/releases')
        let checkedVersion, downloadUrl, detail
        if(isTauri) {
            let fileType
            if(thisPlatform == 'windows') fileType = '.exe'
            else if(thisPlatform == 'linux') {
                if(thisArch == 'aarch64') fileType = 'arm64.deb'
                else if(thisArch == 'x86_64') fileType = 'amd64.deb'
                else {
                    ElMessage({
                        message: '未识别的系统架构',
                        type: 'error'
                    })
                    return
                }
            }
            else if(thisPlatform == 'macos') {
                if(thisArch == 'aarch64') fileType = 'aarch64.dmg'
                else if(thisArch == 'x86_64') fileType = 'x64.dmg'
                else {
                    ElMessage({
                        message: '未识别的系统架构',
                        type: 'error'
                    })
                    return
                }
            }
            else {
                ElMessage({
                    message: '未识别的平台版本',
                    type: 'error'
                })
                return
            }
            let i = 0
            let asset = undefined
            while(i < versionInfo.length) {
                asset = versionInfo[i].assets.find(asset => asset.name.endsWith(fileType))
                if((!versionInfo[i].prerelease || settingsStore.mainSettings.checkPrerelease) && asset) break
                i++
            }
            if(i == versionInfo.length) {
                ElMessage({
                    message: '未检测到可用版本',
                    type: 'info'
                })
                return
            }
            else {
                checkedVersion = versionInfo[i].tag_name.slice(1)
                downloadUrl = asset.browser_download_url
                detail = versionInfo[i].body
            }
        }
        else {
            checkedVersion = versionInfo[0].tag_name.slice(1)
            downloadUrl = ''
            detail = versionInfo[0].body
        }
        if(compareVersion(currentVersion, checkedVersion)) {
            if(!hasNewVersion) {
                hasNewVersion = true
                ElMessage({
                    message: `检查到新版本v${checkedVersion}`,
                    type: 'success',
                    duration: 0,
                    showClose: true,
                    onClose: () => hasNewVersion = false
                })
            }
            ElMessageBox.close()
            const md = new MarkdownIt({ linkify: true })
            if(isTauri) {
                if(!silent) {
                    ElMessageBox.confirm(
                        h('div', {
                            innerHTML: md.render(detail),
                            style: {
                                listStylePosition: 'inside',
                                maxHeight: '50vh',
                                overflow: 'auto',
                                fontSize: '16px'
                            }
                        }),
                        `发现新版本 v${checkedVersion}`,
                        {
                            confirmButtonText: '下载',
                            cancelButtonText: '关闭',
                            type: '',
                            showClose: false,
                            customStyle: {
                                '--el-messagebox-width': '500px',
                            }
                        }
                    ).then(()=>{
                        openUrl(downloadUrl)
                    })
                }
            }
            else {
                if(settingsStore.mainSettings.autoRefresh) {
                    ElMessage({
                        message: '发现新版本，即将自动刷新',
                        type: 'success'
                    })
                    setTimeout(() => {
                        handleReload()
                    }, 5000);
                }
                else {
                    if(!silent) {
                        ElMessageBox.confirm(
                        h('div', {
                            innerHTML: md.render(detail),
                            style: {
                                listStylePosition: 'inside',
                                maxHeight: '50vh',
                                overflow: 'auto',
                                fontSize: '16px'
                            }
                        }),
                        `发现新版本 v${checkedVersion}`,
                        {
                            confirmButtonText: '刷新页面',
                            cancelButtonText: '关闭',
                            type: '',
                            showClose: false,
                            customStyle: {
                                '--el-messagebox-width': '500px',
                            }
                        }
                    ).then(()=>{
                            handleReload()
                        })
                    }
                }
            }
        }
        else if(!silent) {
            ElMessage({
                message: '当前已经是最新版本',
                type: 'success'
            })
        }
    } catch (_) {
        ElMessage({
            message: '检查更新失败，请稍后重试！',
            type: 'error'
        })
    }
}
const compareArray = (arr1, arr2) => {
    arr1 = arr1.map(i => Number(i))
    arr2 = arr2.map(i => Number(i))
    const len1 = arr1.length
    const len2 = arr2.length
    const lenDiff = len1 - len2
    if(lenDiff > 0) {
        arr2.push(...new Array(lenDiff).fill(0))
    }
    else if(lenDiff < 0) {
        arr1.push(...new Array(-lenDiff).fill(0))
    }
    const len = arr1.length
    for(let i = 0; i < len; i++) {
        if(arr1[i] > arr2[i]) return true
        else if(arr1[i] < arr2[i]) return false
    }
    return false
}
const compareVersion = (currentVersion, checkedVersion) => {
    const splitCurrent = currentVersion.split('-')
    const splitChecked = checkedVersion.split('-')
    if(compareArray(splitChecked[0].split('.'), splitCurrent[0].split('.'))) return true
    else if(compareArray(splitCurrent[0].split('.'), splitChecked[0].split('.'))) return false
    else if(splitChecked.length < splitCurrent.length) return true
    else if(splitChecked.length > splitCurrent.length) return false
    else if(splitChecked.length == 1) return false
    else {
        const typeArr = ['pre', 'rc']
        const currentSuffixArr = splitCurrent[1].split('.')
        const checkedSuffixArr = splitChecked[1].split('.')
        if(typeArr.indexOf(currentSuffixArr[0]) > typeArr.indexOf(checkedSuffixArr[0])) return false
        else if(typeArr.indexOf(currentSuffixArr[0]) < typeArr.indexOf(checkedSuffixArr[0])) return true
        else {
            currentSuffixArr.shift()
            checkedSuffixArr.shift()
            if(compareArray(checkedSuffixArr, currentSuffixArr)) return true
            else return false
        }
    }
}
let autoCheckInterval
const handleAutoCheckVersion = (val) => {
    clearInterval(autoCheckInterval)
    if(val) {
        checkNewVersion(true)
        autoCheckInterval = setInterval(() => {
            checkNewVersion(true)
        }, 6 * 3600 * 1000);
    }
}
const audioTypes = Object.keys(chimeUrls.general).concat(Object.keys(chimeUrls.srev))
const customizeAudio = ref(false)
const loadAudio = () => {
    if(isTauri) {
        chimeUrls.custom = {}
        audioTypes.forEach(async type => {
            try {
                const fileName = type + '.mp3'
                const appDataPath = await appDataDir()
                const filePath = await join(appDataPath, 'audio', fileName)
                const isExist = await exists(filePath)
                if(isExist) {
                    const url = convertFileSrc(filePath)
                    chimeUrls.custom[type] = url
                }
            } catch (err) {
                console.log(err);
            }
        })
    }
}
const openDataFolder = async () => {
    try {
        const appDataPath = await appDataDir()
        const audioPath = await join(appDataPath, 'audio')
        const isExist = await exists(audioPath)
        if(!isExist) await mkdir(audioPath, { recursive: true })
        openUrl(audioPath)
    } catch (e) {
        console.error(e)
    }
}
const isAutoStart = ref(false)
const handleAutoStart = async (value) => {
    if(isTauri) {
        value ? await enable() : await disable()
        isAutoStart.value = await isEnabled()
    }
}
onMounted(async () => {
    handleAutoCheckVersion(settingsStore.mainSettings.autoCheckNewVersion)
    if(isTauri) {
        loadAudio()
        isAutoStart.value = await isEnabled()
    }
    if(statusStore.isResettingApp) return
    const localFlg = localStorage.getItem('SHOW_ABOUT_FLG') || ''
    if(localFlg < SHOW_ABOUT_FLG) showAbout.value = true
    statusStore.setLocalStorageItem('SHOW_ABOUT_FLG', SHOW_ABOUT_FLG)
})
onBeforeUnmount(() => {
    clearInterval(autoCheckInterval)
})
</script>

<style lang="scss" scoped>
.outer1{
    width: 100%;
    .container{
        width: 100%;
        padding: 5px;
        display: flex;
        flex-direction: column;
        user-select: none;
        .title{
            font-size: 24px;
            font-weight: 700;
        }
        .settings{
            display: flex;
            flex-direction: column;
            width: 100%;
            .sub-title{
                font-size: 18px;
                font-weight: 700;
                margin: 10px 0 5px;
            }
            .group{
                display: flex;
                flex-direction: column;
                width: 100%;
                align-items: flex-start;
                row-gap: 4px;
            }
            .data-source-actions{
                flex-direction: row;
                flex-wrap: wrap;
                gap: 8px;

                .el-button + .el-button{
                    margin-left: 0;
                }
            }
            .switch-group{
                width: 100%;
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                row-gap: 4px;
                column-gap: 15px;
            }
            .switch{
                display: flex;
                align-items: center;
                column-gap: 5px;
            }
            .switch-full {
                display: flex;
                width: 100%;
                justify-content: space-between;
                align-items: center;
            }
            .el-switch{
                height: 24px;
            }
            .lat-lng{
                width: 120px;
            }
            span{
                display: flex;
                align-items: center;
            }
        }
    }
}
ul {
    list-style-position: inside;
}
.w-full{
    width: 100%;
}
.el-checkbox{
    height: 24px;
    margin: 0px;
}
.int {
    width: 22px;
    height: 22px;
    margin-left: 6px;
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
    .roman.scale-9 {
        transform: scaleX(0.9);
    }
}
.mag {
    width: 28px;
    height: 22px;
    margin-left: 6px;
    border-radius: 5px;
    display: flex;
    justify-content: center;
    align-items: center;
    pointer-events: none;
    user-select: none;
}
.el-slider {
    flex: 1;
    margin: 0 1rem;
}
.justify-between {
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.flex {
    display: flex;
    align-items: center;
}
.ml-4 {
    margin-left: 1rem;
}
.mr-4 {
    margin-right: 1rem;
}
.pl-4 {
    padding-left: 1rem;
}
.pl-8 {
    padding-left: 2rem;
}
.pr-4 {
    padding-right: 1rem;
}
.gap-2 {
    gap: 0.5rem;
}
.font-bold {
    font-weight: 700;
}
.api-key-field{
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    width: 100%;
}
.text-right {
    text-align: right;
    :deep(.el-input__inner) {
        text-align: right;
    }
}
.font-red {
    color: red;
}
</style>

<style lang="scss">
.reset-settings-message-box .el-message-box__message {
    white-space: pre-line;
}
.about-box {
    padding: 20px;
    .header {
        width: 100%;
        text-align: center;
        font-size: 24px;
        font-weight: 700;
    }
    .title{
        font-size: 20px;
        font-weight: 700;
    }
    .about {
        font-size: 16px;
    }
    .about+.about{
        margin-top: 10px;
    }
    a,a:visited{
        color: blue;
    }
}
.customize-audio {
    display: flex;
    flex-direction: column;
    align-items: center;
    .explanation,.test {
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        .text {
            font-size: 16px;
        }
        .buttons {
            width: 100%;
            display: flex;
            column-gap: 20px;
            row-gap: 10px;
            justify-content: center;
            flex-wrap: wrap;
            .el-button {
                width: 150px;
                margin: 0;
            }
        }
    }
    .test {
        margin-top: 20px;
    }
}
</style>
