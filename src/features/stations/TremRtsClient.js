import Papa from 'papaparse'
import { gunzipSync, strFromU8 } from 'fflate'

export const parseTremStationList = text => {
    if(typeof text !== 'string') return {}
    const { data, errors } = Papa.parse(text, {
        header: true,
        skipEmptyLines: 'greedy',
        transformHeader: header => header.trim(),
        transform: value => value.trim()
    })
    if(errors.length > 0) return {}
    return Object.fromEntries(data.flatMap(row => {
        const { id, lat, lon } = row
        if(!id || !lat || !lon) return []
        const latitude = Number(lat), longitude = Number(lon)
        if(!Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
            !Number.isFinite(longitude) || Math.abs(longitude) > 180) return []
        return [[id, { info: [{ lat: latitude, lon: longitude }] }]]
    }))
}

// Live SSE and HTTP replay carry the same rts.v1 payload.
export const readTremFrame = payload => {
    if(!Number.isFinite(payload?.ts) || !payload.stations ||
        typeof payload.stations !== 'object' || Array.isArray(payload.stations)) return null
    return { timestamp: payload.ts, data: payload.stations }
}

export const decodeTremRtsPayload = data => {
    const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0))
    return JSON.parse(strFromU8(gunzipSync(bytes)))
}

export const connectTremRts = (url, onFrame) => {
    // EventSource handles SSE framing and reconnects after a lost connection.
    const source = new EventSource(url)
    let closed = false
    const handleFrame = event => {
        if(closed) return
        try {
            const frame = readTremFrame(decodeTremRtsPayload(event.data))
            if(frame) onFrame(frame)
        }
        catch(err) {
            console.log('TREM RTS 数据解析失败', err)
        }
    }
    source.addEventListener('trem.rts.v1', handleFrame)
    return () => {
        closed = true
        source.removeEventListener('trem.rts.v1', handleFrame)
        source.close()
    }
}
