//! Virtual-drive lifecycle: owns the live WinFSP mount once attached, plus
//! its lifecycle state. Detaching only clears attachment state — it never
//! deletes cloud objects or cache files.
//!
//! The drive shows the caller's whole folder tree. `ApiLibrary` lists each
//! folder over the authenticated STASH API when Windows asks for it (the
//! adapter re-lists after a few seconds, so new Stashes appear without a
//! remount) and reads committed files through the range-verified
//! `stash-core` cache and `stash-s3-provider` HTTP range provider, using
//! short-lived download leases from `ApiLeaseSource`.

use reqwest::blocking::Client as BlockingClient;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use stash_core::ReadError;
use stash_s3_provider::{HttpRangeProvider, LeaseSource};
use stash_windows_fs::{DriveOptions, Library, Listing, QueuedUpload, StashFileSystemContext, TrashTarget, WriteSink, WriteSpool};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use windows::Win32::System::LibraryLoader::{LoadLibraryW, SetDllDirectoryW};
use winfsp::host::{FileSystemHost, FileSystemParams, FineGuard, VolumeParams};

const MOUNT_LETTER: &str = "S:";
const SEGMENT_SIZE: u64 = 1 << 20; // 1 MiB
const READ_TIMEOUT: Duration = Duration::from_secs(20);

#[cfg(target_arch = "x86_64")]
const WINFSP_DLL: &str = "winfsp-x64.dll";
#[cfg(target_arch = "x86")]
const WINFSP_DLL: &str = "winfsp-x86.dll";
#[cfg(target_arch = "aarch64")]
const WINFSP_DLL: &str = "winfsp-a64.dll";

/// Explorer's free-space figure is refreshed at most this often.
const USAGE_TTL: Duration = Duration::from_secs(30);
const LIST_TIMEOUT: Duration = Duration::from_secs(15);

type LiveHost = FileSystemHost<StashFileSystemContext<ApiLibrary>, FineGuard>;

/// The signed-in user's STASH as the drive sees it. Blocking HTTP on
/// purpose: WinFSP calls these from its own dispatcher threads, never from
/// inside the async Tauri runtime.
pub struct ApiLibrary {
    client: BlockingClient,
    usage: Mutex<Option<(Instant, u64)>>,
}

impl ApiLibrary {
    fn new() -> Self {
        Self {
            client: BlockingClient::builder()
                .timeout(LIST_TIMEOUT)
                .build()
                .unwrap_or_else(|_| BlockingClient::new()),
            usage: Mutex::new(None),
        }
    }

    fn get(&self, path: &str) -> Result<Value, ReadError> {
        let token = crate::auth::id_token().map_err(|_| ReadError::LeaseExpired)?;
        let response = self
            .client
            .get(format!("{}{path}", crate::api::api_url()))
            .bearer_auth(token)
            .send()
            .map_err(|_| ReadError::Offline)?;
        match response.status().as_u16() {
            200..=299 => response.json::<Value>().map_err(|_| ReadError::Io),
            401 | 403 => Err(ReadError::LeaseExpired),
            _ => Err(ReadError::Io),
        }
    }
}

fn safe_folder_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
}

/// The drive's view of one `GET /folders/{id}/children` body: active
/// folders and committed files only. Uploading, failed and trashed files
/// have no readable bytes, so they never appear on the drive.
fn listing_from(body: &Value) -> Vec<Listing> {
    let Some(items) = body.get("items").and_then(Value::as_array) else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let text = |key: &str| item.get(key).and_then(Value::as_str).map(str::to_string);
            let name = text("name")?;
            match text("entity").as_deref() {
                Some("FOLDER") if matches!(text("state").as_deref(), None | Some("active")) => {
                    Some(Listing::Folder { id: text("folderId").filter(|id| safe_folder_id(id))?, name })
                }
                Some("FILE") if text("state").as_deref() == Some("committed") => Some(Listing::File {
                    id: text("fileId").filter(|id| safe_folder_id(id))?,
                    name,
                    size: item.get("sizeBytes").and_then(Value::as_u64).unwrap_or(0),
                }),
                _ => None,
            }
        })
        .collect()
}

impl Library for ApiLibrary {
    type Provider = HttpRangeProvider<ApiLeaseSource>;

    fn list(&self, folder_id: Option<&str>) -> Result<Vec<Listing>, ReadError> {
        let id = folder_id.unwrap_or("ROOT");
        if !safe_folder_id(id) {
            return Err(ReadError::Io);
        }
        Ok(listing_from(&self.get(&format!("/folders/{id}/children"))?))
    }

    fn open_file(&self, file_id: &str) -> Self::Provider {
        HttpRangeProvider::new(ApiLeaseSource { file_id: file_id.to_string() })
    }

    fn used_bytes(&self) -> Option<u64> {
        if let Some((at, used)) = *self.usage.lock().ok()? {
            if at.elapsed() < USAGE_TTL {
                return Some(used);
            }
        }
        let used = self.get("/me/usage").ok()?.get("usedBytes")?.as_u64()?;
        *self.usage.lock().ok()? = Some((Instant::now(), used));
        Some(used)
    }

    fn create_folder(&self, parent: Option<&str>, name: &str) -> Result<String, ReadError> {
        if parent.is_some_and(|id| !safe_folder_id(id)) {
            return Err(ReadError::Io);
        }
        let token = crate::auth::id_token().map_err(|_| ReadError::LeaseExpired)?;
        let response = self
            .client
            .post(format!("{}/folders", crate::api::api_url()))
            .bearer_auth(token)
            .json(&create_folder_body(parent, name))
            .send()
            .map_err(|_| ReadError::Offline)?;
        match response.status().as_u16() {
            200..=299 => response
                .json::<Value>()
                .ok()
                .and_then(|body| body.get("folderId").and_then(Value::as_str).map(str::to_string))
                .filter(|id| safe_folder_id(id))
                .ok_or(ReadError::Io),
            401 | 403 => Err(ReadError::LeaseExpired),
            _ => Err(ReadError::Io),
        }
    }

    fn trash(&self, target: TrashTarget<'_>) -> Result<(), ReadError> {
        let path = trash_path(target).ok_or(ReadError::Io)?;
        let token = crate::auth::id_token().map_err(|_| ReadError::LeaseExpired)?;
        let response = self
            .client
            .delete(format!("{}{path}", crate::api::api_url()))
            .bearer_auth(token)
            .send()
            .map_err(|_| ReadError::Offline)?;
        match response.status().as_u16() {
            200..=299 => Ok(()),
            401 | 403 => Err(ReadError::LeaseExpired),
            _ => Err(ReadError::Io),
        }
    }
}

/// The `POST /folders` body for a folder made on S:; the top level sends no parent.
fn create_folder_body(parent: Option<&str>, name: &str) -> Value {
    match parent {
        Some(parent) => serde_json::json!({ "name": name, "parentFolderId": parent }),
        None => serde_json::json!({ "name": name }),
    }
}

/// The existing move-to-Trash route for a delete on S:. Ids are validated so
/// a crafted name can never become a different API path.
fn trash_path(target: TrashTarget<'_>) -> Option<String> {
    match target {
        TrashTarget::File(id) if safe_folder_id(id) => Some(format!("/files/{id}")),
        TrashTarget::Folder(id) if safe_folder_id(id) => Some(format!("/folders/{id}")),
        _ => None,
    }
}

#[derive(Clone)]
struct MountWriteSink {
    uploads: crate::upload::UploadController,
}

impl WriteSink for MountWriteSink {
    fn begin(&self, parent: Option<&str>, name: &[u16]) -> Result<WriteSpool, String> {
        #[cfg(debug_assertions)]
        eprintln!("[stash-mount] begin write spool for {} UTF-16 units", name.len());
        WriteSpool::create_for_mount(parent, name)
    }

    fn queued_in(&self, parent: Option<&str>) -> Vec<QueuedUpload> {
        self.uploads.mount_queued_in(parent)
    }

    fn submit(&self, spool: WriteSpool) -> Result<(), String> {
        #[cfg(debug_assertions)]
        eprintln!("[stash-mount] submit completed write spool");
        match self.uploads.submit_mount_spool(spool) {
            Ok(()) => Ok(()),
            Err(error) => {
                self.uploads.mark_needs_attention(error.clone());
                Err(error)
            }
        }
    }
}

/// Loads the installed WinFsp DLL by its absolute installation path before
/// the delay-loaded binding asks Windows for it by name. Development builds
/// run from Cargo's target directory, which is not part of the WinFsp DLL
/// search path.
fn preload_winfsp() -> Result<(), String> {
    let roots = ["ProgramFiles(x86)", "ProgramFiles"];
    for variable in roots {
        let Some(root) = std::env::var_os(variable) else {
            continue;
        };
        let directory = std::path::PathBuf::from(root).join("WinFsp").join("bin");
        let candidate = directory.join(WINFSP_DLL);
        if !candidate.is_file() {
            continue;
        }
        let directory = windows::core::HSTRING::from(directory.as_os_str());
        // The Rust binding uses a delay-loaded import by basename. Set this
        // process's DLL directory so that resolver finds the installed DLL
        // later, not just this explicit preload call.
        unsafe { SetDllDirectoryW(&directory) }
            .map_err(|err| format!("STASH couldn't configure the Windows drive service: {err}"))?;
        let path = windows::core::HSTRING::from(candidate.as_os_str());
        unsafe { LoadLibraryW(&path) }
            .map_err(|err| format!("STASH couldn't load the Windows drive service: {err}"))?;
        return Ok(());
    }
    Err("STASH needs WinFsp installed to mount a virtual drive.".to_string())
}

/// Fetches and renews one file's download lease over the authenticated
/// STASH API. Uses a blocking HTTP client deliberately: WinFSP calls
/// `RangeProvider`/`LeaseSource` methods from its own dispatcher threads,
/// never from inside the async Tauri runtime, so there is no runtime to
/// block and no `.await` available at the call site.
pub struct ApiLeaseSource {
    file_id: String,
}

#[derive(Deserialize)]
struct DownloadUrlResponse {
    url: String,
}

impl LeaseSource for ApiLeaseSource {
    fn current_url(&self) -> Result<String, ReadError> {
        self.fetch()
    }

    fn renew(&self) -> Result<String, ReadError> {
        self.fetch()
    }
}

impl ApiLeaseSource {
    fn fetch(&self) -> Result<String, ReadError> {
        let token = crate::auth::id_token().map_err(|_| ReadError::LeaseExpired)?;
        let response = BlockingClient::new()
            .post(format!(
                "{}/files/{}/download-url",
                crate::api::api_url(),
                self.file_id
            ))
            .bearer_auth(token)
            .send()
            .map_err(|_| ReadError::Offline)?;
        if !response.status().is_success() {
            return Err(ReadError::LeaseExpired);
        }
        response
            .json::<DownloadUrlResponse>()
            .map(|body| body.url)
            .map_err(|_| ReadError::Io)
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MountState {
    pub mounted: bool,
    pub letter: Option<char>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct MountStatus {
    pub mounted: bool,
    pub letter: Option<String>,
    pub label: String,
}

impl From<&MountState> for MountStatus {
    fn from(state: &MountState) -> Self {
        Self {
            mounted: state.mounted,
            letter: state.letter.map(|letter| letter.to_string()),
            label: "STASH".to_string(),
        }
    }
}

#[derive(Clone)]
pub struct MountController {
    state: Arc<Mutex<MountState>>,
    host: Arc<Mutex<Option<LiveHost>>>,
    write_sink: Arc<MountWriteSink>,
}

impl Default for MountController {
    fn default() -> Self {
        Self::with_uploads(crate::upload::UploadController::default())
    }
}

impl MountController {
    pub fn with_uploads(uploads: crate::upload::UploadController) -> Self {
        Self {
            state: Arc::new(Mutex::new(MountState::default())),
            host: Arc::new(Mutex::new(None)),
            write_sink: Arc::new(MountWriteSink { uploads }),
        }
    }
    pub fn status(&self) -> MountStatus {
        let state = self.state.lock().expect("mount state lock poisoned");
        MountStatus::from(&*state)
    }

    pub async fn mount(&self) -> Result<MountStatus, String> {
        if self
            .state
            .lock()
            .expect("mount state lock poisoned")
            .mounted
        {
            return Ok(self.status());
        }

        // WinFsp dynamically loads its native DLL. It must be initialized
        // before a host is created; otherwise a delay-load exception can
        // escape the native boundary and terminate the desktop process.
        preload_winfsp()?;
        winfsp::winfsp_init().map_err(|err| {
            format!("STASH couldn't initialize the Windows drive service: {err:?}")
        })?;

        // Confirm the signed-in session can list the top level before a
        // drive letter appears. An empty STASH is still a valid, usable drive.
        let library = tauri::async_runtime::spawn_blocking(|| {
            let library = ApiLibrary::new();
            library.list(None).map(|_| library)
        })
        .await
        .map_err(|_| "Mounting STASH was interrupted.".to_string())?
        .map_err(|error| match error {
            ReadError::LeaseExpired => "Your sign-in has expired. Please sign in again.".to_string(),
            ReadError::Offline | ReadError::Timeout => {
                "STASH could not be reached. Check your connection and try again.".to_string()
            }
            _ => "STASH couldn't read your folders to mount the drive.".to_string(),
        })?;
        let options = DriveOptions {
            segment_size: SEGMENT_SIZE,
            read_timeout: READ_TIMEOUT,
            ..DriveOptions::default()
        };
        let context = StashFileSystemContext::new_with_write_sink(library, options, self.write_sink.clone());

        // WinFSP's host/mount/dispatcher calls are blocking FFI, not async —
        // run them off the Tauri async runtime's own worker threads.
        let host = tauri::async_runtime::spawn_blocking(move || -> Result<LiveHost, String> {
            let mut volume_params = VolumeParams::new();
            volume_params
                .sector_size(4096)
                .sectors_per_allocation_unit(1)
                .case_sensitive_search(false)
                .case_preserved_names(true)
                .unicode_on_disk(true)
                .persistent_acls(false)
                .read_only_volume(false)
                .filesystem_name("STASH");
            let params = FileSystemParams::default_params(volume_params);

            let mut host = FileSystemHost::<_, FineGuard>::new_with_options(params, context)
                .map_err(|err| format!("Couldn't prepare the STASH drive: {err:?}"))?;
            host.mount(MOUNT_LETTER)
                .map_err(|err| format!("Couldn't mount {MOUNT_LETTER} - {err:?}"))?;
            host.start()
                .map_err(|err| format!("Couldn't start the STASH drive: {err:?}"))?;
            Ok(host)
        })
        .await
        .map_err(|_| "Mounting STASH was interrupted.".to_string())??;

        *self.host.lock().expect("mount host lock poisoned") = Some(host);
        let mut state = self.state.lock().expect("mount state lock poisoned");
        state.mounted = true;
        state.letter = Some('S');
        Ok(MountStatus::from(&*state))
    }

    pub fn unmount(&self) -> Result<MountStatus, String> {
        let mut state = self.state.lock().expect("mount state lock poisoned");
        // Dropping the host runs FileSystemHost's own Drop impl, which
        // unmounts and stops the dispatcher. No cloud object, cache path, or
        // user file is touched by this operation — only attachment state.
        *self.host.lock().expect("mount host lock poisoned") = None;
        state.mounted = false;
        state.letter = None;
        Ok(MountStatus::from(&*state))
    }
}


#[tauri::command]
pub async fn mount_status(state: tauri::State<'_, MountController>) -> Result<MountStatus, String> {
    Ok(state.status())
}

#[tauri::command]
pub async fn mount_stash(state: tauri::State<'_, MountController>) -> Result<MountStatus, String> {
    state.mount().await
}

#[tauri::command]
pub async fn unmount_stash(
    state: tauri::State<'_, MountController>,
) -> Result<MountStatus, String> {
    state.unmount()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starts_detached() {
        let controller = MountController::default();
        assert_eq!(
            controller.status(),
            MountStatus {
                mounted: false,
                letter: None,
                label: "STASH".into()
            }
        );
    }

    #[test]
    fn unmount_before_ever_mounting_is_a_no_op_not_an_error() {
        let controller = MountController::default();
        assert!(controller.unmount().is_ok());
        assert!(!controller.status().mounted);
    }

    #[test]
    fn a_folder_made_on_s_is_created_in_its_parent_or_at_the_top_level() {
        assert_eq!(create_folder_body(Some("pack-1"), "Snares"), serde_json::json!({ "name": "Snares", "parentFolderId": "pack-1" }));
        assert_eq!(create_folder_body(None, "Beats"), serde_json::json!({ "name": "Beats" }));
    }

    #[test]
    fn unmount_is_idempotent() {
        let controller = MountController::default();
        assert!(controller.unmount().is_ok());
        assert!(controller.unmount().is_ok());
        assert!(!controller.status().mounted);
    }

    #[test]
    fn empty_listing_is_an_empty_but_valid_folder() {
        assert!(listing_from(&serde_json::json!({ "items": [] })).is_empty());
        assert!(listing_from(&serde_json::json!({})).is_empty());
    }

    #[test]
    fn drive_lists_folders_and_committed_files_only() {
        let body = serde_json::json!({ "items": [
            { "entity": "FOLDER", "folderId": "f1", "name": "KSHMR Vol 5", "state": "active" },
            { "entity": "FOLDER", "folderId": "f2", "name": "Legacy" },
            { "entity": "FOLDER", "folderId": "f3", "name": "Old", "state": "trashed" },
            { "entity": "FILE", "fileId": "a", "name": "Kick.wav", "state": "committed", "sizeBytes": 10 },
            { "entity": "FILE", "fileId": "b", "name": "Half.wav", "state": "uploading", "sizeBytes": 10 },
            { "entity": "FILE", "fileId": "../x", "name": "Bad.wav", "state": "committed" }
        ]});
        assert_eq!(
            listing_from(&body),
            vec![
                Listing::Folder { id: "f1".into(), name: "KSHMR Vol 5".into() },
                Listing::Folder { id: "f2".into(), name: "Legacy".into() },
                Listing::File { id: "a".into(), name: "Kick.wav".into(), size: 10 },
            ]
        );
    }

    #[test]
    fn deletes_on_s_use_the_move_to_trash_routes() {
        assert_eq!(trash_path(TrashTarget::File("abc-1")).as_deref(), Some("/files/abc-1"));
        assert_eq!(trash_path(TrashTarget::Folder("f_2")).as_deref(), Some("/folders/f_2"));
        assert_eq!(trash_path(TrashTarget::File("../me/usage")), None);
    }

    #[test]
    fn unsafe_folder_ids_are_never_requested() {
        assert!(safe_folder_id("ROOT"));
        assert!(safe_folder_id("0f8c-4b2a_x"));
        assert!(!safe_folder_id("../me/usage"));
        assert!(!safe_folder_id(""));
    }
}
