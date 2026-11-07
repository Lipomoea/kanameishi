# 静冈县西部地震性能回放（2026-11-08）

事件：2026-11-08 01:04:41（UTC+9），M5.7、40 km、最大震度 5强。

## 数据与方法

- 数据来自 `https://weather-kyoshin.east.edge.storage-yahoo.jp/RealTimeData/20261108/`。
- 下载 01:03:40–01:08:40 的 301 个连续秒帧，1725 个测站，站表版本 `20260123000000`。逐帧校验时间、站表版本和数据长度。
- `nied_replay.mjs` 执行源码中的 `NiedStation`、NiedNet 检出/聚合逻辑和真实 Vue 响应式逻辑；12.5 秒活跃超时使用虚拟时钟，按历史时间逐秒推进。下载和邻站初始化不计入更新耗时。
- 测量包含给 Worker 准备快照的成本；快照克隆另计。`--infer` 单独计时生产反演类，顺序处理所有输入；并不模拟 Worker 忙碌时合并待处理帧的调度。
- 浏览器对比使用独立配置的无头 Edge、Vite 开发版本、加载完成后的真实 Leaflet 地图、Canvas 测站、自动视野和 EEW 波形，测站反演关闭。采用前 181 帧，并把数据中的 `hypoInfo` 历次报告转换成 EEW 事件；该数据没有警报区域列表，因此没有复现区域填色。
- 浏览器每帧后让出 50 ms，属于加速压力回放。普通定时器未随历史时钟加速，活跃状态到期时刻不是实际 1 倍速回放；它用于定位 UI 热点，不代表真实播放帧率。检出一致性以完整 301 帧、虚拟定时器的 Node 回放为准。

原始数据、结果 JSON 和 Chrome DevTools 可打开的 `.cpuprofile` 保存在 `shizuoka-20261108.local/`，由仓库的 `*.local` 规则忽略。

## 已定位并修复：测站历史数组的深度响应式开销

`NiedStation.recentLevel` 是只供算法使用的 60 秒历史，但每个测站被 `reactive()` 包装后，数组也被深度代理。1725 个测站每秒 `unshift/splice`，以及 `calcAscend` 的反复索引访问，产生大量 Proxy get/set 和数组跟踪操作。它在平时也存在，会与地震发生后的绘制和反演负载叠加。

修改 `src/classes/StationClasses.js`：将历史数组标记为 `markRaw`，并在 `calcAscend` 中读取一次历史引用。对外显示的 `level`、`activity`、`ascend`、`triggerStamp`、`isActive` 等字段继续保持响应式。

浏览器采样结果（同一机器、同一脚本，两轮均开启 CPU profiler）：

| 指标 | 修复前 | 修复后 |
| --- | ---: | ---: |
| 测站提交和 Vue 更新平均耗时 | 166.4 ms | 23.1 ms |
| 95 分位 | 216.5 ms | 34.6 ms |
| 最大更新耗时 | 270.1 ms | 50.8 ms |
| 整段回放中 >50 ms 的主线程长任务 | 181 | 6 |
| 运行时异常 | 0 | 0 |

平均更新耗时降低约 86%。长任务统计还包括异步绘制/布局，因此其最大耗时与更新函数的最大耗时不同。剩余长任务仍可能来自地图缩放和绘制，这次结果不表示所有卡顿均已消除。

301 帧检出输出的 SHA-256 在原版、仅排除历史数组响应式、最终修复和开启反演的回放中一致：

`d1b24225dce63b48f62a4bb1844dd0874031a81bcc1c4865f5fc1aa0f7065573`

峰值活跃测站数均为 **620**。摘要覆盖逐帧触发站、候选拾取、活跃站和非活跃站及其属性，说明本次优化未改变该事件提交给反演器的输入。

最终未开启 profiler 的完整回放复核：检测和快照准备平均耗时从 **173.9 ms** 降到 **23.3 ms**，活跃帧平均从 **195.7 ms** 降到 **22.8 ms**。同机调度和 GC 会使单次计时波动，不应把这些数字视为所有设备的固定性能。

## 另一个瓶颈：可选的震源反演

优化后的检测器加生产反演类，在 Node v24.21.0 / Windows 上顺序回放并开启 CPU profiler：

- 127 帧求解耗时超过 1 ms；这些帧平均 **702.8 ms**，95 分位 **1257.7 ms**。
- 其中 **28 帧超过 1000 ms**，最大 **1696.1 ms**，发生在历史时间 01:06:08。
- 全部帧的快照克隆平均约 **1.77 ms**，不是主要耗时。
- CPU 自耗时热点为 `FindHypocenter.getOptionCacheEntry`、`calcPickWaveOption`、`calcMeanAbsResidual`，以及候选波相结果创建、残差/罚分评估和垃圾回收。

应用已通过 Worker 运行反演，并在忙碌时合并待处理更新。因此这些数据说明其处理能力有时跟不上逐秒输入，可能增加反演结果延迟；它们不是浏览器主线程被阻塞同样时长的证据，也不是对实际 Worker 调度延迟的直接测量。本次未修改反演算法。

## 验证

- 301 帧完整回放的基线/修复版快照一致性断言通过。
- `pnpm build` 通过；Vite 提示大体积 chunk。
- `node --test --test-isolation=none tests/WebSocket.test.js tests/LipoMigration.test.js`：52 项通过。
- EEW 取消生命周期、测站网关联及地图范围回归脚本全部通过。
- 两轮浏览器回放运行时异常均为 0。

## 复现

在仓库根目录依次运行（避免同时运行多组计时或构建任务）：

```powershell
node --experimental-vm-modules etc/performance/nied_replay.mjs --baseline
node --experimental-vm-modules etc/performance/nied_replay.mjs
node --experimental-vm-modules etc/performance/nied_replay.mjs --infer --profile
```

`--baseline` 只在测试内存中还原优化前的历史数组访问方式，不修改工作区。存在对应结果时，脚本自动断言逐帧快照摘要一致。首次执行需要网络；之后复用本地缓存。`--profile` 可用于任一模式。

浏览器复测先用单独终端启动：

```powershell
node etc/performance/serve_profile.mjs
```

再启动隔离配置的无头 Edge（此目录只用于性能测试）：

```powershell
Start-Process -FilePath 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' -ArgumentList @('--headless=new', '--remote-debugging-port=9333', "--user-data-dir=$PWD\etc\performance\edge-profile.local", '--no-first-run', '--no-default-browser-check', '--window-size=1440,1000', 'about:blank') -WindowStyle Hidden
node etc/performance/browser_profile.mjs optimized
```

浏览器脚本在该隔离配置中新建测试页，重置该测试站点设置，拦截外部 HTTP 数据请求并使用本地数据，阻止外部 WebSocket，完成后关闭测试页。不要让它连接日常使用的浏览器配置。记录中的 `browser-baseline.*` 是应用修复前采集的基线；传入名称仅控制输出文件名，不会切换代码版本。
