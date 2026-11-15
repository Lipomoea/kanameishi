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

export const connectTremRts = (url, onFrame, fallbackUrls = []) => {
    const urls = [...new Set([url, ...fallbackUrls])]
    const retryDelays = [1000, 2000, 3000, 5000]
    const networkEvents = typeof window === 'undefined' ? null : window
    let stopped = false
    let connection = null
    let retryTimer = null
    let sourceIndex = 0
    let failures = 0
    let sourceFailures = 0
    const isCurrent = attempt => !stopped && connection === attempt
    const closeConnection = () => {
        const previous = connection
        connection = null
        if(!previous) return
        clearTimeout(previous.timer)
        previous.source?.removeEventListener('trem.rts.v1', previous.handleFrame)
        previous.source?.removeEventListener('error', previous.handleError)
        previous.source?.removeEventListener('close', previous.handleError)
        previous.source?.close()
    }
    const retry = attempt => {
        if(!isCurrent(attempt)) return
        closeConnection()
        failures++
        sourceFailures++
        if(sourceFailures >= 2) {
            sourceIndex = (sourceIndex + 1) % urls.length
            sourceFailures = 0
        }
        const timer = setTimeout(() => {
            if(retryTimer !== timer) return
            retryTimer = null
            connect()
        }, retryDelays[Math.min(failures - 1, retryDelays.length - 1)])
        retryTimer = timer
    }
    const watchData = (attempt, timeout) => {
        clearTimeout(attempt.timer)
        const timer = setTimeout(() => {
            if(attempt.timer !== timer) return
            retry(attempt)
        }, timeout)
        attempt.timer = timer
    }
    const connect = () => {
        if(stopped || connection) return
        const attempt = { source: null, timer: null, handleFrame: null, handleError: null }
        connection = attempt
        attempt.handleError = () => retry(attempt)
        attempt.handleFrame = event => {
            if(!isCurrent(attempt)) return
            try {
                const frame = readTremFrame(decodeTremRtsPayload(event.data))
                if(!frame) return
                failures = 0
                sourceFailures = 0
                watchData(attempt, 5000)
                onFrame(frame)
            }
            catch(err) {
                console.log('TREM RTS 数据解析失败', err)
            }
        }
        try {
            attempt.source = new EventSource(urls[sourceIndex])
            attempt.source.addEventListener('trem.rts.v1', attempt.handleFrame)
            attempt.source.addEventListener('error', attempt.handleError)
            attempt.source.addEventListener('close', attempt.handleError)
            watchData(attempt, 10000)
        }
        catch(err) {
            console.log('TREM RTS 连接失败', err)
            retry(attempt)
        }
    }
    const handleOnline = () => {
        if(stopped || retryTimer === null) return
        clearTimeout(retryTimer)
        retryTimer = null
        connect()
    }
    networkEvents?.addEventListener('online', handleOnline)
    connect()
    return () => {
        stopped = true
        clearTimeout(retryTimer)
        retryTimer = null
        closeConnection()
        networkEvents?.removeEventListener('online', handleOnline)
    }
}
