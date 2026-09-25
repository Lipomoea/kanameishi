import { calcDistanceKm, calcLngDiff, calcReachTime, compareFloat, exactRound } from '@/utils/Utils'

const sortedInactiveStationsCacheKey = Symbol('sortedInactiveStations')
const compareStrings = (value1, value2) => {
    const string1 = String(value1)
    const string2 = String(value2)
    return string1 < string2 ? -1 : string1 > string2 ? 1 : 0
}

export class FindHypocenter {
    constructor(inactiveStations, adjStations, profile, stationDensityWeights = null, stationDistanceTable = null) {
        this.profile = profile
        this.parameters = profile.parameters
        this.picks = new Map()
        this.clusters = []
        this.pickClusterMap = new Map()
        this.stationPickMap = new Map()
        this.latestPickIdByStation = new Map()
        this.latestPickStampByStation = new Map()
        this.pickStationPresenceVersion = 0
        this.inactiveStations = null
        this.inactiveStationMap = new Map()
        this.inactiveStationsKey = ''
        this.inactiveStationsVersion = 0
        this.inactivePenaltyCandidateCache = new WeakMap()
        this.adjStations = adjStations
        this.stationDensityWeights = stationDensityWeights ?? FindHypocenter.calcStationDensityWeights(adjStations)
        this.stationDistanceTable = stationDistanceTable
        this.nextClusterId = 1
        this.updateVersion = 0
        this.setInactiveStations(inactiveStations)
    }

    update(pickCandidates = [], inactiveStations = this.inactiveStations, stationUpdates = []) {
        this.updateVersion++
        this.setInactiveStations(inactiveStations)
        const activeStationIds = new Set(stationUpdates.map(station => station.id))
        pickCandidates
            .slice()
            .sort((pick1, pick2) => this.comparePicks(pick1, pick2))
            .forEach(pick => this.upsertPickCandidate(pick))
        this.updateActivePickSources(stationUpdates)
        this.refreshClusterResults()
        this.mergeCloseClusters()
        this.removeFinishedClusters(activeStationIds)
        return this.getResults()
    }

    upsertPickCandidate(pick) {
        if(!this.hasValidPickCandidate(pick)) return
        const existingPick = this.picks.get(pick.pickId)
        if(existingPick) {
            this.updatePickSnapshot(existingPick, pick)
            return
        }
        const pickSnapshot = this.createPickSnapshot(pick)
        this.picks.set(pickSnapshot.pickId, pickSnapshot)
        this.addPickToStationIndex(pickSnapshot)

        const neighborClusterSet = new Set(this.findNeighborClusters(pickSnapshot))
        const matchingCluster = this.findBestMatchingCluster(pickSnapshot)
        if(matchingCluster) neighborClusterSet.add(matchingCluster)
        const neighborClusters = [...neighborClusterSet]
        if(neighborClusters.length === 0) {
            this.createCluster([pickSnapshot], null, true)
        }
        else if(neighborClusters.length === 1) {
            this.addPickToCluster(pickSnapshot, neighborClusters[0])
        }
        else {
            this.mergeAdjacentClusters(pickSnapshot, neighborClusters)
        }
    }

    createPickSnapshot(pick) {
        return {
            pickId: pick.pickId,
            stationId: pick.stationId,
            latLng: [...pick.latLng],
            triggerStamp: pick.triggerStamp,
            createdStamp: pick.createdStamp ?? pick.updateStamp,
            updateStamp: pick.updateStamp,
            ...this.profile.createPickMetrics(pick),
            densityWeight: this.getStationDensityWeight(pick.stationId)
        }
    }

    addPickToStationIndex(pick) {
        let stationPicks = this.stationPickMap.get(pick.stationId)
        if(!stationPicks) {
            stationPicks = new Set()
            this.stationPickMap.set(pick.stationId, stationPicks)
            this.pickStationPresenceVersion++
        }
        stationPicks.add(pick)
        const latestPickStamp = this.latestPickStampByStation.get(pick.stationId)
        const latestPickId = this.latestPickIdByStation.get(pick.stationId)
        if(
            latestPickStamp === undefined ||
            pick.triggerStamp > latestPickStamp ||
            (pick.triggerStamp === latestPickStamp && compareStrings(pick.pickId, latestPickId) > 0)
        ) {
            this.latestPickIdByStation.set(pick.stationId, pick.pickId)
            this.latestPickStampByStation.set(pick.stationId, pick.triggerStamp)
        }
    }

    static calcStationDensityWeights(adjStations) {
        return Object.fromEntries(
            Object.keys(adjStations || {}).map(id => {
                // Directional links beyond 30 km provide connectivity, not local density.
                const localNeighborCount = Math.max(adjStations[id]?.filter(({ distance }) => distance <= 30).length || 0, 1)
                return [id, 1 / Math.sqrt(localNeighborCount)]
            })
        )
    }

    getStationDensityWeight(stationId) {
        return this.stationDensityWeights[stationId] ?? 1
    }

    updateActivePickSources(stations) {
        stations.forEach(station => {
            if(!this.hasValidTriggerStamp(station)) return
            const pickId = this.createPickId(station.id, station.triggerStamp)
            const pick = this.picks.get(pickId)
            if(pick) this.updatePickSnapshot(pick, station)
        })
    }

    updatePickSnapshot(pickSnapshot, source) {
        if(this.latestPickIdByStation.get(pickSnapshot.stationId) !== pickSnapshot.pickId) return
        pickSnapshot.updateStamp = Math.max(pickSnapshot.updateStamp || 0, source.updateStamp || 0)
        if(this.profile.updatePickMetrics(pickSnapshot, source)) {
            const cluster = this.pickClusterMap.get(pickSnapshot.pickId)
            if(cluster) this.markClusterUpdated(cluster)
        }
    }

    findNeighborClusters(pick) {
        const clusterSet = new Set()
        const neighbors = this.adjStations?.[pick.stationId] || []
        neighbors.forEach(({ stationId, distance }) => {
            this.stationPickMap.get(stationId)?.forEach(neighborPick => {
                if(!this.arePicksAssociated(pick, neighborPick, distance)) return
                const cluster = this.pickClusterMap.get(neighborPick.pickId)
                if(cluster) clusterSet.add(cluster)
            })
        })
        return [...clusterSet]
    }

    arePicksAssociated(pick1, pick2, distance) {
        if(!Number.isFinite(distance)) return false
        const maxTriggerDiff = distance / this.parameters.pickAssociationVelocity * 1000 + this.parameters.pickAssociationPadding
        return Math.abs(pick1.triggerStamp - pick2.triggerStamp) <= maxTriggerDiff
    }

    findBestMatchingCluster(pick) {
        if(!this.hasValidTriggerStamp(pick)) return null
        const matches = this.clusters.map(cluster => {
            const match = this.calcClusterPickMatch(pick, cluster)
            return match ? { cluster, ...match } : null
        }).filter(match =>
            match && match.residual <= this.getClusterMatchResidualThreshold(match.cluster)
        )
        if(matches.length === 0) return null
        const minResidual = Math.min(...matches.map(match => match.residual))
        return matches
            .filter(match => match.residual - minResidual < this.parameters.clusterMatchResidualTieTolerance)
            .reduce((best, match) => {
                if(match.distance !== best.distance) return match.distance < best.distance ? match : best
                if(match.residual !== best.residual) return match.residual < best.residual ? match : best
                return match.cluster.id < best.cluster.id ? match : best
            }).cluster
    }

    getClusterMatchResidualThreshold(cluster) {
        return this.getClusterStationCount(cluster) >= this.parameters.largeClusterMatchStationCount
            ? this.parameters.largeClusterMatchResidual
            : this.parameters.defaultClusterMatchResidual
    }

    calcClusterPickMatch(pick, cluster) {
        const result = cluster.result
        if(!result?.hypocenter || !Number.isFinite(result.originStamp)) return null
        const optionCache = new Map()
        const options = this.calcPickOriginOptions(pick, result.hypocenter, optionCache)
        return {
            residual: Math.min(
                Math.abs(options.P.originStamp - result.originStamp),
                Math.abs(options.S.originStamp - result.originStamp)
            ),
            distance: options.distance
        }
    }

    createCluster(picks, initialHypocenter = null, markUpdated = false) {
        const cluster = {
            id: this.nextClusterId++,
            picks: [],
            dirty: true,
            result: null,
            previousResults: {
                P: null,
                S: null
            },
            updates: 0,
            reportNum: 0,
            reportHypocenter: null,
            stableHypocenterUpdateCount: 0,
            stable: false,
            lastUpdateVersion: null,
            initialHypocenter
        }
        picks.forEach(pick => this.addPickToCluster(pick, cluster, markUpdated))
        this.clusters.push(cluster)
        return cluster
    }

    addPickToCluster(pick, cluster, markUpdated = true) {
        if(cluster.picks.some(item => item.pickId === pick.pickId)) return
        this.insertPickToCluster(pick, cluster)
        this.pickClusterMap.set(pick.pickId, cluster)
        if(markUpdated) this.markClusterUpdated(cluster)
        else cluster.dirty = true
    }

    insertPickToCluster(pick, cluster) {
        let low = 0
        let high = cluster.picks.length
        while(low < high) {
            const mid = Math.floor((low + high) / 2)
            if(this.comparePicks(cluster.picks[mid], pick) <= 0) {
                low = mid + 1
            }
            else {
                high = mid
            }
        }
        cluster.picks.splice(low, 0, pick)
    }

    comparePicks(pick1, pick2) {
        if(pick1.triggerStamp !== pick2.triggerStamp) return pick1.triggerStamp - pick2.triggerStamp
        return compareStrings(pick1.pickId, pick2.pickId)
    }

    markClusterUpdated(cluster) {
        if(cluster.lastUpdateVersion !== this.updateVersion) {
            cluster.updates++
            cluster.lastUpdateVersion = this.updateVersion
        }
        cluster.dirty = true
    }

    mergeAdjacentClusters(pick, clusters) {
        const baseCluster = clusters.reduce((best, cluster) => 
            this.selectMergeBaseCluster(best, cluster)
        )
        const initialHypocenter = this.getClusterInitialHypocenter(baseCluster)
        const picks = [pick]
        clusters.forEach(cluster => {
            picks.push(...cluster.picks)
            this.removeCluster(cluster)
        })
        const mergedCluster = this.createCluster(picks, initialHypocenter, false)
        mergedCluster.updates = baseCluster.updates
        mergedCluster.reportNum = baseCluster.reportNum
        mergedCluster.reportHypocenter = baseCluster.reportHypocenter ? { ...baseCluster.reportHypocenter } : null
        this.copyClusterStableState(mergedCluster, baseCluster)
        mergedCluster.previousResults = baseCluster.previousResults
        mergedCluster.lastUpdateVersion = baseCluster.lastUpdateVersion
        this.markClusterUpdated(mergedCluster)
        return mergedCluster
    }

    removeCluster(cluster) {
        this.clusters = this.clusters.filter(item => item !== cluster)
        cluster.picks.forEach(pick => {
            if(this.pickClusterMap.get(pick.pickId) === cluster) {
                this.pickClusterMap.delete(pick.pickId)
            }
        })
    }

    removeFinishedClusters(activeStationIds) {
        const finishedClusters = this.clusters.filter(cluster => this.isClusterFinished(cluster, activeStationIds))
        const previousPickStationPresenceVersion = this.pickStationPresenceVersion
        finishedClusters.forEach(cluster => {
            const picks = [...cluster.picks]
            this.removeCluster(cluster)
            picks.forEach(pick => this.removeKnownPick(pick))
        })
        if(previousPickStationPresenceVersion !== this.pickStationPresenceVersion) {
            this.clusters.forEach(cluster => this.markClusterUpdated(cluster))
        }
    }

    isClusterFinished(cluster, activeStationIds) {
        return cluster.picks.length > 0 && cluster.picks.every(pick =>
            !activeStationIds.has(pick.stationId) || this.isPickOutdated(pick)
        )
    }

    isPickOutdated(pick) {
        const latestPickStamp = this.latestPickStampByStation.get(pick.stationId)
        return Number.isFinite(latestPickStamp) && latestPickStamp > pick.triggerStamp
    }

    removeKnownPick(pick) {
        if(this.pickClusterMap.has(pick.pickId)) return
        this.picks.delete(pick.pickId)
        const stationPicks = this.stationPickMap.get(pick.stationId)
        stationPicks?.delete(pick)
        if(!stationPicks || stationPicks.size > 0) return
        this.stationPickMap.delete(pick.stationId)
        this.latestPickIdByStation.delete(pick.stationId)
        this.latestPickStampByStation.delete(pick.stationId)
        this.pickStationPresenceVersion++
    }

    setInactiveStations(inactiveStations) {
        const inactiveStationArr = Array.from(inactiveStations || [])
        const inactiveStationsKey = `${inactiveStationArr.length}:${inactiveStationArr.map(station => station.id).join(',')}`
        this.inactiveStations = inactiveStations
        if(this.inactiveStationsKey === inactiveStationsKey) return
        this.inactiveStationsKey = inactiveStationsKey
        this.inactiveStationsVersion++
        this.inactiveStationMap = new Map(
            inactiveStationArr.map(station => [station.id, station])
        )
        this.clusters.forEach(cluster => {
            this.markClusterUpdated(cluster)
        })
    }

    refreshClusterResults() {
        this.clusters.forEach(cluster => {
            if(!cluster.dirty) return
            // this.logClusterTriggerStamps(cluster)
            if(this.getClusterStationCount(cluster) < this.parameters.minInferenceStationCount) {
                cluster.result = this.createClusterResult(cluster, this.createHypocenterResult(null, this.createInvalidLikelihood(null)))
                cluster.previousResults = { P: null, S: null }
                this.resetClusterStableState(cluster)
                cluster.dirty = false
                return
            }
            const initialHypocenter = cluster.initialHypocenter || cluster.result?.hypocenter || null
            const previousWaveMaps = this.createPreviousWaveMaps(cluster.previousResults)
            const result = this.findBestHypocenterWithEffectivePicks(cluster.picks, initialHypocenter, previousWaveMaps)
            // this.logNewScenarioPicks(result, previousWaveMaps)
            // this.logNextPreviousResults(result.previousResults)
            cluster.previousResults = this.mergeValidPreviousResults(cluster.previousResults, result.previousResults)
            this.refreshClusterHypocenterState(cluster, result)
            cluster.result = this.createClusterResult(cluster, this.createPublicHypocenterResult(result))
            cluster.initialHypocenter = result.hypocenter
            cluster.dirty = false
        })
    }

    // Classify every pick, cap each station-phase group, then refit without duplicate picks.
    findBestHypocenterWithEffectivePicks(picks, initialHypocenter, previousWaveMaps) {
        const penaltyContext = this.createInactivePenaltyContext(picks)
        // this.logInferenceRound(1, picks)
        const classificationResult = this.findBestHypocenter(
            picks,
            initialHypocenter,
            previousWaveMaps,
            penaltyContext
        )
        const inferenceFilterStageLevels = [classificationResult.filterStageLevel ?? 0]
        const weightedPhasePickIds = this.getWeightedPhasePickIds(classificationResult)
        const effectivePickIds = this.selectEffectivePickIds(classificationResult)
        const duplicatePickIds = this.getDuplicatePickIds(weightedPhasePickIds, effectivePickIds)
        if(duplicatePickIds.size === 0) {
            return {
                ...classificationResult,
                inferenceFilterStageLevels
            }
        }

        const effectivePicks = picks.filter(pick => effectivePickIds.has(pick.pickId))
        if(this.getDistinctStationCount(effectivePicks) < this.parameters.minInferenceStationCount) {
            return {
                ...this.createDuplicatePickInvalidResult(picks, classificationResult, duplicatePickIds),
                inferenceFilterStageLevels
            }
        }
        const refitPicks = picks.filter(pick => !duplicatePickIds.has(pick.pickId))
        // this.logInferenceRound(2, refitPicks)
        const finalResult = this.findBestHypocenter(
            refitPicks,
            classificationResult?.hypocenter || initialHypocenter,
            previousWaveMaps,
            penaltyContext
        )
        inferenceFilterStageLevels.push(finalResult.filterStageLevel ?? 0)
        if(!Number.isFinite(finalResult.score)) {
            return {
                ...this.createDuplicatePickInvalidResult(picks, classificationResult, duplicatePickIds),
                inferenceFilterStageLevels
            }
        }

        const finalPickResults = this.createAllPickResults(
            picks,
            classificationResult,
            finalResult,
            duplicatePickIds
        )
        return this.createLikelihoodResultWithPickMetrics(
            {
                ...finalResult,
                inferenceFilterStageLevels
            },
            finalPickResults,
            picks.length
        )
    }

    logInferenceRound(round, picks) {
        console.log(`${this.profile.logPrefix} inference round`, {
            round,
            pickCount: picks.length,
            stationCount: this.getDistinctStationCount(picks)
        })
    }

    logClusterTriggerStamps(cluster) {
        const triggerStampsByStation = new Map()
        cluster.picks.forEach(pick => {
            if(!triggerStampsByStation.has(pick.stationId)) {
                triggerStampsByStation.set(pick.stationId, {
                    latLng: pick.latLng,
                    triggerStamps: []
                })
            }
            triggerStampsByStation.get(pick.stationId).triggerStamps.push(pick.triggerStamp)
        })
        const stations = [...triggerStampsByStation.entries()]
            .map(([stationId, { latLng, triggerStamps }]) => ({
                stationId,
                latLng,
                triggerStamps: triggerStamps.sort((a, b) => a - b)
            }))
            .sort((station1, station2) =>
                station1.triggerStamps[0] - station2.triggerStamps[0] ||
                station1.stationId - station2.stationId
            )
        console.log(`${this.profile.logPrefix} cluster triggerStamps`, {
            clusterId: cluster.id,
            updates: cluster.updates,
            stations
        })
    }

    getWeightedPhasePickIds(result) {
        return new Set(
            (result?.pickResults || [])
                .filter(item => item?.pick && item.weight > 0 && (item.wave === 'P' || item.wave === 'S'))
                .map(item => item.pick.pickId)
        )
    }

    selectEffectivePickIds(result) {
        const selectedByStationWave = new Map()
        const originStamp = result?.originStamp
        if(!Number.isFinite(originStamp)) return new Set()
        ;(result.pickResults || [])
            .filter(item => item?.pick && (item.wave === 'P' || item.wave === 'S') && item.weight > 0)
            .forEach(item => {
                const key = `${item.pick.stationId}:${item.wave}`
                const candidate = {
                    item,
                    residual: Math.abs(item.originStamp - originStamp)
                }
                const selected = selectedByStationWave.get(key)
                if(!selected || this.isPreferredEffectivePick(candidate, selected)) {
                    selectedByStationWave.set(key, candidate)
                }
            })
        return new Set([...selectedByStationWave.values()].map(candidate => candidate.item.pick.pickId))
    }

    getDuplicatePickIds(weightedPhasePickIds, effectivePickIds) {
        return new Set([...weightedPhasePickIds].filter(pickId => !effectivePickIds.has(pickId)))
    }

    isPreferredEffectivePick(candidate, selected) {
        const residualDiff = candidate.residual - selected.residual
        if(Math.abs(residualDiff) > this.parameters.duplicatePickResidualTieTolerance) return residualDiff < 0
        const strengthDiff = this.profile.getEffectivePickStrength(candidate.item) - this.profile.getEffectivePickStrength(selected.item)
        if(strengthDiff !== 0) return strengthDiff > 0
        return compareStrings(candidate.item.pick.pickId, selected.item.pick.pickId) < 0
    }

    createAllPickResults(picks, classificationResult, finalResult, duplicatePickIds) {
        const classifiedResultMap = new Map(
            (classificationResult?.pickResults || []).map(item => [item.pick?.pickId, item])
        )
        const finalResultMap = new Map(
            (finalResult?.pickResults || []).map(item => [item.pick?.pickId, item])
        )
        return picks.map(pick => {
            if(!duplicatePickIds.has(pick.pickId)) return finalResultMap.get(pick.pickId) || null
            const classifiedResult = classifiedResultMap.get(pick.pickId)
            if(!classifiedResult) return null
            return {
                ...classifiedResult,
                weight: 0,
                excludedReason: 'duplicate-phase'
            }
        }).filter(Boolean)
    }

    createDuplicatePickInvalidResult(picks, classificationResult, duplicatePickIds) {
        const result = this.createHypocenterResult(null, this.createInvalidLikelihood(null))
        result.pickResults = this.createAllPickResults(
            picks,
            classificationResult,
            classificationResult,
            duplicatePickIds
        )
        return result
    }

    getClusterStationCount(cluster) {
        return this.getDistinctStationCount(cluster.picks)
    }

    getDistinctStationCount(picks) {
        return new Set((picks || []).map(pick => pick.stationId)).size
    }

    createInactivePenaltyContext(picks) {
        const stations = [...new Map((picks || []).map(pick => [pick.stationId, pick])).values()]
        const stationCount = stations.length
        let penaltyWeightStationCount = stationCount
        // Fix the breadth station bonus before searching, including the duplicate-pick refit.
        if(stationCount < this.parameters.penaltyZeroWeightStationCount && stationCount > 1 && this.parameters.penaltyBreadthKmPerStation > 0) {
            const distanceRows = stations.map(pick => this.stationDistanceTable?.rows[this.stationDistanceTable.indexes[pick.stationId]])
            const distanceIndexes = stations.map(pick => this.stationDistanceTable?.indexes[pick.stationId])
            let distanceSum = 0
            for(let i = 0; i < stationCount; i++) {
                for(let j = 0; j < i; j++) {
                    // Standalone callers without a roster table retain coordinate-based calculation.
                    distanceSum += distanceRows[i]?.[distanceIndexes[j]] ??
                        calcDistanceKm(stations[i].latLng ?? [], stations[j].latLng ?? [])
                }
            }
            const breadthKm = distanceSum / (stationCount * (stationCount - 1) / 2)
            if(Number.isFinite(breadthKm)) {
                penaltyWeightStationCount += breadthKm / this.parameters.penaltyBreadthKmPerStation
            }
        }
        return {
            picks,
            stationCount,
            inactivePenaltyWeight: this.calcInactivePenaltyWeight(penaltyWeightStationCount)
        }
    }

    refreshClusterHypocenterState(cluster, result) {
        const hypocenter = Number.isFinite(result?.score) ? result.hypocenter : null
        this.refreshClusterReportState(cluster, hypocenter)
    }

    refreshClusterReportState(cluster, hypocenter) {
        const reportChanged = !this.isSameHypocenter(cluster.reportHypocenter, hypocenter)
        if(reportChanged) {
            cluster.reportNum++
            cluster.reportHypocenter = hypocenter ? { ...hypocenter } : null
        }
        if(!hypocenter) {
            this.resetClusterStableState(cluster)
            return
        }
        if(reportChanged) {
            cluster.stableHypocenterUpdateCount = 1
            cluster.stable = false
        }
        else cluster.stableHypocenterUpdateCount++
        if(cluster.stableHypocenterUpdateCount >= this.parameters.stableHypocenterUpdateThreshold) {
            cluster.stable = true
        }
    }

    resetClusterStableState(cluster) {
        cluster.stableHypocenterUpdateCount = 0
        cluster.stable = false
    }

    isSameHypocenter(hypocenter1, hypocenter2) {
        if(hypocenter1 === null || hypocenter2 === null) return hypocenter1 === null && hypocenter2 === null
        if(!hypocenter1 || !hypocenter2) return false
        return Math.abs(hypocenter1.lat - hypocenter2.lat) <= this.parameters.sameHypocenterThreshold.lat &&
            calcLngDiff(hypocenter1.lng, hypocenter2.lng) <= this.parameters.sameHypocenterThreshold.lng &&
            Math.abs(hypocenter1.depth - hypocenter2.depth) <= this.parameters.sameHypocenterThreshold.depth
    }

    mergeCloseClusters() {
        let merged = true
        while(merged) {
            merged = false
            for(let i = 0; i < this.clusters.length; i++) {
                for(let j = i + 1; j < this.clusters.length; j++) {
                    const cluster1 = this.clusters[i]
                    const cluster2 = this.clusters[j]
                    if(this.canMergeClusterResults(cluster1.result, cluster2.result)) {
                        const picks = [...cluster1.picks, ...cluster2.picks]
                        const baseCluster = this.selectMergeBaseCluster(cluster1, cluster2)
                        const initialHypocenter = this.getClusterInitialHypocenter(baseCluster)
                        this.removeCluster(cluster1)
                        this.removeCluster(cluster2)
                        const mergedCluster = this.createCluster(picks, initialHypocenter, false)
                        mergedCluster.updates = baseCluster.updates
                        mergedCluster.reportNum = baseCluster.reportNum
                        mergedCluster.reportHypocenter = baseCluster.reportHypocenter ? { ...baseCluster.reportHypocenter } : null
                        this.copyClusterStableState(mergedCluster, baseCluster)
                        mergedCluster.previousResults = baseCluster.previousResults
                        mergedCluster.lastUpdateVersion = baseCluster.lastUpdateVersion
                        this.markClusterUpdated(mergedCluster)
                        this.refreshClusterResults()
                        mergedCluster.dirty = false
                        merged = true
                        break
                    }
                }
                if(merged) break
            }
        }
    }

    selectMergeBaseCluster(cluster1, cluster2) {
        const stationCount1 = this.getClusterStationCount(cluster1)
        const stationCount2 = this.getClusterStationCount(cluster2)
        if(stationCount1 !== stationCount2) {
            return stationCount1 > stationCount2 ? cluster1 : cluster2
        }
        const pickCount1 = cluster1.picks.length
        const pickCount2 = cluster2.picks.length
        if(pickCount1 !== pickCount2) {
            return pickCount1 > pickCount2 ? cluster1 : cluster2
        }
        return cluster1.updates >= cluster2.updates ? cluster1 : cluster2
    }

    getClusterInitialHypocenter(cluster) {
        return cluster.result?.hypocenter || cluster.initialHypocenter || null
    }

    copyClusterStableState(targetCluster, sourceCluster) {
        targetCluster.stable = sourceCluster.stable
        targetCluster.stableHypocenterUpdateCount = sourceCluster.stableHypocenterUpdateCount
    }

    getResults() {
        return this.clusters
            .map(cluster => cluster.result && {
                ...cluster.result,
                updates: cluster.updates,
                reportNum: cluster.reportNum,
                stable: cluster.stable
            })
            .filter(result => result?.hypocenter && Number.isFinite(result.score))
    }

    createPreviousWaveMaps(previousResults) {
        return {
            P: this.createPreviousWaveMap(previousResults?.P),
            S: this.createPreviousWaveMap(previousResults?.S)
        }
    }

    createPreviousWaveMap(result) {
        if(!Array.isArray(result?.pickResults)) return null
        const waveMap = new Map(
            result.pickResults
                .filter(item => item?.pick?.pickId && item.weight > 0 && (item.wave === 'P' || item.wave === 'S'))
                .map(item => [item.pick.pickId, item.wave])
        )
        return waveMap.size > 0 ? waveMap : null
    }

    logNewScenarioPicks(result, previousWaveMaps) {
        if(!Array.isArray(result?.pickResults)) return
        const previousWaveMap = previousWaveMaps?.[result.firstWave]
        const newPicks = result.pickResults
            .filter(item => item?.pick && !previousWaveMap?.has(item.pick.pickId))
            .map(item => ({
                pickId: item.pick.pickId,
                stationId: item.pick.stationId,
                latLng: item.pick.latLng,
                wave: item.wave
            }))
        if(newPicks.length > 0) {
            console.log(`${this.profile.logPrefix} new picks`, result.scenario, newPicks)
        }
    }

    logNextPreviousResults(previousResults) {
        const summary = Object.fromEntries(['P', 'S'].map(firstWave => {
            const result = previousResults?.[firstWave]
            return [
                firstWave,
                {
                    scenario: result?.scenario ?? null,
                    score: result?.score ?? null,
                    rmse: result?.rmse ?? null,
                    effectiveStationCount: result?.effectiveStationCount ?? null
                }
            ]
        }))
        console.log(`${this.profile.logPrefix} next previous results`, summary)
    }

    calcLikelihood(picks, hypocenter, previousWaveMaps = null, penaltyContext = this.createInactivePenaltyContext(picks)) {
        const optionCache = new Map()
        const previousResults = Object.fromEntries(['P', 'S'].map(firstWave => [
            firstWave,
            this.calcFirstWaveLikelihood(
                picks,
                hypocenter,
                firstWave,
                optionCache,
                previousWaveMaps?.[firstWave],
                penaltyContext
            )
        ]))
        const result = Object.values(previousResults)
            .reduce((best, item) => item.score < best.score ? item : best)
        return {
            ...result,
            previousResults
        }
    }

    calcFirstWaveLikelihood(picks, hypocenter, firstWave, optionCache, previousWaveMap = null, penaltyContext = this.createInactivePenaltyContext(picks)) {
        if(!Array.isArray(picks) || picks.length === 0) {
            return this.createInvalidLikelihood(firstWave)
        }
        if(!picks.every(pick => this.hasValidTriggerStamp(pick))) {
            return this.createInvalidLikelihood(firstWave)
        }
        const greedyResults = ['P', 'S'].map(lastWave =>
            this.calcScenarioLikelihood(picks, hypocenter, firstWave, lastWave, optionCache, penaltyContext)
        )
        const results = [...greedyResults]
        if(previousWaveMap?.size) {
            results.push(
                ...this.calcPreviousWaveScenarioLikelihoods(
                    picks,
                    hypocenter,
                    firstWave,
                    optionCache,
                    previousWaveMap,
                    penaltyContext
                )
            )
        }
        // console.log(this.updateVersion, hypocenter, firstWave, results)
        return results.reduce((best, result) => result.score < best.score ? result : best)
    }

    mergeValidPreviousResults(previousResults, nextPreviousResults) {
        return Object.fromEntries(['P', 'S'].map(firstWave => {
            const nextResult = nextPreviousResults?.[firstWave]
            return [
                firstWave,
                Number.isFinite(nextResult?.score) ? nextResult : previousResults?.[firstWave] || null
            ]
        }))
    }

    findBestHypocenter(picks, initialHypocenter = null, previousWaveMaps = null, penaltyContext = this.createInactivePenaltyContext(picks)) {
        if(!Array.isArray(picks) || picks.length === 0) {
            return this.createHypocenterResult(null, this.createInvalidLikelihood(null))
        }

        const { lat, lng } = this.calcInitialHypocenterLatLng(picks)
        let currentResult = this.evaluateHypocenter(
            picks,
            initialHypocenter || { lat, lng, depth: this.parameters.initialDepth },
            previousWaveMaps,
            penaltyContext
        )
        let stepIndex = 0
        let iteration = 0
        while(stepIndex < this.parameters.hypocenterSearchSteps.length && iteration < this.parameters.maxHypocenterSearchIterations) {
            iteration++
            const { degree, depth } = this.parameters.hypocenterSearchSteps[stepIndex]
            const candidates = this.createNeighborHypocenters(currentResult.hypocenter, degree, depth)
                .map(hypocenter => this.evaluateHypocenter(
                    picks,
                    hypocenter,
                    previousWaveMaps,
                    penaltyContext
                ))
            const bestCandidate = candidates.reduce(
                (best, candidate) => candidate.score < best.score ? candidate : best,
                currentResult
            )
            if(bestCandidate.score < currentResult.score) {
                currentResult = bestCandidate
            }
            else {
                stepIndex++
            }
        }
        // this.logFinalScenarioRmses(picks, currentResult.hypocenter, previousWaveMaps, penaltyContext)
        return currentResult
    }

    logFinalScenarioRmses(picks, hypocenter, previousWaveMaps = null, penaltyContext = this.createInactivePenaltyContext(picks)) {
        const optionCache = new Map()
        const greedyScenarioResults = ['P', 'S'].flatMap(firstWave => ['P', 'S'].map(lastWave => {
                const key = `${firstWave}${lastWave}`
                const result = this.calcScenarioLikelihood(
                    picks,
                    hypocenter,
                    firstWave,
                    lastWave,
                    optionCache,
                    penaltyContext
                )
                return { key: result.scenario || key, result }
            }))
        const previousScenarioResults = ['P', 'S']
            .flatMap(firstWave => {
                const previousWaveMap = previousWaveMaps?.[firstWave]
                if(!previousWaveMap?.size) return []
                return this.calcPreviousWaveScenarioLikelihoods(
                    picks,
                    hypocenter,
                    firstWave,
                    optionCache,
                    previousWaveMap,
                    penaltyContext
                ).map(result => ({
                    key: `${result.scenario || `${firstWave}_PREV`}_${result.filterStageLevel ?? 0}`,
                    result
                }))
            })
        const scenarioResults = [...greedyScenarioResults, ...previousScenarioResults]
        const rmses = Object.fromEntries(
            scenarioResults.map(({ key, result }) => [key, result.rmse])
        )
        const scores = Object.fromEntries(
            scenarioResults.map(({ key, result }) => [key, result.score])
        )
        console.log(`${this.profile.logPrefix} cluster picks`, picks.map(pick => ({
            pickId: pick.pickId,
            stationId: pick.stationId
        })))
        console.log(`${this.profile.logPrefix} final scenario RMSE`, rmses)
        console.log(`${this.profile.logPrefix} final scenario score`, scores)
        scenarioResults.forEach(({ key, result }) => {
            console.log(`${this.profile.logPrefix} ${key} waves`, result.pickResults.map(item => ({
                pickId: item.pick?.pickId,
                stationId: item.pick?.stationId,
                wave: item.wave
            })))
        })
    }

    calcInitialHypocenterLatLng(picks) {
        const earliestTriggerStamp = picks[0].triggerStamp
        const earliestPicks = picks.filter(pick => pick.triggerStamp === earliestTriggerStamp)
        const [latSum, lngSum] = earliestPicks.reduce(
            (sum, pick) => [sum[0] + pick.latLng[0], sum[1] + pick.latLng[1]],
            [0, 0]
        )
        return {
            lat: exactRound(latSum / earliestPicks.length, this.parameters.initialLatLngDigits),
            lng: exactRound(lngSum / earliestPicks.length, this.parameters.initialLatLngDigits)
        }
    }

    calcScenarioLikelihood(picks, hypocenter, firstWave, lastWave, optionCache, penaltyContext = this.createInactivePenaltyContext(picks)) {
        if(!Array.isArray(picks) || picks.length === 0) {
            return this.createInvalidLikelihood(firstWave, lastWave)
        }
        if(!picks.every(pick => this.hasValidTriggerStamp(pick))) {
            return this.createInvalidLikelihood(firstWave, lastWave)
        }

        return this.calcGreedyScenarioLikelihood(
            picks,
            hypocenter,
            firstWave,
            lastWave,
            optionCache,
            penaltyContext
        )
    }

    calcGreedyScenarioLikelihood(picks, hypocenter, firstWave, lastWave, optionCache, penaltyContext = this.createInactivePenaltyContext(picks)) {
        const pickResults = new Array(picks.length)
        const originEntries = []
        const triggerRankWeights = this.calcTriggerRankWeights(picks)
        const anchorIndexes = this.getScenarioAnchorIndexes(picks, triggerRankWeights)
        if(!anchorIndexes) return this.createInvalidLikelihood(firstWave, lastWave)
        const { firstAnchorIndex, lastAnchorIndex } = anchorIndexes
        pickResults[firstAnchorIndex] = this.addScenarioPickResult(picks[firstAnchorIndex], hypocenter, firstWave, optionCache, triggerRankWeights, null, originEntries)
        pickResults[lastAnchorIndex] = this.addScenarioPickResult(picks[lastAnchorIndex], hypocenter, lastWave, optionCache, triggerRankWeights, null, originEntries)
        for(const i of this.createScenarioInferenceIndexes(picks, firstAnchorIndex, lastAnchorIndex)) {
            const pick = picks[i]
            const options = this.calcPickOriginOptions(pick, hypocenter, optionCache)
            const wave = this.selectScenarioWave(pick, options, originEntries, triggerRankWeights)
            pickResults[i] = this.addScenarioPickResult(pick, hypocenter, wave, optionCache, triggerRankWeights, null, originEntries, options)
        }
        return this.createScenarioLikelihoodResult(
            picks,
            hypocenter,
            firstWave,
            lastWave,
            `${firstWave}${lastWave}`,
            optionCache,
            pickResults.filter(Boolean),
            originEntries,
            penaltyContext
        )
    }

    calcPreviousWaveScenarioLikelihoods(picks, hypocenter, firstWave, optionCache, previousWaveMap, penaltyContext = this.createInactivePenaltyContext(picks)) {
        const triggerRankWeights = this.calcTriggerRankWeights(picks)
        const weightedPickCount = this.calcWeightedPickCount(picks, triggerRankWeights)
        const inheritedItems = []
        for(const i of this.createScenarioInferenceIndexes(picks)) {
            const pick = picks[i]
            const previousWave = previousWaveMap.get(pick.pickId)
            const item = this.createInheritedScenarioPickItem(i, pick, hypocenter, previousWave, optionCache, triggerRankWeights)
            if(item) inheritedItems.push(item)
        }
        return this.calcInheritedOutlierFilterResults(inheritedItems, weightedPickCount)
            .map(({ outlierIndexes, filterStage }) => {
                const pickResults = new Array(picks.length)
                const originEntries = []
                inheritedItems.forEach(item => {
                    if(outlierIndexes.has(item.index)) return
                    pickResults[item.index] = this.addScenarioPickResult(
                        picks[item.index],
                        hypocenter,
                        item.wave,
                        optionCache,
                        triggerRankWeights,
                        null,
                        originEntries,
                        item.options
                    )
                })
                if(this.calcWeightSum(originEntries) <= 0) {
                    return this.createInvalidLikelihood(firstWave, null, `${firstWave}_PREV`)
                }
                for(const i of this.createScenarioInferenceIndexes(picks)) {
                    if(pickResults[i]) continue
                    const pick = picks[i]
                    const options = this.calcPickOriginOptions(pick, hypocenter, optionCache)
                    const wave = this.selectScenarioWave(pick, options, originEntries, triggerRankWeights, filterStage)
                    pickResults[i] = this.addScenarioPickResult(
                        pick,
                        hypocenter,
                        wave,
                        optionCache,
                        triggerRankWeights,
                        null,
                        originEntries,
                        options
                    )
                }
                return this.createScenarioLikelihoodResult(
                    picks,
                    hypocenter,
                    firstWave,
                    null,
                    `${firstWave}_PREV`,
                    optionCache,
                    pickResults.filter(Boolean),
                    originEntries,
                    penaltyContext,
                    filterStage
                )
            })
    }

    getScenarioAnchorIndexes(picks, triggerRankWeights) {
        if(!Array.isArray(picks) || this.getDistinctStationCount(picks) < this.parameters.minInferenceStationCount) return null
        const lastIndex = picks.length - 1
        const preferredFirstAnchorIndex = Math.ceil(lastIndex * 0.25)
        const preferredLastAnchorIndex = Math.floor(lastIndex * 0.75)
        const firstAnchorIndex = this.findValidScenarioAnchorIndex(
            picks,
            preferredFirstAnchorIndex,
            preferredLastAnchorIndex,
            1,
            triggerRankWeights,
            new Set()
        )
        if(firstAnchorIndex === null) return null
        const lastAnchorIndex = this.findValidScenarioAnchorIndex(
            picks,
            preferredLastAnchorIndex,
            preferredFirstAnchorIndex,
            -1,
            triggerRankWeights,
            new Set([firstAnchorIndex])
        )
        if(lastAnchorIndex === null) return null
        return {
            firstAnchorIndex,
            lastAnchorIndex
        }
    }

    createScenarioInferenceIndexes(picks, ...anchorIndexes) {
        const anchors = new Set(anchorIndexes.filter(index => Number.isInteger(index)))
        return this.createMiddleOutPickIndexes(0, picks.length - 1)
            .filter(index => !anchors.has(index))
    }

    findValidScenarioAnchorIndex(picks, preferredIndex, centerIndex, centerDirection, triggerRankWeights, usedIndexes) {
        const candidateIndexes = this.createScenarioAnchorCandidateIndexes(
            picks.length,
            preferredIndex,
            centerIndex,
            centerDirection
        )
        return candidateIndexes.find(index =>
            !usedIndexes.has(index) &&
            this.getPickWeight(picks[index], triggerRankWeights.get(picks[index].pickId) ?? 1) > 0
        ) ?? null
    }

    createScenarioAnchorCandidateIndexes(pickCount, preferredIndex, centerIndex, centerDirection) {
        const indexes = []
        const addIndex = index => {
            if(index >= 0 && index < pickCount && !indexes.includes(index)) indexes.push(index)
        }
        const centerStep = centerDirection > 0 ? 1 : -1
        for(let index = preferredIndex; centerDirection > 0 ? index <= centerIndex : index >= centerIndex; index += centerStep) {
            addIndex(index)
        }
        for(let offset = 1; preferredIndex - offset >= 0 || preferredIndex + offset < pickCount; offset++) {
            addIndex(preferredIndex - offset)
            addIndex(preferredIndex + offset)
        }
        return indexes
    }

    createInheritedScenarioPickItem(index, pick, hypocenter, wave, optionCache, triggerRankWeights) {
        if(wave !== 'P' && wave !== 'S') return null
        const options = this.calcPickOriginOptions(pick, hypocenter, optionCache)
        const triggerRankWeight = triggerRankWeights.get(pick.pickId) ?? 1
        const weight = this.getPickWeight(pick, triggerRankWeight)
        if(weight <= 0) return null
        return {
            index,
            wave,
            options,
            originStamp: options[wave].originStamp,
            weight
        }
    }

    calcWeightedPickCount(picks, triggerRankWeights) {
        return picks.filter(pick =>
            this.getPickWeight(pick, triggerRankWeights.get(pick.pickId) ?? 1) > 0
        ).length
    }

    calcInheritedOutlierFilterResults(inheritedItems, weightedPickCount) {
        const noFilterResult = { outlierIndexes: new Set(), filterStage: null }
        const stages = this.parameters.inheritedOutlierFilterStages
            .filter(stage => inheritedItems.length >= stage.minCount)
        if(stages.length === 0) return [noFilterResult]
        const originEntries = inheritedItems.map(item => ({
            value: item.originStamp,
            weight: item.weight
        }))
        const originStamp = this.calcWeightedMean(originEntries)
        const meanResidual = this.calcMeanAbsResidual(originEntries, originStamp)
        if(!Number.isFinite(meanResidual) || meanResidual <= 0) {
            return [noFilterResult]
        }
        const filterResults = stages.map(stage => {
            if(Number.isFinite(stage.maxMeanResidual) && meanResidual > stage.maxMeanResidual) return null
            const threshold = Math.max(meanResidual * stage.ratio, stage.minResidual)
            const outlierIndexes = new Set(inheritedItems
                .filter(item => item.index > 0 && Math.abs(item.originStamp - originStamp) > threshold)
                .map(item => item.index)
            )
            const remainingInheritedPickCount = inheritedItems.length - outlierIndexes.size
            return (
                remainingInheritedPickCount >= stage.minCount &&
                remainingInheritedPickCount >= weightedPickCount * stage.minRemainingInheritedRatio
            ) ? { outlierIndexes, filterStage: stage } : null
        }).filter(Boolean)
        return [...filterResults, noFilterResult]
    }

    createScenarioLikelihoodResult(picks, hypocenter, firstWave, lastWave, scenario, optionCache, pickResults, originEntries, penaltyContext = this.createInactivePenaltyContext(picks), filterStage = null) {
        if(this.calcWeightSum(originEntries) <= 0) {
            return this.createInvalidLikelihood(firstWave, lastWave, scenario)
        }
        const originStamp = this.calcWeightedMean(originEntries)
        const rmse = this.calcWeightedRmse(originEntries, originStamp) / 1000
        const inactivePenalty = this.calcInactiveStationPenalty(
            hypocenter,
            penaltyContext.picks,
            optionCache,
            penaltyContext.stationCount
        )
        const inactivePenaltyWeight = penaltyContext.inactivePenaltyWeight
        const waveCountPenalty = this.calcWaveCountPenalty(
            pickResults,
            filterStage?.waveCountPenalty ?? this.parameters.defaultWaveCountPenaltyConfig
        )
        return this.createLikelihoodResultWithPickMetrics({
            rmse,
            inactivePenalty,
            inactivePenaltyWeight,
            waveCountPenalty,
            originStamp,
            firstWave,
            lastWave,
            scenario,
            filterStageLevel: filterStage?.level ?? 0
        }, pickResults, penaltyContext.picks.length)
    }

    createLikelihoodResultWithPickMetrics(result, pickResults, totalPickCount) {
        const effectivePickCount = this.calcEffectivePickCount(pickResults)
        const effectiveStationCount = this.calcEffectiveStationCount(pickResults)
        const unexplainedPickPenalty = this.calcUnexplainedPickPenalty(
            pickResults,
            totalPickCount
        )
        const score = result.rmse +
            result.inactivePenalty * result.inactivePenaltyWeight +
            result.waveCountPenalty +
            unexplainedPickPenalty
        const effectiveCount = (effectivePickCount + effectiveStationCount) / 2
        const qualityScore = this.calcQualityScore(score, effectiveCount)
        return {
            ...result,
            score,
            unexplainedPickPenalty,
            effectivePickCount,
            effectiveStationCount,
            qualityScore,
            qualityRank: this.calcQualityRank(qualityScore, effectiveCount),
            pickResults
        }
    }

    calcEffectivePickCount(pickResults) {
        return pickResults.filter(result =>
            (result.wave === 'P' || result.wave === 'S') && result.weight > 0
        ).length
    }

    calcEffectiveStationCount(pickResults) {
        return new Set(
            pickResults
                .filter(result => (result.wave === 'P' || result.wave === 'S') && result.weight > 0)
                .map(result => result.pick.stationId)
        ).size
    }

    calcQualityScore(score, effectiveCount) {
        return this.profile.calcQualityScore(score, effectiveCount)
    }

    calcQualityRank(qualityScore, effectiveCount) {
        const scoreRank = this.calcQualityRankByScore(qualityScore)
        return ['S', 'A', 'B', 'C', 'D'].find(rank =>
            this.parameters.qualityRankMinEffectiveCounts[rank] <= effectiveCount &&
            this.parameters.qualityRankMinEffectiveCounts[rank] <= this.parameters.qualityRankMinEffectiveCounts[scoreRank]
        ) || 'D'
    }

    calcQualityRankByScore(qualityScore) {
        if(qualityScore < this.parameters.qualityRankMinScores.C) return 'D'
        if(qualityScore < this.parameters.qualityRankMinScores.B) return 'C'
        if(qualityScore < this.parameters.qualityRankMinScores.A) return 'B'
        if(qualityScore < this.parameters.qualityRankMinScores.S) return 'A'
        return 'S'
    }

    calcWaveCountPenalty(pickResults, config = this.parameters.defaultWaveCountPenaltyConfig) {
        const pWavePickCount = pickResults.filter(result => result.wave === 'P' && result.weight > 0).length || 1
        const sWavePickCount = pickResults.filter(result => result.wave === 'S' && result.weight > 0).length
        const excessRatio = sWavePickCount / pWavePickCount - config.thresholdRatio
        const penalty = excessRatio * (this.parameters.waveCountPenaltySlope ?? 1)
        return Math.min(Math.max(penalty, 0), config.maxPenalty)
    }

    calcUnexplainedPickPenalty(pickResults, totalPickCount = pickResults.length) {
        const explainedStationWaves = new Set()
        const unexplainedPickCount = pickResults.reduce((count, result) => {
            if(result.wave === 'O' || result.excludedReason === 'duplicate-phase') return count + 1
            if(result.weight <= 0 || (result.wave !== 'P' && result.wave !== 'S')) return count
            const stationWave = `${result.pick?.stationId}:${result.wave}`
            if(explainedStationWaves.has(stationWave)) return count + 1
            explainedStationWaves.add(stationWave)
            return count
        }, 0)
        const denominator = Math.max(totalPickCount, this.parameters.minUnexplainedPickPenaltyDenominator)
        return unexplainedPickCount / denominator * this.parameters.unexplainedPickPenaltyWeight
    }

    selectScenarioWave(pick, options, originEntries, triggerRankWeights, outlierFilterStage) {
        const triggerRankWeight = triggerRankWeights.get(pick.pickId) ?? 1
        if(this.getPickWeight(pick, triggerRankWeight) <= 0) return 'L'
        const selected = this.selectClosestOption(options, originEntries, outlierFilterStage)
        return selected?.wave ?? 'O'
    }

    addScenarioPickResult(pick, hypocenter, wave, optionCache, triggerRankWeights, pickResults, originEntries, options = null) {
        options ??= this.calcPickOriginOptions(pick, hypocenter, optionCache)
        const triggerRankWeight = triggerRankWeights.get(pick.pickId) ?? 1
        const weight = this.getPickWeight(pick, triggerRankWeight)
        if(weight <= 0 || wave === 'L' || wave === 'O') {
            const pickResult = {
                pick: this.createPickResultSnapshot(pick),
                wave: weight <= 0 ? 'L' : wave,
                originStamp: null,
                reachTime: null,
                distance: options.distance,
                maxAscend: pick.maxAscend,
                triggerRankWeight,
                weight: 0
            }
            pickResults?.push(pickResult)
            return pickResult
        }
        const selected = options[wave]
        const pickResult = {
            pick: this.createPickResultSnapshot(pick),
            wave: selected.wave,
            originStamp: selected.originStamp,
            reachTime: selected.reachTime,
            distance: options.distance,
            maxAscend: pick.maxAscend,
            triggerRankWeight,
            weight
        }
        pickResults?.push(pickResult)
        originEntries.push({
            value: selected.originStamp,
            weight
        })
        return pickResult
    }

    calcTriggerRankWeights(picks) {
        return new Map(picks.map((pick, index) => [
            pick.pickId,
            this.calcTriggerRankWeight(index + 1, picks.length)
        ]))
    }

    calcTriggerRankWeight(rank, pickCount) {
        const ratio = rank / Math.max(pickCount, this.parameters.minReliablePickCount)
        if(ratio <= 0.2) return 1
        else if(ratio <= 0.4) return 1.5 - ratio * 2.5
        else if(ratio <= 0.8) return 0.9 - ratio
        else return 0.1
    }

    createPickResultSnapshot(pick) {
        return {
            pickId: pick.pickId,
            stationId: pick.stationId,
            latLng: pick.latLng,
            triggerStamp: pick.triggerStamp,
            createdStamp: pick.createdStamp,
            updateStamp: pick.updateStamp,
            ...this.profile.getPickMetrics(pick),
            densityWeight: pick.densityWeight
        }
    }

    calcPickOriginOptions(pick, hypocenter, optionCache) {
        const pOption = this.calcPickWaveOption(pick, hypocenter, 'P', optionCache)
        const sOption = this.calcPickWaveOption(pick, hypocenter, 'S', optionCache)
        return {
            distance: pOption.distance,
            P: pOption,
            S: sOption
        }
    }

    calcInactiveStationPenalty(hypocenter, penaltyPicks, optionCache, penaltyStationCount = this.getDistinctStationCount(penaltyPicks)) {
        if(penaltyStationCount <= 0 || penaltyStationCount >= this.parameters.penaltyZeroWeightStationCount) {
            return 0
        }
        const referenceDistance = this.getInactivePenaltyReferenceDistance(penaltyPicks, hypocenter, optionCache)
        if(referenceDistance === null) {
            return 0
        }
        const stations = this.getSortedInactiveStations(penaltyPicks, hypocenter, optionCache)
        if(stations.length === 0) {
            return 0
        }

        const penalty = this.findLastPenalizedStationIndex(stations, 0, stations.length - 1, hypocenter, optionCache, referenceDistance) + 1
        return this.normalizeInactivePenalty(penalty, penaltyStationCount)
    }

    normalizeInactivePenalty(penalty, denominator) {
        return denominator > 0 ? penalty / denominator : 0
    }

    calcInactivePenaltyWeight(stationCount) {
        if(stationCount <= this.parameters.penaltyFullWeightStationCount) return this.parameters.penaltyFullWeight
        if(stationCount >= this.parameters.penaltyZeroWeightStationCount) return 0
        const progress = (stationCount - this.parameters.penaltyFullWeightStationCount) / (this.parameters.penaltyZeroWeightStationCount - this.parameters.penaltyFullWeightStationCount)
        return this.parameters.penaltyFullWeight * (1 - progress)
    }

    getInactivePenaltyReferenceDistance(picks, hypocenter, optionCache) {
        const referenceStationMap = new Map()
        picks
            .filter(pick => this.isPenaltyReferencePick(pick))
            .forEach(pick => referenceStationMap.set(pick.stationId, pick))
        const distances = [...referenceStationMap.values()]
            .map(station => this.getOptionCacheEntry(station, hypocenter, optionCache).distance)
            .filter(distance => Number.isFinite(distance))
            .sort((a, b) => a - b)
        if(distances.length === 0) {
            const fallbackPick = this.selectFallbackPenaltyReferencePick(picks, hypocenter, optionCache)
            if(!fallbackPick) return null
            const fallbackDistance = this.getOptionCacheEntry(fallbackPick, hypocenter, optionCache).distance
            return Number.isFinite(fallbackDistance) ? fallbackDistance : null
        }
        const referenceIndex = Math.max(Math.floor(distances.length * this.parameters.penaltyReferenceQuantile) - 1, 0)
        return distances[referenceIndex]
    }

    selectFallbackPenaltyReferencePick(picks, hypocenter, optionCache) {
        let nearestPick = null
        let nearestDistance = Infinity
        for(const pick of picks) {
            const distance = this.getOptionCacheEntry(pick, hypocenter, optionCache).distance
            if(Number.isFinite(distance) && distance < nearestDistance) {
                nearestPick = pick
                nearestDistance = distance
            }
        }
        if(nearestPick) return nearestPick

        for(const getValue of this.profile.fallbackReferenceMetrics) {
            let strongestPick = null
            let strongestValue = -Infinity
            for(const pick of picks) {
                const value = getValue(pick)
                if(Number.isFinite(value) && value > strongestValue) {
                    strongestPick = pick
                    strongestValue = value
                }
            }
            if(strongestPick) return strongestPick
        }
        return picks[0] || null
    }

    getSortedInactiveStations(picks, hypocenter, optionCache) {
        const cachedStations = optionCache?.get(sortedInactiveStationsCacheKey)
        if(cachedStations) return cachedStations
        const stations = this.getInactivePenaltyCandidates(picks)
            .filter(station => Number.isFinite(station?.updateStamp))
            .map(station => ({
                station,
                distance: this.getOptionCacheEntry(station, hypocenter, optionCache).distance
            }))
            .sort((a, b) => a.distance - b.distance)
            .map(item => item.station)
        optionCache?.set(sortedInactiveStationsCacheKey, stations)
        return stations
    }

    getInactivePenaltyCandidates(picks) {
        const cached = this.inactivePenaltyCandidateCache.get(picks)
        if(
            cached?.version === this.inactiveStationsVersion &&
            cached.pickStationPresenceVersion === this.pickStationPresenceVersion
        ) return cached.stations
        const clusterStationIds = new Set(picks.map(pick => pick.stationId))
        const stations = [...this.inactiveStationMap.values()].filter(station =>
            !this.stationPickMap.has(station.id) &&
            !clusterStationIds.has(station.id)
        )
        this.inactivePenaltyCandidateCache.set(picks, {
            version: this.inactiveStationsVersion,
            pickStationPresenceVersion: this.pickStationPresenceVersion,
            stations
        })
        return stations
    }

    findLastPenalizedStationIndex(stations, low, high, hypocenter, optionCache, referenceDistance) {
        let result = low - 1
        while(low <= high) {
            const mid = Math.floor((low + high) / 2)
            if(this.isInactiveStationPenalized(stations[mid], hypocenter, optionCache, referenceDistance)) {
                result = mid
                low = mid + 1
            }
            else {
                high = mid - 1
            }
        }
        return result
    }

    isInactiveStationPenalized(station, hypocenter, optionCache, referenceDistance) {
        return this.getOptionCacheEntry(station, hypocenter, optionCache).distance <= referenceDistance
    }

    calcPickWaveOption(pick, hypocenter, wave, optionCache) {
        const cacheEntry = this.getOptionCacheEntry(pick, hypocenter, optionCache)
        if(!cacheEntry[wave]) {
            const isPWave = wave == 'P'
            const reachTime = calcReachTime(
                cacheEntry.travelTime,
                isPWave,
                cacheEntry.depth,
                cacheEntry.distance
            ) * 1000
            cacheEntry[wave] = {
                wave,
                reachTime,
                originStamp: pick.triggerStamp - reachTime,
                distance: cacheEntry.distance
            }
        }
        return cacheEntry[wave]
    }

    getOptionCacheEntry(source, hypocenter, optionCache) {
        let cacheEntry = optionCache?.get(source)
        if(!cacheEntry) {
            const distance = calcDistanceKm([hypocenter.lat, hypocenter.lng], source.latLng)
            cacheEntry = {
                distance,
                travelTime: this.profile.selectTravelTimeTable(distance),
                depth: hypocenter.depth ?? this.parameters.initialDepth
            }
            optionCache?.set(source, cacheEntry)
        }
        return cacheEntry
    }

    evaluateHypocenter(picks, hypocenter, previousWaveMaps = null, penaltyContext = this.createInactivePenaltyContext(picks)) {
        const normalizedHypocenter = this.normalizeHypocenter(hypocenter)
        return this.createHypocenterResult(
            normalizedHypocenter,
            this.calcLikelihood(picks, normalizedHypocenter, previousWaveMaps, penaltyContext)
        )
    }

    createNeighborHypocenters(hypocenter, degreeStep, depthStep) {
        const { lat, lng, depth } = hypocenter
        return [
            { lat, lng: lng + degreeStep, depth },
            { lat: lat - degreeStep, lng, depth },
            { lat, lng: lng - degreeStep, depth },
            { lat: lat + degreeStep, lng, depth },
            { lat, lng, depth: depth - depthStep },
            { lat, lng, depth: depth + depthStep }
        ].map(item => this.normalizeHypocenter(item))
    }

    normalizeHypocenter(hypocenter) {
        return {
            lat: Math.min(Math.max(hypocenter.lat, -90), 90),
            lng: ((hypocenter.lng + 540) % 360) - 180,
            depth: Math.min(Math.max(hypocenter.depth ?? this.parameters.initialDepth, this.parameters.minDepth), this.parameters.maxDepth)
        }
    }

    createHypocenterResult(hypocenter, likelihood) {
        return {
            hypocenter,
            ...likelihood
        }
    }

    createPublicHypocenterResult(result) {
        const { previousResults, ...publicResult } = result || {}
        return publicResult
    }

    createClusterResult(cluster, result) {
        return {
            clusterPicks: cluster.picks.map(pick => this.createPickResultSnapshot(pick)),
            clusterStationCount: this.getClusterStationCount(cluster),
            clusterId: cluster.id,
            updates: cluster.updates,
            reportNum: cluster.reportNum,
            stable: cluster.stable,
            ...result
        }
    }

    canMergeClusterResults(result1, result2) {
        if(!result1?.hypocenter || !result2?.hypocenter) return false
        if(!Number.isFinite(result1.originStamp) || !Number.isFinite(result2.originStamp)) return false
        const hypo1 = result1.hypocenter
        const hypo2 = result2.hypocenter
        return compareFloat(Math.abs(hypo1.lat - hypo2.lat), this.parameters.clusterMergeThreshold.lat) <= 0 &&
            compareFloat(calcLngDiff(hypo1.lng, hypo2.lng), this.parameters.clusterMergeThreshold.lng) <= 0 &&
            Math.abs(hypo1.depth - hypo2.depth) <= this.parameters.clusterMergeThreshold.depth &&
            Math.abs(result1.originStamp - result2.originStamp) <= this.parameters.clusterMergeThreshold.originStamp
    }

    selectClosestOption(
        options,
        originEntries,
        outlierFilterStage = {
            minCount: this.parameters.minGreedyOutlierPickCount,
            ratio: this.parameters.residualOutlierToleranceRatio,
            minResidual: this.parameters.minResidualThreshold
        }
    ) {
        const currentOriginStamp = this.calcWeightedMean(originEntries)
        if(this.isResidualOutlier(options, originEntries, currentOriginStamp, outlierFilterStage)) return null
        return this.selectClosestOptionByOriginStamp(options, currentOriginStamp)
    }

    isResidualOutlier(options, originEntries, originStamp, outlierFilterStage = {
        minCount: this.parameters.minGreedyOutlierPickCount,
        ratio: this.parameters.residualOutlierToleranceRatio,
        minResidual: this.parameters.minResidualThreshold
    }) {
        if(!outlierFilterStage) return false
        if(originEntries.length < outlierFilterStage.minCount) return false
        const meanResidual = this.calcMeanAbsResidual(originEntries, originStamp)
        const threshold = this.calcResidualOutlierThreshold(
            meanResidual,
            outlierFilterStage.minResidual,
            outlierFilterStage.ratio
        )
        if(threshold === null) return false
        return Math.abs(options.P.originStamp - originStamp) > threshold &&
            Math.abs(options.S.originStamp - originStamp) > threshold
    }

    calcResidualOutlierThreshold(meanResidual, minThreshold = this.parameters.minResidualThreshold, ratio = this.parameters.residualOutlierToleranceRatio) {
        if(!Number.isFinite(meanResidual) || meanResidual <= 0) return null
        return Math.max(meanResidual * ratio, minThreshold)
    }

    selectClosestOptionByOriginStamp(options, originStamp) {
        const pDiff = Math.abs(options.P.originStamp - originStamp)
        const sDiff = Math.abs(options.S.originStamp - originStamp)
        return pDiff <= sDiff ? options.P : options.S
    }

    createMiddleOutPickIndexes(startIndex, endIndex) {
        if(startIndex > endIndex) return []
        const indexes = []
        const mid = Math.floor((startIndex + endIndex) / 2)
        indexes.push(mid)
        for(let offset = 1; mid - offset >= startIndex || mid + offset <= endIndex; offset++) {
            if(mid + offset <= endIndex) indexes.push(mid + offset)
            if(mid - offset >= startIndex) indexes.push(mid - offset)
        }
        return indexes
    }

    calcWeightedMean(entries) {
        const weightSum = this.calcWeightSum(entries)
        if(weightSum > 0) {
            return entries.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / weightSum
        }
        return entries.reduce((sum, entry) => sum + entry.value, 0) / entries.length
    }

    calcWeightedRmse(entries, expectedValue) {
        const weightSum = this.calcWeightSum(entries)
        if(weightSum <= 0) return Infinity
        const mse = entries.reduce((sum, entry) => 
            sum + entry.weight * (entry.value - expectedValue) ** 2, 0
        ) / weightSum
        return Math.sqrt(mse)
    }

    calcMeanAbsResidual(entries, expectedValue) {
        if(entries.length === 0) return Infinity
        return entries.reduce((sum, entry) => 
            sum + Math.abs(entry.value - expectedValue), 0
        ) / entries.length
    }

    calcWeightSum(entries) {
        return entries.reduce((sum, entry) => sum + entry.weight, 0)
    }

    getPickWeight(pick, triggerRankWeight = 1) {
        const baseWeight = this.profile.getPickBaseWeight(pick)
        return baseWeight * (pick.densityWeight ?? 1) * triggerRankWeight
    }

    isPenaltyReferencePick(pick) {
        return this.profile.isPenaltyReferencePick(pick)
    }

    hasValidTriggerStamp(source) {
        return Number.isFinite(source?.triggerStamp) && source.triggerStamp > 0
    }

    createPickId(stationId, triggerStamp) {
        return `${stationId}:${triggerStamp}`
    }

    hasValidPickCandidate(pick) {
        return this.profile.isValidStationId(pick?.stationId) &&
            this.hasValidTriggerStamp(pick) &&
            pick.pickId === this.createPickId(pick.stationId, pick.triggerStamp)
    }

    createInvalidLikelihood(firstWave = null, lastWave = null, scenario = null) {
        return {
            score: Infinity,
            rmse: Infinity,
            inactivePenalty: 0,
            inactivePenaltyWeight: 0,
            waveCountPenalty: 0,
            unexplainedPickPenalty: 0,
            effectivePickCount: 0,
            effectiveStationCount: 0,
            qualityScore: -Infinity,
            qualityRank: 'D',
            originStamp: null,
            firstWave,
            lastWave,
            scenario,
            pickResults: []
        }
    }

    run() {
        this.refreshClusterResults()
        this.mergeCloseClusters()
        return this.getResults()
    }
}
