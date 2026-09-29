//! Rust-owned calls to the authenticated STASH control plane.
//!
//! The webview supplies only safe route inputs. The Cognito ID token is read
//! from `auth`'s process-local state and is never returned to JavaScript,
//! persisted, or written to logs.

use reqwest::{Client, StatusCode};
use serde::{de::DeserializeOwned, Deserialize};
use serde_json::{json, Value};

const DEFAULT_API_URL: &str = "https://9fvkogmupj.execute-api.ap-south-1.amazonaws.com";

pub(crate) fn api_url() -> String {
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
        Some(message) if message.len() <= 240 && safe_message(&message) => message,
        _ if status == StatusCode::UNAUTHORIZED => {
            "Your sign-in has expired. Please sign in again.".to_string()
        }
        _ => format!("STASH returned an error ({})", status.as_u16()),
    }
}

fn safe_message(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    ![
        "http://",
        "https://",
        "s3://",
        "presigned",
        "bearer ",
        "authorization",
        "credential",
        "object key",
        "upload id",
        "etag",
        "token",
        "secret",
    ]
    .iter()
    .any(|term| lower.contains(term))
}

pub(crate) async fn get_json(path: &str) -> Result<Value, String> {
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

pub(crate) struct UploadApi {
    client: Client,
}

impl UploadApi {
    pub(crate) fn new() -> Self {
        Self {
            client: Client::new(),
        }
    }

    pub(crate) async fn post<T: DeserializeOwned>(
        &self,
        path: &str,
        body: &Value,
        idempotency: Option<String>,
    ) -> Result<T, String> {
        let token = crate::auth::id_token()?;
        let mut request = self
            .client
            .post(format!("{}{path}", api_url()))
            .bearer_auth(token)
            .json(body);
        if let Some(key) = idempotency {
            request = request.header("Idempotency-Key", key);
        }
        let response = request.send().await.map_err(|_| {
            "STASH could not be reached. Check your connection and try again.".to_string()
        })?;
        decode_json(response).await
    }

    pub(crate) async fn post_value(
        &self,
        path: &str,
        body: &Value,
        idempotency: Option<String>,
    ) -> Result<Value, String> {
        self.post(path, body, idempotency).await
    }

    pub(crate) async fn delete_value(&self, path: &str) -> Result<Value, String> {
        let token = crate::auth::id_token()?;
        let response = self
            .client
            .delete(format!("{}{path}", api_url()))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|_| "STASH could not be reached. Check your connection and try again.".to_string())?;
        decode_json(response).await
    }
}

async fn decode_json<T: DeserializeOwned>(response: reqwest::Response) -> Result<T, String> {
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

/// The caller's Stashes, most recent first (Recent Stashes).
#[tauri::command]
pub async fn list_stashes() -> Result<Value, String> {
    get_json("/stashes?limit=25").await
}

#[tauri::command]
pub async fn get_usage() -> Result<Value, String> {
    get_json("/me/usage").await
}

#[tauri::command]
pub async fn create_folder(name: String, parent_folder_id: String) -> Result<Value, String> {
    let name = name.trim();
    if name.is_empty() || name.len() > 255 || name.contains(['/', '\\']) || name == "." || name == ".." {
        return Err("That folder name cannot be used in STASH.".to_string());
    }
    let parent = parent_folder_id.trim();
    UploadApi::new()
        .post_value(
            "/folders",
            &json!({
                "name": name,
                "parentFolderId": if parent.is_empty() || parent == "ROOT" { Value::Null } else { Value::String(parent.to_string()) },
            }),
            None,
        )
        .await
}

/// An id is safe to place in a route path: 1–128 of `[A-Za-z0-9_-]`.
fn safe_route_id(value: &str) -> Option<&str> {
    let id = value.trim();
    let valid = !id.is_empty()
        && id.len() <= 128
        && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'));
    valid.then_some(id)
}

#[tauri::command]
pub async fn trash_folder(folder_id: String) -> Result<Value, String> {
    let id = safe_route_id(&folder_id)
        .ok_or_else(|| "That folder could not be moved to Trash.".to_string())?;
    UploadApi::new().delete_value(&format!("/folders/{id}")).await
}

#[tauri::command]
pub async fn trash_file(file_id: String) -> Result<Value, String> {
    let id = safe_route_id(&file_id)
        .ok_or_else(|| "That file could not be moved to Trash.".to_string())?;
    UploadApi::new().delete_value(&format!("/files/{id}")).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_url_has_no_trailing_slash() {
        assert!(!api_url().ends_with('/'));
    }

    #[test]
    fn route_ids_cannot_escape_their_path_segment() {
        assert_eq!(safe_route_id(" file_01-AB "), Some("file_01-AB"));
        for unsafe_id in ["", "../stashes", "a/b", "a?b", "a b", &"x".repeat(129)] {
            assert_eq!(safe_route_id(unsafe_id), None, "{unsafe_id:?}");
        }
    }

    #[test]
    fn error_formatter_does_not_echo_unstructured_body() {
        let error = safe_http_error(StatusCode::INTERNAL_SERVER_ERROR, "token=secret");
        assert!(!error.contains("secret"));
        assert_eq!(error, "STASH returned an error (500)");
    }
}
