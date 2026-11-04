const numberOrNull = value => Number.isFinite(value) ? value : null
const textOrEmpty = value => typeof value === 'string' ? value : ''

// Both providers use the complete USGS feature.id and upstream millisecond times.
export const normalizeUsgsEvent = (data, provider) => {
    if (!data || typeof data !== 'object') return null
    let event
    if (provider === 'lipo') {
        event = {
            id: data.eventId,
            originTimeStamp: data.originTimeStamp,
            versionTime: data.reportTimeStamp,
            latitude: numberOrNull(data.latitude),
            longitude: numberOrNull(data.longitude),
            depth: numberOrNull(data.depth),
            magnitude: numberOrNull(data.magnitude),
            magnitudeType: textOrEmpty(data.magnitudeType),
            epicenter: textOrEmpty(data.epicenter),
            reviewType: textOrEmpty(data.reviewType),
            url: textOrEmpty(data.url),
        }
    } else {
        const { properties, geometry } = data
        if (!properties || !Array.isArray(geometry?.coordinates)) return null
        const [longitude, latitude, depth] = geometry.coordinates
        event = {
            id: data.id,
            originTimeStamp: properties.time,
            versionTime: properties.updated,
            latitude: numberOrNull(latitude),
            longitude: numberOrNull(longitude),
            depth: numberOrNull(depth),
            magnitude: numberOrNull(properties.mag),
            magnitudeType: textOrEmpty(properties.magType),
            epicenter: textOrEmpty(properties.place),
            reviewType: textOrEmpty(properties.status),
            url: textOrEmpty(properties.url),
        }
    }
    if (typeof event.id !== 'string' || !event.id
        || !Number.isSafeInteger(event.originTimeStamp) || !Number.isSafeInteger(event.versionTime)) return null
    return event
}

const encoder = new TextEncoder()

export const hashUsgsContent = event => {
    // Explicit field order excludes report times, URLs, DYFI and ShakeMap metadata.
    const content = JSON.stringify([
        event.originTimeStamp, event.latitude, event.longitude, event.depth,
        event.magnitude, event.magnitudeType, event.epicenter, event.reviewType,
    ])
    // FNV-1a 64-bit: a synchronous content fingerprint, not an authentication digest.
    let hash = 0xcbf29ce484222325n
    for (const byte of encoder.encode(content)) {
        hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n)
    }
    return hash.toString(16).padStart(16, '0')
}
