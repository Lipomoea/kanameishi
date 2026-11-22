import { formatShindo, getShindoRank } from '@/utils/Utils'

const detailTitle = '震源・震度情報'
const bulletinTitle = '震度速報'
const cacheDuration = 5 * 60 * 1000
const list = value => Array.isArray(value) ? value : []
const issuedAt = report => {
    const time = Date.parse(report?.issuedAt)
    return Number.isFinite(time) ? time : -Infinity
}
const intensity = value => getShindoRank(value) >= 0
    ? formatShindo(value.trim().replaceAll('强', '強'), false) : '不明'
const atIndex = (values, index) => Number.isInteger(index) && index >= 0 ? values?.[index] : undefined

export const selectJmaIntensityReport = event => {
    if(event?.status === 'cancelled') return null
    const reports = list(event?.reports)
    for(const title of [detailTitle, bulletinTitle]) {
        let selected = null
        for(const report of reports) {
            if(report?.title !== title || report.status === 'cancelled') continue
            if(!selected || issuedAt(report) >= issuedAt(selected)) selected = report
        }
        if(selected) return selected
    }
    return null
}

export const normalizeJmaIntensityEvent = event => {
    const report = selectJmaIntensityReport(event)
    if(!report) return null
    const observation = report.observation ?? {}
    const rawAreas = list(observation.areas)
    const areas = rawAreas.filter(area => typeof area?.code === 'string').map(area => ({
        code: area.code, name: area.name ?? '', intensity: intensity(area.int),
    }))
    const stations = new Map()
    const addStations = (items, area) => {
        for(const station of list(items)) {
            if(typeof station?.code !== 'string') continue
            stations.set(station.code, {
                code: station.code, name: station.name ?? '', intensity: intensity(station.int),
                areaCode: area?.code ?? '',
            })
        }
    }
    for(const area of rawAreas) addStations(area?.stations, area)
    for(const city of list(observation.cities)) {
        addStations(city?.stations, atIndex(rawAreas, city?.area))
    }
    return {
        eventId: event.eventId, title: report.title, reportId: report.id ?? '', issuedAt: report.issuedAt ?? null,
        areas, stations: [...stations.values()],
    }
}

export const mergeJmaHistoryAreas = events => {
    const areas = {}
    for(const event of events) {
        for(const area of event.jmaDetail?.areas ?? []) {
            const rank = getShindoRank(area.intensity)
            if(rank < 0) continue
            if(!areas[area.code] || rank > getShindoRank(areas[area.code].intensity)) areas[area.code] = area
        }
    }
    return areas
}

export class JmaEarthquakeDetailCache {
    constructor(request, now = Date.now) {
        this.request = request
        this.now = now
        this.events = new Map()
        this.pending = null
    }
    async get(eventId) {
        const cached = this.events.get(eventId)
        const age = cached ? this.now() - cached.fetchedAt : Infinity
        if(cached?.detail.title === detailTitle && age >= 0 && age < cacheDuration) return cached.detail
        if(!this.pending) {
            this.pending = this.refresh().finally(() => { this.pending = null })
        }
        await this.pending
        return this.events.get(eventId)?.detail ?? null
    }
    async refresh() {
        const response = await this.request(this.now())
        if(!Array.isArray(response?.events)) throw new Error('INVALID_JMA_DETAIL')
        const fetchedAt = this.now(), events = new Map()
        for(const event of response.events) {
            if(typeof event?.eventId !== 'string' || !event.eventId) continue
            const detail = normalizeJmaIntensityEvent(event)
            if(detail) events.set(event.eventId, { detail, fetchedAt })
        }
        // Replace the snapshot to bound memory; displayed events hold their own compact data.
        this.events = events
    }
}
