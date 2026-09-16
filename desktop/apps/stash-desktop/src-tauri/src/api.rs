//! Rust-owned calls to the authenticated STASH control plane.
//!
//! The webview supplies only safe route inputs. The Cognito ID token is read
//! from `auth`'s process-local state and is never returned to JavaScript,
//! persisted, or written to logs.

use reqwest::{Client, StatusCode};
use serde::Deserialize;
use serde_json::Value;

const DEFAULT_API_URL: &str = "https://8ojdkvlefl.execute-api.ap-south-1.amazonaws.com";

fn api_url() -> String {
    option_env!("STASH_API_URL")
        .unwrap_or(DEFAULT_API_URL)
        .trim_end_matches('/')
        .to_string()
}

#[derive(Debug, Deserialize)]
struct ApiError {
    code: Option<String>,
    message: Option<String>,
}

fn safe_http_error(status: StatusCode, body: &str) -> String {
    let parsed = serde_json::from_str::<ApiError>(body).ok();
    match parsed.and_then(|e| e.message.or(e.code)) {
        Some(message) if message.len() <= 240 => message,
        _ if status == StatusCode::UNAUTHORIZED => {
            "Your sign-in has expired. Please sign in again.".to_string()
        }
        _ => format!("STASH returned an error ({})", status.as_u16()),
    }
}

async fn get_json(path: &str) -> Result<Value, String> {
    let token = crate::auth::id_token()?;
    let response = Client::new()
        .get(format!("{}{path}", api_url()))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| {
            "STASH could not be reached. Check your connection and try again.".to_string()
        })?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|_| "STASH returned an unreadable response.".to_string())?;
    if !status.is_success() {
        return Err(safe_http_error(status, &body));
    }
    serde_json::from_str(&body).map_err(|_| "STASH returned an unreadable response.".to_string())
}

#[tauri::command]
pub async fn list_children(folder_id: String) -> Result<Value, String> {
    let folder_id = folder_id.trim();
    if folder_id.is_empty()
        || folder_id.len() > 128
        || folder_id
            .chars()
            .any(|c| !c.is_ascii_alphanumeric() && !matches!(c, '-' | '_'))
    {
        return Err("That folder could not be opened.".to_string());
    }
    get_json(&format!("/folders/{folder_id}/children")).await
}

#[tauri::command]
pub async fn get_usage() -> Result<Value, String> {
    get_json("/me/usage").await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_url_has_no_trailing_slash() {
        assert!(!api_url().ends_with('/'));
    }

    #[test]
    fn error_formatter_does_not_echo_unstructured_body() {
        let error = safe_http_error(StatusCode::INTERNAL_SERVER_ERROR, "token=secret");
        assert!(!error.contains("secret"));
        assert_eq!(error, "STASH returned an error (500)");
    }
}
