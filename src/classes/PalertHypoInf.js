import { FindHypocenter } from './FindHypocenter'
import { palertHypocenterProfile } from './PalertHypocenterProfile'

export class FindPalertHypocenter extends FindHypocenter {
    constructor(inactiveStations, adjStations, stationDensityWeights = null, stationDistanceTable = null) {
        super(inactiveStations, adjStations, palertHypocenterProfile, stationDensityWeights, stationDistanceTable)
    }

    setInactiveStations(inactiveStations) {
        const stations = Array.from(inactiveStations || [])
        const key = JSON.stringify(stations.map(station => [
            station.id, station.nonQuietBoundaryStamp, station.latLng, Number.isFinite(station.updateStamp)
        ]))
        this.inactiveStations = stations
        this.inactiveStationMap = new Map(stations.map(station => [station.id, station]))
        // Refresh snapshots on every batch, but only eligibility/position changes require a refit.
        this.inactivePenaltyCandidateCache = new WeakMap()
        if(this.inactiveStationsKey === key) return
        this.inactiveStationsKey = key
        this.inactiveStationsVersion++
        this.clusters.forEach(cluster => this.markClusterUpdated(cluster))
    }

    getInactivePenaltyCandidates(picks) {
        const cached = this.inactivePenaltyCandidateCache.get(picks)
        // Pick timestamps are immutable; additions can change the start of the same cluster array.
        if(cached?.version === this.inactiveStationsVersion && cached.pickCount === picks.length) return cached.stations
        const clusterStartStamp = picks.reduce((earliest, pick) =>
            this.hasValidTriggerStamp(pick) ? Math.min(earliest, pick.triggerStamp) : earliest, Infinity)
        const clusterStationIds = new Set(picks.map(pick => pick.stationId))
        const stations = Number.isFinite(clusterStartStamp)
            ? [...this.inactiveStationMap.values()].filter(station =>
                Number.isFinite(station.nonQuietBoundaryStamp) && station.nonQuietBoundaryStamp < clusterStartStamp &&
                !clusterStationIds.has(station.id)
            ) : []
        this.inactivePenaltyCandidateCache.set(picks, {
            version: this.inactiveStationsVersion, pickCount: picks.length, stations
        })
        return stations
    }
}
