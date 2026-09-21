const fanWsBaseUrl = ["wss://ws.fanstudio.tech", "wss://ws.fanstudio.hk"];

export const FAN_API_APP_ID = "76d92e4b-a1d2-46be-93c8-75fc2d3286b8";

export const eqUrls = {
  niedLatest: "http://www.kmoni.bosai.go.jp/webservice/server/pros/latest.json",
  jmaEew2_http: "http://www.kmoni.bosai.go.jp/webservice/hypo/eew",
  jmaEqlist_http: "https://api.p2pquake.net/v2/history?codes=551&limit=1",
  usgsEqlist_http:
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson",
  wolfx_ws: ["wss://ws-api.wolfx.jp/all_eew"],
  fan_ws: fanWsBaseUrl.map(baseUrl => baseUrl + "/all"),
  p2pquake_ws: ["wss://api.p2pquake.net/v2/ws"],
};
export const tsunamiUrls = {
  jmaTsunami_http: "https://api.p2pquake.net/v2/history?codes=552&limit=1",
};
export const seisNetUrls = {
  nied: {
    stationList:
      "https://weather-kyoshin.east.edge.storage-yahoo.jp/SiteList/sitelist.json",
    stationData:
      "https://weather-kyoshin.east.edge.storage-yahoo.jp/RealTimeData",
  },
  kma: fanWsBaseUrl.map(baseUrl => baseUrl + "/kma-station"),
};
export const iconUrls = {
  info: "/icon/info.png",
  caution: "/icon/caution.png",
  warn: "/icon/warn.png",
};
export const chimeUrls = {
  general: {
    countdown: "/sound/general/countdown.wav",
    intense: "/sound/general/intense.wav",
    ews: "/sound/general/ews.mp3",
    "0s": "/sound/general/0s.mp3",
    "1s": "/sound/general/1s.mp3",
    "2s": "/sound/general/2s.mp3",
    "3s": "/sound/general/3s.mp3",
    "4s": "/sound/general/4s.mp3",
    "5s": "/sound/general/5s.mp3",
    "6s": "/sound/general/6s.mp3",
    "7s": "/sound/general/7s.mp3",
    "8s": "/sound/general/8s.mp3",
    "9s": "/sound/general/9s.mp3",
    "10s": "/sound/general/10s.mp3",
    "20s": "/sound/general/20s.mp3",
    "30s": "/sound/general/30s.mp3",
    "40s": "/sound/general/40s.mp3",
    "50s": "/sound/general/50s.mp3",
    "60s": "/sound/general/60s.mp3",
  },
  srev: {
    issue: "/sound/srev/issue.mp3",
    caution: "/sound/srev/caution.mp3",
    warn: "/sound/srev/warn.mp3",
    update: "/sound/srev/update.mp3",
    final: "/sound/srev/final.mp3",
    cancel: "/sound/srev/cancel.mp3",
    prompt: "/sound/srev/prompt.mp3",
    hypocenter: "/sound/srev/hypocenter.mp3",
    detail: "/sound/srev/detail.mp3",
    shindo0: "/sound/srev/shindo0.mp3",
    shindo1: "/sound/srev/shindo1.mp3",
    shindo2: "/sound/srev/shindo2.mp3",
    shindo3: "/sound/srev/shindo3.mp3",
    shindo4: "/sound/srev/shindo4.mp3",
    shindo5: "/sound/srev/shindo5.mp3",
    shindo6: "/sound/srev/shindo6.mp3",
    shindo7: "/sound/srev/shindo6.mp3",
    tsunami1issue: "/sound/srev/tsunami1issue.mp3",
    tsunami1update: "/sound/srev/tsunami1update.mp3",
    tsunami1switch: "/sound/srev/tsunami1switch.mp3",
    tsunami1cancel: "/sound/srev/tsunami1cancel.mp3",
    tsunami2issue: "/sound/srev/tsunami2issue.mp3",
    tsunami2update: "/sound/srev/tsunami2update.mp3",
    tsunami2switch: "/sound/srev/tsunami2switch.mp3",
    tsunami2cancel: "/sound/srev/tsunami2cancel.mp3",
    tsunami3issue: "/sound/srev/tsunami3issue.mp3",
    tsunami3update: "/sound/srev/tsunami3update.mp3",
    tsunami3cancel: "/sound/srev/tsunami3cancel.mp3",
  },
  custom: {},
};
export const topojsonUrls = {
  global: "/json/medium.global.modified.topo.json",
  cn: "/json/cn.province.topo.json",
  cn_eew: "/json/cn.eew.topo.json",
  cn_fault: "/json/cn.fault.topo.json",
  jp: "/json/jp.pref.topo.json",
  jp_eew: "/json/jp.eew.topo.json",
  jp_tsunami: "/json/jp.tsunami.topo.json",
  kr_eew: "/json/kr.eew.topo.json",
};
export const utilUrls = {
  geoIp: [
    {
      url: "https://api.fanstudio.tech/tool/ip/",
      func: item => ({
        lat: item.latitude,
        lng: item.longitude,
        place: item.city + (item.district || ""),
      }),
    },
    {
      url: "https://api.wolfx.jp/geoip.php",
      func: item => ({
        lat: item.latitude,
        lng: item.longitude,
        place: item.city_zh,
      }),
    },
  ],
  ntpTime: [
    {
      url: "https://api.fanstudio.tech/tool/ntp.php",
      func: item => item.unixtime_ms,
    },
    {
      url: "https://api.wolfx.jp/ntp.json",
      func: item => item.timestamp,
    },
  ],
};
export const typhoonUrls = {
  typhoon_activity_http: "https://typhoon.slt.zj.gov.cn/Api/TyhoonActivity",
  typhoon_info_http: "https://typhoon.slt.zj.gov.cn/Api/TyphoonInfo/",
};
