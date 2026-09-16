//! Exercises `HttpRangeProvider` against a real local HTTP server that
//! honors `Range` requests the way an S3 presigned-URL GET would, so this
//! proves actual network byte-range behavior rather than an in-memory mock.
use stash_core::RangeProvider;
use stash_s3_provider::{HttpRangeProvider, LeaseSource};
use std::thread;
use std::time::Duration;

struct FixedLease(String);
impl LeaseSource for FixedLease {
    fn current_url(&self) -> Result<String, stash_core::ReadError> {
        Ok(self.0.clone())
    }
    fn renew(&self) -> Result<String, stash_core::ReadError> {
        Ok(self.0.clone())
    }
}

/// Starts a background HTTP server on an OS-assigned port that serves a
/// fixed body and honors `Range: bytes=start-end`, mirroring S3's contract.
fn start_range_server(body: &'static [u8]) -> String {
    let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
    let addr = server.server_addr().to_ip().unwrap();
    thread::spawn(move || {
        for request in server.incoming_requests() {
            let range = request
                .headers()
                .iter()
                .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case("Range"))
                .map(|h| h.value.as_str().to_string());
            let (start, end) = match range {
                Some(value) => parse_range(&value, body.len()),
                None => (0, body.len() - 1),
            };
            let chunk = body[start..=end].to_vec();
            let response = tiny_http::Response::from_data(chunk).with_status_code(206);
            let _ = request.respond(response);
        }
    });
    format!("http://{}/", addr)
}

fn parse_range(value: &str, len: usize) -> (usize, usize) {
    let spec = value.trim_start_matches("bytes=");
    let mut parts = spec.split('-');
    let start: usize = parts.next().unwrap().parse().unwrap();
    let end: usize = parts
        .next()
        .filter(|s| !s.is_empty())
        .map(|s| s.parse().unwrap())
        .unwrap_or(len - 1);
    (start, end.min(len - 1))
}

#[test]
fn fetches_requested_byte_range_from_a_real_http_server() {
    let body: &'static [u8] = b"0123456789ABCDEF";
    let url = start_range_server(body);
    let provider = HttpRangeProvider::new(FixedLease(url));

    let segment = provider.fetch(4, 4, Duration::from_secs(2)).unwrap();

    assert_eq!(segment.bytes, b"4567");
}

#[test]
fn nonsequential_reads_return_only_the_requested_bytes() {
    let body: &'static [u8] = b"0123456789ABCDEF";
    let url = start_range_server(body);
    let provider = HttpRangeProvider::new(FixedLease(url));

    let tail = provider.fetch(12, 4, Duration::from_secs(2)).unwrap();

    assert_eq!(tail.bytes, b"CDEF");
}

#[test]
fn unreachable_lease_url_is_a_bounded_offline_error() {
    // Port 1 is a privileged, always-refused port on Linux/macOS/Windows, so this fails fast
    // as a connection error rather than actually waiting out the timeout — the test itself
    // must not hang even if the timeout bound were implemented incorrectly.
    let provider = HttpRangeProvider::new(FixedLease("http://127.0.0.1:1/".to_string()));

    let result = provider.fetch(0, 4, Duration::from_millis(200));

    assert_eq!(result.err(), Some(stash_core::ReadError::Offline));
}
