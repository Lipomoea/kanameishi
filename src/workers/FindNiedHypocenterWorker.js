import { FindNiedHypocenter } from '@/classes/NiedHypoInf'
import { mergeNiedHypocenterUpdates } from '@/features/stations/NiedHypocenterUpdates'

let finder = null
let pendingUpdate = null
let processingScheduled = false
let workerVersion = 0
let adjStations = {}
let stationDensityWeights = {}
let stationDistanceTable = null

self.onmessage = event => {
    const message = event.data || {}
    const { type, requestId } = message

    if(type === 'init' || type === 'reset') {
        workerVersion++
        finder = null
        pendingUpdate = null
        processingScheduled = false
        if(type === 'init') {
            adjStations = message.adjStations || {}
            stationDensityWeights = FindNiedHypocenter.calcStationDensityWeights(adjStations)
            stationDistanceTable = message.stationDistanceTable ?? null
        }
        else self.postMessage({ requestId, results: [] })
        return
    }

    if(type !== 'update') return

    pendingUpdate = mergeNiedHypocenterUpdates(pendingUpdate, message)
    schedulePendingUpdate()
}

const schedulePendingUpdate = () => {
    if(processingScheduled) return
    processingScheduled = true
    const scheduledVersion = workerVersion
    setTimeout(() => processPendingUpdate(scheduledVersion), 0)
}

const processPendingUpdate = scheduledVersion => {
    if(scheduledVersion !== workerVersion) return
    processingScheduled = false
    const message = pendingUpdate
    if(!message) return
    pendingUpdate = null

    const {
        requestId,
        pickCandidates = [],
        activeStations = [],
        inactiveStations = []
    } = message

    if(!finder) {
        finder = new FindNiedHypocenter(inactiveStations, adjStations, stationDensityWeights, stationDistanceTable)
    }

    const results = finder.update(pickCandidates, inactiveStations, activeStations)
    if(scheduledVersion !== workerVersion) return
    self.postMessage({ requestId, results })

    if(pendingUpdate) schedulePendingUpdate()
}
