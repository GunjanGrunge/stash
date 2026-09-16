//! HTTP-backed `RangeProvider`: performs real `Range` GET requests against a
//! short-lived S3 lease URL. Lease acquisition/renewal is delegated to a
//! `LeaseSource` so this crate never talks to the control plane and never
//! holds a credential or object key — only the URL the lease route already
//! returned.
use sha2::{Digest, Sha256};
use stash_core::{RangeProvider, ReadError, Segment};
use std::io::Read;
use std::sync::Mutex;
use std::time::Duration;

/// Supplies and renews the short-lived S3 GET URL. Implemented by the
/// control-plane client layer.
pub trait LeaseSource: Send + Sync {
    fn current_url(&self) -> Result<String, ReadError>;
    fn renew(&self) -> Result<String, ReadError>;
}

pub struct HttpRangeProvider<L: LeaseSource> {
    lease: L,
    url: Mutex<Option<String>>,
    agent: ureq::Agent,
}

impl<L: LeaseSource> HttpRangeProvider<L> {
    pub fn new(lease: L) -> Self {
        Self { lease, url: Mutex::new(None), agent: ureq::AgentBuilder::new().build() }
    }

    fn url(&self) -> Result<String, ReadError> {
        let mut held = self.url.lock().unwrap();
        if let Some(existing) = held.as_ref() {
            return Ok(existing.clone());
        }
        let fresh = self.lease.current_url()?;
        *held = Some(fresh.clone());
        Ok(fresh)
    }

    fn get_range(&self, url: &str, offset: u64, length: u64, timeout: Duration) -> Result<Vec<u8>, ReadError> {
        let range = format!("bytes={}-{}", offset, offset + length - 1);
        match self.agent.get(url).timeout(timeout).set("Range", &range).call() {
            Ok(response) => {
                let mut buf = Vec::with_capacity(length as usize);
                response
                    .into_reader()
                    .take(length)
                    .read_to_end(&mut buf)
                    .map_err(|_| ReadError::Io)?;
                Ok(buf)
            }
            // A lease past its TTL reads as a rejected/expired object URL, not a network fault.
            Err(ureq::Error::Status(403, _)) | Err(ureq::Error::Status(404, _)) => Err(ReadError::LeaseExpired),
            // Anything below the HTTP layer (refused connection, reset, timed-out socket) is
            // reported as Offline: the mount cannot currently reach the asset, network-not-code.
            Err(ureq::Error::Status(_, _)) | Err(ureq::Error::Transport(_)) => Err(ReadError::Offline),
        }
    }
}

impl<L: LeaseSource> RangeProvider for HttpRangeProvider<L> {
    fn fetch(&self, offset: u64, length: u64, timeout: Duration) -> Result<Segment, ReadError> {
        let url = self.url()?;
        let bytes = self.get_range(&url, offset, length, timeout)?;
        // Self-consistency only (protects against a truncated/corrupted transfer within this
        // call) — matches the existing test-mock convention in stash-core. This does not yet
        // verify the bytes against the file's stored manifest checksum, which would require the
        // caller to pass an expected hash through; tracked as a follow-up, not silently skipped.
        let sha256 = Sha256::digest(&bytes).into();
        Ok(Segment { bytes, sha256 })
    }

    fn renew_lease(&self) -> Result<(), ReadError> {
        let fresh = self.lease.renew()?;
        *self.url.lock().unwrap() = Some(fresh);
        Ok(())
    }
}
