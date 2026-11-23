export const reportTime = Date.parse('2026-11-24T00:00:00Z')
export const tsunamiReport = (overrides = {}) => ({
    type: 'jma_tsunami', status: 'active', validUntil: new Date(reportTime + 90000).toISOString(),
    report: { time: new Date(reportTime).toISOString(), title: '津波警報・津波予報', id: 'report-1', issuedAt: null },
    areas: [
        { code: '772', name: '奄美諸島・トカラ列島', level: 'warning', firstWave: { time: '2026-11-24T00:20:00Z' }, maxWave: { height: 3, text: '３ｍ' } },
        { code: '100', name: '北海道太平洋沿岸東部', level: 'forecast' },
    ],
    ...overrides,
})

