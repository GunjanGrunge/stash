//! Workstation preferences: starting with Windows and reconnecting S:.
//!
//! Stored as a small JSON file in the app's config folder. `was_mounted` is
//! not a setting the creator edits: it records whether S: was mounted when
//! STASH last ran, so "Mount S: when STASH starts" reconnects only a drive
//! the creator had connected, never one they deliberately unmounted.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Preferences {
    /// Start STASH (in the tray, no window) when the creator signs in to Windows.
    pub launch_at_login: bool,
    /// When STASH starts, mount S: again if it was mounted last time.
    pub mount_at_launch: bool,
    pub was_mounted: bool,
}

impl Default for Preferences {
    fn default() -> Self {
        Self { launch_at_login: true, mount_at_launch: true, was_mounted: false }
    }
}

impl Preferences {
    /// Whether this launch should mount S: without being asked.
    pub fn mounts_at_launch(&self) -> bool {
        self.mount_at_launch && self.was_mounted
    }
}

pub struct PreferenceStore {
    path: Option<PathBuf>,
    current: Mutex<Preferences>,
}

impl PreferenceStore {
    /// Reads saved preferences; a missing or unreadable file means defaults.
    pub fn load(path: Option<PathBuf>) -> Self {
        let current = path
            .as_ref()
            .and_then(|path| std::fs::read(path).ok())
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self { path, current: Mutex::new(current) }
    }

    pub fn get(&self) -> Preferences {
        *self.current.lock().expect("preferences lock poisoned")
    }

    /// Applies a change and saves it (write to a temp file, then rename, so a
    /// crash never leaves half a file).
    pub fn update(&self, change: impl FnOnce(&mut Preferences)) -> Result<Preferences, String> {
        let mut current = self.current.lock().map_err(|_| "Preferences are unavailable.".to_string())?;
        let mut next = *current;
        change(&mut next);
        if let Some(path) = &self.path {
            let failed = || "STASH couldn't save your settings.".to_string();
            if let Some(dir) = path.parent() {
                std::fs::create_dir_all(dir).map_err(|_| failed())?;
            }
            let temp = path.with_extension("json.tmp");
            std::fs::write(&temp, serde_json::to_vec_pretty(&next).map_err(|_| failed())?).map_err(|_| failed())?;
            std::fs::rename(&temp, path).map_err(|_| failed())?;
        }
        *current = next;
        Ok(next)
    }

    /// Records whether S: is mounted, for the next launch. Best-effort.
    pub fn remember_mounted(&self, mounted: bool) {
        if self.get().was_mounted != mounted {
            if let Err(error) = self.update(|prefs| prefs.was_mounted = mounted) {
                eprintln!("{error}");
            }
        }
    }
}

#[tauri::command]
pub fn get_preferences(store: tauri::State<'_, PreferenceStore>) -> Preferences {
    store.get()
}

#[tauri::command]
pub fn set_preferences(
    launch_at_login: bool,
    mount_at_launch: bool,
    store: tauri::State<'_, PreferenceStore>,
) -> Result<Preferences, String> {
    crate::startup::set_launch_at_login(launch_at_login)?;
    store.update(|prefs| {
        prefs.launch_at_login = launch_at_login;
        prefs.mount_at_launch = mount_at_launch;
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("stash-prefs-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir.join("preferences.json")
    }

    #[test]
    fn a_first_run_starts_with_windows_but_mounts_nothing_yet() {
        let prefs = PreferenceStore::load(Some(scratch("first"))).get();
        assert!(prefs.launch_at_login && prefs.mount_at_launch);
        assert!(!prefs.mounts_at_launch(), "S: was never mounted, so nothing to reconnect");
    }

    #[test]
    fn preferences_survive_a_restart() {
        let path = scratch("restart");
        let store = PreferenceStore::load(Some(path.clone()));
        store.update(|prefs| prefs.launch_at_login = false).unwrap();
        store.remember_mounted(true);
        let reloaded = PreferenceStore::load(Some(path.clone())).get();
        assert_eq!(reloaded, Preferences { launch_at_login: false, mount_at_launch: true, was_mounted: true });
        assert!(reloaded.mounts_at_launch());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn a_drive_the_creator_unmounted_or_opted_out_of_stays_unmounted() {
        let unmounted = Preferences { was_mounted: false, ..Preferences::default() };
        let opted_out = Preferences { mount_at_launch: false, was_mounted: true, ..Preferences::default() };
        assert!(!unmounted.mounts_at_launch());
        assert!(!opted_out.mounts_at_launch());
    }

    #[test]
    fn a_damaged_file_falls_back_to_defaults() {
        let path = scratch("damaged");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"{not json").unwrap();
        assert_eq!(PreferenceStore::load(Some(path.clone())).get(), Preferences::default());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
