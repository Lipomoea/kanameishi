// Headless Edge must be running on localhost:9333 with a disposable profile.
// node etc/performance/serve_profile.mjs; node etc/performance/browser_profile.mjs [label]
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = path.join(root, 'etc/performance/shizuoka-20261108.local')
const label = process.argv[2] || 'before'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const target = await (await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' })).json()
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
let id = 0
const pending = new Map(), errors = []
const call = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id
    pending.set(requestId, { resolve, reject })
    socket.send(JSON.stringify({ id: requestId, method, params }))
})
socket.onmessage = async event => {
    const message = JSON.parse(event.data)
    if(message.id) {
        const request = pending.get(message.id)
        pending.delete(message.id)
        if(message.error) request.reject(new Error(JSON.stringify(message.error)))
        else request.resolve(message.result)
    }
    if(message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails)
    if(message.method === 'Fetch.requestPaused') {
        const { requestId, request } = message.params
        if(request.url.startsWith('http://127.0.0.1:5173/')) await call('Fetch.continueRequest', { requestId })
        else {
            let body = '{}'
            if(request.url.includes('SiteList/sitelist.json')) body = readFileSync(path.join(output, 'sitelist.json'), 'utf8')
            if(request.url.includes('/RealTimeData/')) body = readFileSync(path.join(output, 'frames/20261108010340.json'), 'utf8')
            await call('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [
                { name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }
            ], body: Buffer.from(body).toString('base64') })
        }
    }
}
const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if(result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
}
try {
    await call('Page.enable')
    await call('Runtime.enable')
    await call('Network.enable')
    await call('Network.setBlockedURLs', { urls: ['wss://*', 'ws://*'] })
    await call('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
    await call('Page.addScriptToEvaluateOnNewDocument', { source: `
        localStorage.clear();
        localStorage.setItem('mainSettings', JSON.stringify({
            displaySeisNet: { niedNet: true, displayGrid: true, displayNiedShindo: true },
            viewLatLng: [35, 138], defaultZoom: 7
        }));
        window.__longTasks = [];
        new PerformanceObserver(list => window.__longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })))).observe({ type: 'longtask', buffered: true });
    ` })
    await call('Page.navigate', { url: 'http://127.0.0.1:5173/' })
    for(let i = 0; i < 90; i++) {
        if(await evaluate(`!!document.getElementById('mainMap')?.__vueParentComponent?.setupState?.setView`)) break
        await sleep(1000)
    }
    console.log('SETUP', await evaluate(`(() => {
        window.__main = document.getElementById('mainMap').__vueParentComponent;
        const find = (v, name) => {
            if(!v) return null;
            if(v.component?.type?.__name === name) return v.component;
            if(v.component) { const result = find(v.component.subTree, name); if(result) return result; }
            if(Array.isArray(v.children)) for(const c of v.children) { const result = find(c, name); if(result) return result; }
            return null;
        };
        window.__nied = find(__main.subTree, 'NiedNet');
        return { main: __main.type.__name, nied: __nied?.type.__name };
    })()`))
    for(let i = 0; i < 60; i++) {
        if(await evaluate(`__nied.setupState.stations.length === 1725 && !!__main.setupState.jpEewBaseMap`)) break
        await sleep(1000)
    }
    if(!await evaluate(`__nied.setupState.stations.length === 1725 && !!__main.setupState.jpEewBaseMap`)) throw new Error('Station/map initialization timed out')
    await evaluate(`clearInterval(__nied.setupState.requestInterval); __main.setupState.timeStore.stopUpdatingTime();`)
    console.log('READY', await evaluate(`({stations:__nied.setupState.stations.length, layers:Object.keys(__main.setupState.map._layers).length})`))
    const frames = Array.from({ length: 181 }, (_, i) => {
        const stamp = Date.parse('2026-11-08T01:03:40+09:00') + i * 1000
        const key = new Date(stamp + 9 * 3600000).toISOString().slice(0, 19).replaceAll(/[-:T]/g, '')
        return JSON.parse(readFileSync(path.join(output, `frames/${key}.json`), 'utf8'))
    })
    await evaluate(`window.__frames = ${JSON.stringify(frames)}; window.__replaySamples = []; window.__longTasks = [];`)
    await call('Profiler.enable')
    await call('Profiler.start')
    const result = await evaluate(`(async () => {
        const { nextTick } = await import('/node_modules/.vite/deps/vue.js');
        const { EewEvent } = await import('/src/classes/EewEqlistClasses.js');
        const n = __nied.setupState, m = __main.setupState;
        const realNow = Date.now;
        let now = Date.parse(__frames[0].realTimeData.dataTime);
        Date.now = () => now;
        m.timeStore.offset = 0;
        let eew = null, lastReport = null;
        for(const data of __frames) {
            now = Date.parse(data.realTimeData.dataTime);
            m.timeStore.currentTimeStamp = now;
            const h = data.hypoInfo?.items?.[0];
            if(h && h.reportNum !== lastReport) {
                lastReport = h.reportNum;
                const message = {
                    source: 'jmaEew', id: h.reportId, isEew: true, timeZone: 9,
                    lat: Number(h.latitude.slice(1)), lng: Number(h.longitude.slice(1)),
                    depth: parseFloat(h.depth), magnitude: Number(h.magnitude),
                    originTime: h.originTime.slice(0, 19).replace('T', ' '),
                    reportTime: h.reportTime.slice(0, 19).replace('T', ' '), reportNum: Number(h.reportNum),
                    isCanceled: h.isCancel === 'true', isAssumption: false, isWarn: true,
                    isFinal: h.isFinal === 'true', hypocenter: h.regionName, titleText: '回放·静岡県西部',
                    reportNumText: h.reportNum, depthText: h.depth, maxIntensity: h.calcintensity,
                    maxIntensityText: h.calcintensity, className: 'red', warnArea: '[]'
                };
                if(!eew) {
                    const { reactive } = await import('/node_modules/.vite/deps/vue.js');
                    eew = reactive(new EewEvent(m.map, message, m.activeEewList, m.handleTempEqlists, m.smartSetView));
                    m.activeEewList.push(eew);
                    eew.update(message, 300000, true);
                } else eew.update(message, 300000);
            }
            const start = performance.now();
            n.commitFrame({ timestamp: now, frameTime: data.realTimeData.dataTime.slice(0,19), intensity: data.realTimeData.intensity, siteConfigId: data.realTimeData.siteConfigId, generation: n.requestGeneration });
            await nextTick();
            __replaySamples.push({ time: data.realTimeData.dataTime, active: n.stations.filter(s => s.isActive).length, updateMs: performance.now() - start });
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        eew?.renderStop();
        Date.now = realNow;
        return { samples: __replaySamples, longTasks: __longTasks, note: '181 historical frames, 50ms yield between updates; production timers not accelerated, so expiry counts are not realtime-equivalent.' };
    })()`)
    const { profile } = await call('Profiler.stop')
    writeFileSync(path.join(output, `browser-${label}.cpuprofile`), JSON.stringify(profile))
    writeFileSync(path.join(output, `browser-${label}.json`), JSON.stringify({ ...result, errors }, null, 2))
    console.log('RESULT', JSON.stringify({ frames: result.samples.length, meanMs: result.samples.reduce((s,r)=>s+r.updateMs,0)/result.samples.length, maxMs: Math.max(...result.samples.map(r=>r.updateMs)), longTasks: result.longTasks.length, errors: errors.length }))
} finally {
    await call('Page.close').catch(() => {})
    socket.close()
}
