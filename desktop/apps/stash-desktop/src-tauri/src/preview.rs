//! Previews: the window reads a Stashed file through `stash://` (served as
//! `http://stash.localhost/<fileId>/<size>/<ext>` on Windows). The webview
//! never talks to AWS; this process fetches only the byte ranges asked for,
//! through the same short-lived download leases the drive uses, so audio and
//! video seek at once and nothing is downloaded that isn't played or shown.

use crate::mount::ApiLeaseSource;
use serde::Serialize;
use serde_json::Value;
use stash_core::{RangeProvider, ReadError};
use stash_s3_provider::HttpRangeProvider;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::http::{header, HeaderValue, Method, Request, Response, StatusCode};

pub const SCHEME: &str = "stash";

/// Largest piece sent for one range request; players ask again for the next.
const CHUNK_BYTES: u64 = 4 * 1024 * 1024;
/// A request without a range (an image, a PDF) gets the whole file up to this.
const WHOLE_FILE_LIMIT: u64 = 64 * 1024 * 1024;
const FETCH_TIMEOUT: Duration = Duration::from_secs(30);
/// Open providers kept for quick re-seeks and re-opens.
const PROVIDERS_KEPT: usize = 16;

type Provider = HttpRangeProvider<ApiLeaseSource>;

/// The type a preview is served as, by extension. Anything else has no preview.
pub fn mime_for(ext: &str) -> Option<&'static str> {
    Some(match ext.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "ogg" | "oga" => "audio/ogg",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "pdf" => "application/pdf",
        "txt" | "md" | "csv" | "log" | "json" | "xml" | "srt" | "cue" | "nfo" => "text/plain; charset=utf-8",
        _ => return None,
    })
}

#[derive(Debug, PartialEq, Eq)]
struct Target {
    file_id: String,
    size: u64,
    mime: &'static str,
}

fn safe_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
}

/// `/<fileId>/<size>/<ext>` → what to serve.
fn parse_target(path: &str) -> Option<Target> {
    let mut parts = path.trim_start_matches('/').split('/');
    let (id, size, ext) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() || !safe_id(id) {
        return None;
    }
    Some(Target { file_id: id.to_string(), size: size.parse().ok()?, mime: mime_for(ext)? })
}

/// The inclusive byte range to send for a `Range` header, or `None` when the
/// range can't be satisfied. No header means the whole file.
fn byte_range(range: Option<&str>, size: u64) -> Option<(u64, u64, bool)> {
    if size == 0 {
        return None;
    }
    let Some(range) = range else {
        return (size <= WHOLE_FILE_LIMIT).then_some((0, size - 1, false));
    };
    let spec = range.trim().strip_prefix("bytes=")?;
    if spec.contains(',') {
        return None;
    }
    let (start, end) = spec.split_once('-')?;
    let (start, end) = match (start.trim(), end.trim()) {
        // "bytes=-500": the last 500 bytes.
        ("", suffix) => {
            let suffix: u64 = suffix.parse().ok()?;
            (size.saturating_sub(suffix), size - 1)
        }
        (start, "") => (start.parse().ok()?, size - 1),
        (start, end) => (start.parse().ok()?, end.parse::<u64>().ok()?.min(size - 1)),
    };
    if start > end || start >= size {
        return None;
    }
    Some((start, end.min(start + CHUNK_BYTES - 1), true))
}

fn providers() -> &'static Mutex<HashMap<String, Arc<Provider>>> {
    static PROVIDERS: OnceLock<Mutex<HashMap<String, Arc<Provider>>>> = OnceLock::new();
    PROVIDERS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn provider(file_id: &str) -> Arc<Provider> {
    let mut open = providers().lock().expect("preview providers lock poisoned");
    if let Some(provider) = open.get(file_id) {
        return provider.clone();
    }
    if open.len() >= PROVIDERS_KEPT {
        open.clear();
    }
    let provider = Arc::new(HttpRangeProvider::new(ApiLeaseSource::for_file(file_id)));
    open.insert(file_id.to_string(), provider.clone());
    provider
}

/// Bytes `start..=end`, renewing an expired lease once.
fn fetch(file_id: &str, start: u64, end: u64) -> Result<Vec<u8>, ReadError> {
    let provider = provider(file_id);
    let mut bytes = Vec::with_capacity((end - start + 1) as usize);
    let mut offset = start;
    while offset <= end {
        let length = (end - offset + 1).min(CHUNK_BYTES);
        let segment = match provider.fetch(offset, length, FETCH_TIMEOUT) {
            Err(ReadError::LeaseExpired) => {
                provider.renew_lease(FETCH_TIMEOUT)?;
                provider.fetch(offset, length, FETCH_TIMEOUT)?
            }
            other => other?,
        };
        offset += segment.bytes.len() as u64;
        bytes.extend(segment.bytes);
    }
    Ok(bytes)
}

fn plain(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(message.as_bytes().to_vec())
        .expect("static response")
}

/// The app's own page. stash.localhost is another origin to it, so reads with
/// fetch() (the text view, the audio waveform) need CORS; <img>, <audio>,
/// <video> and <iframe> don't. No other page may read previews.
const APP_ORIGINS: [&str; 3] = ["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"];

fn app_origin(request: &Request<Vec<u8>>) -> Option<&'static str> {
    let origin = request.headers().get(header::ORIGIN)?.to_str().ok()?;
    APP_ORIGINS.into_iter().find(|allowed| *allowed == origin)
}

/// Answers one preview request from the window.
pub fn respond(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let mut response = if request.method() == Method::OPTIONS {
        // Preflight for a fetch() that sends a Range header.
        Response::builder()
            .status(StatusCode::NO_CONTENT)
            .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET")
            .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "Range")
            .header(header::ACCESS_CONTROL_MAX_AGE, "600")
            .body(Vec::new())
            .expect("static response")
    } else {
        answer(request)
    };
    #[cfg(debug_assertions)]
    if response.status().is_client_error() || response.status().is_server_error() {
        eprintln!("[stash-preview] {} {} -> {}", request.method(), request.uri().path(), response.status());
    }
    if let Some(origin) = app_origin(request) {
        let headers = response.headers_mut();
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static(origin));
        headers.insert(header::ACCESS_CONTROL_EXPOSE_HEADERS, HeaderValue::from_static("Content-Range, Content-Length"));
        headers.insert(header::VARY, HeaderValue::from_static("Origin"));
    }
    response
}

fn answer(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let Some(target) = parse_target(request.uri().path()) else {
        return plain(StatusCode::NOT_FOUND, "No preview for this file.");
    };
    let range = request.headers().get(header::RANGE).and_then(|value| value.to_str().ok());
    let Some((start, end, partial)) = byte_range(range, target.size) else {
        return Response::builder()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_RANGE, format!("bytes */{}", target.size))
            .body(Vec::new())
            .expect("static response");
    };
    match fetch(&target.file_id, start, end) {
        Ok(bytes) => {
            let mut response = Response::builder()
                .status(if partial { StatusCode::PARTIAL_CONTENT } else { StatusCode::OK })
                .header(header::CONTENT_TYPE, target.mime)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::CACHE_CONTROL, "private, max-age=600")
                .header("X-Content-Type-Options", "nosniff");
            // An SVG or text file opened on its own must never run as a page.
            // (Not on PDFs: it would stop WebView2's built-in PDF viewer.)
            if target.mime == "image/svg+xml" || target.mime.starts_with("text/") {
                response = response.header(header::CONTENT_SECURITY_POLICY, "default-src 'none'; style-src 'unsafe-inline'");
            }
            if partial {
                response = response.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{}", target.size));
            }
            response.body(bytes).expect("valid preview response")
        }
        Err(ReadError::LeaseExpired) => plain(StatusCode::FORBIDDEN, "Sign in again to preview this file."),
        Err(ReadError::Offline | ReadError::Timeout) => plain(StatusCode::SERVICE_UNAVAILABLE, "STASH could not be reached."),
        Err(_) => plain(StatusCode::BAD_GATEWAY, "STASH couldn't read this file."),
    }
}

/// What the Details card shows about one file. Everything here is real:
/// kind, tempo, key, resolution and frame rate are read from the name the
/// way Search reads them; size and checksum come from STASH.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileDetails {
    pub name: String,
    pub path: Option<String>,
    pub size_bytes: Option<u64>,
    pub checksum: Option<String>,
    pub kind: &'static str,
    pub extension: Option<String>,
    pub bpm: Option<u32>,
    pub key: Option<String>,
    pub resolution: Option<u32>,
    pub fps: Option<u32>,
}

fn details_from(record: &Value) -> Option<FileDetails> {
    let text = |key: &str| record.get(key).and_then(Value::as_str).map(str::to_string);
    let name = text("name")?;
    let path = text("originalRelativePath");
    let meta = stash_core::search::extract_metadata(path.as_deref().unwrap_or(&name));
    Some(FileDetails {
        kind: crate::search::kind_label(meta.kind),
        key: meta.key.map(crate::search::key_label),
        extension: meta.extension,
        bpm: meta.bpm,
        resolution: meta.resolution,
        fps: meta.fps,
        size_bytes: record.get("sizeBytes").and_then(Value::as_u64),
        checksum: text("checksum"),
        name,
        path,
    })
}

#[tauri::command]
pub async fn describe_file(file_id: String) -> Result<FileDetails, String> {
    if !safe_id(&file_id) {
        return Err("That file could not be found.".to_string());
    }
    let record = crate::api::get_json(&format!("/files/{file_id}")).await?;
    details_from(&record).ok_or_else(|| "STASH returned an invalid file.".to_string())
}

/// Opens a file on S: in its usual Windows app, as a double-click would.
/// `path` is the file's place under S:, e.g. `KSHMR Vol 5/Kicks/Kick.wav`.
#[tauri::command]
pub fn open_on_drive(path: String, mount: tauri::State<'_, crate::mount::MountController>) -> Result<(), String> {
    if !mount.status().mounted {
        return Err("Mount S: to open files in your apps.".to_string());
    }
    let parts: Vec<&str> = path.split(['/', '\\']).filter(|part| !part.is_empty()).collect();
    let safe = !parts.is_empty()
        && path.len() <= 4096
        && parts.iter().all(|part| *part != "." && *part != ".." && !part.contains(':') && !part.chars().any(char::is_control));
    if !safe {
        return Err("That file could not be opened.".to_string());
    }
    let full = format!("S:\\{}", parts.join("\\"));
    if !std::path::Path::new(&full).is_file() {
        return Err("That file isn't on S: yet.".to_string());
    }
    std::process::Command::new("explorer.exe")
        .arg(&full)
        .spawn()
        .map(|_| ())
        .map_err(|_| "Windows couldn't open that file.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_types_are_previewed() {
        assert_eq!(mime_for("WAV"), Some("audio/wav"));
        assert_eq!(mime_for("pdf"), Some("application/pdf"));
        assert_eq!(mime_for("exe"), None);
        assert_eq!(mime_for("html"), None, "a page must never be served as itself");
    }

    #[test]
    fn preview_paths_carry_a_safe_id_a_size_and_a_type() {
        assert_eq!(parse_target("/f_1-a/4800/wav"), Some(Target { file_id: "f_1-a".into(), size: 4800, mime: "audio/wav" }));
        for bad in ["/../x/1/wav", "/f1/abc/wav", "/f1/10/exe", "/f1/10", "/f1/10/wav/extra", "/a%2Fb/1/wav"] {
            assert_eq!(parse_target(bad), None, "{bad}");
        }
    }

    fn request(method: &str, path: &str, origin: Option<&str>) -> Request<Vec<u8>> {
        let mut builder = Request::builder().method(method).uri(format!("http://stash.localhost{path}"));
        if let Some(origin) = origin {
            builder = builder.header(header::ORIGIN, origin);
        }
        builder.body(Vec::new()).unwrap()
    }

    #[test]
    fn only_the_app_page_may_read_previews_with_fetch() {
        // The text view's fetch() sends Range, so WebView2 asks first.
        let preflight = respond(&request("OPTIONS", "/f1/155/txt", Some("http://tauri.localhost")));
        assert_eq!(preflight.status(), StatusCode::NO_CONTENT);
        assert_eq!(preflight.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN], "http://tauri.localhost");
        assert_eq!(preflight.headers()[header::ACCESS_CONTROL_ALLOW_HEADERS], "Range");
        // Errors carry it too, so the page sees the status instead of a blocked read.
        let missing = respond(&request("GET", "/f1/155/exe", Some("http://tauri.localhost")));
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
        assert_eq!(missing.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN], "http://tauri.localhost");
        for other in [Some("https://evil.example"), Some("null"), None] {
            let response = respond(&request("OPTIONS", "/f1/155/txt", other));
            assert!(response.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN).is_none(), "{other:?}");
        }
    }

    #[test]
    fn ranges_are_clamped_to_the_file_and_one_chunk() {
        let size = 10 * 1024 * 1024;
        assert_eq!(byte_range(Some("bytes=0-99"), size), Some((0, 99, true)));
        assert_eq!(byte_range(Some("bytes=0-"), size), Some((0, CHUNK_BYTES - 1, true)));
        assert_eq!(byte_range(Some("bytes=-100"), size), Some((size - 100, size - 1, true)));
        assert_eq!(byte_range(Some("bytes=5-999999999"), 10), Some((5, 9, true)));
        assert_eq!(byte_range(Some("bytes=20-30"), 10), None);
        assert_eq!(byte_range(Some("bytes=0-1,5-6"), 10), None);
        assert_eq!(byte_range(None, 10), Some((0, 9, false)));
        assert_eq!(byte_range(None, WHOLE_FILE_LIMIT + 1), None, "big files are only served in ranges");
        assert_eq!(byte_range(None, 0), None);
    }

    #[test]
    fn details_read_tempo_and_key_from_the_name_and_facts_from_stash() {
        let record = serde_json::json!({
            "id": "f1", "name": "Kick_G#_128.wav", "originalRelativePath": "KSHMR Vol 5/Kicks/Kick_G#_128.wav",
            "sizeBytes": 4800, "checksum": "sha256:9e72", "state": "committed"
        });
        let details = details_from(&record).unwrap();
        assert_eq!((details.kind, details.bpm, details.key.as_deref()), ("audio", Some(128), Some("G#")));
        assert_eq!((details.size_bytes, details.checksum.as_deref()), (Some(4800), Some("sha256:9e72")));
    }
}
