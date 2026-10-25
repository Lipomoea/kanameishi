import { shallowRef } from 'vue'

const normalizeConfig = data => {
    const config = data?.seisNetUrls?.trem
    return {
        stationList: typeof config?.stationList === 'string' ? config.stationList : '',
        stationReplay: typeof config?.stationReplay === 'string' ? config.stationReplay : '',
        stationSources: Array.isArray(config?.stationSources) ? config.stationSources.filter(source =>
            typeof source?.id === 'string' && source.id.length > 0 &&
            typeof source.name === 'string' && typeof source.url === 'string' && source.url.length > 0
        ) : []
    }
}

const readStoredConfig = () => {
    try {
        return normalizeConfig(JSON.parse(localStorage.getItem('tremUrl')))
    }
    catch {
        return normalizeConfig(null)
    }
}

export const tremConfig = shallowRef(readStoredConfig())

export const setTremConfig = data => {
    tremConfig.value = normalizeConfig(data)
}

export const selectTremStationSource = (sources, id) =>
    sources.find(source => source.id === id) ?? sources[0]
