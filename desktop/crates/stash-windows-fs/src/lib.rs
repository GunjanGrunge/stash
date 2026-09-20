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
use std::fs::{File, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use windows::Win32::Foundation::{
    STATUS_ACCESS_DENIED, STATUS_INVALID_DEVICE_REQUEST, STATUS_IO_DEVICE_ERROR,
    STATUS_MEDIA_WRITE_PROTECTED, STATUS_NETWORK_UNREACHABLE, STATUS_OBJECT_NAME_COLLISION,
    STATUS_OBJECT_NAME_NOT_FOUND,
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

/// A native sink receives a completed spool. The filesystem crate does not
/// know about Tauri, HTTP, credentials, or the STASH API.
pub trait WriteSink: Send + Sync {
    fn begin(&self, name: &[u16]) -> Result<WriteSpool, String>;
    fn submit(&self, spool: WriteSpool) -> Result<(), String>;
}

/// A bounded, file-backed write session. The file is always created below the
/// OS temp directory and is removed on drop unless ownership is detached by a
/// sink that has safely scheduled its upload.
pub struct WriteSpool {
    name: Vec<u16>,
    path: PathBuf,
    file: Option<File>,
    remove_on_drop: bool,
}

impl WriteSpool {
    pub fn create_for_mount(name: &[u16]) -> Result<Self, String> {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let directory = std::env::temp_dir().join("stash-mount-spool");
        std::fs::create_dir_all(&directory)
            .map_err(|_| "STASH could not prepare its temporary write spool.".to_string())?;
        let path = directory.join(format!(
            "write-{}-{}.spool",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let file = OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .open(&path)
            .map_err(|_| "STASH could not create its temporary write spool.".to_string())?;
        Ok(Self {
            name: name.to_vec(),
            path,
            file: Some(file),
            remove_on_drop: true,
        })
    }

    pub fn name(&self) -> &[u16] {
        &self.name
    }
    pub fn path(&self) -> &std::path::Path {
        &self.path
    }

    fn write_at(&mut self, buffer: &[u8], offset: u64, write_to_eof: bool) -> Result<u32, String> {
        let file = self
            .file
            .as_mut()
            .ok_or_else(|| "STASH write handle is closed.".to_string())?;
        if write_to_eof {
            file.seek(SeekFrom::End(0))
        } else {
            file.seek(SeekFrom::Start(offset))
        }
        .map_err(|_| "STASH could not seek its temporary write spool.".to_string())?;
        file.write_all(buffer)
            .map_err(|_| "STASH could not write its temporary write spool.".to_string())?;
        Ok(buffer.len() as u32)
    }

    fn prepare(&mut self) -> Result<(), String> {
        let file = self
            .file
            .as_mut()
            .ok_or_else(|| "STASH write handle is closed.".to_string())?;
        file.flush()
            .map_err(|_| "STASH could not flush its temporary write spool.".to_string())?;
        file.sync_all()
            .map_err(|_| "STASH could not finalize its temporary write spool.".to_string())?;
        self.file.take();
        Ok(())
    }

    pub fn detach_path(mut self) -> PathBuf {
        self.file.take();
        self.remove_on_drop = false;
        self.path.clone()
    }
}

impl Drop for WriteSpool {
    fn drop(&mut self) {
        let _ = self.file.take();
        if self.remove_on_drop {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

struct RejectWriteSink;
impl WriteSink for RejectWriteSink {
    fn begin(&self, _name: &[u16]) -> Result<WriteSpool, String> {
        Err("STASH mount writes are not configured for this filesystem.".to_string())
    }
    fn submit(&self, _spool: WriteSpool) -> Result<(), String> {
        Err("STASH mount writes are not configured for this filesystem.".to_string())
    }
}

/// An open handle: root, a committed read-only file, or one new root-level file.
pub enum Handle {
    Root,
    File(usize),
    Pending(Arc<Mutex<PendingWrite>>),
}

pub struct PendingWrite {
    spool: Option<WriteSpool>,
    reserved_name: Option<Vec<u16>>,
    submitted: bool,
    failure: Option<String>,
    size: u64,
}

impl PendingWrite {
    fn write_at(
        &mut self,
        buffer: &[u8],
        offset: u64,
        write_to_eof: bool,
    ) -> Result<u32, String> {
        let result = self
            .spool
            .as_mut()
            .ok_or_else(|| "STASH write handle is closed.".to_string())
            .and_then(|spool| spool.write_at(buffer, offset, write_to_eof));
        match result {
            Ok(written) => {
                let end = if write_to_eof {
                    self.size.saturating_add(written as u64)
                } else {
                    offset.saturating_add(written as u64)
                };
                self.size = self.size.max(end);
                Ok(written)
            }
            Err(error) => {
                // A failed native write is terminal for this handle. Cleanup
                // may still run later, but it must only drop the partial spool.
                self.failure = Some(error.clone());
                Err(error)
            }
        }
    }

    fn finalize(
        &mut self,
        sink: &dyn WriteSink,
        pending_names: &Mutex<std::collections::HashSet<Vec<u16>>>,
    ) {
        if self.submitted {
            return;
        }
        self.submitted = true;

        if self.failure.is_none() {
            if let Some(mut spool) = self.spool.take() {
                if let Err(error) = spool.prepare().and_then(|_| sink.submit(spool)) {
                    self.failure = Some(error);
                }
            }
        } else {
            // Dropping the spool removes the partial file; never hand failed
            // bytes to the native upload boundary.
            let _ = self.spool.take();
        }

        if let Some(name) = self.reserved_name.take() {
            pending_names
                .lock()
                .expect("pending names lock poisoned")
                .remove(&name);
        }
    }
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

/// Returns one safe root-level UTF-16 filename, preserving the original code
/// units. Any separator, dot component, drive syntax, control character, or
/// empty name is rejected; nested paths never reach the native sink.
fn root_name(file_name: &U16CStr) -> Option<Vec<u16>> {
    const BACKSLASH: u16 = b'\\' as u16;
    const SLASH: u16 = b'/' as u16;
    let name = match file_name.as_slice() {
        [] | [BACKSLASH] => return None,
        [BACKSLASH, rest @ ..] => rest,
        other => other,
    };
    if name.is_empty()
        || name.iter().any(|unit| {
            *unit == BACKSLASH || *unit == SLASH || *unit == b':' as u16 || *unit < 0x20
        })
    {
        return Some(Vec::new());
    }
    if name == [b'.' as u16] || name == [b'.' as u16, b'.' as u16] {
        return Some(Vec::new());
    }
    Some(name.to_vec())
}

/// Writable only for newly-created root-level files; committed entries remain
/// read-only and the injected sink owns the upload policy.
pub struct StashFileSystemContext<P: RangeProvider> {
    entries: Vec<StashFile<P>>,
    write_sink: Arc<dyn WriteSink>,
    pending_names: Mutex<std::collections::HashSet<Vec<u16>>>,
}

impl<P: RangeProvider> StashFileSystemContext<P> {
    pub fn new(entries: Vec<StashFile<P>>) -> Self {
        Self::new_with_write_sink(entries, Arc::new(RejectWriteSink))
    }

    pub fn new_with_write_sink(
        mut entries: Vec<StashFile<P>>,
        write_sink: Arc<dyn WriteSink>,
    ) -> Self {
        entries.sort_by(|a, b| a.name.as_slice().cmp(b.name.as_slice()));
        Self {
            entries,
            write_sink,
            pending_names: Mutex::new(std::collections::HashSet::new()),
        }
    }

    fn reserve_pending_name(&self, name: &[u16]) -> bool {
        let mut pending_names = self
            .pending_names
            .lock()
            .expect("pending names lock poisoned");
        // The membership check and insertion share this one lock, so two
        // synchronous WinFSP create callbacks cannot reserve the same name.
        pending_names.insert(name.to_vec())
    }

    fn release_pending_name(&self, name: &[u16]) {
        self.pending_names
            .lock()
            .expect("pending names lock poisoned")
            .remove(name);
    }

    /// Pure path resolution: no WinFSP types in or out. This is the piece
    /// worth testing thoroughly — `open` and `get_security_by_name` are both
    /// thin wrappers around it.
    fn resolve(&self, file_name: &U16CStr) -> Resolved {
        match root_name(file_name) {
            None => Resolved::Root,
            Some(name) if name.is_empty() => Resolved::NotFound,
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

    fn create(
        &self,
        file_name: &U16CStr,
        create_options: u32,
        _granted_access: u32,
        file_attributes: u32,
        _security_descriptor: Option<&[c_void]>,
        _allocation_size: u64,
        _extra_buffer: Option<&[u8]>,
        _extra_buffer_is_reparse_point: bool,
        file_info: &mut OpenFileInfo,
    ) -> FspResult<Self::FileContext> {
        const FILE_DIRECTORY_FILE: u32 = 0x0000_0001;
        const FILE_ATTRIBUTE_DIRECTORY_VALUE: u32 = 0x10;
        let Some(name) = root_name(file_name) else {
            return Err(FspError::NTSTATUS(STATUS_ACCESS_DENIED.0));
        };
        if name.is_empty()
            || create_options & FILE_DIRECTORY_FILE != 0
            || file_attributes & FILE_ATTRIBUTE_DIRECTORY_VALUE != 0
        {
            return Err(FspError::NTSTATUS(STATUS_ACCESS_DENIED.0));
        }
        if self
            .entries
            .iter()
            .any(|entry| entry.name.as_slice() == name)
        {
            return Err(FspError::NTSTATUS(STATUS_OBJECT_NAME_COLLISION.0));
        }
        if !self.reserve_pending_name(&name) {
            return Err(FspError::NTSTATUS(STATUS_OBJECT_NAME_COLLISION.0));
        }
        let spool = match self.write_sink.begin(&name) {
            Ok(spool) => spool,
            Err(_) => {
                // Reservation precedes sink creation so the check-and-reserve
                // is atomic; a failed begin must roll it back immediately.
                self.release_pending_name(&name);
                return Err(FspError::NTSTATUS(STATUS_ACCESS_DENIED.0));
            }
        };
        let pending = PendingWrite {
            spool: Some(spool),
            reserved_name: Some(name),
            submitted: false,
            failure: None,
            size: 0,
        };
        let handle = Handle::Pending(Arc::new(Mutex::new(pending)));
        *file_info.as_mut() = FileInfo::default();
        Ok(handle)
    }

    fn cleanup(&self, context: &Self::FileContext, _file_name: Option<&U16CStr>, _flags: u32) {
        if let Handle::Pending(pending) = context {
            if let Ok(mut pending) = pending.lock() {
                pending.finalize(self.write_sink.as_ref(), &self.pending_names);
            }
        }
    }

    fn close(&self, context: Self::FileContext) {
        if let Handle::Pending(pending) = &context {
            if let Ok(mut pending) = pending.lock() {
                pending.finalize(self.write_sink.as_ref(), &self.pending_names);
            }
        }
    }

    fn get_file_info(
        &self,
        context: &Self::FileContext,
        file_info: &mut FileInfo,
    ) -> FspResult<()> {
        *file_info = match context {
            Handle::Root => self.root_file_info(),
            Handle::File(index) => self.file_info_for(*index),
            Handle::Pending(pending) => {
                let mut info = FileInfo::default();
                info.file_size = pending.lock().expect("pending write lock poisoned").size;
                info.allocation_size = info.file_size;
                info
            }
        };
        Ok(())
    }

    fn read(&self, context: &Self::FileContext, buffer: &mut [u8], offset: u64) -> FspResult<u32> {
        match context {
            Handle::File(index) => self.read_file(*index, buffer, offset),
            Handle::Pending(_) => Err(FspError::NTSTATUS(STATUS_ACCESS_DENIED.0)),
            Handle::Root => Err(FspError::NTSTATUS(STATUS_INVALID_DEVICE_REQUEST.0)),
        }
    }

    fn write(
        &self,
        context: &Self::FileContext,
        buffer: &[u8],
        offset: u64,
        write_to_eof: bool,
        constrained_io: bool,
        file_info: &mut FileInfo,
    ) -> FspResult<u32> {
        let Handle::Pending(pending) = context else {
            return Err(FspError::NTSTATUS(STATUS_MEDIA_WRITE_PROTECTED.0));
        };
        if constrained_io {
            return Err(FspError::NTSTATUS(STATUS_INVALID_DEVICE_REQUEST.0));
        }
        let mut pending = pending
            .lock()
            .map_err(|_| FspError::NTSTATUS(STATUS_IO_DEVICE_ERROR.0))?;
        let written = pending
            .write_at(buffer, offset, write_to_eof)
            .map_err(|_| FspError::NTSTATUS(STATUS_IO_DEVICE_ERROR.0))?;
        file_info.file_size = pending.size;
        file_info.allocation_size = pending.size;
        Ok(written)
    }

    fn overwrite(
        &self,
        _context: &Self::FileContext,
        _file_attributes: u32,
        _replace_file_attributes: bool,
        _allocation_size: u64,
        _extra_buffer: Option<&[u8]>,
        _file_info: &mut FileInfo,
    ) -> FspResult<()> {
        Err(FspError::NTSTATUS(STATUS_OBJECT_NAME_COLLISION.0))
    }

    fn rename(
        &self,
        _context: &Self::FileContext,
        _file_name: &U16CStr,
        _new_file_name: &U16CStr,
        _replace_if_exists: bool,
    ) -> FspResult<()> {
        Err(FspError::NTSTATUS(STATUS_ACCESS_DENIED.0))
    }

    fn set_delete(
        &self,
        _context: &Self::FileContext,
        _file_name: &U16CStr,
        _delete_file: bool,
    ) -> FspResult<()> {
        Err(FspError::NTSTATUS(STATUS_ACCESS_DENIED.0))
    }

    fn set_file_size(
        &self,
        _context: &Self::FileContext,
        _new_size: u64,
        _set_allocation_size: bool,
        _file_info: &mut FileInfo,
    ) -> FspResult<()> {
        Err(FspError::NTSTATUS(STATUS_ACCESS_DENIED.0))
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

    struct CountingSink {
        submissions: AtomicUsize,
    }

    impl WriteSink for CountingSink {
        fn begin(&self, name: &[u16]) -> Result<WriteSpool, String> {
            WriteSpool::create_for_mount(name)
        }
        fn submit(&self, spool: WriteSpool) -> Result<(), String> {
            self.submissions.fetch_add(1, Ordering::SeqCst);
            let _ = std::fs::remove_file(spool.path());
            Ok(())
        }
    }

    struct FailingBeginSink;

    impl WriteSink for FailingBeginSink {
        fn begin(&self, _name: &[u16]) -> Result<WriteSpool, String> {
            Err("begin failed".to_string())
        }

        fn submit(&self, _spool: WriteSpool) -> Result<(), String> {
            panic!("a failed begin must never submit")
        }
    }

    #[test]
    fn failed_begin_rolls_back_the_pending_name_reservation() {
        let fs: StashFileSystemContext<FixedProvider> = StashFileSystemContext::new_with_write_sink(
            Vec::new(),
            Arc::new(FailingBeginSink),
        );
        let name = path("retry.wav");
        assert!(fs.write_sink.begin(name.as_slice()).is_err());
        assert!(fs.reserve_pending_name(name.as_slice()));
        fs.release_pending_name(name.as_slice());
    }

    #[test]
    fn concurrent_same_name_reservation_allows_exactly_one_handle() {
        let fs = Arc::new(one_file_context());
        let name = path("concurrent.wav");
        let results = std::thread::scope(|scope| {
            (0..8)
                .map(|_| {
                    let fs = Arc::clone(&fs);
                    let name = name.clone();
                    scope.spawn(move || fs.reserve_pending_name(name.as_slice()))
                })
                .map(|thread| thread.join().unwrap())
                .collect::<Vec<_>>()
        });
        assert_eq!(results.iter().filter(|reserved| **reserved).count(), 1);
        fs.release_pending_name(name.as_slice());
    }

    #[test]
    fn failed_spool_write_is_not_submitted_and_name_can_be_reused() {
        let sink = CountingSink {
            submissions: AtomicUsize::new(0),
        };
        let name = path("failed-write.wav");
        let fs = one_file_context();
        assert!(fs.reserve_pending_name(name.as_slice()));
        let spool = WriteSpool::create_for_mount(name.as_slice()).unwrap();
        let mut pending = PendingWrite {
            spool: Some(spool),
            reserved_name: Some(name.as_slice().to_vec()),
            submitted: false,
            failure: None,
            size: 0,
        };
        pending.spool.as_mut().unwrap().file.take();
        assert!(pending.write_at(b"partial", 0, false).is_err());
        pending.finalize(&sink, &fs.pending_names);
        assert!(pending.failure.is_some());
        assert_eq!(sink.submissions.load(Ordering::SeqCst), 0);
        assert!(fs.reserve_pending_name(name.as_slice()));
        fs.release_pending_name(name.as_slice());
    }


    #[test]
    fn root_name_preserves_unicode_and_rejects_unsafe_paths() {
        let unicode = path("Étage.wav");
        assert_eq!(root_name(&unicode).unwrap(), unicode.as_slice());
        assert!(root_name(&path("\\Beats\\take.wav")).unwrap().is_empty());
        assert!(root_name(&path("\\..\\take.wav")).unwrap().is_empty());
        assert!(root_name(&path("\\C:take.wav")).unwrap().is_empty());
    }

    #[test]
    fn pending_spool_writes_at_offsets_and_zero_fills_gaps() {
        let mut spool = WriteSpool::create_for_mount(path("offset.wav").as_slice()).unwrap();
        spool.write_at(b"stash", 4, false).unwrap();
        let path = spool.path().to_path_buf();
        spool.prepare().unwrap();
        let bytes = std::fs::read(path).unwrap();
        assert_eq!(bytes, b"\0\0\0\0stash");
    }

    #[test]
    fn duplicate_and_directory_names_are_rejected_before_sink_submission() {
        let fs = one_file_context();
        assert!(matches!(fs.resolve(&path("\\kick.wav")), Resolved::File(_)));
        assert!(root_name(&path("\\folder\\")).unwrap().is_empty());
        assert!(root_name(&path("\\new.wav")).unwrap().len() > 0);
    }

    #[test]
    fn cleanup_and_submission_are_idempotent() {
        let sink = CountingSink {
            submissions: AtomicUsize::new(0),
        };
        let spool = WriteSpool::create_for_mount(path("once.wav").as_slice()).unwrap();
        let path = spool.path().to_path_buf();
        let mut pending = PendingWrite {
            spool: Some(spool),
            reserved_name: None,
            submitted: false,
            failure: None,
            size: 0,
        };
        let pending_names = Mutex::new(std::collections::HashSet::new());
        pending.finalize(&sink, &pending_names);
        pending.finalize(&sink, &pending_names);
        assert_eq!(sink.submissions.load(Ordering::SeqCst), 1);
        assert!(!path.exists());
        let _ = std::fs::remove_file(path);
    }
    #[test]
    fn successful_cleanup_releases_name_for_a_retry() {
        let sink = CountingSink {
            submissions: AtomicUsize::new(0),
        };
        let fs = one_file_context();
        let name = path("cleanup-retry.wav");
        assert!(fs.reserve_pending_name(name.as_slice()));
        let spool = WriteSpool::create_for_mount(name.as_slice()).unwrap();
        let mut pending = PendingWrite {
            spool: Some(spool),
            reserved_name: Some(name.as_slice().to_vec()),
            submitted: false,
            failure: None,
            size: 0,
        };
        pending.finalize(&sink, &fs.pending_names);
        assert_eq!(sink.submissions.load(Ordering::SeqCst), 1);
        assert!(fs.reserve_pending_name(name.as_slice()));
        fs.release_pending_name(name.as_slice());
    }


    #[test]
    fn security_lookup_preserves_directory_and_file_attributes() {
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
