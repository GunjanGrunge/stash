//! The desktop shell owns the welcome window, Cognito sign-in, and the
//! process-lifetime mount controller. STASH lives in the tray: closing the
//! window closes only the window (its web view's memory is freed) while the
//! drive and uploads keep running; only Quit or Unmount detaches the live
//! WinFsp host. At launch STASH restores the session, resumes unfinished
//! uploads and reconnects S: as the creator's settings say, with or without
//! a window (a start at Windows sign-in opens none).

mod api;
mod auth;
mod device;
mod events;
mod mount;
mod prefs;
mod preview;
mod search;
mod startup;
mod upload;

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, DragDropEvent, Emitter, Manager, RunEvent, WebviewWindowBuilder, WindowEvent,
};

const TRAY_ID: &str = "stash-tray";
const TRAY_SHOW_ID: &str = "tray-show-stash";
const TRAY_UNMOUNT_ID: &str = "tray-unmount-stash";
const TRAY_QUIT_ID: &str = "tray-quit-stash";
const TRAY_SHOW_LABEL: &str = "Show STASH";
const TRAY_UNMOUNT_LABEL: &str = "Unmount STASH";
const TRAY_QUIT_LABEL: &str = "Quit STASH";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TrayCommand {
    Show,
    Unmount,
    Quit,
}

fn tray_command(id: &str) -> Option<TrayCommand> {
    match id {
        TRAY_SHOW_ID => Some(TrayCommand::Show),
        TRAY_UNMOUNT_ID => Some(TrayCommand::Unmount),
        TRAY_QUIT_ID => Some(TrayCommand::Quit),
        _ => None,
    }
}

fn tray_command_unmounts(command: TrayCommand) -> bool {
    matches!(command, TrayCommand::Unmount | TrayCommand::Quit)
}

/// Shows the main window, opening a fresh one if it was closed to the tray.
fn show_stash(app: &AppHandle) -> Result<(), String> {
    let window = match app.get_webview_window("main") {
        Some(window) => window,
        None => {
            let config = app
                .config()
                .app
                .windows
                .first()
                .cloned()
                .ok_or_else(|| "STASH's main window is unavailable.".to_string())?;
            WebviewWindowBuilder::from_config(app, &config)
                .and_then(|builder| builder.build())
                .map_err(|error| error.to_string())?
        }
    };
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

fn handle_tray_command(app: &AppHandle, command: TrayCommand) {
    if tray_command_unmounts(command) {
        let result = app.state::<mount::MountController>().unmount();
        match result {
            Ok(status) => {
                // Unmount is the creator's choice and is remembered; Quit is
                // not, so S: comes back the next time STASH starts.
                if command == TrayCommand::Unmount {
                    app.state::<prefs::PreferenceStore>().remember_mounted(false);
                    let _ = app.emit(mount::MOUNT_EVENT, status);
                }
            }
            Err(error) => eprintln!("Couldn't unmount STASH: {error}"),
        }
        if command == TrayCommand::Quit {
            app.exit(0);
        }
        return;
    }

    if let Err(error) = show_stash(app) {
        eprintln!("Couldn't show STASH: {error}");
    }
}

fn build_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let show = MenuItemBuilder::with_id(TRAY_SHOW_ID, TRAY_SHOW_LABEL).build(app)?;
    let unmount = MenuItemBuilder::with_id(TRAY_UNMOUNT_ID, TRAY_UNMOUNT_LABEL).build(app)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id(TRAY_QUIT_ID, TRAY_QUIT_LABEL).build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&show, &unmount, &separator, &quit])
        .build()?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(
            app.default_window_icon()
                .expect("STASH has a configured app icon")
                .clone(),
        )
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            if let Some(command) = tray_command(event.id().as_ref()) {
                handle_tray_command(app, command);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    ..
                } | TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                handle_tray_command(&tray.app_handle(), TrayCommand::Show);
            }
        })
        .build(app)?;
    Ok(())
}

/// What STASH does as it starts, window or not: restore the saved sign-in,
/// pick up uploads from S: that had not landed, and reconnect S: if the
/// creator's settings say so. Without a saved sign-in it waits for sign-in.
async fn resume_at_launch(app: AppHandle) {
    if !matches!(auth::restore_session().await, Ok(auth::RestoreOutcome::SignedIn)) {
        return;
    }
    app.state::<upload::UploadController>().resume_saved_uploads();
    if app.state::<prefs::PreferenceStore>().get().mounts_at_launch() {
        match app.state::<mount::MountController>().mount().await {
            Ok(status) => {
                let _ = app.emit(mount::MOUNT_EVENT, status);
            }
            Err(error) => eprintln!("Couldn't reconnect S: at launch: {error}"),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let uploads = upload::UploadController::default();
    let started_at_login = startup::launched_at_login(std::env::args());
    let app = tauri::Builder::default()
        // Opening STASH while it runs in the tray shows the running one; a
        // second process would fight over S: and the upload queue.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Err(error) = show_stash(app) {
                eprintln!("Couldn't show STASH: {error}");
            }
        }))
        // Previews stream from here; each request runs off the UI thread.
        .register_asynchronous_uri_scheme_protocol(preview::SCHEME, |_ctx, request, responder| {
            std::thread::spawn(move || responder.respond(preview::respond(&request)));
        })
        .manage(mount::MountController::with_uploads(uploads.clone()))
        .manage(uploads)
        .manage(search::SearchController::default())
        .setup(move |app| {
            let preferences = app.path().app_config_dir().ok().map(|dir| dir.join("preferences.json"));
            let store = prefs::PreferenceStore::load(preferences);
            // Keeps the Run entry pointing at this executable (or removed).
            if let Err(error) = startup::set_launch_at_login(store.get().launch_at_login) {
                eprintln!("{error}");
            }
            app.manage(store);
            events::init(app.handle());
            build_tray(app)?;
            // A start at Windows sign-in stays in the tray; otherwise open the window.
            if !started_at_login {
                if let Err(error) = show_stash(app.handle()) {
                    eprintln!("Couldn't open STASH: {error}");
                }
            }
            tauri::async_runtime::spawn(resume_at_launch(app.handle().clone()));
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            match event {
                // Closing lets the window go (freeing its web view); STASH
                // itself keeps running in the tray, see `RunEvent` below.
                WindowEvent::CloseRequested { .. } => {}
                WindowEvent::DragDrop(DragDropEvent::Enter { .. })
                | WindowEvent::DragDrop(DragDropEvent::Over { .. }) => {
                    let _ = window.emit(
                        "stash-drop",
                        upload::DropNotice {
                            phase: "over".into(),
                            summary: None,
                            message: None,
                        },
                    );
                }
                WindowEvent::DragDrop(DragDropEvent::Leave { .. }) => {
                    let _ = window.emit(
                        "stash-drop",
                        upload::DropNotice {
                            phase: "leave".into(),
                            summary: None,
                            message: None,
                        },
                    );
                }
                WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) => {
                    let controller = window.state::<upload::UploadController>();
                    let notice = if paths.len() != 1 {
                        upload::DropNotice {
                            phase: "rejected".into(),
                            summary: None,
                            message: Some("Drop one file or folder at a time.".into()),
                        }
                    } else {
                        match controller.select_source_path(paths[0].clone()) {
                            Ok(summary) => upload::DropNotice {
                                phase: "accepted".into(),
                                summary: Some(summary),
                                message: None,
                            },
                            Err(error) => upload::DropNotice {
                                phase: "rejected".into(),
                                summary: None,
                                message: Some(error),
                            },
                        }
                    };
                    let _ = window.emit("stash-drop", notice);
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            auth::sign_in,
            auth::complete_new_password,
            auth::restore_session,
            auth::sign_out,
            api::list_children,
            api::get_usage,
            api::list_stashes,
            api::create_folder,
            api::trash_folder,
            api::trash_file,
            search::search_stash,
            search::storage_breakdown,
            device::device_info,
            mount::mount_status,
            mount::mount_stash,
            mount::unmount_stash,
            upload::select_stash_source,
            upload::confirm_stash,
            upload::get_transfer_status,
            upload::cancel_stash,
            prefs::get_preferences,
            prefs::set_preferences,
            preview::describe_file,
            preview::open_on_drive
        ])
        .build(tauri::generate_context!())
        .expect("error while building the STASH desktop shell");
    app.run(|_app, event| {
        // The last window closing is not a reason to quit: STASH stays in the
        // tray. Quit (an explicit exit code) still exits.
        if let RunEvent::ExitRequested { code: None, api, .. } = event {
            api.prevent_exit();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_ids_map_only_to_the_stable_commands() {
        assert_eq!(tray_command(TRAY_SHOW_ID), Some(TrayCommand::Show));
        assert_eq!(tray_command(TRAY_UNMOUNT_ID), Some(TrayCommand::Unmount));
        assert_eq!(tray_command(TRAY_QUIT_ID), Some(TrayCommand::Quit));
        assert_eq!(tray_command("unknown-command"), None);
    }

    #[test]
    fn tray_lifecycle_intent_unmounts_before_unmount_or_quit() {
        assert!(!tray_command_unmounts(TrayCommand::Show));
        assert!(tray_command_unmounts(TrayCommand::Unmount));
        assert!(tray_command_unmounts(TrayCommand::Quit));
    }

    #[test]
    fn tray_labels_are_accessible_and_stable() {
        assert_eq!(TRAY_SHOW_LABEL, "Show STASH");
        assert_eq!(TRAY_UNMOUNT_LABEL, "Unmount STASH");
        assert_eq!(TRAY_QUIT_LABEL, "Quit STASH");
    }

    #[test]
    fn tray_ids_are_stable_and_distinct() {
        assert_ne!(TRAY_ID, TRAY_SHOW_ID);
        assert_ne!(TRAY_SHOW_ID, TRAY_UNMOUNT_ID);
        assert_ne!(TRAY_UNMOUNT_ID, TRAY_QUIT_ID);
    }
}
