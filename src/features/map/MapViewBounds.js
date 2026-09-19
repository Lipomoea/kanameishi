import L from 'leaflet'

export const extendLayerBounds = (bounds, layer) => {
    if(!layer) return bounds
    if(typeof layer.getBounds === 'function') {
        const layerBounds = layer.getBounds()
        if(layerBounds?.isValid()) bounds.extend(layerBounds)
    }
    else if(typeof layer.getLatLng === 'function') {
        const latLng = layer.getLatLng()
        if(latLng && Number.isFinite(latLng.lat) && Number.isFinite(latLng.lng)) {
            bounds.extend(latLng)
        }
    }
    return bounds
}

const collectStyledAreaBounds = (group, property, defaultColor) => {
    const bounds = L.latLngBounds([])
    const visit = layer => {
        if(!layer) return
        // Inspect descendants before geometry: a group's bounds include unstyled areas.
        if(typeof layer.eachLayer === 'function') {
            layer.eachLayer(visit)
            return
        }
        const color = layer.options?.[property]
        if(color && color !== defaultColor) extendLayerBounds(bounds, layer)
    }
    visit(group)
    return bounds
}

export const collectFilledAreaBounds = (group, defaultFillColor) =>
    collectStyledAreaBounds(group, 'fillColor', defaultFillColor)

export const collectStrokedAreaBounds = (group, defaultStrokeColor) =>
    collectStyledAreaBounds(group, 'color', defaultStrokeColor)
