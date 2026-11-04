export const dataSourceCategories = [
    { key: 'eew', label: '地震预警' },
    { key: 'eqlist', label: '地震信息' },
    { key: 'tsunami', label: '海啸信息' },
]

export const dataSourceProviders = {
    wolfx: 'Wolfx',
    lipo: 'Lipo',
    p2pquake: 'P2PQ',
    globalquake: 'GQ',
    usgs: 'USGS',
    mock: 'MOCK',
}

export const dataSourceCatalog = {
    jmaEew: {
        label: '日本気象庁: 緊急地震速報',
        category: 'eew',
        displayOrder: 3,
        apis: ['wolfx', 'lipo'],
    },
    cwaEew: {
        label: '臺灣中央氣象署: 強震即時警報',
        category: 'eew',
        displayOrder: 2,
        apis: ['wolfx'],
        defaultEnabled: true,
    },
    ceaEew: {
        label: '中国地震局: 地震预警',
        category: 'eew',
        displayOrder: 0,
        apis: ['wolfx', 'lipo'],
        defaultEnabled: true,
    },
    iclEew: {
        label: '成都高新减灾研究所: 地震预警',
        category: 'eew',
        displayOrder: 1,
        apis: ['lipo'],
        requiredCapability: 'iclEew',
    },
    kmaEew: {
        label: '기상청: 지진 조기 경보',
        category: 'eew',
        displayOrder: 4,
        apis: ['lipo'],
    },
    gqEew: {
        label: 'GlobalQuake: 地震预警',
        category: 'eew',
        displayOrder: 5,
        apis: ['globalquake'],
        requiredCapability: 'gqEew',
    },
    jmaEqlist: {
        label: '日本気象庁: 地震情報',
        category: 'eqlist',
        displayOrder: 2,
        apis: ['wolfx', 'p2pquake'],
    },
    cwaEqlist: {
        label: '臺灣中央氣象署: 地震報告',
        category: 'eqlist',
        displayOrder: 1,
        apis: ['lipo'],
        defaultEnabled: true,
    },
    cencEqlist: {
        label: '中国地震台网: 地震测定',
        category: 'eqlist',
        displayOrder: 0,
        apis: ['wolfx', 'lipo'],
        defaultEnabled: true,
    },
    kmaEqlist: {
        label: '기상청: 지진 정보',
        category: 'eqlist',
        displayOrder: 3,
        apis: ['lipo'],
    },
    usgsEqlist: {
        label: 'USGS: 地震测定',
        category: 'eqlist',
        displayOrder: 4,
        apis: ['usgs', 'lipo'],
    },
    jmaTsunami: {
        label: '日本気象庁: 津波情報',
        category: 'tsunami',
        displayOrder: 1,
        apis: ['p2pquake'],
    },
    nmefcTsunami: {
        label: '自然资源部: 海啸预警',
        category: 'tsunami',
        displayOrder: 0,
        apis: ['lipo'],
        defaultEnabled: true,
    },
}

export const eewSources = Object.keys(dataSourceCatalog).filter(source => dataSourceCatalog[source].category == 'eew')
export const eqlistSources = Object.keys(dataSourceCatalog).filter(source => dataSourceCatalog[source].category == 'eqlist')
export const tsunamiSources = Object.keys(dataSourceCatalog).filter(source => dataSourceCatalog[source].category == 'tsunami')

export const wolfxSocketSources = Object.keys(dataSourceCatalog).filter(source => dataSourceCatalog[source].apis.includes('wolfx'))
export const lipoSocketSources = Object.keys(dataSourceCatalog).filter(source => dataSourceCatalog[source].apis.includes('lipo'))
export const p2pquakeSocketSources = Object.keys(dataSourceCatalog).filter(source => dataSourceCatalog[source].apis.includes('p2pquake'))

export const createDefaultDataSources = () => Object.fromEntries(
    Object.entries(dataSourceCatalog).map(([source, config]) => [
        source,
        Object.fromEntries(config.apis.map(api => [api, Boolean(config.defaultEnabled)])),
    ])
)

// Map application sources to each provider's API wire types.
export const wolfxSourceTypes = {
    jmaEew: 'jma_eew',
    cwaEew: 'cwa_eew',
    ceaEew: 'cenc_eew',
    jmaEqlist: 'jma_eqlist',
    cencEqlist: 'cenc_eqlist',
}

export const lipoSourceTypes = {
    jmaEew: 'jma_eew',
    ceaEew: 'cea_eew',
    iclEew: 'icl_eew',
    kmaEew: 'kma_eew',
    cwaEqlist: 'cwa_report',
    cencEqlist: 'cenc_report',
    kmaEqlist: 'kma_report',
    usgsEqlist: 'usgs_report',
    nmefcTsunami: 'nmefc_tsunami',
}

export const migrateDataSources = saved => {
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {}
    const result = {}
    for (const [source, config] of Object.entries(dataSourceCatalog)) {
        const previous = saved[source]
        if (!previous || typeof previous !== 'object' || Array.isArray(previous)) continue
        const apis = { ...previous }
        if (config.apis.includes('lipo') && !Object.hasOwn(apis, 'lipo') && typeof apis.fan === 'boolean') {
            apis.lipo = apis.fan
        }
        delete apis.fan
        result[source] = apis
    }
    return result
}
