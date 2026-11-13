const intensityMapping = [-3, -2, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, -1, 0, 1]

export class KmaPewsProtocolError extends Error {
    constructor(message, code = 'PEWS_INVALID_MESSAGE') {
        super(message)
        this.name = 'KmaPewsProtocolError'
        this.code = code
    }
}

export const decodeKmaPewsMessage = buffer => {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 7) {
        throw new KmaPewsProtocolError('Invalid PEWS binary header')
    }
    const view = new DataView(buffer)
    const tag = view.getUint8(0)
    if ((tag >>> 4) !== 1) {
        throw new KmaPewsProtocolError('Unsupported PEWS version', 'PEWS_UNSUPPORTED_VERSION')
    }
    const type = tag & 15
    if (type !== 1 && type !== 2) throw new KmaPewsProtocolError('Unknown PEWS message type')
    const count = view.getUint16(5, false)
    const width = type === 1 ? 20 : 4
    if (count === 0 || buffer.byteLength !== 7 + Math.ceil(count * width / 8)) {
        throw new KmaPewsProtocolError('Invalid PEWS count or payload length')
    }
    const payload = new Uint8Array(buffer, 7)
    if ((count & 1) && (payload[payload.length - 1] & 15)) {
        throw new KmaPewsProtocolError('Nonzero PEWS padding')
    }
    const timestampMs = view.getUint32(1, false) * 1000
    const frameTime = new Date(timestampMs + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ')
    if (type === 1) {
        const staLatLng = new Array(count)
        for (let index = 0; index < count; index++) {
            const offset = Math.floor(index * 20 / 8)
            const word = (payload[offset] << 16) | (payload[offset + 1] << 8) | payload[offset + 2]
            const code = (index & 1) ? word & 0xfffff : word >>> 4
            const latitudeCode = code >>> 10
            const longitudeCode = code & 1023
            const longitudeBase = (latitudeCode === 748 && longitudeCode === 89)
                || (latitudeCode === 751 && longitudeCode === 81) ? 13000 : 12000
            staLatLng[index] = {
                latitude: (3000 + latitudeCode) / 100,
                longitude: (longitudeBase + longitudeCode) / 100,
            }
        }
        return { type: 'station_list', data: { frameTime, timestampMs, staLatLng } }
    }
    const mmi = new Array(count)
    for (let index = 0; index < count; index++) {
        const code = (payload[index >>> 1] >>> ((index & 1) ? 0 : 4)) & 15
        if (code === 15) throw new KmaPewsProtocolError('Undefined PEWS intensity code 15')
        mmi[index] = intensityMapping[code]
    }
    return { type: 'station_int', data: { frameTime, timestampMs, mmi } }
}
