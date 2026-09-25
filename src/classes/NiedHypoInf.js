import { FindHypocenter } from './FindHypocenter'
import { niedHypocenterProfile } from './NiedHypocenterProfile'

export class FindNiedHypocenter extends FindHypocenter {
    constructor(inactiveStations, adjStations, stationDensityWeights = null, stationDistanceTable = null) {
        super(inactiveStations, adjStations, niedHypocenterProfile, stationDensityWeights, stationDistanceTable)
    }
}
