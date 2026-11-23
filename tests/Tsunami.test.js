import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, existsSync } from 'node:fs'
import {
    normalizeJmaTsunami, normalizeNmefcTsunami, shouldAcceptJmaTsunami, getJmaTsunamiAction,
    getJmaTsunamiDisplayState, getTsunamiSound, formatTsunamiArrival, tsunamiExpiryGrace,
} from '../src/utils/Tsunami.js'
import { chimeUrls } from '../src/utils/Urls.js'

import { reportTime, tsunamiReport } from './fixtures/JmaTsunami.js'

test('normalizes Wolfx title, optional fields, forecast height and UTC times', () => {
    const msg = normalizeJmaTsunami(tsunamiReport(), reportTime)
    assert.equal(msg.status, 3)
    assert.equal(msg.reportTime, '2026-11-24 09:00:00')
    const [warning, forecast] = JSON.parse(msg.warnArea)
    assert.equal(warning.code, '772')
    assert.equal(warning.description, '3m')
    assert.equal(warning.arrivalTime, '2026-11-24 09:20:00')
    assert.equal(forecast.height, 0.2)
    assert.equal(forecast.description, '20cm')
    assert.equal(forecast.arrivalTime, '')
    const areas = [{ code: '100', level: 'warning', maxWave: { height: '3', text: null } }]
    const missing = JSON.parse(normalizeJmaTsunami(tsunamiReport({ areas }), reportTime).warnArea)[0]
    assert.equal(missing.height, null)
    assert.equal(missing.description, '')
    assert.equal(formatTsunamiArrival('第１波の到達を確認', warning.arrivalTime), 'すでに到達')
    assert.equal(formatTsunamiArrival('', warning.arrivalTime), '24日 09:20')
    assert.equal(formatTsunamiArrival(undefined, undefined), '')
})

test('rejects unrecognized reports, missing time/expiry and already expired active snapshots', () => {
    for (const data of [
        tsunamiReport({ report: null }), tsunamiReport({ report: { time: null } }),
        tsunamiReport({ validUntil: null }), tsunamiReport({ status: 'unknown' }),
        tsunamiReport({ status: 'none_reported' }), tsunamiReport({ status: 'forecast_only' }),
        tsunamiReport({ areas: null }),
    ]) assert.equal(normalizeJmaTsunami(data, reportTime), null)
    const deadline = reportTime + 90000 + tsunamiExpiryGrace
    assert.ok(normalizeJmaTsunami(tsunamiReport(), deadline))
    assert.equal(normalizeJmaTsunami(tsunamiReport(), deadline + 1), null)
    for (const status of ['cleared', 'expired']) {
        assert.equal(normalizeJmaTsunami(tsunamiReport({ status, validUntil: null }), deadline + 1).status, 0)
    }
    const cancelled = normalizeJmaTsunami(tsunamiReport({ status: 'unknown', reason: 'report_cancelled', validUntil: null }), reportTime)
    assert.equal(cancelled.reportState, 'cancelled')
    assert.equal(cancelled.status, 0)
})

test('NMEFC keeps its forecast height, arrival text and overall clearance independent of area grades', () => {
    const data = {
        reportId: 'cn-forecast', timeInfo: { issueTime: '2026-11-24 08:00:00' },
        warningInfo: { level: '蓝色' },
        forecasts: [{ forecastArea: 'test', warningLevel: '蓝色', estimatedArrivalTime: '２４日　０９：００' }],
    }
    const active = normalizeNmefcTsunami(data)
    assert.equal(active.status, 1)
    assert.equal(active.title, '海啸留意报')
    assert.equal(active.titleText, '现正发布海啸留意报')
    assert.equal(active.reportTime, data.timeInfo.issueTime)
    assert.deepEqual(JSON.parse(active.warnArea), [{
        name: 'test', grade: '蓝色', height: 0.3, description: '30cm',
        arrivalTime: '24日 09:00', className: 'blue',
    }])
    const clear = normalizeNmefcTsunami({ ...data, warningInfo: { level: '解除' } })
    assert.equal(clear.status, 0)
    assert.equal(clear.titleText, '海啸预警已解除')
    assert.equal(clear.warnArea, active.warnArea)
    const unknown = normalizeNmefcTsunami({ ...data, forecasts: [{ forecastArea: 'test', warningLevel: '未知' }] })
    assert.deepEqual(JSON.parse(unknown.warnArea), [{
        name: 'test', grade: '未知', height: 0, description: '', arrivalTime: '', className: 'gray',
    }])
})

test('orders by report time, terminal state and then validUntil, ignoring exact ties', () => {
    const active = normalizeJmaTsunami(tsunamiReport(), reportTime)
    const clear = normalizeJmaTsunami(tsunamiReport({ status: 'cleared' }), reportTime)
    assert.equal(shouldAcceptJmaTsunami(active, clear), true)
    assert.equal(shouldAcceptJmaTsunami(clear, active), false)
    assert.equal(shouldAcceptJmaTsunami(clear, { ...clear, reportState: 'expired' }), false)
    assert.equal(shouldAcceptJmaTsunami(active, { ...active, areaKey: 'changed' }), false)
    assert.equal(shouldAcceptJmaTsunami(active, { ...active, validUntilStamp: active.validUntilStamp + 1 }), true)
    assert.equal(shouldAcceptJmaTsunami(active, { ...active, validUntilStamp: active.validUntilStamp - 1 }), false)
    assert.equal(shouldAcceptJmaTsunami(clear, { ...active, reportTimeStamp: reportTime + 1 }), true)
    assert.equal(shouldAcceptJmaTsunami(active, { ...clear, reportTimeStamp: reportTime - 1 }), false)
    assert.equal(shouldAcceptJmaTsunami(clear, { ...clear, reportTimeStamp: reportTime + 1 }), true)
})

test('renewals/arrival changes are silent, height/level/membership changes trigger actions', () => {
    const before = normalizeJmaTsunami(tsunamiReport(), reportTime)
    const renewal = tsunamiReport({ validUntil: new Date(reportTime + 120000).toISOString() })
    renewal.areas.reverse()
    renewal.areas[1].firstWave = { condition: '津波到達中と推測', revise: '更新' }
    renewal.areas[1].name = '新しい名称'
    renewal.areas[1].maxWave.text = '3m'
    const after = normalizeJmaTsunami(renewal, reportTime)
    assert.equal(getJmaTsunamiAction(before, after), null)
    for (const mutate of [
        areas => { areas[0].maxWave.height = 4 },
        areas => { areas[0].maxWave.text = '３ｍ以上' },
        areas => { areas[0].level = 'advisory' },
        areas => { areas.pop() },
        areas => { areas.push({ code: '101', level: 'forecast' }) },
    ]) {
        const data = tsunamiReport(); mutate(data.areas)
        assert.equal(getJmaTsunamiAction(before, normalizeJmaTsunami(data, reportTime)).action, 'update')
    }
    const clear = normalizeJmaTsunami(tsunamiReport({ status: 'cleared' }), reportTime)
    assert.deepEqual(getJmaTsunamiAction(before, clear), { action: 'clear', status: 3, title: '津波警報' })
    assert.equal(getJmaTsunamiAction(clear, clear), null)
})

test('local expiry hides without mutating the report and renewal restores the same-time report', () => {
    const before = normalizeJmaTsunami(tsunamiReport(), reportTime)
    const original = structuredClone(before)
    const now = before.validUntilStamp + tsunamiExpiryGrace + 1
    assert.equal(getJmaTsunamiDisplayState(before, now), 'expired')
    assert.deepEqual(before, original)
    const next = normalizeJmaTsunami(tsunamiReport({ validUntil: new Date(now + 90000).toISOString() }), now)
    assert.equal(shouldAcceptJmaTsunami(before, next), true)
    assert.equal(getJmaTsunamiDisplayState(next, now), 'active')
    assert.equal(getJmaTsunamiAction(before, next), null)
    const data = tsunamiReport({ validUntil: new Date(now + 90000).toISOString() })
    data.areas[0].maxWave.height = 4
    assert.equal(getJmaTsunamiAction(before, normalizeJmaTsunami(data, now)).action, 'update')
})

test('semantic audio entries exist for all reachable transitions and forecast copies match', () => {
    for (const level of [1, 2, 3, 4]) for (const action of ['issue', 'update', 'clear', ...(level < 4 ? ['switch'] : [])]) {
        const url = chimeUrls.srev[getTsunamiSound(level, action)]
        assert.ok(url)
        assert.ok(existsSync(new URL('../public' + url, import.meta.url)))
    }
    const audio = action => readFileSync(new URL('../public' + chimeUrls.srev[getTsunamiSound(1, action)], import.meta.url))
    assert.deepEqual(audio('issue'), audio('update'))
    assert.deepEqual(audio('issue'), audio('switch'))
    assert.equal(Object.keys(chimeUrls.srev).some(key => /^tsunami\d/.test(key)), false)
})
