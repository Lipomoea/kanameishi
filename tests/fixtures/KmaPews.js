export const createPewsFrame = (type, values, second = 0) => {
    const width = type === 1 ? 20 : 4
    const bits = values.map(value => value.toString(2).padStart(width, '0')).join('')
    const bytes = new Uint8Array(7 + Math.ceil(bits.length / 8))
    const view = new DataView(bytes.buffer)
    view.setUint8(0, 0x10 | type)
    view.setUint32(1, second, false)
    view.setUint16(5, values.length, false)
    for (let offset = 0; offset < bits.length; offset += 8) {
        bytes[7 + offset / 8] = parseInt(bits.slice(offset, offset + 8).padEnd(8, '0'), 2)
    }
    return bytes.buffer
}
