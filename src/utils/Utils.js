import { useTimeStore } from "@/stores/time";
import { useSettingsStore } from "@/stores/settings";
import { chimeUrls } from "./Urls";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { booleanPointInPolygon, point } from "@turf/turf";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { presimplify, simplify } from "topojson-simplify";
import { cnSeisIntLoc, cnSeisIntLocBush } from "./CnSeisIntLoc";
import { around } from "geokdbush";
import { jmaSeisIntLoc } from "./JmaSeisIntLoc";
import { krSeisIntLoc, krSeisIntLocBush } from "./KrSeisIntLoc";
dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

let timeStore;
let settingsStore;

export const systemTimeZone = -new Date().getTimezoneOffset() / 60;

const EARTH_RADIUS_KM = 6371.0088;
const toRadians = degrees => (degrees * Math.PI) / 180;
const toDegrees = radians => (radians * 180) / Math.PI;

export const calcDistanceKm = ([lat1, lng1], [lat2, lng2]) => {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const lat1Rad = toRadians(lat1);
  const lat2Rad = toRadians(lat2);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLng / 2) ** 2;
  const boundedA = Math.min(Math.max(a, 0), 1);
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(boundedA), Math.sqrt(1 - boundedA));
};

export const calcLngDiff = (lng1, lng2) => {
  const diff = Math.abs(lng1 - lng2) % 360;
  return Math.min(diff, 360 - diff);
};

export const calcBearingDeg = ([lat1, lng1], [lat2, lng2]) => {
  const lat1Rad = toRadians(lat1);
  const lat2Rad = toRadians(lat2);
  const dLng = toRadians(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
};

export const formatNumber = (value, digit) => {
  if (value) {
    if (digit) return value.toFixed(digit);
    else return value;
  } else {
    return "N/A";
  }
};
export const formatText = text => {
  if (text) {
    return text;
  } else {
    return "N/A";
  }
};
export const msToTime = duration => {
  if (!duration) return;
  let seconds = Math.floor((duration / 1000) % 60);
  let minutes = Math.floor((duration / (1000 * 60)) % 60);
  let hours = Math.floor((duration / (1000 * 60 * 60)) % 24);
  let days = Math.floor(duration / (1000 * 60 * 60 * 24));

  hours = hours < 10 ? "0" + hours : hours;
  minutes = minutes < 10 ? "0" + minutes : minutes;
  seconds = seconds < 10 ? "0" + seconds : seconds;

  return days + "d " + hours + ":" + minutes + ":" + seconds;
};
export const timeToStamp = (time, timeZone) => {
  if (!time) return 0;
  return dayjs.utc(time).subtract(timeZone, "hours").valueOf();
};
export const stampToTime = (timeStamp, timeZone) => {
  return new Date(timeStamp + timeZone * 3600 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, -5);
};
export const convertCompactTimeString = time => {
  if (typeof time !== "string") return null;
  const parsed = dayjs.utc(time, "YYYYMMDDHHmmss", true);
  return parsed.isValid() ? parsed.format("YYYY-MM-DD HH:mm:ss") : null;
};
export const convertTimeString = (
  time,
  sourceTimeZone,
  targetTimeZone = systemTimeZone,
) => stampToTime(timeToStamp(time, sourceTimeZone), targetTimeZone);
export const calcPassedTime = (time, timeZone) => {
  if (!time || !Number.isFinite(timeZone)) return;
  if (!timeStore) timeStore = useTimeStore();
  let stamp1 = timeStore.getTimeStamp();
  let stamp2 = timeToStamp(time, timeZone);
  return stamp1 - stamp2;
};
export const verifyUpToDate = (time, timeZone, interval) => {
  if (!time || !Number.isFinite(timeZone) || !interval) return;
  return calcPassedTime(time, timeZone) <= interval;
};
export const calcTimeDiff = (time1, timeZone1, time2, timeZone2) => {
  if (
    !time1 ||
    !Number.isFinite(timeZone1) ||
    !time2 ||
    !Number.isFinite(timeZone2)
  )
    return;
  let stamp1 = timeToStamp(time1, timeZone1);
  let stamp2 = timeToStamp(time2, timeZone2);
  return stamp1 - stamp2;
};
export const sendMyNotification = (title, body, icon = "") => {
  if (!settingsStore) settingsStore = useSettingsStore();
  const silent = settingsStore.mainSettings.muteNotification;
  if ("Notification" in window) {
    if (Notification.permission == "granted") {
      if (!settingsStore.mainSettings.gameMode) {
        const notification = new Notification(title, {
          body,
          icon,
          silent,
        });
        notification.onclick = () => {
          window.focus();
        };
      }
    }
  }
};
export const setClassName = (intensity, useShindo, isCanceled = false) => {
  let className = "dark-gray";
  if (!isCanceled) {
    if (useShindo) {
      const rank = getShindoRank(intensity);
      if (rank == 1) className = "gray";
      if (rank == 2) className = "blue";
      if (rank == 3) className = "green";
      if (rank == 4) className = "yellow";
      if (rank == 5) className = "orange";
      if (rank == 6) className = "dark-orange";
      if (rank == 7) className = "red";
      if (rank == 8) className = "dark-red";
      if (rank == 9) className = "purple";
    } else {
      const numIntensity = Math.round(Number(intensity));
      if (numIntensity >= 1 && numIntensity <= 12) {
        if (numIntensity == 1) className = "dark-gray";
        if (numIntensity == 2) className = "gray";
        if (numIntensity == 3) className = "sky-blue";
        if (numIntensity == 4) className = "blue";
        if (numIntensity == 5) className = "green";
        if (numIntensity == 6) className = "yellow";
        if (numIntensity == 7) className = "orange";
        if (numIntensity == 8) className = "dark-orange";
        if (numIntensity == 9) className = "red";
        if (numIntensity >= 10) className = "purple";
      }
    }
  }
  return className;
};
export const classNameArray = [
  "dark-gray",
  "gray",
  "sky-blue",
  "blue",
  "green",
  "yellow",
  "orange",
  "dark-orange",
  "red",
  "dark-red",
  "purple",
];
export const csisArray = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "",
  "≥10",
];
export const csisRomanArray = [
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "",
  "≥X",
];
export const shindoArray = [
  "",
  "1",
  "",
  "2",
  "3",
  "4",
  "5-",
  "5+",
  "6-",
  "6+",
  "7",
];
export const shindoScale = [
  "0",
  "1",
  "2",
  "3",
  "4",
  "5-",
  "5+",
  "6-",
  "6+",
  "7",
];
export const shindoScaleKanji = [
  "0",
  "1",
  "2",
  "3",
  "4",
  "5弱",
  "5強",
  "6弱",
  "6強",
  "7",
];
export const intScale = [
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
];
export const getClassLevel = className => {
  return classNameArray.indexOf(className);
};
export const playSound = type => {
  if (!settingsStore) settingsStore = useSettingsStore();
  const soundEffect = settingsStore.mainSettings.soundEffect;
  const url =
    chimeUrls.custom[type] ||
    chimeUrls.general[type] ||
    chimeUrls[soundEffect][type];
  const audio = new Audio(url);
  audio.volume = settingsStore.mainSettings.masterVolume / 100;
  audio.play().catch(async _ => {
    let objectUrl;
    let fallbackAudio;
    let objectUrlRevoked = false;
    const revokeObjectUrl = () => {
      if (!objectUrl || objectUrlRevoked) return;
      objectUrlRevoked = true;
      fallbackAudio?.removeEventListener("ended", revokeObjectUrl);
      fallbackAudio?.removeEventListener("error", revokeObjectUrl);
      URL.revokeObjectURL(objectUrl);
    };
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);
      fallbackAudio = new Audio(objectUrl);
      fallbackAudio.volume = settingsStore.mainSettings.masterVolume / 100;
      fallbackAudio.addEventListener("ended", revokeObjectUrl, { once: true });
      fallbackAudio.addEventListener("error", revokeObjectUrl, { once: true });
      await fallbackAudio.play();
    } catch (_) {
      revokeObjectUrl();
      console.log("不支持的音频");
    }
  });
};
export const calcWaveDistance = (travelTime, isPWave, depth, time) => {
  if (depth < 0) depth = 0;
  if (time < 0) time = 0;
  const { depths, distances, p_times, s_times } = travelTime;
  const data = isPWave ? p_times : s_times;
  let i = 1;
  while (depths[i] < depth && i < depths.length - 1) i++;
  const k1 = depths[i] - depth;
  const k2 = depth - depths[i - 1];
  let time0 = (k1 * data[i - 1][0] + k2 * data[i][0]) / (k1 + k2);
  if (time <= time0) return { reach: time / time0, radius: 0 };
  let j = 1;
  let time1 = (k1 * data[i - 1][j] + k2 * data[i][j]) / (k1 + k2);
  while (time1 < time && j < distances.length - 1) {
    time0 = time1;
    j++;
    time1 = (k1 * data[i - 1][j] + k2 * data[i][j]) / (k1 + k2);
  }
  const k = (distances[j] - distances[j - 1]) / (time1 - time0);
  const b = distances[j] - k * time1;
  const distance = k * time + b;
  return { reach: 1, radius: distance };
};
export const calcReachTime = (travelTime, isPWave, depth, distance) => {
  if (depth < 0) depth = 0;
  if (distance < 0) distance = 0;
  const { depths, distances, p_times, s_times } = travelTime;
  const data = isPWave ? p_times : s_times;
  let i = 1;
  while (depths[i] < depth && i < depths.length - 1) i++;
  const k1 = depths[i] - depth;
  const k2 = depth - depths[i - 1];
  let j = 1;
  while (distances[j] < distance && j < distances.length - 1) j++;
  const time0 = (k1 * data[i - 1][j - 1] + k2 * data[i][j - 1]) / (k1 + k2);
  const time1 = (k1 * data[i - 1][j] + k2 * data[i][j]) / (k1 + k2);
  const k = (time1 - time0) / (distances[j] - distances[j - 1]);
  const b = time1 - k * distances[j];
  const time = k * distance + b;
  return time;
};
export const extractNumbers = str => {
  let numberString = "";
  for (let i = 0; i < str.length; i++) {
    if (str[i] >= "0" && str[i] <= "9") numberString += str[i];
  }
  return numberString;
};
export const getTimeNumberString = (timeZone, offset) => {
  if (!timeStore) timeStore = useTimeStore();
  const now = new Date(
    timeStore.getTimeStamp() + timeZone * 3600 * 1000 + offset,
  );
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hours = String(now.getUTCHours()).padStart(2, "0");
  const minutes = String(now.getUTCMinutes()).padStart(2, "0");
  const seconds = String(now.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
};
export const getShindoFromChar = char => {
  if (char >= "d" && char <= "k") return "0";
  if (char >= "l" && char <= "m") return "1";
  if (char >= "n" && char <= "o") return "2";
  if (char >= "p" && char <= "q") return "3";
  if (char >= "r" && char <= "s") return "4";
  if (char == "t") return "5-";
  if (char == "u") return "5+";
  if (char == "v") return "6-";
  if (char == "w") return "6+";
  if (char == "x") return "7";
  return "?";
};
export const getShindoFromLevel = level => {
  if (level >= 0 && level <= 7) return "0";
  if (level >= 8 && level <= 9) return "1";
  if (level >= 10 && level <= 11) return "2";
  if (level >= 12 && level <= 13) return "3";
  if (level >= 14 && level <= 15) return "4";
  if (level == 16) return "5-";
  if (level == 17) return "5+";
  if (level == 18) return "6-";
  if (level == 19) return "6+";
  if (level == 20) return "7";
  return "?";
};
const palertPgaThresholds = [
  0.1, 0.14, 0.18, 0.25, 0.33, 0.44, 0.59, 0.8, 1.4, 2.5, 4.4, 8, 14, 25, 44,
];
const palertPgvThresholds = [15, 30, 50, 80, 140];
export const getPalertLevelFromPgaPgv = (pga, pgv) => {
  if (!Number.isFinite(pga) || pga < 0) return -1;

  const usePgv = pga >= 80;
  const thresholds = usePgv ? palertPgvThresholds : palertPgaThresholds;
  const effectivePgv = Number.isFinite(pgv) && pgv >= 0 ? pgv : 0;
  const value = usePgv ? effectivePgv : pga;
  let level = 0;
  while (level < thresholds.length && value >= thresholds[level]) level++;
  return usePgv ? level + 15 : level;
};
export const getShindoFromInstShindo = (instShindo, useSymbol = true) => {
  if (!Number.isFinite(instShindo)) return useSymbol ? "?" : "不明";
  if (instShindo < -3.0) return "?";
  else if (instShindo < 0.5) return "0";
  else if (instShindo < 1.5) return "1";
  else if (instShindo < 2.5) return "2";
  else if (instShindo < 3.5) return "3";
  else if (instShindo < 4.5) return "4";
  else if (instShindo < 5.0) return useSymbol ? "5-" : "5弱";
  else if (instShindo < 5.5) return useSymbol ? "5+" : "5強";
  else if (instShindo < 6.0) return useSymbol ? "6-" : "6弱";
  else if (instShindo < 6.5) return useSymbol ? "6+" : "6強";
  else return "7";
};
export const getLevelFromInstShindo = instShindo => {
  if (instShindo < -3.0) return -1;
  else if (instShindo == -3.0) return 0;
  else if (instShindo >= 6.5) return 20;
  else return Math.floor(instShindo * 2 + 7);
};
export const getCsisLevelFromCsis = csis =>
  Math.min(Math.max(csis, 0), 12).toFixed(0);
export const judgeSameEvent = (eqMessage1, eqMessage2) => {
  if (eqMessage1.source == eqMessage2.source && eqMessage1.id == eqMessage2.id)
    return true;
  else return false;
};
export const focusWindow = async () => {
  if (!settingsStore) settingsStore = useSettingsStore();
  if (isTauri() && !settingsStore.mainSettings.gameMode) {
    await getCurrentWindow().show();
    await getCurrentWindow().unminimize();
    await getCurrentWindow().setFocus();
  }
};
export const pointDistToCnArea = (pointLngLat, feature) => {
  const turfPoint = point(pointLngLat);
  if (booleanPointInPolygon(turfPoint, feature)) {
    return 0;
  } else {
    const name = feature.properties.name;
    const kdbush = cnSeisIntLocBush[name];
    const nearestPoint = around(kdbush, pointLngLat[0], pointLngLat[1], 1).map(
      index => cnSeisIntLoc[name][index],
    )[0];
    const minDist = calcDistanceKm(
      [pointLngLat[1], pointLngLat[0]],
      [nearestPoint[1], nearestPoint[0]],
    );
    return minDist;
  }
};
export const pointDistToKrArea = (pointLngLat, feature) => {
  const turfPoint = point(pointLngLat);
  if (booleanPointInPolygon(turfPoint, feature)) {
    return 0;
  } else {
    const name = feature.properties.name;
    const kdbush = krSeisIntLocBush[name];
    const nearestPoint = around(kdbush, pointLngLat[0], pointLngLat[1], 1).map(
      index => krSeisIntLoc[name][index],
    )[0];
    const minDist = calcDistanceKm(
      [pointLngLat[1], pointLngLat[0]],
      [nearestPoint[1], nearestPoint[0]],
    );
    return minDist;
  }
};
const calcLineDis = (dep, dis) => {
  const r = EARTH_RADIUS_KM;
  const theta = dis / r;
  const a = r - dep;
  const lineDis = Math.sqrt(a * a + r * r - 2 * a * r * Math.cos(theta));
  return lineDis;
};
const calcCeaCsis = (m, dis = 0) =>
  1.297 * m - 4.368 * Math.log10(dis + 15) + 5.363;
const calcIclCsis = (m, dis = 0) =>
  1.363 * m - 1.494 * Math.log(dis + 7) + 2.941;
export const calcCsis = (m, dep = 10, dis = 0) => {
  m = Number(m);
  dep = Number(dep);
  dis = Number(dis);
  if (isNaN(m) || isNaN(dis)) return 0;
  if (dis > 10000) return 0;
  dep = isNaN(dep) || dep === null || dep < 10 ? 10 : dep;
  const lineDis = calcLineDis(dep, dis);
  const long = 10 ** ((m - 3.821) / 1.86);
  const hypoDis = Math.max(
    lineDis - 10 - long,
    dis - long,
    0.2 * (lineDis - 10),
    0,
  );
  const ceaCsis1 = calcCeaCsis(m, dis);
  const ceaCsis2 = calcCeaCsis(m, hypoDis);
  return (ceaCsis1 + ceaCsis2) / 2;
};
export const calcCsisLevel = (m, dep = 10, dis = 0) =>
  getCsisLevelFromCsis(calcCsis(m, dep, dis));
export const formatChineseTaiwan = str =>
  (str.startsWith("台湾") && !(str.includes("市") || str.includes("县"))
    ? "中国"
    : "") + str;
export const calcJmaShindo = (mj, dep, hypoLat, hypoLng, loc) => {
  const mw = mj - 0.171;
  const long = 10 ** (0.5 * mw - 1.85) / 2;
  const surfaceDist = calcDistanceKm([hypoLat, hypoLng], loc.location);
  const lineDis = calcLineDis(dep, surfaceDist);
  const hypoDist = lineDis - long;
  const x = Math.max(hypoDist, 3);
  const pgv600 =
    10 **
    (0.58 * mw +
      0.0038 * dep -
      1.29 -
      Math.log10(x + 0.0028 * 10 ** (0.5 * mw)) -
      0.002 * x);
  const arv = Number(loc.arv);
  const pgv400 = pgv600 * 1.307;
  const pgv = pgv400 * arv;
  const instShindo = 2.68 + 1.72 * Math.log10(pgv);
  return instShindo;
};
export const calcJmaShindoLevel = (
  mj,
  dep,
  hypoLat,
  hypoLng,
  loc,
  useSymbol = true,
) => {
  if (dep > 150) return useSymbol ? "?" : "不明";
  const instShindo = calcJmaShindo(mj, dep, hypoLat, hypoLng, loc);
  const instShindo1 = Math.floor(Math.round(instShindo * 100) / 10) / 10;
  if (instShindo1 < 0.5) return "0";
  else return getShindoFromInstShindo(instShindo1, useSymbol);
};
export const openUrl = url => {
  isTauri() ? open(url) : window.open(url, "_blank");
};
export const formatTimeZone = timeZone => (timeZone >= 0 ? "+" : "") + timeZone;
export const simplifyTopoJson = (topojson, factor) => {
  if (!factor) return topojson;
  else {
    const minWeights = {
      1: 2e-5,
      2: 1e-4,
      3: 5e-4,
      4: 2e-3,
    };
    const presimplified = presimplify(topojson);
    const simplified = simplify(presimplified, minWeights[factor]);
    return simplified;
  }
};
export const formatCsis = value => {
  if (!settingsStore) settingsStore = useSettingsStore();
  if (!value) return;
  if (settingsStore.mainSettings.useRomanCsis) {
    switch (value) {
      case "0":
        return "N";
      case "1":
        return "I";
      case "2":
        return "II";
      case "3":
        return "III";
      case "4":
        return "IV";
      case "5":
        return "V";
      case "6":
        return "VI";
      case "7":
        return "VII";
      case "8":
        return "VIII";
      case "9":
        return "IX";
      case "10":
        return "X";
      case "11":
        return "XI";
      case "12":
        return "XII";
      default:
        return "?";
    }
  } else {
    if (isNaN(value)) return "?";
    else return value;
  }
};
export const formatShindo = (intensity, useSymbol = true) =>
  intensity
    ? useSymbol
      ? intensity
          .replace("強", "+")
          .replace("弱", "-")
          .replace("不明", "?")
          .replace("級", "")
      : intensity.replace("+", "強").replace("-", "弱").replace("?", "不明")
    : undefined;
export const getShindoRank = value => {
  if (typeof value !== "string") return -1;
  return shindoScale.indexOf(
    formatShindo(value.trim().replaceAll("强", "強")),
  );
};
export const calcMaxJmaShindoLevel = (
  mj,
  dep,
  hypoLat,
  hypoLng,
  useSymbol = true,
) => {
  if (dep > 150) return useSymbol ? "?" : "不明";
  const locList = Object.keys(jmaSeisIntLoc);
  const maxInt = locList.reduce(
    (maxInt, currLoc) =>
      Math.max(
        calcJmaShindo(mj, dep, hypoLat, hypoLng, jmaSeisIntLoc[currLoc]),
        maxInt,
      ),
    -Infinity,
  );
  const maxInt1 = Math.floor(Math.round(maxInt * 100) / 10) / 10;
  if (maxInt1 < 0.5) return "0";
  else return getShindoFromInstShindo(maxInt1, useSymbol);
};
export const getMmiFromKmaLevel = level =>
  level == -1 ? "?" : Math.min(Math.max(level - 2, 0), 11).toString();
export const exactRound = (input, digit) => {
  if (!Number.isFinite(input) || !Number.isSafeInteger(digit)) return NaN;
  const [coefficient, exponent = "0"] = String(input).split("e");
  const shifted = Number(`${coefficient}e${Number(exponent) + digit}`);
  // Overflow while shifting means the requested decimal places already exceed the input's precision.
  if (!Number.isFinite(shifted)) return input;
  const [rounded, roundedExponent = "0"] = String(Math.round(shifted)).split("e");
  return Number(`${rounded}e${Number(roundedExponent) - digit}`);
};
export const compareFloat = (a, b, digit = 10) => {
  const left = exactRound(a, digit);
  const right = exactRound(b, digit);
  if (Number.isNaN(left) || Number.isNaN(right)) return NaN;
  return left < right ? -1 : left > right ? 1 : 0;
};
export const getCoordByDistanceBearing = (lat, lng, distanceKm, bearing) => {
  const radiusKm = EARTH_RADIUS_KM;
  const toDegrees = radians => (radians * 180) / Math.PI;

  const normalizedBearing = ((bearing % 360) + 360) % 360;

  const lat1Rad = toRadians(lat);
  const lng1Rad = toRadians(lng);
  const bearingRad = toRadians(normalizedBearing);

  const angularDistance = distanceKm / radiusKm;

  const lat2Rad = Math.asin(
    Math.sin(lat1Rad) * Math.cos(angularDistance) +
      Math.cos(lat1Rad) * Math.sin(angularDistance) * Math.cos(bearingRad),
  );

  const lng2Rad =
    lng1Rad +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(lat1Rad),
      Math.cos(angularDistance) - Math.sin(lat1Rad) * Math.sin(lat2Rad),
    );

  let lat2 = toDegrees(lat2Rad);
  let lng2 = toDegrees(lng2Rad);

  lng2 = ((lng2 + 540) % 360) - 180;

  return [lat2, lng2];
};
