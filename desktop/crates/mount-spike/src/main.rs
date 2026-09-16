//! Manual, live proof of the cloud-asset-mount feasibility spike: mounts
//! `STASH (S:)` for real using the `stash-windows-fs` adapter, backed by a
//! local HTTP fixture server standing in for S3 (no real AWS deployment
//! needed to prove the mount mechanism itself). See
//! `_bmad-output/implementation-artifacts/spec-cloud-asset-mount-feasibility-spike.md`.
//!
//! This is a manual verification tool, not an automated test: it mounts a
//! real drive letter and blocks until Ctrl+C.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use stash_s3_provider::{HttpRangeProvider, LeaseSource};
use stash_windows_fs::{StashFile, StashFileSystemContext};
use winfsp::host::{FileSystemHost, FileSystemParams, FineGuard, VolumeParams};
use winfsp::winfsp_init_or_die;

struct FixedLease(String);
impl LeaseSource for FixedLease {
    fn current_url(&self) -> Result<String, stash_core::ReadError> {
        Ok(self.0.clone())
    }
    fn renew(&self) -> Result<String, stash_core::ReadError> {
        Ok(self.0.clone())
    }
}

/// Local HTTP server that honors `Range` headers like an S3 presigned URL —
/// this is the fixture, not the real control-plane lease route, so the
/// spike proves the mount mechanism without needing AWS deployed yet.
fn start_fixture_server(body: &'static [u8]) -> String {
    let server = tiny_http::Server::http("127.0.0.1:0").expect("failed to bind fixture server");
    let addr = server
        .server_addr()
        .to_ip()
        .expect("fixture server has no IP address");
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
    let start: usize = parts.next().unwrap_or("0").parse().unwrap_or(0);
    let end: usize = parts
        .next()
        .filter(|s| !s.is_empty())
        .and_then(|s| s.parse().ok())
        .unwrap_or(len - 1);
    (start, end.min(len - 1))
}

fn main() {
    let _init = winfsp_init_or_die();

    let body: &'static [u8] = b"This file is served live through the STASH mount, from a local\r\n\
fixture server standing in for S3 (no real AWS deployment yet).\r\n\
If you can read this in a text editor via S:\\hello.txt, the mount works.\r\n";
    let url = start_fixture_server(body);
    println!("Fixture server (stand-in for S3) listening at {url}");

    let provider = HttpRangeProvider::new(FixedLease(url));
    let file = StashFile::new(
        "hello.txt",
        body.len() as u64,
        64,
        Duration::from_secs(5),
        provider,
    );
    let context = StashFileSystemContext::new(vec![file]);

    let mut volume_params = VolumeParams::new();
    volume_params
        .sector_size(4096)
        .sectors_per_allocation_unit(1)
        .case_sensitive_search(false)
        .case_preserved_names(true)
        .unicode_on_disk(true)
        .persistent_acls(false)
        .read_only_volume(true)
        .filesystem_name("STASH");

    let params = FileSystemParams::default_params(volume_params);
    let mut host = FileSystemHost::<_, FineGuard>::new_with_options(params, context)
        .expect("failed to create the WinFSP filesystem host");

    host.mount("S:").expect(
        "failed to mount S: - it may already be in use; edit main.rs to try a different letter",
    );
    host.start().expect("failed to start the WinFSP dispatcher");

    println!("STASH (S:) is mounted. Try: dir S:\\  and  type S:\\hello.txt");
    println!("Press Ctrl+C to unmount and exit.");

    let running = Arc::new(AtomicBool::new(true));
    let flag = running.clone();
    ctrlc::set_handler(move || flag.store(false, Ordering::SeqCst))
        .expect("failed to install the Ctrl+C handler");

    while running.load(Ordering::SeqCst) {
        thread::sleep(Duration::from_millis(200));
    }

    println!("Unmounting...");
    drop(host);
}
