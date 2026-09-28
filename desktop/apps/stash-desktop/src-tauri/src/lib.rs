//! The desktop shell owns the welcome window, Cognito sign-in, and the
//! process-lifetime mount controller. Closing the window hides it to the tray;
//! only an explicit unmount or quit detaches the live WinFsp host.

mod api;
mod auth;
mod mount;
mod search;
mod upload;

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, DragDropEvent, Emitter, Manager, WindowEvent,
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

fn show_stash(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "STASH's main window is unavailable.".to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

fn handle_tray_command(app: &AppHandle, command: TrayCommand) {
    if tray_command_unmounts(command) {
        let result = app.state::<mount::MountController>().unmount();
        if let Err(error) = result {
            eprintln!("Couldn't unmount STASH: {error}");
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let uploads = upload::UploadController::default();
    tauri::Builder::default()
        .manage(mount::MountController::with_uploads(uploads.clone()))
        .manage(uploads)
        .manage(search::SearchController::default())
        .setup(|app| {
            build_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    if let Err(error) = window.hide() {
                        eprintln!("Couldn't hide STASH to the tray: {error}");
                    }
                }
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
            api::create_folder,
            api::trash_folder,
            search::search_stash,
            mount::mount_status,
            mount::mount_stash,
            mount::unmount_stash,
            upload::select_stash_source,
            upload::confirm_stash,
            upload::get_transfer_status,
            upload::cancel_stash
        ])
        .run(tauri::generate_context!())
        .expect("error while running the STASH desktop shell");
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
