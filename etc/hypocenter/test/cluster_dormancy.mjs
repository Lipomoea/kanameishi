import assert from 'node:assert/strict'

// Called by palert_inference.mjs using its real module loader and both production profiles.
export async function verifyClusterDormancy({ FindNiedHypocenter, FindPalertHypocenter, load, read }) {
    const start = 1788880000000
    const dormancyDuration = 30000
    for(const [name, Finder] of [['Nied', FindNiedHypocenter], ['Palert', FindPalertHypocenter]]) {
        const ids = Array.from({ length: 5 }, (_, i) => name === 'Nied' ? i : `W${i}`)
        const pick = (index, offset = 0) => ({
            stationId: ids[index], pickId: `${ids[index]}:${start + offset}`,
            triggerStamp: start + offset, updateStamp: start + 10000,
            latLng: [24 + index * 0.01, 121], ascend: 3, level: 10, maxLevel: 10, secondMaxLevel: 9
        })
        const active = picks => picks.map(p => ({ ...p, id: p.stationId, isActive: true }))
        const adjacency = Object.fromEntries(ids.map(id => [id, ids.map(stationId => ({ stationId, distance: 10 }))]))
        const f = new Finder([], adjacency)
        const first = pick(0)
        f.update([first], [], active([first]), start + 10000)
        const cluster = f.clusters[0]
        assert.equal(cluster.dormantSince, null)
        f.update([], [], [], start + 11000)
        assert.equal(cluster.dormantSince, start + 11000, 'Even a one-station cluster enters dormancy')
        assert.equal(f.pickClusterMap.get(first.pickId), cluster)
        assert(f.stationPickMap.get(first.stationId).has(f.picks.get(first.pickId)))
        assert.deepEqual(f.getResults(), [])

        // Reactivation, new metrics, and a later updateStamp all retain the original deadline.
        const repeated = { ...first, updateStamp: start + 20000, ascend: 8, maxLevel: 13, secondMaxLevel: 12 }
        f.update([repeated], [], active([repeated]), start + 20000)
        assert.equal(cluster.dormantSince, start + 11000)
        assert.equal(cluster.dirty, true, 'Dormant clusters retain pending changes until waking')
        f.update([], [], active([first]), start + 11000 + dormancyDuration)
        assert.equal(f.clusters[0], cluster, 'Exactly thirty seconds is still eligible')

        // This observation arrives now, but its onset predates both dormancy and the first pick.
        const backdated = pick(1, -1000)
        f.update([backdated], [], active([backdated]), start + 11000 + dormancyDuration)
        assert.equal(f.clusters[0], cluster)
        assert.equal(cluster.dormantSince, null, 'One newly associated active pick wakes the original cluster')
        assert.equal(cluster.picks.length, 2)
        f.update([], [], [], start + 72000)
        assert.equal(cluster.dormantSince, start + 72000, 'A later sleep has its own deadline')
        const sameStationNewPick = pick(1, 1000)
        f.update([sameStationNewPick], [], active([sameStationNewPick]), start + 73000)
        assert.equal(cluster.dormantSince, null, 'A new pick identity at the same station also wakes')
        f.update([], [], [], start + 74000)

        // A coalesced earlier observation may be new to Finder, but is no longer active now.
        const queued = pick(2, 2000)
        f.update([queued], [], [], start + 75000)
        assert.equal(cluster.picks.length, 4)
        assert.equal(cluster.dormantSince, start + 74000, 'Inactive queued observations do not wake or extend the TTL')
        f.update([], [], active([first]), start + 74000 + dormancyDuration + 1)
        for(const map of [f.picks, f.pickClusterMap, f.stationPickMap, f.latestPickIdByStation, f.latestPickStampByStation]) {
            assert.equal(map.size, 0, 'Expiry clears pick/index state even if old stations are active again')
        }
        assert.equal(f.clusters.length, 0)

        const late = new Finder([], adjacency)
        late.update([first], [], active([first]), start)
        const oldId = late.clusters[0].id
        late.update([], [], [], start + 1000)
        late.update([backdated], [], active([backdated]), start + 1000 + dormancyDuration + 1)
        assert(!late.picks.has(first.pickId), 'Expired picks are removed before a late compatible pick is associated')
        assert.notEqual(late.clusters[0].id, oldId)
        assert.equal(late.clusters[0].picks.length, 1)

        // Real inferred results freeze while metrics and inactive-candidate membership keep updating.
        const inferred = new Finder([], adjacency)
        const picks = ids.map((_, i) => pick(i, i * 100))
        assert(inferred.update(picks, [], active(picks), start + 10000).length > 0)
        const inferredCluster = inferred.clusters[0]
        const previous = inferredCluster.previousResults
        const resultBeforeSleep = inferredCluster.result
        const reportBeforeSleep = inferredCluster.reportNum
        const stableCountBeforeSleep = inferredCluster.stableHypocenterUpdateCount
        const inactive = [0, 1].map(i => ({ id: name === 'Nied' ? 1000 + i : `Q${i}`,
            latLng: [i, i], updateStamp: start + 11000, nonQuietBoundaryStamp: start - 1000 }))
        const dormantStation = { ...picks[0], id: picks[0].stationId, nonQuietBoundaryStamp: start - 1000 }
        assert.deepEqual(inferred.getInactivePenaltyCandidates(inferredCluster.picks), [])
        let fits = 0
        let fittedInactiveIds = null
        const fit = inferred.findBestHypocenterWithEffectivePicks.bind(inferred)
        inferred.findBestHypocenterWithEffectivePicks = (...args) => {
            fits++
            fittedInactiveIds = inferred.getInactivePenaltyCandidates(args[0]).map(station => station.id)
            return fit(...args)
        }
        inferred.update([], [dormantStation, inactive[0]], [], start + 11000)
        assert.deepEqual(inferred.getInactivePenaltyCandidates(inferredCluster.picks), [inactive[0]],
            'Retained dormant picks still exclude their stations from inactive candidates')
        const changed = { ...picks[0], ascend: 12, maxLevel: 14, secondMaxLevel: 13 }
        inferred.update([changed], [inactive[1]], active([changed]), start + 12000)
        assert.equal(fits, 0, 'Entering dormancy and later metric/inactive changes never run the solver')
        assert.equal(inferredCluster.result, resultBeforeSleep)
        assert.equal(inferredCluster.previousResults, previous)
        assert.equal(inferredCluster.reportNum, reportBeforeSleep)
        assert.equal(inferredCluster.stableHypocenterUpdateCount, stableCountBeforeSleep)
        assert.equal(inferredCluster.dirty, true)
        assert.equal(inferred.picks.get(changed.pickId)[name === 'Nied' ? 'maxAscend' : 'maxLevel'],
            name === 'Nied' ? 12 : 14, 'Pick metrics still update during dormancy')
        assert.deepEqual(inferred.getInactivePenaltyCandidates(inferredCluster.picks), [inactive[1]])
        assert.deepEqual(inferred.getResults(), [], 'Frozen solutions remain hidden')
        let wakingInactive = [inactive[1]]
        if(name === 'Palert') {
            const noLongerQuiet = { ...inactive[1], nonQuietBoundaryStamp: start + 500 }
            inferred.update([], [noLongerQuiet], [], start + 12500)
            assert.deepEqual(inferred.getInactivePenaltyCandidates(inferredCluster.picks), [],
                'A changed quiet boundary invalidates candidates during dormancy without an ID change')
            assert.equal(fits, 0)
            wakingInactive = [noLongerQuiet]
        }
        const renewed = pick(0, 1000)
        inferred.adjStations = {}
        assert.equal(inferred.findBestMatchingCluster(renewed), inferredCluster,
            'The frozen solution can associate a pick without a neighboring station')
        assert(inferred.update([renewed], wakingInactive, active([renewed]), start + 13000).length > 0)
        assert.equal(inferred.clusters[0], inferredCluster)
        assert.equal(inferredCluster.dormantSince, null)
        assert.equal(inferredCluster.dirty, false)
        assert.equal(fits, 1, 'Waking refits in the same frame')
        assert.deepEqual(fittedInactiveIds, name === 'Nied' ? [inactive[1].id] : [],
            'Waking uses the current inactive candidates')
        assert.notEqual(inferredCluster.result, resultBeforeSleep)

        const bridged = new Finder([], { [ids[2]]: [0, 1].map(i => ({ stationId: ids[i], distance: 10 })) })
        bridged.update([first, pick(1)], [], active([first, pick(1)]), start)
        assert.equal(bridged.clusters.length, 2)
        bridged.update([], [], [], start + 1000)
        assert(bridged.clusters.every(cluster => cluster.dormantSince !== null))
        bridged.update([pick(2)], [], active([pick(2)]), start + 2000)
        assert.equal(bridged.clusters.length, 1)
        assert.equal(bridged.clusters[0].picks.length, 3)
        assert.equal(bridged.clusters[0].dormantSince, null,
            'One new active bridge wakes and merges two unsolved dormant groups through adjacency')
        assert.equal(bridged.clusters[0].dirty, false)

        for(const method of ['adjacent', 'close']) for(const hasActiveMember of [false, true]) {
            const merged = new Finder([], {})
            merged.update([first, pick(1)], [], active([first, pick(1)]), start)
            assert.equal(merged.clusters.length, 2)
            const [a, b] = merged.clusters
            a.dormantSince = start + 1000
            b.dormantSince = hasActiveMember ? null : start + 2000
            b.updates = 100 // The selected base must not override the earlier dormant deadline.
            if(method === 'adjacent') merged.mergeAdjacentClusters(pick(2), [a, b])
            else {
                merged.canMergeClusterResults = () => true
                merged.mergeCloseClusters()
            }
            assert.equal(merged.clusters.length, 1)
            assert.equal(merged.clusters[0].dormantSince, hasActiveMember ? null : start + 1000,
                `${method}: only an active member wakes a merge; two dormant members retain the earliest start`)
            if(!hasActiveMember) assert.equal(merged.clusters[0].dirty, true,
                `${method}: a dormant merge must retain pending inference`)
        }

        // Both merge paths keep a usable old model without fitting dormant picks, then resume on waking.
        for(const method of ['adjacent', 'close']) for(const hasActiveMember of [false, true]) {
            const merged = new Finder([], adjacency)
            merged.update(picks, [], active(picks), start + 10000)
            const a = merged.clusters[0]
            merged.update([], [], [], start + 11000)
            const bPick = pick(0, 2000)
            merged.picks.set(bPick.pickId, bPick)
            merged.addPickToStationIndex(bPick)
            const b = merged.createCluster([bPick], null, true)
            b.dormantSince = hasActiveMember ? null : start + 12000
            // Reuse a measured solver result as a matching-model fixture for the second group.
            b.result = a.result
            const retained = a.result
            let mergeFits = 0
            const mergeFit = merged.findBestHypocenterWithEffectivePicks.bind(merged)
            merged.findBestHypocenterWithEffectivePicks = (...args) => { mergeFits++; return mergeFit(...args) }
            if(method === 'adjacent') {
                const bridge = pick(1, 2000)
                merged.picks.set(bridge.pickId, bridge)
                merged.addPickToStationIndex(bridge)
                merged.mergeAdjacentClusters(bridge, [a, b])
                merged.refreshClusterResults()
            }
            else merged.mergeCloseClusters()
            assert.equal(merged.clusters.length, 1)
            const combined = merged.clusters[0]
            assert.equal(combined.dormantSince, hasActiveMember ? null : start + 11000)
            assert.equal(mergeFits, hasActiveMember ? 1 : 0,
                `${method}: only a merge containing an active group is fitted`)
            if(hasActiveMember) {
                assert.equal(combined.dirty, false)
                assert.notEqual(combined.result, retained)
                continue
            }
            assert.equal(combined.result, retained)
            assert.equal(combined.previousResults, a.previousResults)
            assert.equal(combined.dirty, true)
            assert.deepEqual(merged.getResults(), [])
            merged.adjStations = {}
            const wakePick = pick(2, 2000)
            assert.equal(merged.findBestMatchingCluster(wakePick), combined,
                `${method}: the dormant merged group keeps travel-time association`)
            merged.update([wakePick], [], active([wakePick]), start + 13000)
            assert.equal(merged.clusters[0], combined)
            assert.equal(combined.dormantSince, null)
            assert.equal(combined.dirty, false)
            assert.equal(mergeFits, 1, `${method}: the full merged group is fitted upon waking`)
            assert.equal(combined.result.clusterId, combined.id)
            assert.equal(combined.result.clusterPicks.length, combined.picks.length)
        }

        // A larger unsolved group must not erase the other dormant group's working model.
        const fallback = new Finder([], {})
        const solved = fallback.createCluster([first])
        solved.result = resultBeforeSleep
        solved.previousResults = previous
        solved.dormantSince = start + 1000
        const unsolved = fallback.createCluster([pick(1), pick(2)])
        unsolved.dormantSince = start + 2000
        const combined = fallback.mergeAdjacentClusters(pick(3), [solved, unsolved])
        fallback.refreshClusterResults()
        assert.equal(combined.result, resultBeforeSleep)
        assert.equal(combined.previousResults, previous)
        assert.equal(combined.initialHypocenter, resultBeforeSleep.hypocenter)

        // Expiry releases NIED exclusions; PAlert keeps its cluster-specific quiet-boundary rule.
        const expired = new Finder([], {})
        expired.update([first, pick(1)], [], active([first, pick(1)]), start)
        const survivor = expired.clusters[1]
        const oldStation = { ...first, id: first.stationId, nonQuietBoundaryStamp: start - 1000 }
        expired.update([], [oldStation], active([pick(1)]), start + 1000)
        assert.deepEqual(expired.getInactivePenaltyCandidates(survivor.picks), name === 'Nied' ? [] : [oldStation])
        expired.update([], [oldStation], active([pick(1)]), start + 1000 + dormancyDuration + 1)
        assert.equal(expired.clusters.length, 1)
        assert.deepEqual(expired.getInactivePenaltyCandidates(survivor.picks), [oldStation])

        for(const queuedGroupAlreadyExisted of [false, true]) {
            const queuedMerge = new Finder([], {})
            const initial = queuedGroupAlreadyExisted ? [first, pick(1)] : [first]
            queuedMerge.update(initial, [], active(initial), start)
            queuedMerge.update([], [], queuedGroupAlreadyExisted ? active([pick(1)]) : [], start + 1000)
            queuedMerge.canMergeClusterResults = () => true
            queuedMerge.update(queuedGroupAlreadyExisted ? [] : [pick(1)], [], [], start + 2000)
            assert.equal(queuedMerge.clusters.length, 1)
            assert.equal(queuedMerge.clusters[0].dormantSince, start + 1000,
                'A now-inactive group cannot masquerade as an active merge member and extend dormancy')
        }

        // Execute each real Worker with a controlled task queue. No wall-clock waiting is involved.
        const callbacks = [], responses = []
        globalThis.__dormancyWorker = {
            self: { postMessage: message => responses.push(message) },
            setTimeout: callback => callbacks.push(callback)
        }
        const state = await load(`src/workers/test-${name}-dormancy.js`,
            `const { self, setTimeout } = globalThis.__dormancyWorker;\n` +
            read(`src/workers/Find${name}HypocenterWorker.js`) + '\nexport { finder };')
        const handler = globalThis.__dormancyWorker.self.onmessage
        handler({ data: { type: 'init', adjStations: adjacency } })
        let requestId = 0
        const send = (frameStamp, pickCandidates = [], activeStations = []) => {
            handler({ data: { type: 'update', requestId: ++requestId, frameStamp, pickCandidates, activeStations, inactiveStations: [] } })
            callbacks.shift()()
            assert.equal(responses.at(-1).requestId, requestId)
        }
        send(start)
        assert.equal(state.finder, null, 'An empty quiet frame does not construct Finder')
        send(start + 10000, [first], active([first]))
        const retainedFinder = state.finder
        send(start + 11000)
        assert.equal(state.finder, retainedFinder, 'A nationwide quiet frame retains dormant Finder')
        send(start + 11000 + dormancyDuration, [backdated], active([backdated]))
        assert.equal(state.finder, retainedFinder, 'Waking the last dormant cluster must not reset Finder')
        assert.equal(state.finder.clusters[0].dormantSince, null)
        send(start + 72000)
        send(start + 72000 + dormancyDuration)
        assert.equal(state.finder, retainedFinder)
        send(start + 72000 + dormancyDuration + 1)
        assert.equal(state.finder, null, 'Finder is released only when quiet and all clusters have expired')
        send(start + 140000, [first], active([first]))
        send(start + 141000)
        handler({ data: { type: 'update', requestId: ++requestId, frameStamp: start + 142000,
            pickCandidates: [backdated], activeStations: active([backdated]), inactiveStations: [] } })
        handler({ data: { type: 'update', requestId: ++requestId, frameStamp: start + 143000,
            pickCandidates: [], activeStations: [], inactiveStations: [] } })
        assert.equal(callbacks.length, 1)
        callbacks.shift()()
        assert.equal(state.finder.frameStamp, start + 143000, 'Coalesced updates use the newest data frame time')
        assert.equal(state.finder.clusters[0].dormantSince, start + 141000,
            'An earlier queued pick from a station now inactive cannot wake the dormant cluster')
        assert.equal(state.finder.clusters[0].picks.length, 2, 'Coalescing still retains the earlier observation')
        handler({ data: { type: 'reset', requestId: ++requestId } })
        assert.equal(state.finder, null, 'Explicit timeline reset also drops dormant state immediately')
        delete globalThis.__dormancyWorker
    }
    console.log('PASS NIED/P-Alert dormant inference suspension, waking, frozen-model merges, inactive caches, frame-time expiry and Worker retention/reset')
}
