import { calcLngDiff, compareFloat, timeToStamp } from '@/utils/Utils'

// Source-level relationships do not assign every station/grid to an individual EEW.
export const eewNetworkRelations = [
    {
        id: 'taiwan',
        eewSource: 'cwaEew',
        networkSources: ['palertNet', 'tremNet'],
        gridPane: 'taiwanGridPane',
        inferenceSources: { palertNet: 'palertInfHypo' }
    },
    {
        id: 'japan',
        eewSource: 'jmaEew',
        networkSources: ['niedNet'],
        gridPane: 'niedGridPane',
        inferenceSources: { niedNet: 'niedInfHypo' }
    },
    {
        id: 'korea',
        eewSource: 'kmaEew',
        networkSources: ['kmaNet'],
        gridPane: 'kmaGridPane',
        inferenceSources: {}
    }
]

export const getEewNetworkRelation = eewSource =>
    eewNetworkRelations.find(relation => relation.eewSource === eewSource)

export const getNetworkEewRelation = networkSource =>
    eewNetworkRelations.find(relation => relation.networkSources.includes(networkSource))

export const getGridNetworkRelation = gridPane =>
    eewNetworkRelations.find(relation => relation.gridPane === gridPane)

export const shouldIncludeEewSWaveBounds = (eewSource, isActive) => {
    const relation = getEewNetworkRelation(eewSource)
    return !relation || !relation.networkSources.some(source => isActive[source])
}

// This controls visibility only. Hidden detection grids still contribute view bounds.
// Inference activity keys describe displayed results, not all solver candidates.
export const shouldDisplayNetworkGrid = (gridPane, isActive, alwaysDisplayGrid = false) => {
    if(alwaysDisplayGrid) return true
    const relation = getGridNetworkRelation(gridPane)
    return !relation || !(isActive[relation.eewSource] ||
        Object.values(relation.inferenceSources).some(source => isActive[source]))
}

export const isNetworkPeriodActive = (networkSource, isActive) => {
    const relation = getNetworkEewRelation(networkSource)
    // Networks sharing a grid retain independent period statistics.
    return !!(isActive[networkSource] || relation && isActive[relation.eewSource])
}

const hypoInfEewMatchThreshold = { lat: 1, lng: 1, depth: 100, originStamp: 10000 }
const minDisplayedHypocenterQualityScore = -3

export const matchesAssociatedEewHypocenter = (networkSource, result, eqMessage) => {
    const relation = getNetworkEewRelation(networkSource)
    if(!relation || eqMessage?.source !== relation.eewSource) return false
    if(eqMessage.isAssumption || eqMessage.isCanceled) return false
    if(!result?.hypocenter || !Number.isFinite(result.originStamp)) return false
    if(!Number.isFinite(eqMessage.lat) || !Number.isFinite(eqMessage.lng)) return false
    if(!Number.isFinite(eqMessage.depth)) return false
    const eewOriginStamp = timeToStamp(eqMessage.originTime, eqMessage.timeZone)
    if(!Number.isFinite(eewOriginStamp) || eewOriginStamp <= 0) return false
    const hypocenter = result.hypocenter
    return compareFloat(Math.abs(hypocenter.lat - eqMessage.lat), hypoInfEewMatchThreshold.lat) <= 0 &&
        compareFloat(calcLngDiff(hypocenter.lng, eqMessage.lng), hypoInfEewMatchThreshold.lng) <= 0 &&
        Math.abs((hypocenter.depth ?? 10) - eqMessage.depth) <= hypoInfEewMatchThreshold.depth &&
        Math.abs(result.originStamp - eewOriginStamp) <= hypoInfEewMatchThreshold.originStamp
}

export const shouldDisplayInferredHypocenter = (networkSource, result, activeEewList, alwaysDisplay = false) => {
    if(result.qualityScore < minDisplayedHypocenterQualityScore) return false
    if(alwaysDisplay) return true
    return !Array.isArray(activeEewList) || !activeEewList.some(event =>
        matchesAssociatedEewHypocenter(networkSource, result, event?.eqMessage))
}
