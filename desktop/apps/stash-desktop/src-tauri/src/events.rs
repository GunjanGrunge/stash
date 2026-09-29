//! Tells an open window the moment the creator's STASH changes, from
//! wherever the change happened: a delete or new folder on S:, a file queued
//! from S:, an upload landing, or an action in the app. The window refreshes
//! what it shows instead of waiting to be clicked back into.

use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

pub const LIBRARY_EVENT: &str = "stash-library";

static APP: OnceLock<AppHandle> = OnceLock::new();

/// Called once at startup; before it, changes simply are not announced.
pub fn init(app: &AppHandle) {
    let _ = APP.set(app.clone());
}

/// Safe from any thread (WinFsp dispatchers, upload workers, commands).
pub fn library_changed() {
    if let Some(app) = APP.get() {
        let _ = app.emit(LIBRARY_EVENT, ());
    }
}
