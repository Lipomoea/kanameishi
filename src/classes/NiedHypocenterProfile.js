import travelTimes from '@/utils/TravelTimes'

const minResidualThreshold = 5000
const nearTravelTimeMaxDistance = 2000

// Treat the profile as fixed for the lifetime of a finder and its caches.
export const niedHypocenterProfile = {
    logPrefix: '[FindNiedHypocenter]',
    parameters: {
        hypocenterSearchSteps: [
            { degree: 3, depth: 100 },
            { degree: 1, depth: 50 },
            { degree: 0.3, depth: 20 },
            { degree: 0.1, depth: 10 }
        ],
        maxHypocenterSearchIterations: 1000,
        initialDepth: 10,
        minDepth: 0,
        maxDepth: 700,
        initialLatLngDigits: 1,
        clusterMergeThreshold: {
            lat: 1,
            lng: 1,
            depth: 100,
            originStamp: 10000
        },
        minInferenceStationCount: 5,
        penaltyFullWeightStationCount: 0,
        penaltyZeroWeightStationCount: 50,
        penaltyFullWeight: 10,
        penaltyBreadthKmPerStation: 10,
        penaltyReferenceQuantile: 0.9,
        pickAssociationVelocity: 3.5,
        pickAssociationPadding: 2000,
        clusterMatchResidualTieTolerance: 1000,
        duplicatePickResidualTieTolerance: 1000,
        stableHypocenterUpdateThreshold: 15,
        sameHypocenterThreshold: {
            lat: 1e-9,
            lng: 1e-9,
            depth: 1e-9
        },
        minResidualThreshold,
        residualOutlierToleranceRatio: 3,
        defaultClusterMatchResidual: minResidualThreshold,
        largeClusterMatchResidual: 7500,
        largeClusterMatchStationCount: 50,
        defaultWaveCountPenaltyConfig: { thresholdRatio: 3, maxPenalty: 2 },
        unexplainedPickPenaltyWeight: 1,
        minUnexplainedPickPenaltyDenominator: 10,
        inheritedOutlierFilterStages: [
            { level: 3, minCount: 100, minRemainingInheritedRatio: 0.9, ratio: 2, minResidual: 3000, maxMeanResidual: 1500, waveCountPenalty: { thresholdRatio: 4.5, maxPenalty: 0.5 } },
            { level: 2, minCount: 30, minRemainingInheritedRatio: 0.8, ratio: 2.5, minResidual: 4000, maxMeanResidual: 2000, waveCountPenalty: { thresholdRatio: 4, maxPenalty: 1 } },
            { level: 1, minCount: 10, minRemainingInheritedRatio: 0.5, ratio: 3, minResidual: 5000, waveCountPenalty: { thresholdRatio: 3.5, maxPenalty: 1.5 } }
        ],
        minReliablePickCount: 100,
        minGreedyOutlierPickCount: 30,
        qualityRankMinEffectiveCounts: {
            S: 200,
            A: 100,
            B: 30,
            C: 10,
            D: 0
        },
        qualityRankMinScores: { S: 3, A: 2, B: 1, C: 0 }
    },

    isValidStationId(id) {
        return Number.isFinite(id)
    },

    createPickMetrics(pick) {
        return { maxAscend: pick.ascend, maxLevel: pick.level }
    },

    updatePickMetrics(pick, source) {
        const oldMaxAscend = pick.maxAscend
        const oldMaxLevel = pick.maxLevel
        pick.maxAscend = Math.max(pick.maxAscend || 0, source.ascend || 0)
        pick.maxLevel = Math.max(pick.maxLevel ?? -1, source.level ?? -1)
        return oldMaxAscend !== pick.maxAscend || oldMaxLevel !== pick.maxLevel
    },

    getPickMetrics(pick) {
        return { maxAscend: pick.maxAscend, maxLevel: pick.maxLevel }
    },

    getEffectivePickStrength(item) {
        return item.maxAscend || 0
    },

    fallbackReferenceMetrics: [pick => pick.maxAscend, pick => pick.maxLevel],

    getPickBaseWeight({ maxAscend }) {
        if(maxAscend >= 4) return Math.min(0.2 * maxAscend, 2)
        else if(maxAscend >= 3) return 0.3
        else if(maxAscend >= 2) return 0.1
        else return 0
    },

    isPenaltyReferencePick(pick) {
        return pick.maxAscend >= 3 && pick.maxLevel >= 5
    },

    selectTravelTimeTable(distance) {
        return distance <= nearTravelTimeMaxDistance ? travelTimes.jma2001 : travelTimes.jb
    },

    calcQualityScore(score, effectiveCount) {
        return 3.8 + Math.sqrt(effectiveCount / 10) * 0.2 - score * 5 / 3
    }
}
