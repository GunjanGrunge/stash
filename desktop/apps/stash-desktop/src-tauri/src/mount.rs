//! Virtual-drive lifecycle: owns the live WinFSP mount once attached, plus
//! its lifecycle state. Detaching only clears attachment state — it never
//! deletes cloud objects or cache files.
//!
//! Scope for this first live mount: a flat listing of the caller's
//! committed root-level files (no subdirectories yet), read on demand via
//! the same range-verified `stash-core` cache and `stash-s3-provider` HTTP
//! range provider already proven in `mount-spike`. The only new piece here
//! is `ApiLeaseSource`, which fetches/renews each file's short-lived
//! download URL from the real, deployed STASH API instead of a local
//! fixture server.

use reqwest::blocking::Client as BlockingClient;
use serde::{Deserialize, Serialize};
use stash_core::ReadError;
use stash_s3_provider::{HttpRangeProvider, LeaseSource};
use stash_windows_fs::{StashFile, StashFileSystemContext};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use winfsp::host::{FileSystemHost, FileSystemParams, FineGuard, VolumeParams};
use windows::Win32::System::LibraryLoader::{LoadLibraryW, SetDllDirectoryW};

const MOUNT_LETTER: &str = "S:";
const SEGMENT_SIZE: u64 = 1 << 20; // 1 MiB
const READ_TIMEOUT: Duration = Duration::from_secs(20);

#[cfg(target_arch = "x86_64")]
const WINFSP_DLL: &str = "winfsp-x64.dll";
#[cfg(target_arch = "x86")]
const WINFSP_DLL: &str = "winfsp-x86.dll";
#[cfg(target_arch = "aarch64")]
const WINFSP_DLL: &str = "winfsp-a64.dll";

type LiveHost = FileSystemHost<StashFileSystemContext<HttpRangeProvider<ApiLeaseSource>>, FineGuard>;

/// Loads the installed WinFsp DLL by its absolute installation path before
/// the delay-loaded binding asks Windows for it by name. Development builds
/// run from Cargo's target directory, which is not part of the WinFsp DLL
/// search path.
fn preload_winfsp() -> Result<(), String> {
    let roots = ["ProgramFiles(x86)", "ProgramFiles"];
    for variable in roots {
        let Some(root) = std::env::var_os(variable) else { continue };
        let directory = std::path::PathBuf::from(root)
            .join("WinFsp")
            .join("bin");
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

#[derive(Clone, Default)]
pub struct MountController {
    state: Arc<Mutex<MountState>>,
    host: Arc<Mutex<Option<LiveHost>>>,
}

impl MountController {
    pub fn status(&self) -> MountStatus {
        let state = self.state.lock().expect("mount state lock poisoned");
        MountStatus::from(&*state)
    }

    pub async fn mount(&self) -> Result<MountStatus, String> {
        if self.state.lock().expect("mount state lock poisoned").mounted {
            return Ok(self.status());
        }

        // WinFsp dynamically loads its native DLL. It must be initialized
        // before a host is created; otherwise a delay-load exception can
        // escape the native boundary and terminate the desktop process.
        preload_winfsp()?;
        winfsp::winfsp_init()
            .map_err(|err| format!("STASH couldn't initialize the Windows drive service: {err:?}"))?;

        // An account with no committed files is still a valid STASH: mount
        // it as an empty, usable root directory. Explorer and creative apps
        // can then use the same S: drive before the first file arrives.
        let files = crate::api::list_root_files().await?;
        let context = StashFileSystemContext::new(mount_entries(files));

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
                .read_only_volume(true)
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

/// Translates committed API rows into the read-only entries exposed by the
/// current mount. An empty committed listing deliberately yields an empty
/// directory rather than rejecting the mount.
fn mount_entries(
    files: Vec<crate::api::ChildItem>,
) -> Vec<StashFile<HttpRangeProvider<ApiLeaseSource>>> {
    let mut entries = Vec::with_capacity(files.len());
    for file in files {
        let Some(file_id) = file.file_id else { continue };
        let provider = HttpRangeProvider::new(ApiLeaseSource { file_id });
        entries.push(StashFile::new(
            &file.name,
            file.size_bytes.unwrap_or(0),
            SEGMENT_SIZE,
            READ_TIMEOUT,
            provider,
        ));
    }
    entries
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
    fn unmount_is_idempotent() {
        let controller = MountController::default();
        assert!(controller.unmount().is_ok());
        assert!(controller.unmount().is_ok());
        assert!(!controller.status().mounted);
    }

    #[test]
    fn empty_committed_listing_creates_an_empty_mount_root() {
        // Regression: an empty STASH is a valid, mountable drive. The live
        // WinFSP host receives this empty entry table instead of an error.
        assert!(mount_entries(Vec::new()).is_empty());
    }
}
