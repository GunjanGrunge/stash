//! WinFSP boundary: maps `STASH (S:)` filesystem operations (open, read,
//! enumerate, stat) onto the platform-agnostic core (`stash-core`'s
//! `Cache`/`RangeProvider`). This crate owns no network logic itself — it
//! only translates between WinFSP's callback shapes and the core's already
//! range-verified, bounded-failure reads.
//!
//! Scope for the feasibility spike: a single flat root directory of
//! read-only files. No subdirectories, no write path, no rename/delete —
//! those are out of scope until the mount itself is proven (see the spike
//! spec's Boundaries & Constraints).
//!
//! ## Why the logic is split from the trait impl
//! `winfsp::filesystem::FileSystemContext::open` and `::read_directory` take
//! `OpenFileInfo`/`DirMarker`, types whose fields are private to the
//! `winfsp` crate — WinFSP itself is the only thing that can construct them
//! (they point into a live filesystem-driver transaction). That makes the
//! trait methods themselves impossible to unit test without a real mount.
//! So the path-resolution and directory-enumeration *logic* lives in plain
//! functions/methods below that take and return only types this crate
//! controls, fully covered by the tests in this file; the trait impl is a
//! thin, deliberately small adapter on top, verified only by the separately
//! gated live-mount check (`desktop/tests/mount-spike/`).
use stash_core::{Cache, RangeProvider, ReadError};
use std::ffi::c_void;
use windows::Win32::Foundation::{
    STATUS_ACCESS_DENIED, STATUS_INVALID_DEVICE_REQUEST, STATUS_IO_DEVICE_ERROR,
    STATUS_MEDIA_WRITE_PROTECTED, STATUS_NETWORK_UNREACHABLE, STATUS_OBJECT_NAME_NOT_FOUND,
};
use windows::Win32::Storage::FileSystem::{FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_READONLY};
use winfsp::filesystem::{
    DirInfo, DirMarker, FileInfo, FileSecurity, FileSystemContext, OpenFileInfo, VolumeInfo,
    WideNameInfo,
};
use winfsp::{FspError, Result as FspResult, U16CStr, U16CString};

/// One read-only file exposed at the mount root.
pub struct StashFile<P: RangeProvider> {
    pub name: U16CString,
    pub size: u64,
    pub cache: Cache,
    pub provider: P,
}

impl<P: RangeProvider> StashFile<P> {
    pub fn new(
        name: &str,
        size: u64,
        segment_size: u64,
        timeout: std::time::Duration,
        provider: P,
    ) -> Self {
        Self {
            name: U16CString::from_str(name).expect("file name must not contain interior NUL"),
            size,
            cache: Cache::new(segment_size, timeout, size, 64 * 1024 * 1024),
            provider,
        }
    }
}

/// An open handle: either the mount root (directory) or one root-level file.
pub enum Handle {
    Root,
    File(usize),
}

/// What resolving a path against the root entry table found. Plain enum —
/// no WinFSP types involved — so path resolution is fully unit-testable.
enum Resolved {
    Root,
    File(usize),
    NotFound,
}

/// Maps `ReadError` (network/verification failures already bounded by
/// `Cache`) onto an NTSTATUS. `Offline`/`Timeout` become network-unreachable
/// rather than a generic device error, so Explorer/creative apps surface a
/// meaningful "can't reach the network" state instead of "file is corrupt."
fn read_error_to_fsp(err: ReadError) -> FspError {
    let status = match err {
        ReadError::Offline | ReadError::Timeout => STATUS_NETWORK_UNREACHABLE,
        ReadError::LeaseExpired => STATUS_ACCESS_DENIED,
        ReadError::Io | ReadError::Range => STATUS_IO_DEVICE_ERROR,
    };
    FspError::NTSTATUS(status.0)
}

/// Strips the mount's leading `\`. Returns `None` for the root itself.
fn path_after_root(file_name: &U16CStr) -> Option<Vec<u16>> {
    const BACKSLASH: u16 = b'\\' as u16;
    let slice = file_name.as_slice();
    match slice {
        [] | [BACKSLASH] => None,
        [BACKSLASH, rest @ ..] => Some(rest.to_vec()),
        other => Some(other.to_vec()),
    }
}

/// Read-only, flat-root filesystem context backed by `stash-core`.
pub struct StashFileSystemContext<P: RangeProvider> {
    entries: Vec<StashFile<P>>,
}

impl<P: RangeProvider> StashFileSystemContext<P> {
    pub fn new(mut entries: Vec<StashFile<P>>) -> Self {
        entries.sort_by(|a, b| a.name.as_slice().cmp(b.name.as_slice()));
        Self { entries }
    }

    /// Pure path resolution: no WinFSP types in or out. This is the piece
    /// worth testing thoroughly — `open` and `get_security_by_name` are both
    /// thin wrappers around it.
    fn resolve(&self, file_name: &U16CStr) -> Resolved {
        match path_after_root(file_name) {
            None => Resolved::Root,
            Some(name) => match self.entries.iter().position(|e| e.name.as_slice() == name) {
                Some(index) => Resolved::File(index),
                None => Resolved::NotFound,
            },
        }
    }

    fn root_file_info(&self) -> FileInfo {
        let mut info = FileInfo::default();
        info.file_attributes = FILE_ATTRIBUTE_DIRECTORY.0;
        info
    }

    fn file_info_for(&self, index: usize) -> FileInfo {
        let entry = &self.entries[index];
        let mut info = FileInfo::default();
        info.file_attributes = FILE_ATTRIBUTE_READONLY.0;
        info.file_size = entry.size;
        info.allocation_size = entry.size;
        info
    }

    /// Pure directory-enumeration order: entries strictly after `after` in
    /// sorted name order. `after` stands in for `DirMarker::inner()`'s
    /// output (owned rather than borrowed, so this has no lifetime tied to
    /// the marker and can be tested without constructing a real one).
    fn entries_after<'e>(
        &'e self,
        after: Option<Vec<u16>>,
    ) -> impl Iterator<Item = (usize, &'e StashFile<P>)> {
        self.entries.iter().enumerate().filter(move |(_, entry)| {
            after
                .as_deref()
                .is_none_or(|after| entry.name.as_slice() > after)
        })
    }

    /// Pure read: bytes for a known-good file index. `read()` (the trait
    /// method) only adds the `Handle`-variant match on top of this.
    fn read_file(&self, index: usize, buffer: &mut [u8], offset: u64) -> FspResult<u32> {
        let entry = &self.entries[index];
        if offset >= entry.size {
            return Ok(0);
        }
        let length = (buffer.len() as u64).min(entry.size - offset);
        let bytes = entry
            .cache
            .read(&entry.provider, offset, length)
            .map_err(read_error_to_fsp)?;
        buffer[..bytes.len()].copy_from_slice(&bytes);
        Ok(bytes.len() as u32)
    }
}

impl<P: RangeProvider> FileSystemContext for StashFileSystemContext<P> {
    type FileContext = Handle;

    fn get_security_by_name(
        &self,
        file_name: &U16CStr,
        _security_descriptor: Option<&mut [c_void]>,
        _reparse_point_resolver: impl FnOnce(&U16CStr) -> Option<FileSecurity>,
    ) -> FspResult<FileSecurity> {
        match self.resolve(file_name) {
            Resolved::Root => Ok(FileSecurity {
                reparse: false,
                sz_security_descriptor: 0,
                attributes: FILE_ATTRIBUTE_DIRECTORY.0,
            }),
            Resolved::File(_) => Ok(FileSecurity {
                reparse: false,
                sz_security_descriptor: 0,
                attributes: FILE_ATTRIBUTE_READONLY.0,
            }),
            Resolved::NotFound => Err(FspError::NTSTATUS(STATUS_OBJECT_NAME_NOT_FOUND.0)),
        }
    }

    fn open(
        &self,
        file_name: &U16CStr,
        _create_options: u32,
        _granted_access: u32,
        file_info: &mut OpenFileInfo,
    ) -> FspResult<Self::FileContext> {
        match self.resolve(file_name) {
            Resolved::Root => {
                *file_info.as_mut() = self.root_file_info();
                Ok(Handle::Root)
            }
            Resolved::File(index) => {
                *file_info.as_mut() = self.file_info_for(index);
                Ok(Handle::File(index))
            }
            Resolved::NotFound => Err(FspError::NTSTATUS(STATUS_OBJECT_NAME_NOT_FOUND.0)),
        }
    }

    fn close(&self, _context: Self::FileContext) {}

    fn get_file_info(
        &self,
        context: &Self::FileContext,
        file_info: &mut FileInfo,
    ) -> FspResult<()> {
        *file_info = match context {
            Handle::Root => self.root_file_info(),
            Handle::File(index) => self.file_info_for(*index),
        };
        Ok(())
    }

    fn read(&self, context: &Self::FileContext, buffer: &mut [u8], offset: u64) -> FspResult<u32> {
        match context {
            Handle::File(index) => self.read_file(*index, buffer, offset),
            Handle::Root => Err(FspError::NTSTATUS(STATUS_INVALID_DEVICE_REQUEST.0)),
        }
    }

    fn write(
        &self,
        _context: &Self::FileContext,
        _buffer: &[u8],
        _offset: u64,
        _write_to_eof: bool,
        _constrained_io: bool,
        _file_info: &mut FileInfo,
    ) -> FspResult<u32> {
        // Read-only mount for this spike (spec: no upload/write path yet).
        Err(FspError::NTSTATUS(STATUS_MEDIA_WRITE_PROTECTED.0))
    }

    fn read_directory(
        &self,
        context: &Self::FileContext,
        _pattern: Option<&U16CStr>,
        marker: DirMarker,
        buffer: &mut [u8],
    ) -> FspResult<u32> {
        if !matches!(context, Handle::Root) {
            return Err(FspError::NTSTATUS(STATUS_INVALID_DEVICE_REQUEST.0));
        }
        // Root has no parent within this mount, so unlike a real subdirectory
        // we never emit "." / "..": there is nothing to enumerate above it.
        let mut cursor = 0u32;
        let mut dir_info: DirInfo<255> = DirInfo::new();
        for (index, entry) in self.entries_after(marker.inner().map(|s| s.to_vec())) {
            dir_info.reset();
            *dir_info.file_info_mut() = self.file_info_for(index);
            dir_info.set_name_raw(entry.name.as_slice())?;
            if !dir_info.append_to_buffer(buffer, &mut cursor) {
                return Ok(cursor);
            }
        }
        DirInfo::<255>::finalize_buffer(buffer, &mut cursor);
        Ok(cursor)
    }

    fn get_volume_info(&self, out_volume_info: &mut VolumeInfo) -> FspResult<()> {
        // Nominal 1 TB ceiling matches the PRD's private-beta per-user quota;
        // this mount reflects one user's committed files, not a real device.
        let total: u64 = 1_000_000_000_000;
        let used: u64 = self
            .entries
            .iter()
            .fold(0u64, |total, entry| total.saturating_add(entry.size));
        out_volume_info.total_size = total;
        out_volume_info.free_size = total.saturating_sub(used);
        out_volume_info.set_volume_label("STASH");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    /// A `RangeProvider` over a fixed in-memory buffer, standing in for the
    /// real `stash-s3-provider::HttpRangeProvider` so these tests exercise
    /// `StashFileSystemContext` without a network or a live WinFSP mount.
    struct FixedProvider {
        data: &'static [u8],
        calls: AtomicUsize,
    }

    impl RangeProvider for FixedProvider {
        fn fetch(
            &self,
            offset: u64,
            length: u64,
            _timeout: Duration,
        ) -> Result<stash_core::Segment, ReadError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let start = offset as usize;
            let end = (start + length as usize).min(self.data.len());
            let bytes = self.data[start..end].to_vec();
            Ok(stash_core::Segment { bytes })
        }
    }

    fn one_file_context() -> StashFileSystemContext<FixedProvider> {
        let provider = FixedProvider {
            data: b"hello stash world",
            calls: AtomicUsize::new(0),
        };
        let file = StashFile::new("kick.wav", 18, 8, Duration::from_secs(2), provider);
        StashFileSystemContext::new(vec![file])
    }

    fn path(s: &str) -> U16CString {
        U16CString::from_str(s).unwrap()
    }

    #[test]
    fn resolves_root_path_to_root() {
        let fs = one_file_context();
        assert!(matches!(fs.resolve(&path("\\")), Resolved::Root));
    }

    #[test]
    fn empty_context_is_a_valid_empty_root_directory() {
        let fs = StashFileSystemContext::<FixedProvider>::new(Vec::new());
        assert!(matches!(fs.resolve(&path("\\")), Resolved::Root));
        assert!(fs.entries_after(None).next().is_none());
    }

    #[test]
    fn resolves_known_file_by_name() {
        let fs = one_file_context();
        assert!(matches!(fs.resolve(&path("\\kick.wav")), Resolved::File(0)));
    }

    #[test]
    fn resolves_unknown_name_to_not_found() {
        let fs = one_file_context();
        assert!(matches!(
            fs.resolve(&path("\\missing.wav")),
            Resolved::NotFound
        ));
    }

    #[test]
    fn reads_requested_range_through_the_core_cache() {
        let fs = one_file_context();
        let mut buffer = [0u8; 5];
        let read = fs.read_file(0, &mut buffer, 6).unwrap();
        assert_eq!(read, 5);
        assert_eq!(&buffer, b"stash");
    }

    #[test]
    fn read_past_end_of_file_is_bounded_end_of_file_status() {
        let fs = one_file_context();
        let mut buffer = [0u8; 4];
        assert_eq!(fs.read_file(0, &mut buffer, 100).unwrap(), 0);
    }

    #[test]
    fn read_reports_bounded_network_error_when_provider_is_offline() {
        struct OfflineProvider;
        impl RangeProvider for OfflineProvider {
            fn fetch(&self, _: u64, _: u64, _: Duration) -> Result<stash_core::Segment, ReadError> {
                Err(ReadError::Offline)
            }
        }
        let file = StashFile::new(
            "kick.wav",
            18,
            8,
            Duration::from_millis(50),
            OfflineProvider,
        );
        let fs = StashFileSystemContext::new(vec![file]);
        let mut buffer = [0u8; 4];
        let err = fs.read_file(0, &mut buffer, 0).unwrap_err();
        assert_eq!(err.to_ntstatus(), STATUS_NETWORK_UNREACHABLE.0);
    }

    #[test]
    fn directory_enumeration_after_marker_skips_earlier_names_in_sort_order() {
        let a = StashFile::new(
            "a.wav",
            1,
            8,
            Duration::from_secs(1),
            FixedProvider {
                data: b"a",
                calls: AtomicUsize::new(0),
            },
        );
        let b = StashFile::new(
            "b.wav",
            1,
            8,
            Duration::from_secs(1),
            FixedProvider {
                data: b"b",
                calls: AtomicUsize::new(0),
            },
        );
        let fs = StashFileSystemContext::new(vec![a, b]);

        let from_start: Vec<_> = fs.entries_after(None).map(|(i, _)| i).collect();
        assert_eq!(from_start, vec![0, 1]);

        let a_name = path("a.wav");
        let after_a: Vec<_> = fs
            .entries_after(Some(a_name.as_slice().to_vec()))
            .map(|(i, _)| i)
            .collect();
        assert_eq!(after_a, vec![1]);
    }

    #[test]
    fn get_security_by_name_matches_open_resolution() {
        let fs = one_file_context();
        let root = fs
            .get_security_by_name(&path("\\"), None, |_| None)
            .unwrap();
        assert_eq!(root.attributes, FILE_ATTRIBUTE_DIRECTORY.0);

        let file = fs
            .get_security_by_name(&path("\\kick.wav"), None, |_| None)
            .unwrap();
        assert_eq!(file.attributes, FILE_ATTRIBUTE_READONLY.0);

        let missing = fs.get_security_by_name(&path("\\missing.wav"), None, |_| None);
        assert!(missing.is_err());
    }
}
