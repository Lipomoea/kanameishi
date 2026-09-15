import { shallowReactive, watch } from 'vue'
import { TaiwanStationCanvasLayer } from './StationCanvasLayer'
import { TaiwanGridCanvasLayer } from './GridCanvasLayer'
import { exactRound } from '@/utils/Utils'

export class TaiwanSeisNetLayers {
    constructor(useStationCanvasRenderer, onGridBoundsChange) {
        this.useStationCanvasRenderer = useStationCanvasRenderer
        this.onGridBoundsChange = onGridBoundsChange
        this.sources = shallowReactive(new Map())
        this.map = null
        this.stationCanvasLayer = null
        this.gridCanvasLayer = null
        this.decimal = null
        this.grids = []
        this.gridPositionSignature = ''
        this.disposed = false
        this.stopWatchGrids = watch(
            () => this.getGridPoints(),
            points => this.updateGrids(points)
        )
    }

    registerSource(id, stations, getGridLevel) {
        const source = { stations, getGridLevel }
        this.sources.set(id, source)
        this.syncLayers()
        this.redrawStations()
        return () => {
            if(this.sources.get(id) !== source) return
            this.sources.delete(id)
            this.syncLayers()
            this.redrawStations()
        }
    }

    getStations() {
        return [...this.sources.values()].flatMap(source => Object.values(source.stations))
    }

    getGridPoints() {
        return [...this.sources.values()].flatMap(source => Object.values(source.stations)
            .filter(station => station.isActive)
            .map(station => ({ latLng: [...station.latLng], level: source.getGridLevel(station) })))
    }

    setMap(map) {
        if(this.map === map || this.disposed) return
        this.removeLayers()
        this.map = map
        this.syncLayers()
        if(this.map && this.grids.length > 0) this.onGridBoundsChange()
    }

    syncLayers() {
        if(this.disposed) return
        if(!this.map || this.sources.size === 0) {
            this.removeLayers()
            return
        }
        if(this.useStationCanvasRenderer.value && !this.stationCanvasLayer) {
            this.stationCanvasLayer = new TaiwanStationCanvasLayer(() => this.getStations()).addTo(this.map)
        }
        if(!this.gridCanvasLayer) {
            this.gridCanvasLayer = new TaiwanGridCanvasLayer(this.grids).addTo(this.map)
        }
    }

    redrawStations() {
        this.stationCanvasLayer?.redraw()
    }

    updateGrids(points) {
        if(this.disposed) return
        if(points.length === 0) {
            this.decimal = null
        }
        else if(this.decimal === null) {
            // Keep the first active batch's origin until both networks become inactive.
            const first = points.reduce((highest, point) => point.level > highest.level ? point : highest)
            this.decimal = first.latLng.map(value => exactRound((value + 180) % 1, 2))
        }
        const gridMap = new Map()
        points.forEach(point => {
            const indices = point.latLng.map((value, index) => Math.round(exactRound(value - this.decimal[index], 10)))
            const key = indices.join(',')
            const grid = gridMap.get(key)
            if(grid) {
                grid.level = Math.max(grid.level, point.level)
            }
            else {
                gridMap.set(key, {
                    latLng: indices.map((value, index) => value + this.decimal[index]),
                    level: point.level
                })
            }
        })
        this.grids = [...gridMap.values()]
        this.gridCanvasLayer?.setGrids(this.grids)
        const positionSignature = this.grids.map(grid => grid.latLng.join(',')).sort().join('|')
        if(positionSignature !== this.gridPositionSignature) {
            this.gridPositionSignature = positionSignature
            if(this.map) this.onGridBoundsChange()
        }
    }

    removeLayers() {
        if(this.stationCanvasLayer) this.stationCanvasLayer.remove()
        if(this.gridCanvasLayer) this.gridCanvasLayer.remove()
        this.stationCanvasLayer = null
        this.gridCanvasLayer = null
    }

    dispose() {
        this.disposed = true
        this.stopWatchGrids()
        this.removeLayers()
        this.sources.clear()
        this.grids = []
        this.decimal = null
        this.map = null
    }
}
