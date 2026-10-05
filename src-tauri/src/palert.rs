use reqwest::{
    header::{ACCEPT, CONTENT_TYPE, REFERER},
    redirect::Policy,
    Client,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, time::Duration};

const PALERT_GRAPHQL_URL: &str = "https://palert.earth.sinica.edu.tw/graphql/";
const PALERT_REFERER: &str = "https://palert.earth.sinica.edu.tw/realtime";
const REALTIME_DATA_QUERY: &str = "query ($recordTime: Float, $type: Int, $token: String) { realtimePGA(recordTime: $recordTime, type: $type, token: $token) { dataVals timestamp } }";
const STATION_LIST_QUERY: &str = "query ($staFilter: staList_filter_choices) { stationList(staFilter: $staFilter) { staInfos timestamp version } }";
const MAX_RECORD_TIME: f64 = 9_007_199_254_740_991.0;
const MAX_RESPONSE_BYTES: usize = 1_048_576;

pub struct PalertClient {
    realtime_http: Result<Client, String>,
    station_list_http: Result<Client, String>,
}

impl PalertClient {
    pub fn new() -> Self {
        let build_http = |timeout| {
            let builder = Client::builder()
                .connect_timeout(timeout)
                .timeout(timeout)
                .redirect(Policy::none())
                .user_agent("kanameishi");

            // Use system certificate-chain handling where the native backend supports it.
            #[cfg(any(target_os = "windows", target_os = "macos"))]
            let builder = builder.use_native_tls();

            #[cfg(not(any(target_os = "windows", target_os = "macos")))]
            let builder = builder.use_rustls_tls();

            builder
                .build()
                .map_err(|err| format!("Failed to initialize P-Alert HTTP client: {err}"))
        };

        Self {
            realtime_http: build_http(Duration::from_secs(5)),
            station_list_http: build_http(Duration::from_secs(15)),
        }
    }

    async fn fetch_realtime_data(
        &self,
        data_type: i32,
        record_time: f64,
    ) -> Result<RealtimeData, String> {
        validate_data_type(data_type)?;
        validate_record_time(record_time)?;
        let data: RealtimeGraphQlData = Self::request_graphql(
            &self.realtime_http,
            REALTIME_DATA_QUERY,
            json!({
                "recordTime": record_time,
                "token": "",
                "type": data_type
            }),
        )
        .await?;

        data.realtime_data
            .ok_or_else(|| "P-Alert response is missing data.realtimePGA".to_string())
    }

    async fn fetch_station_list(&self) -> Result<StationListData, String> {
        let data: StationListGraphQlData = Self::request_graphql(
            &self.station_list_http,
            STATION_LIST_QUERY,
            json!({ "staFilter": "onlineAll" }),
        )
        .await?;

        data.station_list
            .ok_or_else(|| "P-Alert response is missing data.stationList".to_string())
    }

    async fn request_graphql<T>(
        http: &Result<Client, String>,
        query: &'static str,
        variables: Value,
    ) -> Result<T, String>
    where
        T: DeserializeOwned,
    {
        let http = http.as_ref().map_err(Clone::clone)?;
        let response = http
            .post(PALERT_GRAPHQL_URL)
            .header(ACCEPT, "application/json")
            // The endpoint rejects native requests without its public realtime page as referrer.
            .header(REFERER, PALERT_REFERER)
            .json(&json!({ "query": query, "variables": variables }))
            .send()
            .await
            .map_err(|err| format!("P-Alert request failed: {err}"))?;

        let status = response.status();
        if !status.is_success() {
            return Err(format!("P-Alert returned HTTP {status}"));
        }

        let is_json = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.starts_with("application/json"));
        if !is_json {
            return Err("P-Alert returned a non-JSON response".to_string());
        }

        if response
            .content_length()
            .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
        {
            return Err("P-Alert response exceeded the size limit".to_string());
        }

        let body = response
            .bytes()
            .await
            .map_err(|err| format!("Failed to read P-Alert response: {err}"))?;
        if body.len() > MAX_RESPONSE_BYTES {
            return Err("P-Alert response exceeded the size limit".to_string());
        }

        parse_graphql_response(&body)
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeData {
    data_vals: HashMap<String, f64>,
    timestamp: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct StationListData {
    #[serde(rename = "staInfos")]
    sta_infos: Vec<StationInfo>,
    timestamp: String,
    version: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct StationInfo {
    station: String,
    network: String,
    location: String,
    serial: u32,
    area: String,
    locname: String,
    lon: f64,
    lat: f64,
    elev: f64,
    floor: i32,
    start_at: String,
}

#[derive(Deserialize)]
struct GraphQlResponse<T> {
    data: Option<T>,
    #[serde(default)]
    errors: Vec<GraphQlError>,
}

#[derive(Debug, Deserialize)]
struct RealtimeGraphQlData {
    #[serde(rename = "realtimePGA")]
    realtime_data: Option<RealtimeData>,
}

#[derive(Debug, Deserialize)]
struct StationListGraphQlData {
    #[serde(rename = "stationList")]
    station_list: Option<StationListData>,
}

#[derive(Deserialize)]
struct GraphQlError {
    message: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn fetch_palert_realtime_data(
    state: tauri::State<'_, PalertClient>,
    data_type: i32,
    record_time: f64,
) -> Result<RealtimeData, String> {
    state.fetch_realtime_data(data_type, record_time).await
}

#[tauri::command]
pub async fn fetch_palert_station_list(
    state: tauri::State<'_, PalertClient>,
) -> Result<StationListData, String> {
    state.fetch_station_list().await
}

fn validate_data_type(data_type: i32) -> Result<(), String> {
    if matches!(data_type, 0 | 1) {
        Ok(())
    } else {
        Err("type must be 0 (PGA) or 1 (PGV)".to_string())
    }
}

fn validate_record_time(record_time: f64) -> Result<(), String> {
    if record_time.is_finite() && (0.0..=MAX_RECORD_TIME).contains(&record_time) {
        Ok(())
    } else {
        Err("recordTime must be a finite non-negative number".to_string())
    }
}

fn parse_graphql_response<T>(body: &[u8]) -> Result<T, String>
where
    T: DeserializeOwned,
{
    let response: GraphQlResponse<T> = serde_json::from_slice(body)
        .map_err(|err| format!("P-Alert returned invalid JSON: {err}"))?;

    if !response.errors.is_empty() {
        let messages = response
            .errors
            .into_iter()
            .take(3)
            .map(|error| error.message)
            .collect::<Vec<_>>()
            .join("; ");
        return Err(format!("P-Alert GraphQL error: {messages}"));
    }

    response
        .data
        .ok_or_else(|| "P-Alert response is missing data".to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        parse_graphql_response, validate_data_type, validate_record_time, RealtimeGraphQlData,
        StationListGraphQlData,
    };

    #[test]
    fn validates_data_type() {
        assert!(validate_data_type(0).is_ok());
        assert!(validate_data_type(1).is_ok());
        assert!(validate_data_type(-1).is_err());
        assert!(validate_data_type(2).is_err());
    }

    #[test]
    fn validates_record_time() {
        assert!(validate_record_time(0.0).is_ok());
        assert!(validate_record_time(1_788_855_462.0).is_ok());
        assert!(validate_record_time(-1.0).is_err());
        assert!(validate_record_time(f64::NAN).is_err());
        assert!(validate_record_time(f64::INFINITY).is_err());
    }

    #[test]
    fn parses_realtime_data() {
        let data: RealtimeGraphQlData = parse_graphql_response(
            br#"{"data":{"realtimePGA":{"dataVals":{"W460":0.125},"timestamp":"2026-09-08T07:31:24Z"}}}"#,
        )
        .expect("valid response should parse");
        let result = data.realtime_data.expect("realtime data should exist");

        assert_eq!(result.data_vals.get("W460"), Some(&0.125));
        assert_eq!(result.timestamp, "2026-09-08T07:31:24Z");
    }

    #[test]
    fn rejects_graphql_errors() {
        let error = parse_graphql_response::<RealtimeGraphQlData>(
            br#"{"data":null,"errors":[{"message":"denied"}]}"#,
        )
        .expect_err("GraphQL errors should be rejected");

        assert_eq!(error, "P-Alert GraphQL error: denied");
    }

    #[test]
    fn parses_station_list() {
        let data: StationListGraphQlData = parse_graphql_response(
            br#"{"data":{"stationList":{"staInfos":[{"station":"D001","network":"TW","location":"--","serial":1524,"area":"Hualien","locname":"Dong Hwa","lon":121.542278,"lat":23.894972,"elev":41.0,"floor":2,"start_at":"2020-11-03"}],"timestamp":"2026-04-10T11:10:45Z","version":"681ca8f9"}}}"#,
        )
        .expect("valid station list should parse");
        let result = data.station_list.expect("station list should exist");

        assert_eq!(result.sta_infos.len(), 1);
        assert_eq!(result.sta_infos[0].station, "D001");
        assert_eq!(result.version, "681ca8f9");
    }
}
