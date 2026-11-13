import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeKmaPewsMessage, KmaPewsProtocolError } from '../src/utils/KmaPews.js'
import { createPewsFrame } from './fixtures/KmaPews.js'

test('PEWS decodes all 15 valid intensity codes, preserving zero and no-data values', () => {
    const bytes = Uint8Array.from([0x12, 0, 0, 0, 0, 0, 15, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xe0])
    assert.deepEqual(decodeKmaPewsMessage(bytes.buffer), {
        type: 'station_int',
        data: {
            timestampMs: 0,
            frameTime: '1970-01-01 09:00:00',
            mmi: [-3, -2, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, -1, 0, 1],
        },
    })
})

const coordinateCases = [
    { code: 748 * 1024 + 89, latitude: 37.48, longitude: 130.89 },
    { code: 751 * 1024 + 81, latitude: 37.51, longitude: 130.81 },
    { code: 0, latitude: 30, longitude: 120 },
    { code: 1023 * 1024 + 1023, latitude: 40.23, longitude: 130.23 },
    { code: 751 * 1024 + 81, latitude: 37.51, longitude: 130.81 },
    { code: 748 * 1024 + 89, latitude: 37.48, longitude: 130.89 },
]
for (const count of [1, 2, 3, 6, 265, 65535]) {
    test(`PEWS decodes ${count} packed coordinates in order, including both island exceptions`, () => {
        const coordinates = Array.from({ length: count }, (_, index) => coordinateCases[index % coordinateCases.length])
        const frame = createPewsFrame(1, coordinates.map(coordinate => coordinate.code))
        const message = decodeKmaPewsMessage(frame)
        assert.equal(message.type, 'station_list')
        assert.deepEqual(message.data.staLatLng, coordinates.map(({ latitude, longitude }) => ({ latitude, longitude })))
        if (count === 265) assert.equal(frame.byteLength, 670)
    })
}

for (const count of [2, 265, 65535]) {
    test(`PEWS decodes exactly ${count} intensities without treating padding as a station`, () => {
        const frame = createPewsFrame(2, Array(count).fill(14))
        assert.deepEqual(decodeKmaPewsMessage(frame).data.mmi, Array(count).fill(1))
        if (count === 265) assert.equal(frame.byteLength, 140)
    })
}

test('PEWS keeps unsigned UTC seconds and formats UTC+9 correctly across midnight', () => {
    for (const [second, frameTime] of [
        [Date.parse('2026-11-04T14:59:59Z') / 1000, '2026-11-04 23:59:59'],
        [Date.parse('2026-11-04T15:00:00Z') / 1000, '2026-11-05 00:00:00'],
        [0xffffffff, '2106-02-07 15:28:15'],
    ]) {
        const { data } = decodeKmaPewsMessage(createPewsFrame(2, [13], second))
        assert.equal(data.timestampMs, second * 1000)
        assert.equal(data.frameTime, frameTime)
    }
})

test('PEWS rejects invalid headers, versions, types, counts, lengths, padding, and code 15', () => {
    const invalidFrames = [null, '', [], new Uint8Array(8)]
    for (let length = 0; length < 7; length++) invalidFrames.push(new ArrayBuffer(length))
    for (const type of [1, 2]) {
        invalidFrames.push(createPewsFrame(type, []))
        const valid = createPewsFrame(type, [0])
        invalidFrames.push(valid.slice(0, -1))
        const extra = new Uint8Array(valid.byteLength + 1)
        extra.set(new Uint8Array(valid))
        invalidFrames.push(extra.buffer)
        const badPadding = new Uint8Array(valid.slice(0))
        badPadding[badPadding.length - 1] |= 1
        invalidFrames.push(badPadding.buffer)
        const badCount = valid.slice(0)
        new DataView(badCount).setUint16(5, 3, false)
        invalidFrames.push(badCount)
    }
    for (const tag of [0x10, 0x13, 0x1f]) {
        const frame = createPewsFrame(2, [1])
        new DataView(frame).setUint8(0, tag)
        invalidFrames.push(frame)
    }
    invalidFrames.push(createPewsFrame(2, [15]), createPewsFrame(2, [1, 15]))
    for (const frame of invalidFrames) {
        assert.throws(() => decodeKmaPewsMessage(frame), {
            name: 'KmaPewsProtocolError', code: 'PEWS_INVALID_MESSAGE',
        })
    }
    const unsupported = createPewsFrame(2, [1])
    new DataView(unsupported).setUint8(0, 0x22)
    assert.throws(() => decodeKmaPewsMessage(unsupported), error =>
        error instanceof KmaPewsProtocolError && error.code === 'PEWS_UNSUPPORTED_VERSION')
})
