//! Roku second-screen discovery and control through the External Control Protocol (ECP).
//!
//! Roku advertises ECP over SSDP. Izumi launches its separately installed SceneGraph receiver and
//! sends playback controls through `/input`; media itself is fetched from Izumi's LAN cast relay.

use std::{
    collections::{HashMap, HashSet},
    net::{Ipv4Addr, SocketAddr, UdpSocket},
    time::{Duration, Instant},
};

use futures_util::future::join_all;
use quick_xml::{events::Event, Reader};
use reqwest::{header, Client, StatusCode};
use url::Url;

const SSDP_TARGET: &str = "239.255.255.250:1900";
const ROKU_ECP_TARGET: &str = "roku:ecp";
const ROKU_ECP_PORT: u16 = 8060;
const IZUMI_RECEIVER_CHANNEL_ID: &str = "dev";
const MAX_SSDP_PACKET: usize = 16 * 1024;
const MAX_DEVICE_DESCRIPTIONS: usize = 32;
const MAX_XML_BYTES: usize = 256 * 1024;
const HTTP_TIMEOUT: Duration = Duration::from_secs(6);

#[derive(Clone, Debug)]
pub struct RokuDevice {
    pub id: String,
    pub name: String,
    pub model: Option<String>,
    pub address: Ipv4Addr,
    pub port: u16,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct RokuStatus {
    pub state: &'static str,
    pub position_seconds: f32,
    pub duration_seconds: Option<f32>,
}

#[derive(Clone, Copy, Debug)]
pub struct RokuSubtitle<'a> {
    pub url: &'a str,
    pub title: Option<&'a str>,
    pub lang: Option<&'a str>,
}

#[derive(Clone, Copy, Debug)]
pub struct RokuLaunch<'a> {
    pub url: &'a str,
    pub title: &'a str,
    pub content_type: &'a str,
    pub position_seconds: f64,
    pub subtitle: Option<RokuSubtitle<'a>>,
}

#[derive(Clone, Debug)]
struct DiscoveredLocation {
    url: Url,
    source: Ipv4Addr,
}

pub async fn discover(wait: Duration) -> Result<Vec<RokuDevice>, String> {
    let locations = tauri::async_runtime::spawn_blocking(move || discover_locations(wait))
        .await
        .map_err(|error| format!("Roku discovery stopped unexpectedly: {error}"))??;
    if locations.is_empty() {
        return Ok(Vec::new());
    }

    let client = ecp_client()?;
    let descriptions = locations
        .into_iter()
        .take(MAX_DEVICE_DESCRIPTIONS)
        .map(|location| describe_device(client.clone(), location));
    let mut devices = HashMap::<String, RokuDevice>::new();
    for device in join_all(descriptions).await.into_iter().flatten() {
        devices.entry(device.id.clone()).or_insert(device);
    }
    Ok(devices.into_values().collect())
}

fn discover_locations(wait: Duration) -> Result<Vec<DiscoveredLocation>, String> {
    let mut sockets = netdev::get_interfaces()
        .into_iter()
        .filter(|interface| interface.is_up() && !interface.is_loopback())
        .flat_map(|interface| interface.ipv4.into_iter().map(|network| network.addr()))
        .filter(|address| valid_lan_address(*address))
        .filter_map(|address| {
            let socket = UdpSocket::bind((address, 0)).ok()?;
            socket.set_multicast_ttl_v4(2).ok()?;
            socket.set_nonblocking(true).ok()?;
            Some(socket)
        })
        .collect::<Vec<_>>();
    if sockets.is_empty() {
        let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
            .map_err(|error| format!("Could not open Roku discovery: {error}"))?;
        socket
            .set_multicast_ttl_v4(2)
            .map_err(|error| format!("Could not configure Roku multicast: {error}"))?;
        socket
            .set_nonblocking(true)
            .map_err(|error| format!("Could not configure Roku discovery: {error}"))?;
        sockets.push(socket);
    }

    let request = format!(
        "M-SEARCH * HTTP/1.1\r\nHOST: {SSDP_TARGET}\r\nMAN: \"ssdp:discover\"\r\nMX: 1\r\nST: {ROKU_ECP_TARGET}\r\nUSER-AGENT: Izumi/1.0\r\n\r\n"
    );
    let mut sent = false;
    for socket in &sockets {
        sent |= socket.send_to(request.as_bytes(), SSDP_TARGET).is_ok();
    }
    if !sent {
        return Err("Could not send Roku discovery on any network interface".into());
    }

    let deadline = Instant::now() + wait;
    let mut packet = vec![0_u8; MAX_SSDP_PACKET];
    let mut seen = HashSet::new();
    let mut locations = Vec::new();
    while Instant::now() < deadline {
        for socket in &sockets {
            loop {
                match socket.recv_from(&mut packet) {
                    Ok((length, source)) => {
                        let SocketAddr::V4(source) = source else {
                            continue;
                        };
                        let source_ip = *source.ip();
                        if !valid_lan_address(source_ip) {
                            continue;
                        }
                        let response = String::from_utf8_lossy(&packet[..length]);
                        let ecp_response = header_value(&response, "st")
                            .is_some_and(|value| value.eq_ignore_ascii_case(ROKU_ECP_TARGET))
                            || header_value(&response, "server")
                                .is_some_and(|value| value.to_ascii_lowercase().contains("roku"));
                        if !ecp_response {
                            continue;
                        }
                        let Some(location) = header_value(&response, "location") else {
                            continue;
                        };
                        let Ok(url) = Url::parse(location.trim()) else {
                            continue;
                        };
                        let matches_source = url.scheme() == "http"
                            && url
                                .host_str()
                                .and_then(|host| host.parse::<Ipv4Addr>().ok())
                                == Some(source_ip)
                            && url.port_or_known_default() == Some(ROKU_ECP_PORT);
                        if !matches_source || !seen.insert(source_ip) {
                            continue;
                        }
                        locations.push(DiscoveredLocation {
                            url,
                            source: source_ip,
                        });
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => break,
                    Err(error) => return Err(format!("Could not receive Roku discovery: {error}")),
                }
            }
        }
        std::thread::sleep(Duration::from_millis(12));
    }
    Ok(locations)
}

async fn describe_device(client: Client, location: DiscoveredLocation) -> Option<RokuDevice> {
    let url = location.url.join("query/device-info").ok()?;
    let response = client
        .get(url)
        .header(header::USER_AGENT, "Izumi/1.0")
        .send()
        .await
        .ok()?;
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|length| length > MAX_XML_BYTES as u64)
    {
        return None;
    }
    let body = response.bytes().await.ok()?;
    (body.len() <= MAX_XML_BYTES)
        .then(|| parse_device_info(&body, location.source))?
        .ok()
}

fn parse_device_info(xml: &[u8], address: Ipv4Addr) -> Result<RokuDevice, String> {
    let fields = xml_fields(xml)?;
    let value = |names: &[&str]| {
        names
            .iter()
            .find_map(|name| fields.get(*name))
            .map(String::as_str)
    };
    let name = clean(value(&["user-device-name", "friendly-device-name"]), 128)
        .unwrap_or_else(|| format!("Roku at {address}"));
    let model = clean(value(&["model-name", "model-number"]), 128);
    let id =
        clean(value(&["device-id", "serial-number"]), 128).unwrap_or_else(|| address.to_string());
    Ok(RokuDevice {
        id: format!("roku:{id}"),
        name,
        model,
        address,
        port: ROKU_ECP_PORT,
    })
}

pub async fn start(device: &RokuDevice, request: RokuLaunch<'_>) -> Result<(), String> {
    let client = ecp_client()?;
    let url = ecp_url(device, &format!("launch/{IZUMI_RECEIVER_CHANNEL_ID}"))?;
    let mut query = vec![
        ("contentId", request.url.to_string()),
        ("mediaType", media_type(request.content_type).to_string()),
        ("title", request.title.to_string()),
        ("contentType", request.content_type.to_string()),
        ("position", request.position_seconds.max(0.0).to_string()),
    ];
    if let Some(subtitle) = request.subtitle {
        query.push(("subtitle", subtitle.url.to_string()));
        if let Some(title) = subtitle.title {
            query.push(("subtitleTitle", title.to_string()));
        }
        if let Some(lang) = subtitle.lang {
            query.push(("subtitleLang", lang.to_string()));
        }
    }
    let response = client
        .post(url)
        .query(&query)
        .header(header::USER_AGENT, "Izumi/1.0")
        .send()
        .await
        .map_err(|error| format!("Could not launch the Izumi Roku receiver: {error}"))?;
    if response.status().is_success() {
        return Ok(());
    }
    let status = response.status();
    if matches!(
        status,
        StatusCode::NOT_FOUND | StatusCode::SERVICE_UNAVAILABLE
    ) {
        return Err(
            "Izumi Receiver is not installed on this Roku. Sideload the Izumi Roku receiver, then try again."
                .into(),
        );
    }
    Err(format!("Roku rejected the receiver launch ({status})"))
}

pub async fn status(device: &RokuDevice) -> Result<RokuStatus, String> {
    let response = ecp_client()?
        .get(ecp_url(device, "query/media-player")?)
        .header(header::USER_AGENT, "Izumi/1.0")
        .send()
        .await
        .map_err(|error| format!("Could not read Roku playback status: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Roku playback status failed ({})",
            response.status()
        ));
    }
    let body = response
        .bytes()
        .await
        .map_err(|error| format!("Could not read Roku playback status: {error}"))?;
    if body.len() > MAX_XML_BYTES {
        return Err("Roku returned an oversized playback status".into());
    }
    parse_media_player(&body)
}

pub async fn control(
    device: &RokuDevice,
    action: &str,
    position_seconds: Option<f64>,
    subtitle: Option<RokuSubtitle<'_>>,
) -> Result<RokuStatus, String> {
    if action == "volume" {
        return Err("Use the Roku remote to change the TV volume.".into());
    }
    if action == "status" {
        return status(device).await;
    }
    let mut query = vec![("izumiAction", action.to_string())];
    if let Some(position) = position_seconds {
        query.push(("position", position.max(0.0).to_string()));
    }
    if action == "tracks" {
        query.push((
            "subtitle",
            subtitle.map_or_else(String::new, |item| item.url.to_string()),
        ));
        if let Some(title) = subtitle.and_then(|item| item.title) {
            query.push(("subtitleTitle", title.to_string()));
        }
        if let Some(lang) = subtitle.and_then(|item| item.lang) {
            query.push(("subtitleLang", lang.to_string()));
        }
    }
    let response = ecp_client()?
        .post(ecp_url(device, "input")?)
        .query(&query)
        .header(header::USER_AGENT, "Izumi/1.0")
        .send()
        .await
        .map_err(|error| format!("Could not control the Izumi Roku receiver: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Roku rejected the playback control ({})",
            response.status()
        ));
    }
    status(device).await
}

pub async fn stop(device: &RokuDevice) -> Result<(), String> {
    let response = ecp_client()?
        .post(ecp_url(device, "input")?)
        .query(&[("izumiAction", "stop")])
        .header(header::USER_AGENT, "Izumi/1.0")
        .send()
        .await
        .map_err(|error| format!("Could not stop the Izumi Roku receiver: {error}"))?;
    response
        .status()
        .is_success()
        .then_some(())
        .ok_or_else(|| format!("Roku rejected the stop command ({})", response.status()))
}

fn parse_media_player(xml: &[u8]) -> Result<RokuStatus, String> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);
    let mut raw_state = String::new();
    let mut current_tag = String::new();
    let mut position_ms = None;
    let mut duration_ms = None;
    loop {
        match reader.read_event() {
            Ok(Event::Start(element)) => {
                current_tag = String::from_utf8_lossy(element.local_name().as_ref()).into_owned();
                if current_tag == "player" {
                    for attribute in element.attributes().flatten() {
                        if attribute.key.local_name().as_ref() == b"state" {
                            raw_state =
                                String::from_utf8_lossy(attribute.value.as_ref()).into_owned();
                        }
                    }
                }
            }
            Ok(Event::Text(text)) => {
                let decoded = text
                    .xml_content()
                    .map_err(|error| format!("Invalid Roku status text: {error}"))?;
                let value = quick_xml::escape::unescape(&decoded)
                    .map_err(|error| format!("Invalid Roku status escape: {error}"))?;
                match current_tag.as_str() {
                    "position" => position_ms = parse_milliseconds(&value),
                    "duration" => duration_ms = parse_milliseconds(&value),
                    _ => {}
                }
            }
            Ok(Event::End(_)) => current_tag.clear(),
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => return Err(format!("Invalid Roku playback status: {error}")),
        }
    }
    let state = match raw_state.to_ascii_lowercase().as_str() {
        "play" | "playing" => "playing",
        "pause" | "paused" => "paused",
        "buffer" | "buffering" | "open" => "buffering",
        _ => "idle",
    };
    Ok(RokuStatus {
        state,
        position_seconds: position_ms.unwrap_or(0.0) / 1_000.0,
        duration_seconds: duration_ms
            .filter(|value| *value > 0.0)
            .map(|value| value / 1_000.0),
    })
}

fn parse_milliseconds(value: &str) -> Option<f32> {
    value.split_whitespace().next()?.parse::<f32>().ok()
}

fn xml_fields(xml: &[u8]) -> Result<HashMap<String, String>, String> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);
    let mut tag = String::new();
    let mut fields = HashMap::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(element)) => {
                tag = String::from_utf8_lossy(element.local_name().as_ref()).into_owned();
            }
            Ok(Event::Text(text)) if !tag.is_empty() => {
                let decoded = text
                    .xml_content()
                    .map_err(|error| format!("Invalid Roku device text: {error}"))?;
                let value = quick_xml::escape::unescape(&decoded)
                    .map_err(|error| format!("Invalid Roku device escape: {error}"))?
                    .trim()
                    .to_string();
                fields.entry(tag.clone()).or_insert(value);
            }
            Ok(Event::End(_)) => tag.clear(),
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => return Err(format!("Invalid Roku device description: {error}")),
        }
    }
    Ok(fields)
}

fn ecp_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .timeout(HTTP_TIMEOUT)
        .pool_max_idle_per_host(1)
        .build()
        .map_err(|error| format!("Could not configure Roku control: {error}"))
}

fn ecp_url(device: &RokuDevice, path: &str) -> Result<Url, String> {
    Url::parse(&format!(
        "http://{}:{}/{}",
        device.address,
        device.port,
        path.trim_start_matches('/')
    ))
    .map_err(|error| format!("Could not prepare the Roku control URL: {error}"))
}

fn media_type(content_type: &str) -> &'static str {
    if content_type.to_ascii_lowercase().starts_with("audio/") {
        "song"
    } else {
        "movie"
    }
}

fn valid_lan_address(address: Ipv4Addr) -> bool {
    !address.is_loopback()
        && !address.is_unspecified()
        && !address.is_multicast()
        && address != Ipv4Addr::BROADCAST
        && (address.is_private() || address.is_link_local())
}

fn header_value<'a>(response: &'a str, name: &str) -> Option<&'a str> {
    response.lines().skip(1).find_map(|line| {
        let (key, value) = line.split_once(':')?;
        key.trim()
            .eq_ignore_ascii_case(name)
            .then_some(value.trim())
    })
}

fn clean(value: Option<&str>, max_chars: usize) -> Option<String> {
    let value = value?.trim();
    (!value.is_empty()).then(|| value.chars().take(max_chars).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_roku_device_identity() {
        let xml = br#"<device-info>
          <user-device-name>Living Room Roku</user-device-name>
          <model-name>Roku Ultra</model-name><device-id>S0ABC123</device-id>
        </device-info>"#;
        let device = parse_device_info(xml, Ipv4Addr::new(192, 168, 1, 25)).unwrap();
        assert_eq!(device.id, "roku:S0ABC123");
        assert_eq!(device.name, "Living Room Roku");
        assert_eq!(device.model.as_deref(), Some("Roku Ultra"));
        assert_eq!(device.port, 8060);
    }

    #[test]
    fn parses_ecp_player_clock_in_milliseconds() {
        let xml = br#"<player state="play"><position>63400 ms</position><duration>1505000 ms</duration></player>"#;
        let status = parse_media_player(xml).unwrap();
        assert_eq!(status.state, "playing");
        assert!((status.position_seconds - 63.4).abs() < 0.01);
        assert_eq!(status.duration_seconds, Some(1505.0));
    }

    #[test]
    fn only_accepts_roku_ecp_responses_on_the_documented_port() {
        let response =
            "HTTP/1.1 200 OK\r\nST: roku:ecp\r\nLOCATION: http://192.168.1.25:8060/\r\n\r\n";
        assert_eq!(header_value(response, "st"), Some("roku:ecp"));
        let location = Url::parse(header_value(response, "location").unwrap()).unwrap();
        assert_eq!(location.port_or_known_default(), Some(8060));
    }

    #[test]
    fn maps_audio_and_video_to_roku_deep_link_types() {
        assert_eq!(media_type("audio/flac"), "song");
        assert_eq!(media_type("application/vnd.apple.mpegurl"), "movie");
    }
}
