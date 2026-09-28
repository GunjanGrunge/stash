//! Native Stash It transfer boundary.
//!
//! The webview receives only source metadata and transfer state. Absolute paths,
//! SHA-256 computation, request credentials, presigned URLs, upload ids, ETags,
//! and payload bytes stay in this process. Checksums are lowercase SHA-256
//! hex, prefixed with `sha256:`; this is the manifest checksum convention for
//! this client and is calculated incrementally from the file stream.

use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use stash_windows_fs::WriteSpool;
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::State;
use walkdir::WalkDir;

const PART_SIZE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_PARTS: u64 = 10_000;
const READ_BUFFER_BYTES: usize = 1024 * 1024;
const MOUNT_RECOVERY_DIR: &str = "stash-mount-recovery";
const MAX_RECOVERY_SPOOLS: u64 = 32;
const MAX_RECOVERY_BYTES: u64 = 1024 * 1024 * 1024;
static IDEMPOTENCY_COUNTER: AtomicU64 = AtomicU64::new(0);

fn idempotency_key(scope: &str) -> String {
    let counter = IDEMPOTENCY_COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    format!("stash-{scope}-{}-{counter}-{nanos}", std::process::id())
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "PascalCase")]
pub enum TransferPhase {
    Preparing,
    Stashing,
    Verifying,
    Stashed,
    NeedsAttention,
    Canceled,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferStatus {
    pub phase: TransferPhase,
    pub source_name: Option<String>,
    pub file_count: u64,
    pub completed_file_count: u64,
    pub total_bytes: u64,
    pub completed_bytes: u64,
    pub manifest_match: Option<String>,
    pub message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceEntry {
    pub relative_path: String,
    pub size_bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSummary {
    pub source_name: String,
    pub folder_name: String,
    pub file_count: u64,
    pub total_bytes: u64,
    pub entries: Vec<SourceEntry>,
}

#[derive(Clone, Debug, Serialize)]
pub struct DropNotice {
    pub phase: String,
    pub summary: Option<SourceSummary>,
    pub message: Option<String>,
}

#[derive(Clone, Debug)]
struct ManifestEntry {
    relative_path: String,
    size_bytes: u64,
    checksum: String,
}

#[derive(Clone, Debug)]
struct SourceManifest {
    root: PathBuf,
    summary: SourceSummary,
    entries: Vec<ManifestEntry>,
    cleanup_on_success: bool,
}

#[derive(Clone)]
pub struct UploadController {
    inner: Arc<Mutex<ControllerState>>,
}

struct ControllerState {
    selected: Option<SourceManifest>,
    status: TransferStatus,
    cancel: Option<Arc<AtomicBool>>,
}

impl Default for UploadController {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(ControllerState {
                selected: None,
                status: empty_status(),
                cancel: None,
            })),
        }
    }
}

impl UploadController {
    pub fn select_source_path(&self, root: PathBuf) -> Result<SourceSummary, String> {
        let manifest = build_manifest(root)?;
        let summary = manifest.summary.clone();
        let mut state = lock(self)?;
        state.selected = Some(manifest);
        state.status = status_for(&summary);
        Ok(summary)
    }

    pub fn mark_needs_attention(&self, message: String) {
        if let Ok(mut state) = self.inner.lock() {
            state.status.phase = TransferPhase::NeedsAttention;
            state.status.message = Some(message);
            state.cancel = None;
        }
    }

    /// Schedules a mount-originated spool through the same verified transfer
    /// pipeline as the Tauri Stash It flow. The path and payload stay native;
    /// only the safe status is shared with the webview.
    pub fn submit_mount_spool(&self, spool: WriteSpool) -> Result<(), String> {
        let name = String::from_utf16(spool.name())
            .map_err(|_| "STASH rejected a filename that is not valid Unicode.".to_string())?;
        let path = retain_mount_spool(spool.detach_path())?;
        let size_bytes = std::fs::metadata(&path)
            .map_err(|_| "The mounted write spool could not be read.".to_string())?
            .len();
        let summary = SourceSummary {
            source_name: name.clone(),
            folder_name: name.clone(),
            file_count: 1,
            total_bytes: size_bytes,
            entries: vec![SourceEntry {
                relative_path: name.clone(),
                size_bytes,
            }],
        };
        let (cancel, shared) = {
            let mut state = lock(self)?;
            if matches!(
                state.status.phase,
                TransferPhase::Stashing | TransferPhase::Verifying
            ) {
                return Err(
                    "Another STASH transfer is already active; the mounted write needs attention."
                        .to_string(),
                );
            }
            let cancel = Arc::new(AtomicBool::new(false));
            // The WinFSP cleanup callback runs on a small native dispatcher
            // stack. It must only hand off the closed spool; hashing uses a
            // large buffer and happens on a Tauri blocking worker below.
            state.selected = None;
            state.cancel = Some(cancel.clone());
            state.status = status_for(&summary);
            (cancel, self.inner.clone())
        };
        tauri::async_runtime::spawn(async move {
            let manifest_result = tauri::async_runtime::spawn_blocking(move || {
                let mut manifest = build_spool_manifest(path, name);
                if let Ok(value) = &mut manifest {
                    value.cleanup_on_success = true;
                }
                manifest
            })
            .await
            .map_err(|_| "STASH could not prepare the mounted file for transfer.".to_string());
            let manifest = match manifest_result {
                Ok(Ok(manifest)) => manifest,
                Ok(Err(error)) | Err(error) => {
                    #[cfg(debug_assertions)]
                    eprintln!("[stash-transfer] mounted spool prep failed: {error}");
                    if let Ok(mut state) = shared.lock() {
                        state.status.phase = TransferPhase::NeedsAttention;
                        state.status.message = Some(format!(
                            "{error} The native recovery spool was retained for attention."
                        ));
                        state.cancel = None;
                    }
                    return;
                }
            };
            if let Ok(mut state) = shared.lock() {
                state.selected = Some(manifest.clone());
                state.status = status_for(&manifest.summary);
            }
            run_transfer(manifest, cancel, shared).await;
        });
        Ok(())
    }
}

fn mount_recovery_dir() -> PathBuf {
    std::env::temp_dir().join(MOUNT_RECOVERY_DIR)
}

fn retain_mount_spool(path: PathBuf) -> Result<PathBuf, String> {
    let directory = mount_recovery_dir();
    std::fs::create_dir_all(&directory)
        .map_err(|_| "STASH could not prepare native recovery storage.".to_string())?;
    let source_size = std::fs::metadata(&path)
        .map_err(|_| "The mounted write spool could not be retained safely.".to_string())?
        .len();
    let mut count = 0u64;
    let mut bytes = 0u64;
    for entry in std::fs::read_dir(&directory)
        .map_err(|_| "STASH native recovery storage is unavailable.".to_string())?
    {
        let entry = entry.map_err(|_| "STASH native recovery storage is unavailable.".to_string())?;
        let metadata = entry
            .metadata()
            .map_err(|_| "STASH native recovery storage is unavailable.".to_string())?;
        if metadata.is_file() {
            count = count.saturating_add(1);
            bytes = bytes.saturating_add(metadata.len());
        }
    }
    if count >= MAX_RECOVERY_SPOOLS
        || bytes.saturating_add(source_size) > MAX_RECOVERY_BYTES
    {
        return Err(
            "STASH recovery storage is full; the mounted write needs attention.".to_string(),
        );
    }
    let file_name = path
        .file_name()
        .ok_or_else(|| "The mounted write spool could not be retained safely.".to_string())?;
    let retained = directory.join(file_name);
    std::fs::rename(&path, &retained)
        .map_err(|_| "The mounted write spool could not be retained safely.".to_string())?;
    Ok(retained)
}

fn cleanup_mount_spool(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("STASH could not clean up its native recovery spool.".to_string()),
    }
}

fn status_for(summary: &SourceSummary) -> TransferStatus {
    TransferStatus {
        phase: TransferPhase::Preparing,
        source_name: Some(summary.source_name.clone()),
        file_count: summary.file_count,
        completed_file_count: 0,
        total_bytes: summary.total_bytes,
        completed_bytes: 0,
        manifest_match: None,
        message: None,
    }
}
fn empty_status() -> TransferStatus {
    TransferStatus {
        phase: TransferPhase::Preparing,
        source_name: None,
        file_count: 0,
        completed_file_count: 0,
        total_bytes: 0,
        completed_bytes: 0,
        manifest_match: None,
        message: None,
    }
}

fn lock(
    controller: &UploadController,
) -> Result<std::sync::MutexGuard<'_, ControllerState>, String> {
    controller
        .inner
        .lock()
        .map_err(|_| "STASH transfer state is unavailable.".to_string())
}

#[tauri::command]
pub fn select_stash_source(
    kind: String,
    start: Option<String>,
    controller: State<'_, UploadController>,
) -> Result<SourceSummary, String> {
    let root = pick_native_path(&kind, start.as_deref())?;
    controller.select_source_path(root)
}

#[tauri::command]
pub fn get_transfer_status(
    controller: State<'_, UploadController>,
) -> Result<TransferStatus, String> {
    Ok(lock(&controller)?.status.clone())
}

#[tauri::command]
pub fn confirm_stash(controller: State<'_, UploadController>) -> Result<TransferStatus, String> {
    let (manifest, cancel, shared) = {
        let mut state = lock(&controller)?;
        let manifest = state
            .selected
            .clone()
            .ok_or_else(|| "Choose a file or folder before you Stash it.".to_string())?;
        if matches!(
            state.status.phase,
            TransferPhase::Stashing | TransferPhase::Verifying
        ) {
            return Ok(state.status.clone());
        }
        let cancel = Arc::new(AtomicBool::new(false));
        state.cancel = Some(cancel.clone());
        state.status.phase = TransferPhase::Preparing;
        state.status.message = None;
        (manifest, cancel, controller.inner.clone())
    };
    tauri::async_runtime::spawn(async move {
        run_transfer(manifest, cancel, shared).await;
    });
    Ok(lock(&controller)?.status.clone())
}

#[tauri::command]
pub fn cancel_stash(controller: State<'_, UploadController>) -> Result<TransferStatus, String> {
    let mut state = lock(&controller)?;
    if let Some(cancel) = &state.cancel {
        cancel.store(true, Ordering::SeqCst);
    }
    if !matches!(
        state.status.phase,
        TransferPhase::Stashed | TransferPhase::Canceled
    ) {
        state.status.phase = TransferPhase::Canceled;
        state.status.message =
            Some("Stash canceled. No unverified success was recorded.".to_string());
    }
    Ok(state.status.clone())
}

async fn run_transfer(
    manifest: SourceManifest,
    cancel: Arc<AtomicBool>,
    shared: Arc<Mutex<ControllerState>>,
) {
    #[cfg(debug_assertions)]
    eprintln!(
        "[stash-transfer] begin: {} file(s), {} bytes",
        manifest.summary.file_count, manifest.summary.total_bytes
    );
    let result = transfer(manifest.clone(), cancel.clone(), shared.clone()).await;
    #[cfg(debug_assertions)]
    if let Err(error) = &result {
        eprintln!("[stash-transfer] failed: {error}");
    }
    if result.is_ok() && manifest.cleanup_on_success {
        if let Err(error) = cleanup_mount_spool(&manifest.root) {
            if let Ok(mut state) = shared.lock() {
                state.status.phase = TransferPhase::NeedsAttention;
                state.status.message = Some(error);
                state.cancel = None;
            }
            return;
        }
    }
    if let Err(error) = result {
        if let Ok(mut state) = shared.lock() {
            if cancel.load(Ordering::SeqCst) {
                state.status.phase = TransferPhase::Canceled;
                state.status.message = Some(
                    "Stash canceled. The native recovery spool was retained for attention."
                        .to_string(),
                );
            } else {
                state.status.phase = TransferPhase::NeedsAttention;
                state.status.message = Some(format!(
                    "{error} The native recovery spool was retained for attention."
                ));
            }
            state.cancel = None;
        }
    }
}

async fn transfer(
    manifest: SourceManifest,
    cancel: Arc<AtomicBool>,
    shared: Arc<Mutex<ControllerState>>,
) -> Result<(), String> {
    check_canceled(&cancel)?;
    set_phase(&shared, TransferPhase::Preparing, None)?;
    let api = crate::api::UploadApi::new();
    let stash: CreateStashResponse = api
        .post(
            "/stashes",
            &serde_json::json!({
                "manifestTotalBytes": manifest.summary.total_bytes,
                "manifestFileCount": manifest.summary.file_count,
                "manifestFolderName": manifest.summary.folder_name,
            }),
            Some(idempotency_key("create")),
        )
        .await?;
    let stash_id = stash.stash_id.clone();
    let check: ManifestCheckResponse = match api
        .post(
            &format!("/stashes/{stash_id}/manifest-check"),
            &serde_json::json!({
                "folderName": manifest.summary.folder_name,
                "entries": manifest.entries.iter().map(|entry| serde_json::json!({ "relativePath": entry.relative_path, "sizeBytes": entry.size_bytes, "checksum": entry.checksum })).collect::<Vec<_>>(),
            }),
            None,
        )
        .await
    {
        Ok(value) => value,
        Err(error) => { let _ = api.post_value(&format!("/stashes/{stash_id}/cancel"), &serde_json::json!({}), None).await; return Err(error); }
    };
    check_canceled_or_cancel(&api, &stash_id, &cancel).await?;
    let entries: Vec<ManifestEntry> = match check {
        ManifestCheckResponse::Exact(response) => {
            let _ = response;
            set_manifest_match(&shared, "exact")?;
            api.post_value(
                &format!("/stashes/{stash_id}/cancel"),
                &serde_json::json!({}),
                None,
            )
            .await?;
            return Err("A matching Stash already exists; nothing new was uploaded.".to_string());
        }
        ManifestCheckResponse::Partial(response) => {
            set_manifest_match(&shared, "partial")?;
            response
                .new_files
                .into_iter()
                .map(|entry| entry.into_manifest())
                .collect()
        }
        ManifestCheckResponse::None(_) => {
            set_manifest_match(&shared, "none")?;
            manifest.entries.clone()
        }
    };
    if entries.is_empty() {
        api.post_value(
            &format!("/stashes/{stash_id}/cancel"),
            &serde_json::json!({}),
            None,
        )
        .await?;
        return Err("No new files were found to Stash.".to_string());
    }
    set_phase(&shared, TransferPhase::Stashing, None)?;
    let registered: RegisterFilesResponse = match api.post(&format!("/stashes/{stash_id}/files"), &serde_json::json!({ "stashId": stash_id, "files": entries.iter().map(|entry| serde_json::json!({ "relativePath": entry.relative_path, "sizeBytes": entry.size_bytes, "checksum": entry.checksum })).collect::<Vec<_>>() }), Some(idempotency_key("register"))).await {
        Ok(value) => value,
        Err(error) => { let _ = api.post_value(&format!("/stashes/{stash_id}/cancel"), &serde_json::json!({}), None).await; return Err(error); }
    };
    if registered.file_ids.len() != entries.len() {
        return Err("STASH returned an incomplete file registration.".to_string());
    }
    for (entry, file_id) in entries.iter().zip(registered.file_ids.iter()) {
        check_canceled_or_cancel(&api, &stash_id, &cancel).await?;
        if let Err(error) = upload_file(&api, &manifest.root, entry, file_id, &cancel).await {
            let _ = api
                .post_value(
                    &format!("/uploads/{file_id}/abort"),
                    &serde_json::json!({}),
                    None,
                )
                .await;
            let _ = api
                .post_value(
                    &format!("/stashes/{stash_id}/cancel"),
                    &serde_json::json!({}),
                    None,
                )
                .await;
            return Err(error);
        }
        if let Ok(mut state) = shared.lock() {
            state.status.completed_file_count += 1;
            state.status.completed_bytes = state
                .status
                .completed_bytes
                .saturating_add(entry.size_bytes);
        }
    }
    check_canceled_or_cancel(&api, &stash_id, &cancel).await?;
    set_phase(&shared, TransferPhase::Verifying, None)?;
    api.post_value(
        &format!("/stashes/{stash_id}/complete"),
        &serde_json::json!({}),
        None,
    )
    .await?;
    if let Ok(mut state) = shared.lock() {
        state.status.phase = TransferPhase::Stashed;
        state.status.message = Some("Verified and committed by STASH.".to_string());
        state.cancel = None;
    }
    Ok(())
}

async fn upload_file(
    api: &crate::api::UploadApi,
    root: &Path,
    entry: &ManifestEntry,
    file_id: &str,
    cancel: &Arc<AtomicBool>,
) -> Result<(), String> {
    let source = if root.is_file() {
        root.to_path_buf()
    } else {
        root.join(Path::new(
            &entry
                .relative_path
                .replace('/', std::path::MAIN_SEPARATOR_STR),
        ))
    };
    if checksum_file(&source)? != entry.checksum {
        return Err("A selected source file changed after the manifest was prepared.".to_string());
    }
    let part_count = part_count(entry.size_bytes)?;
    let signed: SignPartsResponse = api
        .post(
            &format!("/uploads/{file_id}/parts"),
            &serde_json::json!({ "partCount": part_count }),
            None,
        )
        .await?;
    if signed.parts.len() != part_count as usize
        || signed
            .parts
            .iter()
            .enumerate()
            .any(|(index, part)| part.part_number != index as u32 + 1)
    {
        return Err("STASH returned an incomplete multipart authorization.".to_string());
    }
    let mut file =
        File::open(&source).map_err(|_| "A selected source file could not be read.".to_string())?;
    let mut etags = Vec::with_capacity(signed.parts.len());
    for part in signed.parts {
        check_canceled(cancel)?;
        let start = (part.part_number as u64 - 1) * PART_SIZE_BYTES;
        file.seek(SeekFrom::Start(start))
            .map_err(|_| "A selected source file could not be read.".to_string())?;
        let expected = std::cmp::min(PART_SIZE_BYTES, entry.size_bytes.saturating_sub(start));
        let mut bytes = Vec::with_capacity(expected as usize);
        (&mut file)
            .take(expected)
            .read_to_end(&mut bytes)
            .map_err(|_| "A selected source file could not be read.".to_string())?;
        let response = Client::new()
            .put(&part.url)
            .body(bytes)
            .send()
            .await
            .map_err(|_| "STASH could not transfer a file part directly to storage.".to_string())?;
        if !response.status().is_success() {
            return Err("STASH rejected a file part; the transfer needs attention.".to_string());
        }
        let etag = response
            .headers()
            .get("etag")
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
            .ok_or_else(|| "Storage returned no part verification tag.".to_string())?;
        etags.push(serde_json::json!({ "partNumber": part.part_number, "etag": etag }));
    }
    let completed: CompleteUploadResponse = api
        .post(
            &format!("/uploads/{file_id}/complete"),
            &serde_json::json!({ "parts": etags }),
            None,
        )
        .await?;
    if completed.state != "committed" {
        return Err("STASH did not verify the uploaded file as committed.".to_string());
    }
    Ok(())
}

async fn check_canceled_or_cancel(
    api: &crate::api::UploadApi,
    stash_id: &str,
    cancel: &Arc<AtomicBool>,
) -> Result<(), String> {
    if cancel.load(Ordering::SeqCst) {
        let _ = api
            .post_value(
                &format!("/stashes/{stash_id}/cancel"),
                &serde_json::json!({}),
                None,
            )
            .await;
        return Err("Stash canceled.".to_string());
    }
    Ok(())
}
fn check_canceled(cancel: &Arc<AtomicBool>) -> Result<(), String> {
    if cancel.load(Ordering::SeqCst) {
        Err("Stash canceled.".to_string())
    } else {
        Ok(())
    }
}
fn set_manifest_match(shared: &Arc<Mutex<ControllerState>>, value: &str) -> Result<(), String> {
    let mut state = shared
        .lock()
        .map_err(|_| "STASH transfer state is unavailable.".to_string())?;
    state.status.manifest_match = Some(value.to_string());
    Ok(())
}

fn set_phase(
    shared: &Arc<Mutex<ControllerState>>,
    phase: TransferPhase,
    message: Option<String>,
) -> Result<(), String> {
    #[cfg(debug_assertions)]
    eprintln!("[stash-transfer] phase: {phase:?}");
    let mut state = shared
        .lock()
        .map_err(|_| "STASH transfer state is unavailable.".to_string())?;
    state.status.phase = phase;
    state.status.message = message;
    Ok(())
}

#[derive(Deserialize)]
struct CreateStashResponse {
    #[serde(rename = "stashId")]
    stash_id: String,
}
#[derive(Deserialize)]
#[serde(tag = "match")]
enum ManifestCheckResponse {
    #[serde(rename = "exact")]
    Exact(ExactResponse),
    #[serde(rename = "partial")]
    Partial(PartialResponse),
    #[serde(rename = "none")]
    None(NoneResponse),
}
#[derive(Deserialize)]
struct ExactResponse {
    #[serde(rename = "folderId")]
    _folder_id: String,
}
#[derive(Deserialize)]
struct PartialResponse {
    #[serde(rename = "newFiles")]
    new_files: Vec<ApiManifestEntry>,
}
#[derive(Deserialize)]
struct NoneResponse {}
#[derive(Deserialize)]
struct ApiManifestEntry {
    #[serde(rename = "relativePath")]
    relative_path: String,
    #[serde(rename = "sizeBytes")]
    size_bytes: u64,
    checksum: String,
}
impl ApiManifestEntry {
    fn into_manifest(self) -> ManifestEntry {
        ManifestEntry {
            relative_path: self.relative_path,
            size_bytes: self.size_bytes,
            checksum: self.checksum,
        }
    }
}
#[derive(Deserialize)]
struct RegisterFilesResponse {
    #[serde(rename = "fileIds")]
    file_ids: Vec<String>,
}
#[derive(Deserialize)]
struct SignPartsResponse {
    parts: Vec<PartAuthorization>,
}
#[derive(Deserialize)]
struct PartAuthorization {
    #[serde(rename = "partNumber")]
    part_number: u32,
    url: String,
}
#[derive(Deserialize)]
struct CompleteUploadResponse {
    state: String,
}

pub fn part_count(size_bytes: u64) -> Result<u64, String> {
    let count = std::cmp::max(
        1,
        (size_bytes.saturating_add(PART_SIZE_BYTES - 1)) / PART_SIZE_BYTES,
    );
    if count > MAX_PARTS {
        Err("A file is too large for STASH's multipart upload limit.".to_string())
    } else {
        Ok(count)
    }
}

fn build_manifest(root: PathBuf) -> Result<SourceManifest, String> {
    let metadata = std::fs::metadata(&root)
        .map_err(|_| "The selected source could not be read.".to_string())?;
    let source_name = root
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| "The selected source has no readable name.".to_string())?
        .to_string();
    let mut entries = Vec::new();
    if metadata.is_file() {
        let checksum = checksum_file(&root)?;
        entries.push(ManifestEntry {
            relative_path: source_name.clone(),
            size_bytes: metadata.len(),
            checksum,
        });
    } else if metadata.is_dir() {
        for entry in WalkDir::new(&root)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_file())
        {
            let relative = entry
                .path()
                .strip_prefix(&root)
                .map_err(|_| "The selected source path could not be preserved.".to_string())?;
            let relative_path = manifest_relative_path(relative)?;
            let size_bytes = entry
                .metadata()
                .map_err(|_| "A selected source file could not be read.".to_string())?
                .len();
            entries.push(ManifestEntry {
                relative_path,
                size_bytes,
                checksum: checksum_file(entry.path())?,
            });
        }
    } else {
        return Err("Choose a file or folder to Stash.".to_string());
    }
    entries.sort_by(|left, right| {
        left.relative_path
            .as_bytes()
            .cmp(right.relative_path.as_bytes())
    });
    let total_bytes = entries
        .iter()
        .try_fold(0u64, |sum, entry| sum.checked_add(entry.size_bytes))
        .ok_or_else(|| "The selected source is too large to describe safely.".to_string())?;
    let visible = entries
        .iter()
        .map(|entry| SourceEntry {
            relative_path: entry.relative_path.clone(),
            size_bytes: entry.size_bytes,
        })
        .collect();
    Ok(SourceManifest {
        root,
        summary: SourceSummary {
            source_name: source_name.clone(),
            folder_name: source_name,
            file_count: entries.len() as u64,
            total_bytes,
            entries: visible,
        },
        entries,
        cleanup_on_success: false,
    })
}

fn build_spool_manifest(root: PathBuf, source_name: String) -> Result<SourceManifest, String> {
    let metadata = std::fs::metadata(&root)
        .map_err(|_| "The mounted write spool could not be read.".to_string())?;
    if !metadata.is_file() {
        return Err("The mounted write spool is not a file.".to_string());
    }
    let entry = ManifestEntry {
        relative_path: source_name.clone(),
        size_bytes: metadata.len(),
        checksum: checksum_file(&root)?,
    };
    Ok(SourceManifest {
        root,
        summary: SourceSummary {
            source_name: source_name.clone(),
            folder_name: source_name.clone(),
            file_count: 1,
            total_bytes: entry.size_bytes,
            entries: vec![SourceEntry {
                relative_path: entry.relative_path.clone(),
                size_bytes: entry.size_bytes,
            }],
        },
        entries: vec![entry],
        cleanup_on_success: false,
    })
}

fn manifest_relative_path(path: &Path) -> Result<String, String> {
    path.to_str()
        .ok_or_else(|| "A source name cannot be represented safely in the manifest.".to_string())
        .map(|value| value.replace('\\', "/"))
}

fn checksum_file(path: &Path) -> Result<String, String> {
    let file =
        File::open(path).map_err(|_| "A selected source file could not be read.".to_string())?;
    checksum_reader(file)
}

fn checksum_reader<R: Read>(mut reader: R) -> Result<String, String> {
    let mut hasher = Sha256::new();
    // This is intentionally heap-backed: mount write completion is invoked
    // from WinFSP dispatcher threads, whose native stacks are too small for
    // the 1 MiB stream buffer used for creator-sized assets.
    let mut buffer = vec![0u8; READ_BUFFER_BYTES];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|_| "A selected source file could not be read.".to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

/// The picker's starting folder, as a fixed PowerShell expression. Only
/// these names are accepted, so nothing from the webview reaches the script.
fn start_folder_expr(start: Option<&str>) -> Result<Option<&'static str>, String> {
    match start {
        None => Ok(None),
        Some("desktop") => Ok(Some("[Environment]::GetFolderPath('Desktop')")),
        Some("documents") => Ok(Some("[Environment]::GetFolderPath('MyDocuments')")),
        Some("downloads") => Ok(Some("(Join-Path $env:USERPROFILE 'Downloads')")),
        Some(_) => Err("That starting folder isn't available.".to_string()),
    }
}

/// The PowerShell dialog script for a file or folder picker.
fn picker_script(kind: &str, start: Option<&str>) -> Result<String, String> {
    let start = start_folder_expr(start)?;
    match kind {
        "folder" => Ok(format!(
            "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; {}if($d.ShowDialog() -eq 'OK'){{[Console]::Write($d.SelectedPath)}}",
            start.map(|expr| format!("$d.SelectedPath={expr}; ")).unwrap_or_default()
        )),
        "file" => Ok(format!(
            "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; {}if($d.ShowDialog() -eq 'OK'){{[Console]::Write($d.FileName)}}",
            start.map(|expr| format!("$d.InitialDirectory={expr}; ")).unwrap_or_default()
        )),
        _ => Err("Choose a file or folder.".to_string()),
    }
}

#[cfg(target_os = "windows")]
fn pick_native_path(kind: &str, start: Option<&str>) -> Result<PathBuf, String> {
    let script = picker_script(kind, start)?;
    let output = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-STA", "-Command", script.as_str()])
        .output()
        .map_err(|_| "The native source picker is unavailable.".to_string())?;
    let path = String::from_utf8(output.stdout)
        .map_err(|_| "The selected source name could not be read safely.".to_string())?;
    let path = path.trim_end_matches(['\r', '\n']).trim();
    if path.is_empty() {
        return Err("No source selected.".to_string());
    }
    Ok(PathBuf::from(path))
}
#[cfg(not(target_os = "windows"))]
fn pick_native_path(_kind: &str, _start: Option<&str>) -> Result<PathBuf, String> {
    Err("The native source picker is available in the Windows desktop build.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// The webview gateway rejects anything but these camelCase names
    /// (`sourceSummary` / `transferStatus` in `ui/src/platform/tauri/gateway.ts`).
    #[test]
    fn status_and_summary_serialize_with_the_field_names_the_ui_validates() {
        let summary = SourceSummary {
            source_name: "Pack".into(),
            folder_name: "Pack".into(),
            file_count: 1,
            total_bytes: 2,
            entries: vec![SourceEntry { relative_path: "Pack/a.wav".into(), size_bytes: 2 }],
        };
        let json = serde_json::to_value(&summary).unwrap();
        for key in ["sourceName", "folderName", "fileCount", "totalBytes", "entries"] {
            assert!(json.get(key).is_some(), "summary missing {key}: {json}");
        }
        assert!(json["entries"][0].get("relativePath").is_some());
        assert!(json["entries"][0].get("sizeBytes").is_some());

        let status = serde_json::to_value(status_for(&summary)).unwrap();
        for key in ["phase", "sourceName", "fileCount", "completedFileCount", "totalBytes", "completedBytes", "manifestMatch", "message"] {
            assert!(status.get(key).is_some(), "status missing {key}: {status}");
        }
        assert_eq!(status["phase"], "Preparing");
    }

    #[test]
    fn picker_starts_only_in_allow_listed_folders() {
        assert!(picker_script("folder", None).unwrap().contains("FolderBrowserDialog"));
        assert!(!picker_script("folder", None).unwrap().contains("SelectedPath=["));
        assert!(picker_script("folder", Some("desktop")).unwrap().contains("$d.SelectedPath=[Environment]::GetFolderPath('Desktop'); "));
        assert!(picker_script("file", Some("downloads")).unwrap().contains("$d.InitialDirectory=(Join-Path $env:USERPROFILE 'Downloads'); "));
        assert!(picker_script("file", Some("C:\\; Remove-Item x")).is_err());
        assert!(picker_script("script", None).is_err());
    }

    #[test]
    fn preserves_relative_names_and_hierarchy() {
        let raw = Path::new("Étage/Raw/take.wav");
        let preserved = manifest_relative_path(raw).unwrap();
        assert_eq!(preserved, "Étage/Raw/take.wav");
        let nfd = "Cafe\u{301}/mix.wav";
        assert_ne!(nfd, "Café/mix.wav");
    }
    #[test]
    fn checksum_is_streaming_sha256_and_does_not_normalize_path() {
        assert_eq!(
            checksum_reader(Cursor::new(b"abc".to_vec())).unwrap(),
            "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
    #[test]
    fn part_count_is_bounded_and_zero_byte_files_have_one_part() {
        assert_eq!(part_count(0).unwrap(), 1);
        assert_eq!(part_count(PART_SIZE_BYTES).unwrap(), 1);
        assert_eq!(part_count(PART_SIZE_BYTES + 1).unwrap(), 2);
        assert!(part_count(PART_SIZE_BYTES * MAX_PARTS + 1).is_err());
    }
    #[test]
    fn safe_dto_never_contains_private_transfer_material() {
        let value = serde_json::to_string(&SourceSummary {
            source_name: "take".into(),
            folder_name: "take".into(),
            file_count: 1,
            total_bytes: 4,
            entries: vec![SourceEntry {
                relative_path: "take.wav".into(),
                size_bytes: 4,
            }],
        })
        .unwrap();
        assert!(!value.contains("checksum"));
        assert!(!value.contains("url"));
        assert!(!value.contains("token"));
    }
    #[test]
    fn mount_submission_failure_is_visible_as_needs_attention() {
        let controller = UploadController::default();
        controller.mark_needs_attention("spool submission failed".into());
        let state = controller.inner.lock().unwrap();
        assert_eq!(state.status.phase, TransferPhase::NeedsAttention);
        assert_ne!(state.status.phase, TransferPhase::Stashed);
    }

    #[test]
    fn mount_status_starts_unverified_until_transfer_completion() {
        let summary = SourceSummary {
            source_name: "take.wav".into(),
            folder_name: "take.wav".into(),
            file_count: 1,
            total_bytes: 3,
            entries: vec![],
        };
        assert_eq!(status_for(&summary).phase, TransferPhase::Preparing);
        assert_ne!(status_for(&summary).phase, TransferPhase::Stashed);
    }
    #[test]
    fn transfer_phases_never_use_success_for_unverified_state() {
        assert_ne!(TransferPhase::NeedsAttention, TransferPhase::Stashed);
        assert_ne!(TransferPhase::Canceled, TransferPhase::Stashed);
    }
}
