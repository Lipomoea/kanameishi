export const tsunamiTypes = ['', 'forecast', 'advisory', 'warning', 'major-warning']
export const tsunamiClassNames = ['gray', 'blue', 'yellow', 'red', 'purple']
export const jmaTsunamiTitles = ['津波警報・注意報なし', '津波予報', '津波注意報', '津波警報', '大津波警報']
export const nmefcTsunamiTitles = ['海啸预警已解除', '海啸留意报', '海啸注意报', '海啸警报', '大海啸警报']
export const tsunamiExpiryGrace = 30 * 60 * 1000

const jmaTitleLevels = { '津波予報': 1, '津波注意報': 2, '津波警報': 3, '大津波警報': 4 }
const jmaAreaLevels = { none: 0, cleared: 0, forecast: 1, advisory: 2, warning: 3, major_warning: 4 }
const nmefcLevels = { '蓝色': 1, '黄色': 2, '橙色': 3, '红色': 4 }
const nmefcHeights = [0, 0.3, 1, 3, 5]
const nmefcHeightDescriptions = ['', '30cm', '1m', '3m', '3m超']
const parseTime = value => typeof value === 'string' && value.trim() ? Date.parse(value) : NaN
const jstTime = stamp => new Date(stamp + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ')

export const normalizeTsunamiText = value => typeof value === 'string'
    ? value.replace(/[！-～]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replace(/　/g, ' ')
    : ''

export const getTsunamiSound = (level, action) => tsunamiTypes[level]
    ? `tsunami-${tsunamiTypes[level]}-${action}`
    : ''

// Arrival conditions/times and array order do not constitute warning changes.
export const tsunamiAreaKey = areas => JSON.stringify(areas
    .map(area => [area.code, area.level, area.height, area.description])
    .sort((a, b) => a[0].localeCompare(b[0])))

export const normalizeJmaTsunami = (data, now) => {
    const reportTimeStamp = parseTime(data?.report?.time)
    if (!Number.isFinite(reportTimeStamp)) return null
    const title = typeof data.report.title === 'string' ? data.report.title.split('・')[0].trim() : ''
    const titleLevel = Object.hasOwn(jmaTitleLevels, title) ? jmaTitleLevels[title] : 0
    let reportState, status = 0
    if (titleLevel && data.status === (titleLevel === 1 ? 'forecast_only' : 'active')) {
        reportState = data.status
        status = titleLevel
    } else if (data.status === 'cleared' || data.status === 'expired') {
        reportState = data.status
    } else if (data.reason === 'report_cancelled') {
        reportState = 'cancelled'
    } else return null

    const validUntilStamp = parseTime(data.validUntil)
    if (status && (!Number.isFinite(now) || !Number.isFinite(validUntilStamp)
        || now > validUntilStamp + tsunamiExpiryGrace || !Array.isArray(data.areas))) return null

    const areas = [], codes = new Set()
    if (status) for (const area of data.areas) {
        if (!area || typeof area.code !== 'string' || !area.code
            || !Object.hasOwn(jmaAreaLevels, area.level) || codes.has(area.code)) return null
        codes.add(area.code)
        const level = jmaAreaLevels[area.level]
        const arrivalStamp = parseTime(area.firstWave?.time)
        areas.push({
            code: area.code,
            name: typeof area.name === 'string' ? area.name : '',
            grade: area.level,
            level,
            height: level === 1 ? 0.2 : (typeof area.maxWave?.height === 'number' && Number.isFinite(area.maxWave.height) ? area.maxWave.height : null),
            description: level === 1 ? '20cm' : normalizeTsunamiText(area.maxWave?.text),
            arrivalTime: Number.isFinite(arrivalStamp) ? jstTime(arrivalStamp) : '',
            condition: typeof area.firstWave?.condition === 'string' ? area.firstWave.condition : '',
            className: tsunamiClassNames[level],
        })
    }
    return {
        source: 'jmaTsunami',
        id: typeof data.report.id === 'string' ? data.report.id : '',
        timeZone: 9,
        reportTime: jstTime(reportTimeStamp),
        reportTimeStamp,
        validUntilStamp: Number.isFinite(validUntilStamp) ? validUntilStamp : null,
        reportState,
        status,
        title: jmaTsunamiTitles[status],
        titleText: status ? `${jmaTsunamiTitles[status]}発表中` : jmaTsunamiTitles[0],
        className: tsunamiClassNames[status],
        warnArea: JSON.stringify(areas),
        areaKey: tsunamiAreaKey(areas),
    }
}

export const normalizeNmefcTsunami = data => {
    const status = Object.hasOwn(nmefcLevels, data.warningInfo.level) ? nmefcLevels[data.warningInfo.level] : 0
    const areas = data.forecasts.map(area => {
        const level = Object.hasOwn(nmefcLevels, area.warningLevel) ? nmefcLevels[area.warningLevel] : 0
        return {
            name: area.forecastArea,
            grade: area.warningLevel,
            height: nmefcHeights[level],
            description: nmefcHeightDescriptions[level],
            arrivalTime: normalizeTsunamiText(area.estimatedArrivalTime),
            className: tsunamiClassNames[level],
        }
    })
    return {
        source: 'nmefcTsunami',
        id: data.reportId,
        reportTime: data.timeInfo.issueTime,
        status,
        title: nmefcTsunamiTitles[status],
        titleText: status ? `现正发布${nmefcTsunamiTitles[status]}` : nmefcTsunamiTitles[0],
        className: tsunamiClassNames[status],
        warnArea: JSON.stringify(areas),
    }
}

export const shouldAcceptJmaTsunami = (previous, next) => {
    if (!Number.isFinite(previous.reportTimeStamp)) return true
    if (next.reportTimeStamp !== previous.reportTimeStamp) return next.reportTimeStamp > previous.reportTimeStamp
    if (previous.status > 0 && next.status > 0) return next.validUntilStamp > previous.validUntilStamp
    return previous.status > 0 && next.status === 0
}

export const getJmaTsunamiDisplayState = (message, now) => message.status > 0
    && now > message.validUntilStamp + tsunamiExpiryGrace ? 'expired' : message.reportState

export const getTsunamiAction = (previous, next) => {
    if (!next.status) return previous.status ? { action: 'clear', status: previous.status, title: previous.title } : null
    const action = next.status > previous.status ? 'issue' : next.status < previous.status ? 'switch' : 'update'
    return { action, status: next.status, title: next.title }
}

export const getJmaTsunamiAction = (previous, next) => {
    if (previous.status && next.status && previous.areaKey === next.areaKey) return null
    return getTsunamiAction(previous, next)
}

export const formatTsunamiArrival = (condition, time) => {
    const shortConditions = { '津波到達中と推測': '到達か', 'ただちに津波来襲と予測': 'すぐ来る', '第１波の到達を確認': 'すでに到達' }
    if (condition) return shortConditions[condition] || condition
    return typeof time === 'string' && time ? time.slice(8, -3).replace(' ', '日 ') : ''
}
