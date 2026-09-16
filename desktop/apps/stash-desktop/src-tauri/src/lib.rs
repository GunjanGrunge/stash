//! The desktop shell owns the welcome window and Cognito sign-in. It still
//! has no filesystem or mount dependency — that's a later slice.

mod api;
mod auth;
mod mount;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(mount::MountController::default())
        .invoke_handler(tauri::generate_handler![
            auth::sign_in,
            auth::complete_new_password,
            api::list_children,
            api::get_usage,
            mount::mount_status,
            mount::mount_stash,
            mount::unmount_stash
        ])
        .run(tauri::generate_context!())
        .expect("error while running the STASH desktop shell");
}
