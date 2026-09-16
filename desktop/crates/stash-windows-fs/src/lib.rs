//! WinFsp boundary. The actual WinFsp service is deliberately runtime-gated: installing WinFsp needs approval.
use stash_core::{Cache, RangeProvider, ReadError};
pub enum FsError { Io }
/// Maps normal filesystem reads to core range reads; callers can map `Io` to the platform I/O status.
pub fn read_file(cache: &Cache, provider: &dyn RangeProvider, offset: u64, length: u64) -> Result<Vec<u8>, FsError> { cache.read(provider, offset, length).map_err(|_| FsError::Io) }
