// Run with: node etc/hypocenter/test/nied_trigger.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

// Exercise the production station class, replacing only its UI dependencies.
const source = readFileSync(new URL('../../../src/classes/StationClasses.js', import.meta.url), 'utf8')
const start = source.indexOf('export class NiedStation')
const end = source.indexOf('export class KmaStation', start)
assert(start >= 0 && end > start)
const NiedStation = runInNewContext(`${source.slice(start, end).replace('export class', 'class')}; NiedStation`, {
    markRaw: value => value,
    settingsStore: {},
    abnormalNiedStations: {},
    getShindoFromChar: () => 0
})
const origin = Date.parse('2026-06-16T18:46:34+08:00')
const repeat = (level, count) => Array(count).fill(level)
const createStation = () => new NiedStation(null, 843, [35.9829, 139.7456], 'f', true)
const append = (station, level, index) => station.update(String.fromCharCode(level + 100), origin + index * 1000, false)
const replay = levels => {
    const station = createStation()
    levels.forEach((level, index) => append(station, level, index))
    return station
}
let checked = 0
const check = (name, levels, ascend, triggerIndex) => {
    const station = replay(levels)
    assert.equal(station.ascend, ascend, `${name}: ascend`)
    assert.equal(station.triggerStamp, triggerIndex === null ? 0 : origin + triggerIndex * 1000, `${name}: triggerStamp`)
    checked++
}

assert.deepEqual({ ...createStation().calcAscend() }, { ascend: 0, triggerStamp: 0 })
check('constant background', repeat(2, 12), 0, null)
check('+1 survives four samples', [2, ...repeat(3, 4)], 1, 0)
check('+1 expires on the fifth sample', [2, ...repeat(3, 5)], 0, null)
check('strong follow-up bridges four weak samples', [2, ...repeat(3, 4), 10], 8, 0)
check('strong follow-up cannot revive five weak samples', [2, ...repeat(3, 5), 10], 7, 5)
check('SIT008 eight-second weak plateau', [2, ...repeat(3, 8), 10], 7, 8)
check('1 -> 2 plateau -> 3 -> 8 trims to the last 2', [1, 2, 2, 2, 2, 2, 3, 8], 6, 5)
check('gradual follow-up cannot revive an expired weak rise', [2, ...repeat(3, 5), 4, 10], 7, 5)
check('successive short rises may span more than eight seconds', [2, ...repeat(3, 4), ...repeat(4, 4), ...repeat(5, 4), 10], 8, 0)
check('1 -> 8 -> 9 retains eight seconds', [1, 8, ...repeat(9, 8)], 8, 0)
check('1 -> 8 -> 9 expires on the ninth sample', [1, 8, ...repeat(9, 9)], 0, null)
check('two consecutive +1 rises retain eight seconds', [1, 2, ...repeat(3, 8)], 2, 0)
check('a connected strong plateau supports the next +1 rise', [1, ...repeat(8, 8), ...repeat(9, 8)], 8, 0)
check('an expired strong rise cannot support a later +1 rise', [1, ...repeat(8, 9), ...repeat(9, 5)], 0, null)
check('a later jump cannot revive either expired rise', [1, ...repeat(8, 9), ...repeat(9, 5), 15], 6, 14)
check('strong follow-up bridges a cumulative strong rise', [1, 8, ...repeat(9, 8), 15], 14, 0)
check('a shallow valley preserves cumulative rise strength', [1, 8, 7, 8, ...repeat(9, 8)], 8, 0)
check('a shallow dip does not turn an established rise into a weak rise', [1, 3, ...repeat(2, 5), 3], 2, 0)
check('after trimming, a return to the new baseline updates the onset', [1, ...repeat(2, 5), 3, 2, 3], 1, 7)
check('a deep fall separates an earlier strong rise', [1, 8, ...repeat(6, 3), ...repeat(7, 5)], 0, null)
check('+2 survives eight samples', [2, ...repeat(4, 8)], 2, 0)
check('+2 expires on the ninth sample', [2, ...repeat(4, 9)], 0, null)
check('strong follow-up bridges eight strong samples', [2, ...repeat(4, 8), 10], 8, 0)
check('strong follow-up cannot revive nine strong samples', [2, ...repeat(4, 9), 10], 6, 9)
check('larger rise retains eight-second tolerance', [2, ...repeat(7, 8), 10], 8, 0)
check('one-sample deep valley is still smoothed', [2, 4, 6, 3, 6, 10], 8, 0)
check('two-sample deep valley is still smoothed', [2, 4, 6, 3, 3, 6, 10], 8, 0)
check('an onset on a filled one-sample deep valley remains invalid', [1, ...repeat(2, 5), 0, 8], 6, null)
check('an onset on a filled two-sample deep valley remains invalid', [1, ...repeat(2, 5), 0, 0, 8], 6, null)
check('a real plateau sample after the smoothed valley becomes the onset', [1, ...repeat(2, 5), 0, 2, 8], 6, 7)
check('a filled valley within the four-sample limit preserves the weak rise', [1, ...repeat(2, 3), 0, 8], 7, 0)
check('a filled valley crossing the four-sample limit leaves the onset uncertain', [1, ...repeat(2, 4), 0, 8], 6, null)
check('a strong rise across a smoothed valley still retains eight seconds', [1, 8, 4, ...repeat(9, 8)], 8, 0)
check('long deep valley still separates rises', [2, 5, 3, 3, 3, 10], 7, 4)
check('shallow valley can still be crossed', [2, 4, 5, 4, 5, 10], 8, 0)
check('missing-value bridging is not globally shortened', [2, 4, ...repeat(-1, 5), 10], 8, 0)
check('an onset on a filled gap remains invalid after weak-prefix trimming', [1, ...repeat(2, 5), -1, 8], 6, null)
check('overlong missing gap still truncates history', [2, 4, ...repeat(-1, 9), 10], 0, null)
check('missing gap without an older sample still truncates history', [...repeat(-1, 3), 10], 0, null)

// Expiry must persist when a later strong rise arrives, regardless of activation.
for(const active of [false, true]) {
    const station = createStation()
    station.isActive = active
    station.activeTimer = 'existing activation timer'
    const history = [2, ...repeat(3, 8), 10, 11]
    history.forEach((level, index) => {
        append(station, level, index)
        assert.equal(station.isActive, active)
        assert.equal(station.activeTimer, 'existing activation timer')
        if(index >= 5 && index <= 8) assert.equal(station.triggerStamp, 0)
        if(index >= 9) assert.equal(station.triggerStamp, origin + 8000)
    })
    checked++
}
console.log(`NIED trigger checks passed (${checked} cases plus empty history).`)
