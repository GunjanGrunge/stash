//! The desktop shell owns the welcome window and Cognito sign-in. It still
//! has no filesystem or mount dependency — that's a later slice.

mod auth;
mod api;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            auth::sign_in,
            auth::complete_new_password,
            api::list_children,
            api::get_usage
        ])
        .run(tauri::generate_context!())
        .expect("error while running the STASH desktop shell");
}
