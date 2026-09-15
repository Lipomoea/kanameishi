// node etc/utils/test/exact_round.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Exercise the production helper without loading the app's stores, map data or native APIs.
const source = readFileSync(new URL('../../../src/utils/Utils.js', import.meta.url), 'utf8')
const start = source.indexOf('export const exactRound =')
const end = source.indexOf('export const getCoordByDistanceBearing =', start)
assert(start >= 0 && end > start)
const { exactRound, compareFloat } = new Function(
    source.slice(start, end).replace(/^export /gm, '') + '\nreturn { exactRound, compareFloat };'
)()

for (const [input, digit, expected] of [
    [1.005, 2, 1.01], [2.675, 2, 2.68],
    [-1.005, 2, -1], [-1.015, 2, -1.01],
    [1.5, 0, 2], [-1.5, 0, -1], [-0.4, 0, 0], [0, 12, 0],
    [0.4 * 1.5, 12, 0.6], [32.7 - 31.7, 12, 1], [32.01 - 0.51, 12, 31.5],
    [0.599999, 12, 0.599999], [0.5999999999996, 12, 0.6],
    [1e-7, 12, 1e-7], [1e-7, 7, 1e-7], [1e-7, 6, 0],
    [1.2345e-7, 10, 1.235e-7], [1.235e-7, 9, 1.24e-7], [-1.235e-7, 9, -1.23e-7],
    [1.2345e21, 0, 1.2345e21], [1.2345e21, 12, 1.2345e21],
    [1234, -2, 1200], [1250, -2, 1300], [-1250, -2, -1200], [1.235e21, -19, 1.24e21],
    [Number.MAX_VALUE, 12, Number.MAX_VALUE],
    [Number.MIN_VALUE, 12, 0], [Number.MIN_VALUE, 324, Number.MIN_VALUE],
]) {
    assert.equal(exactRound(input, digit), expected, `exactRound(${input}, ${digit})`)
}
console.log('PASS decimal rounding, floating boundaries, scientific notation, negative ties and extreme magnitudes')

for (const input of [NaN, Infinity, -Infinity]) {
    assert(Number.isNaN(exactRound(input, 2)))
}
for (const digit of [undefined, NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert(Number.isNaN(exactRound(1.25, digit)))
}
console.log('PASS non-finite input and invalid precision handling')

for (const [a, b, digit, expected] of [
    [0.6, 0.4 * 1.5, 12, 0], [32.7 - 31.7, 1, 12, 0],
    [0.599999, 0.6, 12, -1], [0.600001, 0.6, 12, 1],
    [0.6, 0.4 * 1.5, 16, -1],
    [0.6049, 0.6051, 2, -1],
    [-1.005, -1, 2, 0], [-1.015, -1, 2, -1],
    [1e-7, 2e-7, 8, -1], [1e-7, 2e-7, 6, 0],
    [1.2345e21, 1.2345e21, 12, 0], [0, -0, 12, 0],
]) {
    assert.equal(compareFloat(a, b, digit), expected, `compareFloat(${a}, ${b}, ${digit})`)
    assert.equal(compareFloat(b, a, digit), expected === 0 ? 0 : -expected, 'Reversing operands reverses the ordering')
}
console.log('PASS comparison ordering, rounded equality, caller-selected precision and scientific notation')

assert.equal(compareFloat(0.6, 0.4 * 1.5), 0)
assert.equal(compareFloat(0.6, 0.60000000004, undefined), 0)
assert.equal(compareFloat(0.6, 0.6000000001), -1)
assert.equal(compareFloat(0.6, 0.60000000004, 12), -1)
console.log('PASS default ten-decimal precision and explicit precision override')

for (const args of [
    [NaN, 1, 2], [1, NaN, 2], [Infinity, 1, 2], [1, -Infinity, 2],
    [1, 1, NaN], [1, 1, 1.5], [1, 1, Number.MAX_SAFE_INTEGER + 1],
]) {
    const result = compareFloat(...args)
    assert(Number.isNaN(result))
    assert.equal(result >= 0, false)
    assert.equal(result <= 0, false)
    assert.equal(result === 0, false)
}
console.log('PASS invalid comparisons cannot satisfy inclusive bounds or equality')
