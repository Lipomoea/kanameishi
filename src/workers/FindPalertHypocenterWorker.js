import { FindPalertHypocenter } from '@/classes/PalertHypoInf'
import { mergePalertHypocenterUpdates } from '@/features/stations/PalertHypocenterUpdates'

let finder = null
let adjStations = {}
let stationDensityWeights = {}
let stationDistanceTable = null
let pendingUpdate = null
let scheduled = false
let generation = 0

self.onmessage = ({ data: message }) => {
    if(message.type === 'init' || message.type === 'reset') {
        generation++
        finder = null
        pendingUpdate = null
        scheduled = false
        if(message.type === 'init') {
            adjStations = message.adjStations || {}
            stationDensityWeights = FindPalertHypocenter.calcStationDensityWeights(adjStations)
            stationDistanceTable = message.stationDistanceTable ?? null
        }
        else self.postMessage({ requestId: message.requestId, results: [] })
        return
    }
    if(message.type !== 'update') return
    pendingUpdate = mergePalertHypocenterUpdates(pendingUpdate, message)
    if(scheduled) return
    scheduled = true
    const currentGeneration = generation
    setTimeout(() => {
        if(currentGeneration !== generation) return
        scheduled = false
        const update = pendingUpdate
        pendingUpdate = null
        if(!update) return
        finder ??= new FindPalertHypocenter(update.inactiveStations, adjStations, stationDensityWeights, stationDistanceTable)
        const results = finder.update(update.pickCandidates, update.inactiveStations, update.activeStations)
        self.postMessage({ requestId: update.requestId, results })
    }, 0)
}
