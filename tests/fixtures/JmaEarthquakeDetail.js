import { readFileSync } from 'node:fs'

export const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8')
const utilsSource = read('src/utils/Utils.js')
const names = ['shindoScale', 'formatShindo', 'getShindoRank', 'setClassName']
export const shindoUtils = new Function(names.map(name => {
    const start = utilsSource.indexOf(`export const ${name} =`)
    return utilsSource.slice(start, utilsSource.indexOf('\nexport ', start + 1)).replace('export const ', 'const ')
}).join('\n') + `\nreturn { ${names.join(', ')} };`)()
const detailSource = read('src/features/history/JmaEarthquakeDetail.js')
    .replace(/^import[^\n]*\n/gm, '').replaceAll('export const ', 'const ').replaceAll('export class ', 'class ')
export const jmaDetail = new Function('formatShindo', 'getShindoRank', detailSource +
    '\nreturn { selectJmaIntensityReport, normalizeJmaIntensityEvent, mergeJmaHistoryAreas, JmaEarthquakeDetailCache };')(
    shindoUtils.formatShindo, shindoUtils.getShindoRank)

export const report = (overrides = {}) => ({
    id: 'detail-1', product: 'VXSE53', title: '震源・震度情報', status: 'issued', issuedAt: '2026-11-22T12:00:00Z',
    observation: {
        prefs: [{ code: '43', name: '熊本県', int: '5-' }],
        areas: [{ code: '743', name: '熊本県天草・芦北', int: '5-', pref: 0 }],
        cities: [{ code: '4348200', name: '芦北町', area: 0,
            stations: [{ code: '4348201', name: '芦北町芦北', int: '5-' }] }],
    },
    ...overrides,
})
export const quake = (eventId = 'event-1', reports = [report()]) => ({ eventId, status: 'reported', reports })
