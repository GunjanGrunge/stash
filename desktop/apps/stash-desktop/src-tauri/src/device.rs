//! Facts about this workstation that the UI shows as "this device".

use serde::Serialize;

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    /// The computer name Windows shows, e.g. "GUNJAN-PC".
    pub name: String,
    pub os: &'static str,
    pub app_version: &'static str,
}

fn device_name(raw: Option<String>) -> String {
    raw.map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty() && name.len() <= 64)
        .unwrap_or_else(|| "This computer".to_string())
}

#[tauri::command]
pub fn device_info() -> DeviceInfo {
    DeviceInfo {
        name: device_name(std::env::var("COMPUTERNAME").ok().or_else(|| std::env::var("HOSTNAME").ok())),
        os: if cfg!(target_os = "windows") { "Windows" } else if cfg!(target_os = "macos") { "macOS" } else { "Linux" },
        app_version: env!("CARGO_PKG_VERSION"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_name_falls_back_when_missing_or_odd() {
        assert_eq!(device_name(Some("  GUNJAN-PC ".into())), "GUNJAN-PC");
        assert_eq!(device_name(None), "This computer");
        assert_eq!(device_name(Some("".into())), "This computer");
        assert_eq!(device_name(Some("x".repeat(100))), "This computer");
    }
}
