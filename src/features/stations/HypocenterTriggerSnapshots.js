// Weak/unactivated triggers are association evidence, without being submitted as picks.
export const createHypocenterTriggerSnapshots = stations => stations
    .filter(station => Number.isFinite(station.triggerStamp) && station.triggerStamp > 0)
    .map(station => ({
        stationId: station.id,
        latLng: [...station.latLng],
        triggerStamp: station.triggerStamp
    }))
