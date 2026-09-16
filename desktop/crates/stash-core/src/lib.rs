//! Core-only range cache. Adapters own no cache state and never see S3 object keys or leases.
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, sync::Mutex, time::Duration};

#[derive(Debug, Clone, PartialEq, Eq)] pub enum ReadError { Offline, Timeout, Io, LeaseExpired, Verification }
#[derive(Debug, Clone)] pub struct Segment { pub bytes: Vec<u8>, pub sha256: [u8; 32] }
pub trait RangeProvider: Send + Sync {
  fn fetch(&self, offset: u64, length: u64, timeout: Duration) -> Result<Segment, ReadError>;
  /// Renew a short-lived lease in memory. Called at most once for one segment read.
  fn renew_lease(&self) -> Result<(), ReadError> { Err(ReadError::LeaseExpired) }
}
pub struct Cache { segment_size: u64, timeout: Duration, segments: Mutex<BTreeMap<u64, Vec<u8>>> }
impl Cache {
  pub fn new(segment_size: u64, timeout: Duration) -> Self { assert!(segment_size > 0); Self { segment_size, timeout, segments: Mutex::new(BTreeMap::new()) } }
  /// Fetches only missing aligned segments; bytes are admitted only after SHA-256 verification.
  pub fn read(&self, provider: &dyn RangeProvider, offset: u64, length: u64) -> Result<Vec<u8>, ReadError> {
    if length == 0 { return Ok(vec![]); }
    let first = offset / self.segment_size * self.segment_size;
    let last = (offset + length - 1) / self.segment_size * self.segment_size;
    for start in (first..=last).step_by(self.segment_size as usize) {
      if !self.segments.lock().unwrap().contains_key(&start) {
        let segment = match provider.fetch(start, self.segment_size, self.timeout) {
          Err(ReadError::LeaseExpired) => { provider.renew_lease()?; provider.fetch(start, self.segment_size, self.timeout)? },
          result => result?,
        };
        let actual: [u8; 32] = Sha256::digest(&segment.bytes).into();
        if actual != segment.sha256 { return Err(ReadError::Verification); }
        self.segments.lock().unwrap().insert(start, segment.bytes);
      }
    }
    let cache = self.segments.lock().unwrap(); let mut out = Vec::with_capacity(length as usize);
    for position in offset..offset + length { let base = position / self.segment_size * self.segment_size; let i = (position - base) as usize; let bytes = cache.get(&base).ok_or(ReadError::Io)?; if i >= bytes.len() { break; } out.push(bytes[i]); }
    Ok(out)
  }
}
#[cfg(test)] mod tests { use super::*; use std::sync::atomic::{AtomicUsize, Ordering};
 struct P { calls: AtomicUsize, online: bool } impl RangeProvider for P { fn fetch(&self,o:u64,l:u64,_:Duration)->Result<Segment,ReadError>{ self.calls.fetch_add(1,Ordering::SeqCst); if !self.online{return Err(ReadError::Offline)} let bytes=(o..o+l).map(|x|x as u8).collect::<Vec<_>>(); Ok(Segment{sha256:Sha256::digest(&bytes).into(),bytes}) } }
 #[test] fn random_reads_fetch_only_missing_segments(){let p=P{calls:AtomicUsize::new(0),online:true};let c=Cache::new(4,Duration::from_millis(50));assert_eq!(c.read(&p,6,2).unwrap(),vec![6,7]);assert_eq!(c.read(&p,7,1).unwrap(),vec![7]);assert_eq!(p.calls.load(Ordering::SeqCst),1);}
 #[test] fn offline_cache_miss_is_bounded_error(){let p=P{calls:AtomicUsize::new(0),online:false};let c=Cache::new(4,Duration::from_millis(5));assert_eq!(c.read(&p,0,1),Err(ReadError::Offline));}
}
