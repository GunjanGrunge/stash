//! The desktop shell deliberately owns only the welcome window. It has no
//! filesystem, authentication, cloud, or IPC dependency.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running the STASH desktop shell");
}
