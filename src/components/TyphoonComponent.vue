<template>
    <div>

    </div>
</template>

<script setup>
import L from 'leaflet';
import Http from '@/classes/Http';
import { useStatusStore } from '@/stores/status';
import { typhoonUrls } from '@/utils/Urls';
import { getCoordByDistanceBearing, stampToTime } from '@/utils/Utils';
import { onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useTimeStore } from '@/stores/time';

const statusStore = useStatusStore();
const timeStore = useTimeStore();

const typhoonData = reactive([]);
const updateTime = ref('1970-01-01 08:00:00');

const getColorFromPower = power => {
    let color = 'var(--dark-gray)';
    if (power < 6) {
        color = 'var(--gray)';
    } else if (power < 8) {
        color = 'var(--blue)';
    } else if (power < 10) {
        color = 'var(--green)';
    } else if (power < 12) {
        color = 'var(--yellow)';
    } else if (power < 14) {
        color = 'var(--orange)';
    } else if (power < 16) {
        color = 'var(--red)';
    } else {
        color = 'var(--purple)';
    }
    return color;
};

const createTyphoonSvgMarker = (currentInfo) => {
    const { id, name, nameEn, landInfos, time, lat, lng, category, power, windSpeed, pressure, moveSpeed } = currentInfo;
    const color = getColorFromPower(power);
    const svgClassName = power < 8 ? 'typhoon-animated-slow' : power < 12 ? 'typhoon-animated-mid' : power < 16 ? 'typhoon-animated-fast' : 'typhoon-animated-very-fast';
    const svgHtml = `
        <svg viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="40" height="40" class="${svgClassName}">
        <path d="M880.81 390.38c-153.42-236-333.4-227.19-445.52-188.84C358.57 228.1 290.71 284.16 249.4 355c-118 206.54 79.67 368.81 79.67 368.81l-0.63-2.11A277.4 277.4 0 0 0 365 747.61c-2.12-0.06-4.25-0.14-6.39-0.22-123.92-11.8-215.38-115.07-215.38-115.07 153.42 236 333.4 230.14 445.52 188.83 79.67-26.55 144.58-79.66 185.89-153.43 121-206.53-79.67-368.81-79.67-368.81s0.14 0.34 0.39 1a283 283 0 0 0-32.3-25c1.58 0.23 2.41 0.37 2.41 0.37 123.88 14.78 215.34 115.1 215.34 115.1zM574 591c-47.21 35.41-112.12 26.56-144.57-17.7-35.41-44.26-26.56-109.17 17.7-144.58s109.17-26.55 144.57 17.71S618.22 555.61 574 591z" fill="${color}"></path>
        </svg>
    `;
    const svgIcon = L.divIcon({
        html: svgHtml,
        className: 'typhoon-icon',
        iconSize: [40, 40],
        iconAnchor: [20, 20]
    });
    const latlng = [currentInfo.lat, currentInfo.lng];
    const marker = L.marker(latlng, { icon: svgIcon, pane: 'typhoonIconMarkerPane' });
    marker.bindTooltip(`
        <strong>${name} (${nameEn})</strong>
        <br>
        台风编号: ${id}
        <br>
        时间: ${time}
        <br>
        经纬度: (${lat.toFixed(2)}, ${lng.toFixed(2)})
        <br>
        中心风速: ${windSpeed} m/s (${power}级, ${category})
        <br>
        中心气压: ${pressure} hpa
        <br>
        移动速度: ${moveSpeed} km/h
        <br>
        ${landInfos.join('<br>') || '暂无台风登陆信息'}
    `, { permanent: false, direction: 'top', className: 'custom-tooltip' });
    return marker;
};

const generateWindCirclePoints = (lat, lng, radii) => {
    if (!radii || typeof radii !== 'object') {
        return null;
    }
    const { ne = 0, se = 0, sw = 0, nw = 0 } = radii;
    if (ne <= 0 && se <= 0 && sw <= 0 && nw <= 0) {
        return null;
    }
    const points = [];
    for (let i = 0; i < 360; i++) {
        if (i === 0) {
            points.push(getCoordByDistanceBearing(lat, lng, nw, i));
            points.push(getCoordByDistanceBearing(lat, lng, ne, i));
        } else if (i === 90) {
            points.push(getCoordByDistanceBearing(lat, lng, ne, i));
            points.push(getCoordByDistanceBearing(lat, lng, se, i));
        } else if (i === 180) {
            points.push(getCoordByDistanceBearing(lat, lng, se, i));
            points.push(getCoordByDistanceBearing(lat, lng, sw, i));
        } else if (i === 270) {
            points.push(getCoordByDistanceBearing(lat, lng, sw, i));
            points.push(getCoordByDistanceBearing(lat, lng, nw, i));
        } else {
            let r = 0;
            if (i > 0 && i < 90) r = ne;
            else if (i > 90 && i < 180) r = se;
            else if (i > 180 && i < 270) r = sw;
            else if (i > 270 && i < 360) r = nw;
            points.push(getCoordByDistanceBearing(lat, lng, r, i));
        }
    }
    return points;
};

const createTyphoonWindCircles = (centerLat, centerLng, radius7, radius10, radius12) => {
    const points7 = generateWindCirclePoints(centerLat, centerLng, radius7);
    const points10 = generateWindCirclePoints(centerLat, centerLng, radius10);
    const points12 = generateWindCirclePoints(centerLat, centerLng, radius12);
    const baseOptions = {
        fillOpacity: 0.15,
        opacity: 0.75,
        weight: 1,
        pane: 'typhoonWindCirclePane',
        interactive: false
    };
    let poly7 = null;
    let poly10 = null;
    let poly12 = null;
    if (points12) {
        poly12 = L.polygon(points12, {
            ...baseOptions,
            color: 'var(--red)',
            fillColor: 'var(--red)'
        });
    }
    if (points10) {
        const coords10 = points12 ? [points10, points12] : points10;
        poly10 = L.polygon(coords10, {
            ...baseOptions,
            color: 'var(--orange)',
            fillColor: 'var(--orange)'
        });
    }
    if (points7) {
        const innerHole = points10 || points12;
        const coords7 = innerHole ? [points7, innerHole] : points7;

        poly7 = L.polygon(coords7, {
            ...baseOptions,
            color: 'var(--green)',
            fillColor: 'var(--green)'
        });
    }
    return [poly7, poly10, poly12];
};

const createTyphoonPathLine = (latlngs, isForecast = false) => {
    const baseOptions = {
        weight: 1.5,
        pane: 'typhoonPathLinePane',
        interactive: false
    };
    return isForecast
        ? L.polyline(latlngs, {
            ...baseOptions,
            color: 'var(--red)',
            opacity: 0.75,
            dashArray: '10, 10'
        })
        : L.polyline(latlngs, {
            ...baseOptions,
            color: 'var(--green)',
            opacity: 1
        });
};

const createTyphoonPointMarker = (info, isForecast = false) => {
    const baseOptions = {
        radius: 5,
        color: 'white',
        opacity: isForecast ? 0.75 : 1,
        weight: 1,
        fillOpacity: isForecast ? 0.75 : 1,
        pane: 'typhoonPointMarkerPane'
    };
    const latlng = [info.lat, info.lng];
    const { time, lat, lng, category, power, windSpeed, pressure, moveSpeed } = info;
    const fillColor = getColorFromPower(power);
    const marker = L.circleMarker(latlng, {
        ...baseOptions,
        fillColor
    });
    let tooltipHtml = `
        时间: ${time}
        <br>
        经纬度: (${lat.toFixed(2)}, ${lng.toFixed(2)})
        <br>
        中心风速: ${windSpeed} m/s (${power}级, ${category})
        <br>
        中心气压: ${pressure} hpa
    `;
    if (moveSpeed) tooltipHtml += `
        <br>
        移动速度: ${moveSpeed} km/h
    `;
    marker.bindTooltip(tooltipHtml, { permanent: false, direction: 'top', className: 'custom-tooltip' });
    return marker;
};

const extractRadiusFromStr = radiusStr => {
    if (typeof radiusStr !== 'string') return null;
    const radiusArr = radiusStr.split('|').map(str => Number(str));
    if (radiusArr.length !== 4 || radiusArr.some(radius => !Number.isFinite(radius) || radius < 0)) return null;
    return {
        ne: radiusArr[0],
        se: radiusArr[1],
        sw: radiusArr[3],
        nw: radiusArr[2],
    };
};

const parseTyphoonPoint = point => {
    if (!point || point.lat == null || point.lng == null || String(point.lat).trim() === '' || String(point.lng).trim() === '') return null;
    const lat = Number(point.lat);
    const lng = Number(point.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
        time: point.time,
        lat,
        lng,
        category: point.strong,
        power: Number(point.power),
        windSpeed: Number(point.speed),
        pressure: Number(point.pressure),
        moveSpeed: Number(point.movespeed),
    };
};

const parseTyphoonInfo = info => {
    if (!Array.isArray(info?.points) || info.points.length === 0) return null;
    const pastPoints = info.points.map(parseTyphoonPoint);
    if (pastPoints.some(point => !point)) return null;
    const latestPoint = info.points[info.points.length - 1];
    const currentInfo = {
        ...pastPoints[pastPoints.length - 1],
        id: String(info.tfid),
        name: info.name,
        nameEn: info.enname,
        warnLevel: info.warnlevel,
        landInfos: Array.isArray(info.land) ? info.land.map(landInfo => landInfo?.info).filter(Boolean) : [],
        radius7: extractRadiusFromStr(latestPoint.radius7),
        radius10: extractRadiusFromStr(latestPoint.radius10),
        radius12: extractRadiusFromStr(latestPoint.radius12),
    };
    const forecast = latestPoint.forecast?.[0]?.forecastpoints;
    const forecastPoints = Array.isArray(forecast) ? forecast.slice(1).map(parseTyphoonPoint).filter(Boolean) : [];
    return { pastPoints, currentInfo, forecastPoints };
};

const fetchTyphoonData = async () => {
    try {
        const activeList = await Http.get(typhoonUrls.typhoon_activity_http + `?time=${Date.now()}`);
        if (stopped || !Array.isArray(activeList)) return false;
        const ids = [...new Set(activeList.map(info => String(info?.tfid ?? '').trim()))];
        if (ids.some(id => !id)) return false;
        const previousData = new Map(typhoonData.map(info => [info.currentInfo.id, info]));
        const results = await Promise.allSettled(ids.map(async id => {
            const info = await Http.get(typhoonUrls.typhoon_info_http + `${encodeURIComponent(id)}?time=${Date.now()}`);
            const typhoonInfo = String(info?.tfid) === id ? parseTyphoonInfo(info) : null;
            if (!typhoonInfo) throw new Error(`Invalid typhoon detail: ${id}`);
            return typhoonInfo;
        }));
        if (stopped) return false;

        let isSuccess = true;
        const nextData = [];
        results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                nextData.push(result.value);
            } else {
                isSuccess = false;
                console.log(result.reason);
                const previousInfo = previousData.get(ids[index]);
                if (previousInfo) nextData.push(previousInfo);
            }
        });
        // Keep failed details only while their IDs remain in the active list.
        typhoonData.splice(0, typhoonData.length, ...nextData);
        return isSuccess;
    } catch (err) {
        console.log(err);
        return false;
    }
};

let updateTimer;
let stopped = false;
const loopFetch = async () => {
    clearTimeout(updateTimer);
    const isSuccess = await fetchTyphoonData();
    if (stopped) return;
    const interval = isSuccess ? 5 * 60000 : 30000;
    updateTimer = setTimeout(loopFetch, interval);
};

let layers = [];
let map;

const addAndRecordLayer = layer => {
    if (!map || !layer) return;
    layer.addTo(map);
    layers.push(layer);
};

const removeAllLayers = () => {
    if (!map) return;
    layers.forEach(item => {
        if (map.hasLayer(item)) map.removeLayer(item);
    });
    layers = [];
};

const handleUpdate = () => {
    if (!map) return;
    removeAllLayers();
    typhoonData.forEach(typhoonInfo => {
        const currentInfo = typhoonInfo.currentInfo;
        const { lat, lng, radius7, radius10, radius12 } = currentInfo;

        const pastLatlngs = typhoonInfo.pastPoints.map(point => [point.lat, point.lng]);
        const pastLine = createTyphoonPathLine(pastLatlngs, false);
        addAndRecordLayer(pastLine);

        const forecastLatlngs = typhoonInfo.forecastPoints.map(point => [point.lat, point.lng]);
        forecastLatlngs.unshift([lat, lng]);
        const forecastLine = createTyphoonPathLine(forecastLatlngs, true);
        addAndRecordLayer(forecastLine);

        typhoonInfo.pastPoints.forEach(pointInfo => {
            const circleMarker = createTyphoonPointMarker(pointInfo, false);
            addAndRecordLayer(circleMarker);
        });

        typhoonInfo.forecastPoints.forEach(pointInfo => {
            const circleMarker = createTyphoonPointMarker(pointInfo, true);
            addAndRecordLayer(circleMarker);
        });

        const windCircles = createTyphoonWindCircles(lat, lng, radius7, radius10, radius12);
        windCircles.forEach(circle => addAndRecordLayer(circle));

        const svgMarker = createTyphoonSvgMarker(currentInfo);
        addAndRecordLayer(svgMarker);
    });
    updateTime.value = stampToTime(timeStore.getTimeStamp(), 8);
};

let unwatchData;

watch(() => statusStore.map, newVal => {
    if (newVal) {
        map = newVal;
        loopFetch();
        unwatchData = watch(() => JSON.stringify(typhoonData), handleUpdate, { immediate: true });
    }
}, { immediate: true });

onBeforeUnmount(() => {
    stopped = true;
    clearTimeout(updateTimer);
    if (unwatchData) unwatchData();
    removeAllLayers();
});
</script>

<style lang="scss" scoped></style>
