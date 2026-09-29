//! Starting STASH when the creator signs in to Windows: one value under the
//! per-user Run key (no admin rights, removed cleanly when switched off).

use std::path::Path;
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
use windows::Win32::System::Registry::{RegDeleteKeyValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ};

/// Passed by the Run entry: STASH starts in the tray without opening a window.
pub const AUTOSTART_ARG: &str = "--autostart";

const RUN_KEY: PCWSTR = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
const RUN_VALUE: PCWSTR = w!("STASH");

/// The command Windows runs at sign-in: this executable, quoted, in tray mode.
pub fn launch_command(exe: &Path) -> String {
    format!("\"{}\" {AUTOSTART_ARG}", exe.display())
}

/// Whether this process was started by the Run entry.
pub fn launched_at_login(args: impl IntoIterator<Item = String>) -> bool {
    args.into_iter().any(|arg| arg == AUTOSTART_ARG)
}

/// Adds or removes the Run entry. Re-adding refreshes the path, so an app
/// that moved (an update, a reinstall) still starts.
pub fn set_launch_at_login(enabled: bool) -> Result<(), String> {
    let failed = || "STASH couldn't change whether it starts with Windows.".to_string();
    if enabled {
        let exe = std::env::current_exe().map_err(|_| failed())?;
        let command: Vec<u16> = launch_command(&exe).encode_utf16().chain(Some(0)).collect();
        // SAFETY: the key, value name and data are valid NUL-terminated wide
        // strings that outlive the call; the byte count matches the buffer.
        let status = unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                RUN_KEY,
                RUN_VALUE,
                REG_SZ.0,
                Some(command.as_ptr().cast()),
                (command.len() * 2) as u32,
            )
        };
        if status == ERROR_SUCCESS { Ok(()) } else { Err(failed()) }
    } else {
        // SAFETY: constant NUL-terminated wide strings.
        let status = unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, RUN_KEY, RUN_VALUE) };
        if status == ERROR_SUCCESS || status == ERROR_FILE_NOT_FOUND { Ok(()) } else { Err(failed()) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_run_entry_quotes_the_path_and_starts_in_the_tray() {
        let exe = Path::new(r"C:\Program Files\STASH\stash-desktop.exe");
        assert_eq!(launch_command(exe), r#""C:\Program Files\STASH\stash-desktop.exe" --autostart"#);
    }

    #[test]
    fn only_the_run_entry_starts_stash_without_a_window() {
        assert!(launched_at_login(["stash-desktop.exe".to_string(), "--autostart".to_string()]));
        assert!(!launched_at_login(["stash-desktop.exe".to_string()]));
    }
}
