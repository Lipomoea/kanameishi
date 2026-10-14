use hyper_util::client::proxy::matcher::Matcher;
use reqwest::{
    header::{HeaderValue, ACCEPT, CONTENT_TYPE, REFERER},
    redirect::Policy,
    Client, Proxy,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Mutex, time::Duration};

const PALERT_GRAPHQL_URL: &str = "https://palert.earth.sinica.edu.tw/graphql/";
const PALERT_REFERER: &str = "https://palert.earth.sinica.edu.tw/realtime";
const REALTIME_DATA_QUERY: &str = "query ($recordTime: Float, $type: Int, $token: String) { realtimePGA(recordTime: $recordTime, type: $type, token: $token) { dataVals timestamp } }";
const STATION_LIST_QUERY: &str = "query ($staFilter: staList_filter_choices) { stationList(staFilter: $staFilter) { staInfos timestamp version } }";
const MAX_RECORD_TIME: f64 = 9_007_199_254_740_991.0;
const MAX_RESPONSE_BYTES: usize = 1_048_576;

pub struct PalertClient {
    http: Mutex<PalertHttpClients>,
}

// Resolve only the fixed P-Alert endpoint, using the same matcher as reqwest.
// Do not derive Debug: proxy credentials must not end up in logs.
#[derive(Clone, PartialEq, Eq)]
struct PalertProxy {
    url: String,
    basic_auth: Option<HeaderValue>,
    raw_auth: Option<(String, String)>,
}

impl PalertProxy {
    fn from_matcher(matcher: &Matcher) -> Option<Self> {
        let destination = PALERT_GRAPHQL_URL.parse().expect("valid P-Alert URL");
        matcher.intercept(&destination).map(|proxy| Self {
            url: proxy.uri().to_string(),
            basic_auth: proxy.basic_auth().cloned(),
            raw_auth: proxy
                .raw_auth()
                .map(|(user, pass)| (user.into(), pass.into())),
        })
    }

    fn to_reqwest_proxy(&self) -> reqwest::Result<Proxy> {
        let mut proxy = Proxy::all(&self.url)?;
        if let Some(auth) = &self.basic_auth {
            proxy = proxy.custom_http_auth(auth.clone());
        }
        if let Some((user, pass)) = &self.raw_auth {
            proxy = proxy.basic_auth(user, pass);
        }
        Ok(proxy)
    }
}

struct PalertHttpClients {
    proxy: Option<PalertProxy>,
    realtime_http: Result<Client, String>,
    station_list_http: Result<Client, String>,
}

impl PalertHttpClients {
    fn new(proxy: Option<PalertProxy>) -> Self {
        Self {
            realtime_http: Self::build_http(Duration::from_secs(5), proxy.as_ref()),
            station_list_http: Self::build_http(Duration::from_secs(15), proxy.as_ref()),
            proxy,
        }
    }

    fn build_http(timeout: Duration, proxy: Option<&PalertProxy>) -> Result<Client, String> {
        let build_http = |timeout| {
            let mut builder = Client::builder()
                .connect_timeout(timeout)
                .timeout(timeout)
                .redirect(Policy::none())
                .user_agent("kanameishi")
                // Apply this exact snapshot, including direct connections.
                .no_proxy();
            if let Some(proxy) = proxy {
                builder = builder.proxy(proxy.to_reqwest_proxy()?);
            }

            // Use system certificate-chain handling where the native backend supports it.
            #[cfg(any(target_os = "windows", target_os = "macos"))]
            let builder = builder.use_native_tls();

            #[cfg(not(any(target_os = "windows", target_os = "macos")))]
            let builder = builder.use_rustls_tls();

            builder.build()
        };

        build_http(timeout)
            .map_err(|err| format!("Failed to initialize P-Alert HTTP client: {err}"))
    }

    fn refresh_proxy(&mut self, proxy: Option<PalertProxy>) {
        if self.proxy != proxy {
            // Replace both pools so an existing connection cannot retain the old route.
            *self = Self::new(proxy);
        }
    }
}

impl PalertClient {
    pub fn new() -> Self {
        Self {
            http: Mutex::new(PalertHttpClients::new(PalertProxy::from_matcher(
                &Matcher::from_system(),
            ))),
        }
    }

    fn http_client(&self, station_list: bool) -> Result<Client, String> {
        let mut http = self
            .http
            .lock()
            .map_err(|_| "P-Alert HTTP client lock poisoned".to_string())?;
        http.refresh_proxy(PalertProxy::from_matcher(&Matcher::from_system()));
        // Clone the handle and release the lock before any network await.
        if station_list {
            http.station_list_http.clone()
        } else {
            http.realtime_http.clone()
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
            &self.http_client(false)?,
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
            &self.http_client(true)?,
            STATION_LIST_QUERY,
            json!({ "staFilter": "onlineAll" }),
        )
        .await?;

        data.station_list
            .ok_or_else(|| "P-Alert response is missing data.stationList".to_string())
    }

    async fn request_graphql<T>(
        http: &Client,
        query: &'static str,
        variables: Value,
    ) -> Result<T, String>
    where
        T: DeserializeOwned,
    {
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
        parse_graphql_response, validate_data_type, validate_record_time, PalertHttpClients,
        PalertProxy, RealtimeGraphQlData, StationListGraphQlData,
    };
    use hyper_util::client::proxy::matcher::Matcher;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
        time::{Duration, Instant},
    };

    #[test]
    fn resolves_proxy_changes_and_bypass_for_palert() {
        let proxy = |address| PalertProxy::from_matcher(&Matcher::builder().https(address).build());
        let first = proxy("http://user:one@127.0.0.1:7890");
        assert!(first.is_some());
        assert!(first != proxy("http://user:one@127.0.0.1:7891"));
        assert!(first != proxy("http://user:two@127.0.0.1:7890"));
        assert!(
            first
                == PalertProxy::from_matcher(
                    &Matcher::builder()
                        .https("http://user:one@127.0.0.1:7890")
                        .http("http://unrelated:8080")
                        .build()
                )
        );
        assert!(PalertProxy::from_matcher(&Matcher::builder().build()).is_none());
        assert!(PalertProxy::from_matcher(
            &Matcher::builder()
                .all("http://127.0.0.1:7890")
                .no(".sinica.edu.tw")
                .build()
        )
        .is_none());
        let socks = proxy("socks5h://user:pass@127.0.0.1:7890").unwrap();
        assert_eq!(socks.raw_auth, Some(("user".into(), "pass".into())));
    }

    // Each connection must serve two requests. Rebuilding an unchanged client
    // would discard its pool and fail the second request on this server.
    fn serve_http(
        label: &'static str,
        connections: usize,
    ) -> (String, thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        listener.set_nonblocking(true).unwrap();
        let handle = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(20);
            let mut requests = Vec::new();
            for _ in 0..connections {
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                            assert!(Instant::now() < deadline, "missing {label} connection");
                            thread::sleep(Duration::from_millis(5));
                        }
                        Err(err) => panic!("{label} accept failed: {err}"),
                    }
                };
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                stream
                    .set_write_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                for _ in 0..2 {
                    let mut request = Vec::new();
                    while !request.ends_with(b"\r\n\r\n") {
                        let mut byte = [0];
                        stream.read_exact(&mut byte).unwrap();
                        request.push(byte[0]);
                        assert!(request.len() < 8192);
                    }
                    requests.push(String::from_utf8(request).unwrap());
                    write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{label}",
                        label.len()
                    )
                    .unwrap();
                }
            }
            requests
        });
        (url, handle)
    }

    #[test]
    fn switches_both_client_pools_and_reuses_unchanged_connections() {
        let (target, direct) = serve_http("direct", 4);
        let (first_url, first_proxy) = serve_http("first proxy", 2);
        let (second_url, second_proxy) = serve_http("second proxy", 2);
        let resolve = |url: String| PalertProxy::from_matcher(&Matcher::builder().all(url).build());
        let first = resolve(first_url.replacen("http://", "http://user:pass@", 1));
        let second = resolve(second_url);

        tauri::async_runtime::block_on(async {
            let mut clients = PalertHttpClients::new(None);
            for (proxy, label) in [
                (None, "direct"),
                (first, "first proxy"),
                (second, "second proxy"),
                (None, "direct"),
            ] {
                for station_list in [false, true] {
                    for _ in 0..2 {
                        clients.refresh_proxy(proxy.clone());
                        let http = if station_list {
                            &clients.station_list_http
                        } else {
                            &clients.realtime_http
                        };
                        let response = http.as_ref().unwrap().get(&target).send().await.unwrap();
                        assert_eq!(response.text().await.unwrap(), label);
                    }
                }
            }
        });

        let direct_requests = direct.join().unwrap();
        assert!(direct_requests
            .iter()
            .all(|request| request.starts_with("GET / HTTP/1.1")));
        assert!(direct_requests
            .iter()
            .all(|request| !request.to_ascii_lowercase().contains("proxy-authorization")));
        let first_requests = first_proxy.join().unwrap();
        assert!(first_requests
            .iter()
            .all(|request| request.starts_with(&format!("GET {target} HTTP/1.1"))));
        assert!(first_requests.iter().all(|request| request
            .to_ascii_lowercase()
            .contains("proxy-authorization: basic dxnlcjpwyxnz")));
        let second_requests = second_proxy.join().unwrap();
        assert!(second_requests
            .iter()
            .all(|request| request.starts_with(&format!("GET {target} HTTP/1.1"))));
        assert!(second_requests
            .iter()
            .all(|request| !request.to_ascii_lowercase().contains("proxy-authorization")));
    }

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
