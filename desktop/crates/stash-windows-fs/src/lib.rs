//! WinFSP boundary: maps `STASH (S:)` filesystem operations (open, read,
//! enumerate, stat) onto the platform-agnostic core (`stash-core`'s
//! `Cache`/`RangeProvider`). This crate owns no network logic itself — it
//! only translates between WinFSP's callback shapes and a [`Library`] that
//! lists folders and opens files.
//!
//! Scope: the user's full folder hierarchy, read-only for committed files.
//! Each folder is listed from the [`Library`] when Windows first asks for it
//! and re-listed after a short freshness window, so files Stashed from the
//! app (or another device) appear on the drive without remounting. If a
//! refresh fails, the last good listing keeps serving (PRD §9: communicate
//! network state rather than going blank). New root-level files may be
//! written; folders, rename and delete are not supported yet.
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
use std::collections::HashMap;
use std::ffi::c_void;
use std::fs::{File, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use windows::Win32::Foundation::{
    STATUS_ACCESS_DENIED, STATUS_INVALID_DEVICE_REQUEST, STATUS_IO_DEVICE_ERROR,
    STATUS_MEDIA_WRITE_PROTECTED, STATUS_NETWORK_UNREACHABLE, STATUS_OBJECT_NAME_COLLISION,
    STATUS_OBJECT_NAME_NOT_FOUND,
};
use windows::Win32::Storage::FileSystem::{
    FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL,
};
use winfsp::filesystem::{
    DirInfo, DirMarker, FileInfo, FileSecurity, FileSystemContext, OpenFileInfo, VolumeInfo,
    WideNameInfo,
};
use winfsp::{FspError, Result as FspResult, U16CStr, U16CString};

#[cfg(debug_assertions)]
fn debug_mount_trace(event: &str) {
    let path = std::env::temp_dir().join("stash-mount-debug.log");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{event}");
    }
}

#[cfg(not(debug_assertions))]
fn debug_mount_trace(_event: &str) {}

/// One child of a STASH folder, as the control plane lists it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Listing {
    Folder { id: String, name: String },
    File { id: String, name: String, size: u64 },
}

/// Where the drive's folders and file bytes come from. Implemented over the
/// authenticated STASH API by the desktop app; faked in tests.
pub trait Library: Send + Sync {
    type Provider: RangeProvider;
    /// Children of a folder; `None` is the top level of the user's STASH.
    fn list(&self, folder_id: Option<&str>) -> Result<Vec<Listing>, ReadError>;
    /// A range provider for one committed file's bytes.
    fn open_file(&self, file_id: &str) -> Self::Provider;
    /// Bytes used against the quota, for Explorer's free-space display.
    fn used_bytes(&self) -> Option<u64> {
        None
    }
    /// Moves a file or folder (and everything under it) to STASH Trash.
    /// Recoverable; nothing is destroyed. Default: not supported.
    fn trash(&self, _target: TrashTarget<'_>) -> Result<(), ReadError> {
        Err(ReadError::Io)
    }
}

/// What a delete on the drive sends to STASH Trash.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrashTarget<'a> {
    File(&'a str),
    Folder(&'a str),
}

/// Tunables for a mounted drive.
#[derive(Clone, Copy, Debug)]
pub struct DriveOptions {
    pub segment_size: u64,
    pub read_timeout: Duration,
    /// How long a folder listing is reused before it is fetched again.
    pub listing_ttl: Duration,
    /// Per-file in-memory segment budget.
    pub file_cache_bytes: u64,
}

impl Default for DriveOptions {
    fn default() -> Self {
        Self {
            segment_size: 1 << 20,
            read_timeout: Duration::from_secs(20),
            listing_ttl: Duration::from_secs(3),
            file_cache_bytes: 64 * 1024 * 1024,
        }
    }
}

/// One open committed file. Shared by every handle to the same file id so
/// repeated opens (Explorer thumbnails, a DAW re-reading headers) reuse the
/// same verified segment cache.
pub struct OpenFile<P: RangeProvider> {
    id: String,
    size: u64,
    cache: Cache,
    provider: P,
}

/// Open files kept for cache reuse beyond this are dropped once no handle
/// holds them.
const OPEN_FILE_KEEP: usize = 64;

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

    fn set_len(&mut self, length: u64) -> Result<(), String> {
        let file = self
            .file
            .as_mut()
            .ok_or_else(|| "STASH write handle is closed.".to_string())?;
        file.set_len(length)
            .map_err(|_| "STASH could not resize its temporary write spool.".to_string())
    }

    fn flush(&mut self) -> Result<(), String> {
        let file = self
            .file
            .as_mut()
            .ok_or_else(|| "STASH write handle is closed.".to_string())?;
        file.flush()
            .map_err(|_| "STASH could not flush its temporary write spool.".to_string())
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


/// An open handle: a folder (`None` is the drive root), a committed
/// read-only file, or one new root-level file being written.
pub enum Handle<P: RangeProvider> {
    Dir(Option<String>),
    File(Arc<OpenFile<P>>),
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

    fn set_size(&mut self, size: u64) -> Result<(), String> {
        let spool = self
            .spool
            .as_mut()
            .ok_or_else(|| "STASH write handle is closed.".to_string())?;
        spool.set_len(size)?;
        self.size = size;
        Ok(())
    }

    fn flush(&mut self) -> Result<(), String> {
        self.spool
            .as_mut()
            .ok_or_else(|| "STASH write handle is closed.".to_string())?
            .flush()
    }
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

#[derive(Clone, Debug, PartialEq, Eq)]
enum NodeKind {
    Folder(String),
    File { id: String, size: u64 },
}

/// A folder child with its on-drive name.
#[derive(Clone, Debug)]
struct Node {
    name: U16CString,
    /// Case-folded name: the volume is case-insensitive, case-preserving.
    folded: String,
    kind: NodeKind,
}

struct CachedDir {
    at: Instant,
    nodes: Arc<Vec<Node>>,
}

/// What resolving a path found. Plain enum — no WinFSP types involved — so
/// path resolution is fully unit-testable.
#[derive(Debug, PartialEq, Eq)]
enum Resolved {
    Dir(Option<String>),
    File { id: String, size: u64 },
    NotFound,
}

/// One directory-enumeration row, before it is written into WinFSP's buffer.
#[derive(Debug, PartialEq, Eq)]
struct DirRow {
    name: Vec<u16>,
    kind: RowKind,
}

#[derive(Debug, PartialEq, Eq)]
enum RowKind {
    Dot,
    Folder,
    File(u64),
}

const DOT: &[u16] = &[b'.' as u16];
const DOT_DOT: &[u16] = &[b'.' as u16, b'.' as u16];

/// Builds the sorted, de-duplicated child table for one folder. Names that
/// cannot exist on a Windows volume are skipped rather than shown broken.
fn nodes_from(listing: Vec<Listing>) -> Vec<Node> {
    let mut nodes: Vec<Node> = listing
        .into_iter()
        .filter_map(|entry| {
            let (name, kind) = match entry {
                Listing::Folder { id, name } => (name, NodeKind::Folder(id)),
                Listing::File { id, name, size } => (name, NodeKind::File { id, size }),
            };
            let valid = !name.is_empty()
                && name != "."
                && name != ".."
                && !name.chars().any(|c| matches!(c, '\\' | '/' | ':' | '\0'));
            if !valid {
                return None;
            }
            Some(Node {
                folded: name.to_lowercase(),
                name: U16CString::from_str(&name).ok()?,
                kind,
            })
        })
        .collect();
    nodes.sort_by(|a, b| a.name.as_slice().cmp(b.name.as_slice()));
    // Case-insensitive volume: keep the first of any names differing by case.
    let mut seen = std::collections::HashSet::new();
    nodes.retain(|node| seen.insert(node.folded.clone()));
    nodes
}

/// Pure enumeration order for one folder: `.` and `..` first for any folder
/// but the root, then children in name order, all strictly after `marker`.
fn dir_rows(is_root: bool, nodes: &[Node], marker: Option<&[u16]>) -> Vec<DirRow> {
    let mut rows = Vec::new();
    let children_from_start = matches!(marker, None) || marker == Some(DOT) || marker == Some(DOT_DOT);
    if !is_root {
        if marker.is_none() {
            rows.push(DirRow { name: DOT.to_vec(), kind: RowKind::Dot });
        }
        if marker.is_none() || marker == Some(DOT) {
            rows.push(DirRow { name: DOT_DOT.to_vec(), kind: RowKind::Dot });
        }
    }
    for node in nodes {
        if !children_from_start && Some(node.name.as_slice()) <= marker {
            continue;
        }
        rows.push(DirRow {
            name: node.name.as_slice().to_vec(),
            kind: match node.kind {
                NodeKind::Folder(_) => RowKind::Folder,
                NodeKind::File { size, .. } => RowKind::File(size),
            },
        });
    }
    rows
}

/// Current time as a Windows FILETIME (100 ns ticks since 1601-01-01).
fn filetime_now() -> u64 {
    const UNIX_EPOCH_AS_FILETIME: u64 = 116_444_736_000_000_000;
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| UNIX_EPOCH_AS_FILETIME + d.as_nanos() as u64 / 100)
        .unwrap_or(UNIX_EPOCH_AS_FILETIME)
}

/// Committed files are read-only; the root accepts new root-level files and
/// the injected sink owns the upload policy.
pub struct StashFileSystemContext<L: Library> {
    library: L,
    options: DriveOptions,
    dirs: Mutex<HashMap<Option<String>, CachedDir>>,
    open_files: Mutex<HashMap<String, Arc<OpenFile<L::Provider>>>>,
    /// Shown as every item's date until the control plane records one.
    mounted_at: u64,
    write_sink: Arc<dyn WriteSink>,
    pending_names: Mutex<std::collections::HashSet<Vec<u16>>>,
    /// "file:<id>" / "folder:<id>" marked for delete, awaiting cleanup.
    pending_deletes: Mutex<std::collections::HashSet<String>>,
}

impl<L: Library> StashFileSystemContext<L> {
    pub fn new(library: L, options: DriveOptions) -> Self {
        Self::new_with_write_sink(library, options, Arc::new(RejectWriteSink))
    }

    pub fn new_with_write_sink(library: L, options: DriveOptions, write_sink: Arc<dyn WriteSink>) -> Self {
        Self {
            library,
            options,
            dirs: Mutex::new(HashMap::new()),
            open_files: Mutex::new(HashMap::new()),
            mounted_at: filetime_now(),
            write_sink,
            pending_names: Mutex::new(std::collections::HashSet::new()),
            pending_deletes: Mutex::new(std::collections::HashSet::new()),
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

    /// A folder's children: the cached listing while fresh, otherwise a new
    /// one from the library. On a failed refresh the last good listing is
    /// served instead of an error. No lock is held across the network call.
    fn children(&self, folder: Option<&str>) -> Result<Arc<Vec<Node>>, ReadError> {
        let key = folder.map(str::to_string);
        if let Some(cached) = self.dirs.lock().expect("dir cache lock poisoned").get(&key) {
            if cached.at.elapsed() < self.options.listing_ttl {
                return Ok(cached.nodes.clone());
            }
        }
        match self.library.list(folder) {
            Ok(listing) => {
                let nodes = Arc::new(nodes_from(listing));
                self.dirs
                    .lock()
                    .expect("dir cache lock poisoned")
                    .insert(key, CachedDir { at: Instant::now(), nodes: nodes.clone() });
                Ok(nodes)
            }
            Err(error) => match self.dirs.lock().expect("dir cache lock poisoned").get(&key) {
                Some(stale) => Ok(stale.nodes.clone()),
                None => Err(error),
            },
        }
    }

    /// Pure path resolution against the (lazily listed) folder tree.
    fn resolve(&self, file_name: &U16CStr) -> Result<Resolved, ReadError> {
        let Ok(path) = file_name.to_string() else {
            return Ok(Resolved::NotFound);
        };
        let parts: Vec<&str> = path.split('\\').filter(|part| !part.is_empty()).collect();
        let mut folder: Option<String> = None;
        for (index, part) in parts.iter().enumerate() {
            let folded = part.to_lowercase();
            let nodes = self.children(folder.as_deref())?;
            let Some(node) = nodes.iter().find(|node| node.folded == folded) else {
                return Ok(Resolved::NotFound);
            };
            match &node.kind {
                NodeKind::Folder(id) => folder = Some(id.clone()),
                NodeKind::File { id, size } if index + 1 == parts.len() => {
                    return Ok(Resolved::File { id: id.clone(), size: *size });
                }
                NodeKind::File { .. } => return Ok(Resolved::NotFound),
            }
        }
        Ok(Resolved::Dir(folder))
    }

    /// The Trash key for a handle; the drive root and unsubmitted writes have none.
    fn delete_key(context: &Handle<L::Provider>) -> Option<String> {
        match context {
            Handle::Dir(Some(id)) => Some(format!("folder:{id}")),
            Handle::File(file) => Some(format!("file:{}", file.id)),
            Handle::Dir(None) | Handle::Pending(_) => None,
        }
    }

    /// Records or clears a pending delete (Windows' SetDelete step).
    fn mark_delete(&self, context: &Handle<L::Provider>, delete: bool) -> Result<(), ReadError> {
        let key = Self::delete_key(context).ok_or(ReadError::Io)?;
        let mut pending = self.pending_deletes.lock().expect("pending deletes lock poisoned");
        if delete { pending.insert(key); } else { pending.remove(&key); }
        Ok(())
    }

    /// Carries out a pending delete (Windows' Cleanup step): the item goes to
    /// STASH Trash and every cached listing is dropped so it disappears now.
    fn perform_delete(&self, context: &Handle<L::Provider>) -> Result<(), ReadError> {
        let Some(key) = Self::delete_key(context) else { return Ok(()) };
        if !self.pending_deletes.lock().expect("pending deletes lock poisoned").remove(&key) {
            return Ok(());
        }
        let result = match context {
            Handle::Dir(Some(id)) => self.library.trash(TrashTarget::Folder(id)),
            Handle::File(file) => self.library.trash(TrashTarget::File(&file.id)),
            _ => Ok(()),
        };
        self.dirs.lock().expect("dir cache lock poisoned").clear();
        if let Handle::File(file) = context {
            self.open_files.lock().expect("open file lock poisoned").remove(&file.id);
        }
        result
    }

    /// The shared open-file state for a committed file id.
    fn open_file(&self, id: &str, size: u64) -> Arc<OpenFile<L::Provider>> {
        let mut open = self.open_files.lock().expect("open file lock poisoned");
        if let Some(file) = open.get(id) {
            if file.size == size {
                return file.clone();
            }
        }
        if open.len() >= OPEN_FILE_KEEP {
            open.retain(|_, file| Arc::strong_count(file) > 1);
        }
        let file = Arc::new(OpenFile {
            id: id.to_string(),
            size,
            cache: Cache::new(self.options.segment_size, self.options.read_timeout, size, self.options.file_cache_bytes),
            provider: self.library.open_file(id),
        });
        open.insert(id.to_string(), file.clone());
        file
    }

    fn times(&self, info: &mut FileInfo) {
        info.creation_time = self.mounted_at;
        info.last_access_time = self.mounted_at;
        info.last_write_time = self.mounted_at;
        info.change_time = self.mounted_at;
    }

    fn dir_info(&self) -> FileInfo {
        let mut info = FileInfo::default();
        info.file_attributes = FILE_ATTRIBUTE_DIRECTORY.0;
        self.times(&mut info);
        info
    }

    fn file_info(&self, size: u64) -> FileInfo {
        let mut info = FileInfo::default();
        // Not READONLY: Windows refuses to delete read-only files, and a
        // Stashed file can be moved to Trash. Edits are still refused in `write`.
        info.file_attributes = FILE_ATTRIBUTE_NORMAL.0;
        info.file_size = size;
        info.allocation_size = size;
        self.times(&mut info);
        info
    }

    /// Pure read: bytes for one open committed file.
    fn read_file(&self, file: &OpenFile<L::Provider>, buffer: &mut [u8], offset: u64) -> FspResult<u32> {
        if offset >= file.size {
            return Ok(0);
        }
        let length = (buffer.len() as u64).min(file.size - offset);
        let bytes = file
            .cache
            .read(&file.provider, offset, length)
            .map_err(read_error_to_fsp)?;
        buffer[..bytes.len()].copy_from_slice(&bytes);
        Ok(bytes.len() as u32)
    }

    /// Whether a root-level name is already taken by a listed item.
    fn root_has(&self, name: &[u16]) -> Result<bool, ReadError> {
        let folded = String::from_utf16_lossy(name).to_lowercase();
        Ok(self.children(None)?.iter().any(|node| node.folded == folded))
    }
}

impl<L: Library> FileSystemContext for StashFileSystemContext<L> {
    type FileContext = Handle<L::Provider>;

    fn get_security_by_name(
        &self,
        file_name: &U16CStr,
        _security_descriptor: Option<&mut [c_void]>,
        _reparse_point_resolver: impl FnOnce(&U16CStr) -> Option<FileSecurity>,
    ) -> FspResult<FileSecurity> {
        let attributes = match self.resolve(file_name).map_err(read_error_to_fsp)? {
            Resolved::Dir(_) => FILE_ATTRIBUTE_DIRECTORY.0,
            Resolved::File { .. } => FILE_ATTRIBUTE_NORMAL.0,
            Resolved::NotFound => return Err(FspError::NTSTATUS(STATUS_OBJECT_NAME_NOT_FOUND.0)),
        };
        Ok(FileSecurity { reparse: false, sz_security_descriptor: 0, attributes })
    }

    fn open(
        &self,
        file_name: &U16CStr,
        _create_options: u32,
        _granted_access: u32,
        file_info: &mut OpenFileInfo,
    ) -> FspResult<Self::FileContext> {
        match self.resolve(file_name).map_err(read_error_to_fsp)? {
            Resolved::Dir(folder) => {
                *file_info.as_mut() = self.dir_info();
                Ok(Handle::Dir(folder))
            }
            Resolved::File { id, size } => {
                *file_info.as_mut() = self.file_info(size);
                Ok(Handle::File(self.open_file(&id, size)))
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
            debug_mount_trace("create: rejected root");
            return Err(FspError::NTSTATUS(STATUS_ACCESS_DENIED.0));
        };
        if name.is_empty()
            || create_options & FILE_DIRECTORY_FILE != 0
            || file_attributes & FILE_ATTRIBUTE_DIRECTORY_VALUE != 0
        {
            debug_mount_trace("create: rejected directory or unsafe name");
            return Err(FspError::NTSTATUS(STATUS_ACCESS_DENIED.0));
        }
        if self.root_has(&name).map_err(read_error_to_fsp)? {
            debug_mount_trace("create: rejected existing name");
            return Err(FspError::NTSTATUS(STATUS_OBJECT_NAME_COLLISION.0));
        }
        if !self.reserve_pending_name(&name) {
            debug_mount_trace("create: rejected pending collision");
            return Err(FspError::NTSTATUS(STATUS_OBJECT_NAME_COLLISION.0));
        }
        let spool = match self.write_sink.begin(&name) {
            Ok(spool) => spool,
            Err(_) => {
                // Reservation precedes sink creation so the check-and-reserve
                // is atomic; a failed begin must roll it back immediately.
                self.release_pending_name(&name);
                debug_mount_trace("create: spool begin failed");
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
        debug_mount_trace("create: pending handle created");
        let mut info = FileInfo::default();
        info.file_attributes = FILE_ATTRIBUTE_NORMAL.0;
        *file_info.as_mut() = info;
        Ok(handle)
    }

    fn cleanup(&self, context: &Self::FileContext, _file_name: Option<&U16CStr>, flags: u32) {
        const FSP_CLEANUP_DELETE: u32 = 0x01;
        if flags & FSP_CLEANUP_DELETE != 0 {
            // Windows can't report a cleanup failure; a failed Trash call
            // simply leaves the item listed on the next refresh.
            if self.perform_delete(context).is_err() {
                debug_mount_trace("cleanup: trash failed");
            }
        }
        if let Handle::Pending(pending) = context {
            debug_mount_trace("cleanup: pending handle");
            if let Ok(mut pending) = pending.lock() {
                pending.finalize(self.write_sink.as_ref(), &self.pending_names);
            }
        }
    }

    fn close(&self, context: Self::FileContext) {
        if let Handle::Pending(pending) = &context {
            debug_mount_trace("close: pending handle");
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
            Handle::Dir(_) => self.dir_info(),
            Handle::File(file) => self.file_info(file.size),
            Handle::Pending(pending) => {
                let mut info = FileInfo::default();
                info.file_attributes = FILE_ATTRIBUTE_NORMAL.0;
                info.file_size = pending.lock().expect("pending write lock poisoned").size;
                info.allocation_size = info.file_size;
                info
            }
        };
        Ok(())
    }

    fn read(&self, context: &Self::FileContext, buffer: &mut [u8], offset: u64) -> FspResult<u32> {
        match context {
            Handle::File(file) => self.read_file(file, buffer, offset),
            Handle::Pending(_) => Err(FspError::NTSTATUS(STATUS_ACCESS_DENIED.0)),
            Handle::Dir(_) => Err(FspError::NTSTATUS(STATUS_INVALID_DEVICE_REQUEST.0)),
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
        debug_mount_trace("write: bytes accepted");
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

    fn flush(&self, context: Option<&Self::FileContext>, file_info: &mut FileInfo) -> FspResult<()> {
        let Some(Handle::Pending(pending)) = context else {
            return Err(FspError::NTSTATUS(STATUS_INVALID_DEVICE_REQUEST.0));
        };
        let mut pending = pending
            .lock()
            .map_err(|_| FspError::NTSTATUS(STATUS_IO_DEVICE_ERROR.0))?;
        pending
            .flush()
            .map_err(|_| FspError::NTSTATUS(STATUS_IO_DEVICE_ERROR.0))?;
        file_info.file_attributes = FILE_ATTRIBUTE_NORMAL.0;
        file_info.file_size = pending.size;
        file_info.allocation_size = pending.size;
        Ok(())
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
        context: &Self::FileContext,
        _file_name: &U16CStr,
        delete_file: bool,
    ) -> FspResult<()> {
        // Deleting on S: moves the item to STASH Trash (recoverable). The
        // drive root and not-yet-submitted writes can't be deleted.
        self.mark_delete(context, delete_file)
            .map_err(|_| FspError::NTSTATUS(STATUS_ACCESS_DENIED.0))
    }

    /// Explorer and most apps set attributes and times after copying or
    /// touching a file. STASH doesn't store either yet, so accept the call
    /// and report the item's current info instead of failing the copy.
    #[allow(clippy::too_many_arguments)]
    fn set_basic_info(
        &self,
        context: &Self::FileContext,
        _file_attributes: u32,
        _creation_time: u64,
        _last_access_time: u64,
        _last_write_time: u64,
        _last_change_time: u64,
        file_info: &mut FileInfo,
    ) -> FspResult<()> {
        self.get_file_info(context, file_info)
    }

    fn set_file_size(
        &self,
        context: &Self::FileContext,
        new_size: u64,
        _set_allocation_size: bool,
        file_info: &mut FileInfo,
    ) -> FspResult<()> {
        let Handle::Pending(pending) = context else {
            return Err(FspError::NTSTATUS(STATUS_MEDIA_WRITE_PROTECTED.0));
        };
        let mut pending = pending
            .lock()
            .map_err(|_| FspError::NTSTATUS(STATUS_IO_DEVICE_ERROR.0))?;
        pending
            .set_size(new_size)
            .map_err(|_| FspError::NTSTATUS(STATUS_IO_DEVICE_ERROR.0))?;
        file_info.file_attributes = FILE_ATTRIBUTE_NORMAL.0;
        file_info.file_size = pending.size;
        file_info.allocation_size = pending.size;
        Ok(())
    }

    fn read_directory(
        &self,
        context: &Self::FileContext,
        _pattern: Option<&U16CStr>,
        marker: DirMarker,
        buffer: &mut [u8],
    ) -> FspResult<u32> {
        let Handle::Dir(folder) = context else {
            return Err(FspError::NTSTATUS(STATUS_INVALID_DEVICE_REQUEST.0));
        };
        let nodes = self.children(folder.as_deref()).map_err(read_error_to_fsp)?;
        let mut cursor = 0u32;
        let mut dir_info: DirInfo<255> = DirInfo::new();
        for row in dir_rows(folder.is_none(), &nodes, marker.inner()) {
            dir_info.reset();
            *dir_info.file_info_mut() = match row.kind {
                RowKind::Dot | RowKind::Folder => self.dir_info(),
                RowKind::File(size) => self.file_info(size),
            };
            dir_info.set_name_raw(row.name.as_slice())?;
            if !dir_info.append_to_buffer(buffer, &mut cursor) {
                return Ok(cursor);
            }
        }
        DirInfo::<255>::finalize_buffer(buffer, &mut cursor);
        Ok(cursor)
    }

    fn get_volume_info(&self, out_volume_info: &mut VolumeInfo) -> FspResult<()> {
        // Nominal 1 TB ceiling matches the PRD's private-beta per-user quota.
        let total: u64 = 1_000_000_000_000;
        let used = self.library.used_bytes().unwrap_or(0);
        out_volume_info.total_size = total;
        out_volume_info.free_size = total.saturating_sub(used);
        out_volume_info.set_volume_label("STASH");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    /// A `RangeProvider` over a fixed in-memory buffer, standing in for the
    /// real `stash-s3-provider::HttpRangeProvider`.
    struct FixedProvider {
        data: Vec<u8>,
    }

    impl RangeProvider for FixedProvider {
        fn fetch(&self, offset: u64, length: u64, _timeout: Duration) -> Result<stash_core::Segment, ReadError> {
            let start = offset as usize;
            let end = (start + length as usize).min(self.data.len());
            Ok(stash_core::Segment { bytes: self.data[start..end].to_vec() })
        }
    }

    /// An in-memory STASH: folder id → children, file id → bytes.
    #[derive(Default)]
    struct FakeLibrary {
        folders: Mutex<HashMap<Option<String>, Vec<Listing>>>,
        bytes: HashMap<String, Vec<u8>>,
        list_calls: AtomicUsize,
        opens: AtomicUsize,
        offline: AtomicBool,
        trashed: Mutex<Vec<String>>,
    }

    impl Library for FakeLibrary {
        type Provider = FixedProvider;
        fn list(&self, folder_id: Option<&str>) -> Result<Vec<Listing>, ReadError> {
            self.list_calls.fetch_add(1, Ordering::SeqCst);
            if self.offline.load(Ordering::SeqCst) {
                return Err(ReadError::Offline);
            }
            Ok(self.folders.lock().unwrap().get(&folder_id.map(str::to_string)).cloned().unwrap_or_default())
        }
        fn open_file(&self, file_id: &str) -> FixedProvider {
            self.opens.fetch_add(1, Ordering::SeqCst);
            FixedProvider { data: self.bytes.get(file_id).cloned().unwrap_or_default() }
        }
        fn used_bytes(&self) -> Option<u64> {
            Some(42)
        }
        fn trash(&self, target: TrashTarget<'_>) -> Result<(), ReadError> {
            self.trashed.lock().unwrap().push(format!("{target:?}"));
            // Trashed items no longer list, like the real control plane.
            let id = match target { TrashTarget::File(id) | TrashTarget::Folder(id) => id.to_string() };
            for children in self.folders.lock().unwrap().values_mut() {
                children.retain(|child| !matches!(child, Listing::File { id: i, .. } | Listing::Folder { id: i, .. } if *i == id));
            }
            Ok(())
        }
    }

    fn folder(id: &str, name: &str) -> Listing {
        Listing::Folder { id: id.into(), name: name.into() }
    }
    fn file(id: &str, name: &str, size: u64) -> Listing {
        Listing::File { id: id.into(), name: name.into(), size }
    }

    /// `\KSHMR Vol 5\Kicks\Kick_G#_128.wav`, `\logo.svg`.
    fn library() -> FakeLibrary {
        let mut lib = FakeLibrary::default();
        {
            let mut folders = lib.folders.lock().unwrap();
            folders.insert(None, vec![folder("pack", "KSHMR Vol 5"), file("logo", "logo.svg", 3)]);
            folders.insert(Some("pack".into()), vec![folder("kicks", "Kicks")]);
            folders.insert(Some("kicks".into()), vec![file("kick", "Kick_G#_128.wav", 17)]);
        }
        lib.bytes.insert("kick".into(), b"hello stash world".to_vec());
        lib.bytes.insert("logo".into(), b"svg".to_vec());
        lib
    }

    fn fs_with(lib: FakeLibrary, ttl: Duration) -> StashFileSystemContext<FakeLibrary> {
        StashFileSystemContext::new(lib, DriveOptions { segment_size: 8, listing_ttl: ttl, ..DriveOptions::default() })
    }

    fn fs() -> StashFileSystemContext<FakeLibrary> {
        fs_with(library(), Duration::from_secs(60))
    }

    fn path(s: &str) -> U16CString {
        U16CString::from_str(s).unwrap()
    }

    fn names(rows: &[DirRow]) -> Vec<String> {
        rows.iter().map(|row| String::from_utf16_lossy(&row.name)).collect()
    }

    #[test]
    fn root_resolves_to_the_top_level_folder() {
        assert_eq!(fs().resolve(&path("\\")).unwrap(), Resolved::Dir(None));
    }

    #[test]
    fn nested_folders_and_files_resolve_at_any_depth() {
        let fs = fs();
        assert_eq!(fs.resolve(&path("\\KSHMR Vol 5")).unwrap(), Resolved::Dir(Some("pack".into())));
        assert_eq!(fs.resolve(&path("\\KSHMR Vol 5\\Kicks")).unwrap(), Resolved::Dir(Some("kicks".into())));
        assert_eq!(
            fs.resolve(&path("\\KSHMR Vol 5\\Kicks\\Kick_G#_128.wav")).unwrap(),
            Resolved::File { id: "kick".into(), size: 17 }
        );
    }

    #[test]
    fn names_match_case_insensitively_like_a_windows_volume() {
        assert_eq!(
            fs().resolve(&path("\\kshmr vol 5\\KICKS\\kick_g#_128.WAV")).unwrap(),
            Resolved::File { id: "kick".into(), size: 17 }
        );
    }

    #[test]
    fn missing_paths_and_paths_through_files_are_not_found() {
        let fs = fs();
        assert_eq!(fs.resolve(&path("\\missing.wav")).unwrap(), Resolved::NotFound);
        assert_eq!(fs.resolve(&path("\\logo.svg\\inside")).unwrap(), Resolved::NotFound);
    }

    #[test]
    fn listings_are_reused_while_fresh() {
        let fs = fs();
        fs.resolve(&path("\\logo.svg")).unwrap();
        fs.resolve(&path("\\logo.svg")).unwrap();
        assert_eq!(fs.library.list_calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn files_stashed_after_mounting_appear_once_the_listing_is_stale() {
        let fs = fs_with(library(), Duration::ZERO);
        assert_eq!(fs.resolve(&path("\\new.wav")).unwrap(), Resolved::NotFound);
        fs.library.folders.lock().unwrap().get_mut(&None).unwrap().push(file("new", "new.wav", 5));
        assert_eq!(fs.resolve(&path("\\new.wav")).unwrap(), Resolved::File { id: "new".into(), size: 5 });
    }

    #[test]
    fn a_failed_refresh_keeps_serving_the_last_good_listing() {
        let fs = fs_with(library(), Duration::ZERO);
        fs.resolve(&path("\\logo.svg")).unwrap();
        fs.library.offline.store(true, Ordering::SeqCst);
        assert_eq!(fs.resolve(&path("\\logo.svg")).unwrap(), Resolved::File { id: "logo".into(), size: 3 });
    }

    #[test]
    fn offline_with_nothing_cached_is_a_network_error() {
        let lib = library();
        lib.offline.store(true, Ordering::SeqCst);
        let err = fs_with(lib, Duration::ZERO).resolve(&path("\\logo.svg")).unwrap_err();
        assert_eq!(read_error_to_fsp(err).to_ntstatus(), STATUS_NETWORK_UNREACHABLE.0);
    }

    #[test]
    fn root_enumeration_has_no_dot_entries_and_is_sorted() {
        let fs = fs();
        let nodes = fs.children(None).unwrap();
        assert_eq!(names(&dir_rows(true, &nodes, None)), vec!["KSHMR Vol 5", "logo.svg"]);
    }

    #[test]
    fn subfolder_enumeration_starts_with_dot_entries_and_resumes_after_markers() {
        let fs = fs();
        let nodes = fs.children(Some("pack")).unwrap();
        assert_eq!(names(&dir_rows(false, &nodes, None)), vec![".", "..", "Kicks"]);
        assert_eq!(names(&dir_rows(false, &nodes, Some(DOT))), vec!["..", "Kicks"]);
        assert_eq!(names(&dir_rows(false, &nodes, Some(DOT_DOT))), vec!["Kicks"]);
        let kicks = path("Kicks");
        assert!(dir_rows(false, &nodes, Some(kicks.as_slice())).is_empty());
    }

    #[test]
    fn enumeration_rows_carry_folder_and_file_kinds() {
        let fs = fs();
        let nodes = fs.children(None).unwrap();
        let rows = dir_rows(true, &nodes, None);
        assert_eq!(rows[0].kind, RowKind::Folder);
        assert_eq!(rows[1].kind, RowKind::File(3));
    }

    #[test]
    fn unrepresentable_and_case_duplicate_names_are_skipped() {
        let nodes = nodes_from(vec![
            file("a", "ok.wav", 1),
            file("b", "OK.wav", 1),
            file("c", "bad:name.wav", 1),
            folder("d", ".."),
            file("e", "", 1),
        ]);
        let shown: Vec<String> = nodes.iter().map(|n| n.name.to_string_lossy()).collect();
        assert_eq!(shown, vec!["OK.wav"]);
    }

    #[test]
    fn nested_file_reads_through_the_core_cache() {
        let fs = fs();
        let open = fs.open_file("kick", 17);
        let mut buffer = [0u8; 5];
        assert_eq!(fs.read_file(&open, &mut buffer, 6).unwrap(), 5);
        assert_eq!(&buffer, b"stash");
        assert_eq!(fs.read_file(&open, &mut buffer, 100).unwrap(), 0);
    }

    #[test]
    fn reopening_a_file_reuses_its_cache() {
        let fs = fs();
        let first = fs.open_file("kick", 17);
        let second = fs.open_file("kick", 17);
        assert!(Arc::ptr_eq(&first, &second));
        assert_eq!(fs.library.opens.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn security_lookup_reports_folders_and_read_only_files() {
        let fs = fs();
        let dir = fs.get_security_by_name(&path("\\KSHMR Vol 5"), None, |_| None).unwrap();
        assert_eq!(dir.attributes, FILE_ATTRIBUTE_DIRECTORY.0);
        let file = fs.get_security_by_name(&path("\\KSHMR Vol 5\\Kicks\\Kick_G#_128.wav"), None, |_| None).unwrap();
        // Not read-only: Windows refuses to delete read-only files.
        assert_eq!(file.attributes, FILE_ATTRIBUTE_NORMAL.0);
        assert!(fs.get_security_by_name(&path("\\missing.wav"), None, |_| None).is_err());
    }

    #[test]
    fn items_get_a_real_date_instead_of_1601() {
        let info = fs().file_info(1);
        // 2020-01-01 as FILETIME.
        assert!(info.last_write_time > 132_223_104_000_000_000);
    }

    #[test]
    fn deleting_a_file_sends_it_to_trash_and_it_disappears_immediately() {
        let fs = fs(); // 60 s listing TTL: only cache invalidation can hide it.
        let handle = Handle::File(fs.open_file("kick", 17));
        assert!(fs.resolve(&path("\\KSHMR Vol 5\\Kicks\\Kick_G#_128.wav")).unwrap() != Resolved::NotFound);
        fs.mark_delete(&handle, true).unwrap();
        fs.perform_delete(&handle).unwrap();
        assert_eq!(*fs.library.trashed.lock().unwrap(), vec![r#"File("kick")"#]);
        assert_eq!(fs.resolve(&path("\\KSHMR Vol 5\\Kicks\\Kick_G#_128.wav")).unwrap(), Resolved::NotFound);
    }

    #[test]
    fn deleting_a_folder_trashes_the_folder() {
        let fs = fs();
        let handle = Handle::Dir(Some("pack".into()));
        fs.mark_delete(&handle, true).unwrap();
        fs.perform_delete(&handle).unwrap();
        assert_eq!(*fs.library.trashed.lock().unwrap(), vec![r#"Folder("pack")"#]);
        assert_eq!(fs.resolve(&path("\\KSHMR Vol 5")).unwrap(), Resolved::NotFound);
    }

    #[test]
    fn cleanup_without_a_pending_delete_trashes_nothing() {
        let fs = fs();
        let handle = Handle::File(fs.open_file("kick", 17));
        fs.perform_delete(&handle).unwrap();
        fs.mark_delete(&handle, true).unwrap();
        fs.mark_delete(&handle, false).unwrap(); // Windows may retract a delete.
        fs.perform_delete(&handle).unwrap();
        assert!(fs.library.trashed.lock().unwrap().is_empty());
    }

    #[test]
    fn the_drive_root_can_never_be_deleted() {
        let fs = fs();
        assert!(fs.mark_delete(&Handle::Dir(None), true).is_err());
    }

    #[test]
    fn root_collision_check_is_case_insensitive() {
        let fs = fs();
        assert!(fs.root_has(path("LOGO.SVG").as_slice()).unwrap());
        assert!(!fs.root_has(path("new.wav").as_slice()).unwrap());
    }

    // --- Root-level write path (unchanged behaviour) ---

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
        let fs = StashFileSystemContext::new_with_write_sink(library(), DriveOptions::default(), Arc::new(FailingBeginSink));
        let name = path("retry.wav");
        assert!(fs.write_sink.begin(name.as_slice()).is_err());
        assert!(fs.reserve_pending_name(name.as_slice()));
        fs.release_pending_name(name.as_slice());
    }

    #[test]
    fn concurrent_same_name_reservation_allows_exactly_one_handle() {
        let fs = Arc::new(fs());
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
        let sink = CountingSink { submissions: AtomicUsize::new(0) };
        let name = path("failed-write.wav");
        let fs = fs();
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
    fn pending_spool_accepts_windows_style_resize_before_write() {
        let spool = WriteSpool::create_for_mount(path("resize.wav").as_slice()).unwrap();
        let mut pending = PendingWrite { spool: Some(spool), reserved_name: None, submitted: false, failure: None, size: 0 };
        pending.set_size(8).unwrap();
        pending.write_at(b"ok", 2, false).unwrap();
        assert_eq!(pending.size, 8);
        let spool = pending.spool.take().unwrap();
        let spool_path = spool.path().to_path_buf();
        drop(spool);
        assert!(!spool_path.exists());
    }

    #[test]
    fn cleanup_and_submission_are_idempotent() {
        let sink = CountingSink { submissions: AtomicUsize::new(0) };
        let spool = WriteSpool::create_for_mount(path("once.wav").as_slice()).unwrap();
        let path = spool.path().to_path_buf();
        let mut pending = PendingWrite { spool: Some(spool), reserved_name: None, submitted: false, failure: None, size: 0 };
        let pending_names = Mutex::new(std::collections::HashSet::new());
        pending.finalize(&sink, &pending_names);
        pending.finalize(&sink, &pending_names);
        assert_eq!(sink.submissions.load(Ordering::SeqCst), 1);
        assert!(!path.exists());
    }

    #[test]
    fn successful_cleanup_releases_name_for_a_retry() {
        let sink = CountingSink { submissions: AtomicUsize::new(0) };
        let fs = fs();
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
}
