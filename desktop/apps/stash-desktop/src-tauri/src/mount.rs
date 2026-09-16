//! Virtual-drive lifecycle boundary.
//!
//! The filesystem driver is a separate service boundary.  This module owns
//! only its lifecycle state; it deliberately does not delete cloud objects or
//! cache files when a drive is detached.  Until the production WinFsp service
//! is attached, mount requests return an explicit error rather than claiming
//! that a drive was mounted.

use serde::Serialize;
use std::sync::{Arc, Mutex};

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
}

impl MountController {
    pub fn status(&self) -> MountStatus {
        let state = self.state.lock().expect("mount state lock poisoned");
        MountStatus::from(&*state)
    }

    pub fn mount(&self) -> Result<MountStatus, String> {
        let state = self.state.lock().expect("mount state lock poisoned");
        if state.mounted {
            return Ok(MountStatus::from(&*state));
        }
        // Do not fake a successful mount. The production implementation must
        // start/attach the WinFsp service and choose an available drive letter.
        Err("The STASH drive service is not available yet.".to_string())
    }

    pub fn unmount(&self) -> Result<MountStatus, String> {
        let mut state = self.state.lock().expect("mount state lock poisoned");
        // Detaching is intentionally idempotent. No cloud API, cache path, or
        // user file is touched by this operation.
        state.mounted = false;
        state.letter = None;
        Ok(MountStatus::from(&*state))
    }

    #[cfg(test)]
    fn mark_mounted_for_test(&self, letter: char) {
        let mut state = self.state.lock().expect("mount state lock poisoned");
        state.mounted = true;
        state.letter = Some(letter);
    }
}

#[tauri::command]
pub async fn mount_status(state: tauri::State<'_, MountController>) -> Result<MountStatus, String> {
    Ok(state.status())
}

#[tauri::command]
pub async fn mount_stash(state: tauri::State<'_, MountController>) -> Result<MountStatus, String> {
    state.mount()
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
    fn unavailable_backend_never_claims_mount_success() {
        let controller = MountController::default();
        assert!(controller.mount().is_err());
        assert!(!controller.status().mounted);
    }

    #[test]
    fn unmount_is_idempotent_and_only_clears_attachment_state() {
        let controller = MountController::default();
        controller.mark_mounted_for_test('X');
        assert_eq!(controller.unmount().unwrap().letter, None);
        assert_eq!(controller.unmount().unwrap().letter, None);
        assert!(!controller.status().mounted);
    }

    #[test]
    fn status_preserves_stash_label() {
        let controller = MountController::default();
        controller.mark_mounted_for_test('X');
        let status = controller.status();
        assert_eq!(status.label, "STASH");
        assert_eq!(status.letter.as_deref(), Some("X"));
    }
}
