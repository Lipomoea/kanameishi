import assert from 'node:assert/strict'

export async function verifyClusterMatching({ FindNiedHypocenter, FindPalertHypocenter, load, read }) {
    const { createHypocenterTriggerSnapshots } = await load('src/features/stations/HypocenterTriggerSnapshots.js')
    const { createPalertHypocenterUpdate, mergePalertHypocenterUpdates } = await load('src/features/stations/PalertHypocenterUpdates.js')
    const { mergeNiedHypocenterUpdates } = await load('src/features/stations/NiedHypocenterUpdates.js')
    const start = 1788880000000
    for(const [name, Finder, merge] of [
        ['Nied', FindNiedHypocenter, mergeNiedHypocenterUpdates],
        ['Palert', FindPalertHypocenter, mergePalertHypocenterUpdates]
    ]) {
        const ids = Array.from({ length: 4 }, (_, i) => name === 'Nied' ? i : `W${i}`)
        const station = (i, triggerStamp = start) => ({
            id: ids[i], latLng: [24 + i * .01, 121], triggerStamp, updateStamp: start,
            isActive: false, ascend: 1, isPenaltyStation: () => false
        })
        const weak = station(1)
        const sources = createHypocenterTriggerSnapshots([weak, station(2, 0), station(3, NaN)])
        assert.deepEqual(sources.map(s => s.stationId), [ids[1]], 'Weak unactivated triggers participate, invalid triggers do not')
        assert.notEqual(sources[0].latLng, weak.latLng)
        assert.deepEqual(createPalertHypocenterUpdate([weak], start).triggerStations, sources)
        assert.equal(createPalertHypocenterUpdate([weak], start).pickCandidates.length, 0)
        const a = { ...station(0), stationId: ids[0], pickId: `${ids[0]}:${start}`, ascend: 3, maxLevel: 10, secondMaxLevel: 9 }
        const adjacency = { [ids[0]]: [0, 1, 1, 2, 3].map(i => ({ stationId: ids[i], distance: i * 10 })) }
        // Residual matrices isolate the ranking from search; every entry is in milliseconds.
        const rank = (rows, order = rows.map((_, i) => i)) => {
            const f = new Finder([], adjacency)
            assert.equal(f.parameters.clusterMatchMeanResidualTieTolerance, 500)
            assert.equal(f.parameters.clusterMatchResidualTieTolerance, 500)
            const clusters = rows.map(() => f.createCluster([]))
            const calls = []
            f.calcClusterPickMatch = (source, cluster) => {
                calls.push([source, cluster.id])
                const row = rows[cluster.id - 1]
                return { residual: source === a ? row[0] : row[1], distance: row[2] }
            }
            f.setTriggerStations([...sources, { ...sources[0] }, { ...a, triggerStamp: start + 5000 }, station(2, 0)])
            f.clusters = order.map(i => clusters[i])
            return { f, calls, selected: f.findBestMatchingCluster(a)?.id ?? null }
        }
        assert.equal(rank([[2000, 0, 100], [0, 4000, 10]]).selected, 1,
            'A good neighborhood can win despite own residual being over one second worse')
        assert.equal(rank([[2000, 0, 100], [0, 1200, 10]]).selected, 2,
            'A is included once at equal weight; its submitted stamp overrides its newer station stamp')
        assert.equal(rank([[100, 100, 100], [0, 1200, 10]]).selected, 2, 'Mean gap exactly 500 ms is eligible')
        assert.equal(rank([[100, 100, 100], [0, 1200.002, 10]]).selected, 1, 'Mean gap just over 500 ms is excluded')
        assert.equal(rank([[100, 1100, 100], [600, 600, 10]]).selected, 2, 'Own gap exactly 500 ms allows nearer cluster')
        assert.equal(rank([[100, 1100, 100], [600.001, 599.999, 10]]).selected, 1, 'Own gap just over 500 ms excludes nearer cluster')
        const permutations = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]
        for(const order of permutations) {
            assert.equal(rank([[1000,1000,100],[600,2200,10],[0,3600,1]], order).selected, 2,
                'Mean bands are anchored to the global minimum, not chained pairwise')
            assert.equal(rank([[100,3500,100],[500,3100,10],[900,2700,1]], order).selected, 2,
                'Own bands use the minimum among mean survivors, independent of candidate order')
        }
        assert.equal(rank([[100,100,10],[100,100,10]], [1,0]).selected, 1, 'Exact ties are deterministic')
        assert.equal(rank([[6000,0,1],[1000,1000,100]]).selected, 2, 'Neighbors cannot rescue a pick failing its own gate')
        assert.equal(rank([[6000,0,1]]).selected, null)
        const single = rank([[1000,2000,100]])
        assert.equal(single.selected, 1)
        assert.equal(single.calls.length, 1, 'One candidate needs no neighbor predictions')
        const multiple = rank([[2000,0,100],[0,4000,10]])
        assert.equal(multiple.calls.length, 4, 'Each candidate sees A plus the same single deduplicated legal neighbor')
        assert.equal(multiple.f.picks.size, 0, 'Neighborhood evidence is never inserted as a pick')
        multiple.f.setTriggerStations([])
        assert.equal(multiple.f.findBestMatchingCluster(a)?.id, 2, 'Cleared current triggers cannot be replaced with stale evidence')
        assert.equal(rank([[100,Infinity,100],[200,Infinity,10]]).selected, 2, 'Unavailable neighborhood predictions fall back to own evidence')

        const previous = { frameStamp: start, pickCandidates: [a], activeStations: [a], triggerStations: sources }
        const latest = { frameStamp: start + 1000, pickCandidates: [], activeStations: [], triggerStations: [] }
        const coalesced = merge(previous, latest)
        assert.equal(coalesced.pickCandidates.length, 1, 'Queued picks survive message coalescing')
        assert.deepEqual(coalesced.triggerStations, [], 'Closed triggers do not survive message coalescing')

        // Actual Worker forwarding and coalescing, including snapshot replacement before association.
        const callbacks = [], responses = []
        globalThis.__matchingWorker = { self: { postMessage: m => responses.push(m) }, setTimeout: cb => callbacks.push(cb) }
        const state = await load(`src/workers/test-${name}-matching.js`,
            `const { self, setTimeout } = globalThis.__matchingWorker;\n` +
            read(`src/workers/Find${name}HypocenterWorker.js`) + '\nexport { finder };')
        const handler = globalThis.__matchingWorker.self.onmessage
        handler({ data: { type: 'init', adjStations: adjacency } })
        const send = data => handler({ data: { type: 'update', inactiveStations: [], ...data } })
        send({ ...previous, requestId: 1 })
        callbacks.shift()()
        assert(state.finder.triggerStations.has(ids[1]), 'Weak trigger reaches the production Finder through Worker')
        const newPick = { ...a, triggerStamp: start + 1000, pickId: `${ids[0]}:${start + 1000}` }
        let checked = false
        const upsert = state.finder.upsertPickCandidate
        state.finder.upsertPickCandidate = function(...args) {
            assert.equal(this.triggerStations.size, 0, 'Latest snapshot is installed before any queued pick is associated')
            checked = true
            return upsert.apply(this, args)
        }
        send({ ...previous, pickCandidates: [newPick], requestId: 2 })
        send({ ...latest, requestId: 3 })
        callbacks.shift()()
        assert(checked)
        assert.equal(responses.at(-1).requestId, 3)
        handler({ data: { type: 'reset', requestId: 4 } })
        assert.equal(state.finder, null)
        delete globalThis.__matchingWorker
    }
    console.log('PASS NIED/P-Alert neighborhood means, both inclusive 500-ms bands, candidate order, weak trigger snapshots and Worker forwarding/coalescing')
}
