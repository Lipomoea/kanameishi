const mergeMetrics = (previous, next) => ({
    ...previous,
    ...next,
    createdStamp: Math.min(previous.createdStamp ?? previous.updateStamp, next.createdStamp ?? next.updateStamp),
    updateStamp: Math.max(previous.updateStamp || 0, next.updateStamp || 0),
    maxLevel: Math.max(previous.maxLevel ?? -1, next.maxLevel ?? -1),
    secondMaxLevel: Math.max(previous.secondMaxLevel ?? -1, next.secondMaxLevel ?? -1)
})

export const mergePalertHypocenterUpdates = (previous, next) => {
    if(!previous) return next
    const picks = new Map()
    for(const pick of [...(previous.pickCandidates || []), ...(next.pickCandidates || [])]) {
        if(!pick?.pickId) continue
        const old = picks.get(pick.pickId)
        picks.set(pick.pickId, old ? mergeMetrics(old, pick) : pick)
    }
    const previousStations = new Map((previous.activeStations || []).map(station => [station.id, station]))
    return {
        ...next,
        pickCandidates: [...picks.values()],
        activeStations: (next.activeStations || []).map(station => {
            const old = previousStations.get(station.id)
            return old && Number.isFinite(station.triggerStamp) && station.triggerStamp > 0 &&
                old.triggerStamp === station.triggerStamp ? mergeMetrics(old, station) : station
        })
    }
}

export const createPalertHypocenterUpdate = stations => {
    const snapshot = station => ({
        id: station.id,
        latLng: [...station.latLng],
        triggerStamp: station.triggerStamp,
        updateStamp: station.updateStamp,
        level: station.level,
        maxLevel: station.maxLevel,
        secondMaxLevel: station.secondMaxLevel,
        isActive: station.isActive
    })
    const activeSources = stations.filter(station => station.isActive)
    const activeStations = activeSources.map(snapshot)
    return {
        // A pick can close on this frame while its station remains active. Send its final metrics once more.
        pickCandidates: activeSources.flatMap((station, index) => station.completedPick
            ? [{ ...activeStations[index], ...station.completedPick }, activeStations[index]]
            : [activeStations[index]])
            .filter(station => Number.isFinite(station.triggerStamp) && station.triggerStamp > 0)
            .map(({ id, ...station }) => ({
                ...station, stationId: id, pickId: `${id}:${station.triggerStamp}`
            })),
        activeStations,
        inactiveStations: stations.filter(station => station.isPenaltyStation()).map(station => ({
            ...snapshot(station), nonQuietBoundaryStamp: station.nonQuietBoundaryStamp
        }))
    }
}
