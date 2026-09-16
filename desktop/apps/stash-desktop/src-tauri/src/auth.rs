//! Cognito sign-in for the STASH desktop shell.
//!
//! Runs entirely from the Rust side: the webview never talks to Cognito
//! directly, only calling these Tauri commands over IPC. The window's CSP
//! only had to widen by the one narrow exception Tauri's own IPC transport
//! needs (`http://ipc.localhost`) — it still blocks the webview from
//! reaching Cognito, AWS, or anything else directly. No AWS access key is
//! used or needed here — Cognito's
//! `InitiateAuth`/`RespondToAuthChallenge` are called with only the User
//! Pool ID and App Client ID, both public, non-secret identifiers (per the
//! project's own rule: no permanent AWS credentials distributed to a
//! client).
//!
//! This pool is SRP-only (no plaintext password auth flow, no app-client
//! secret), so the flow is: compute SRP_A, InitiateAuth(USER_SRP_AUTH),
//! verify against the returned SRP_B/salt, RespondToAuthChallenge
//! (PASSWORD_VERIFIER). A user created via admin-create-user starts in
//! FORCE_CHANGE_PASSWORD, so Cognito answers with a NEW_PASSWORD_REQUIRED
//! challenge instead of tokens on first sign-in; `complete_new_password`
//! answers that second challenge.
//!
//! A rotating Cognito refresh token is kept in Windows Credential Manager so
//! the desktop app can restore a session after restart. The password and the
//! short-lived ID token are never persisted.
use aws_cognito_srp::{SrpClient, User, VerificationParameters};
use aws_sdk_cognitoidentityprovider::config::{Credentials, Region};
use aws_sdk_cognitoidentityprovider::types::{AuthFlowType, ChallengeNameType};
use aws_sdk_cognitoidentityprovider::Client;
use serde::Serialize;
use std::sync::{Mutex, OnceLock};

const REGION: &str = "ap-south-1";
const USER_POOL_ID: &str = "ap-south-1_0ELYEOOy0";
const CLIENT_ID: &str = "6ovr480b8f4lhuvdvvonsk8atp";
const REFRESH_TOKEN_SERVICE: &str = "com.stash.desktop";
const REFRESH_TOKEN_ACCOUNT: &str = "cognito-refresh-token";

/// Short-lived access material is process-local only. It is deliberately not
/// part of `AuthOutcome`, so Tauri never serializes it into the webview.
static ID_TOKEN: OnceLock<Mutex<Option<String>>> = OnceLock::new();

pub(crate) fn id_token() -> Result<String, String> {
    ID_TOKEN
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| "Sign-in session is unavailable.".to_string())?
        .clone()
        .ok_or_else(|| "Please sign in again to access your STASH.".to_string())
}

fn retain_id_token(token: Option<&str>) -> Result<(), String> {
    let token = token
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Cognito accepted the password but returned no ID token.".to_string())?;
    *ID_TOKEN
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| "Sign-in session is unavailable.".to_string())? = Some(token.to_owned());
    Ok(())
}

fn refresh_token_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(REFRESH_TOKEN_SERVICE, REFRESH_TOKEN_ACCOUNT)
        .map_err(|_| "STASH couldn't access Windows Credential Manager.".to_string())
}

fn store_refresh_token(token: Option<&str>) -> Result<(), String> {
    let token = token.filter(|value| !value.is_empty()).ok_or_else(|| {
        "Cognito accepted the password but returned no refresh token.".to_string()
    })?;
    refresh_token_entry()?
        .set_password(token)
        .map_err(|_| "STASH couldn't save your sign-in session.".to_string())
}

fn clear_refresh_token() {
    if let Ok(entry) = refresh_token_entry() { let _ = entry.delete_credential(); }
}

#[derive(Serialize)]
#[serde(tag = "outcome")]
pub enum AuthOutcome {
    SignedIn {
        username: String,
    },
    NewPasswordRequired {
        session: Option<String>,
        username: String,
    },
}

#[derive(Serialize)]
#[serde(tag = "outcome")]
pub enum RestoreOutcome { SignedIn, SignedOut }

fn retain_initial_session(
    result: &aws_sdk_cognitoidentityprovider::types::AuthenticationResultType,
) -> Result<(), String> {
    retain_id_token(result.id_token())?;
    store_refresh_token(result.refresh_token())
}

fn retain_restored_session(
    result: &aws_sdk_cognitoidentityprovider::types::AuthenticationResultType,
) -> Result<(), String> {
    retain_id_token(result.id_token())?;
    // Rotation normally supplies a replacement refresh token. If a provider
    // ever omits it, retain the existing Credential Manager entry instead of
    // throwing away a still-valid remembered session.
    if result
        .refresh_token()
        .is_some_and(|token| !token.is_empty())
    {
        store_refresh_token(result.refresh_token())?;
    }
    Ok(())
}

async fn cognito_client() -> Client {
    // These operations are unauthenticated (unsigned) Cognito public APIs;
    // the placeholder credentials below are never sent anywhere and never
    // used to sign a request.
    let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(Region::new(REGION))
        .credentials_provider(Credentials::new(
            "unused",
            "unused",
            None,
            None,
            "stash-desktop-unauthenticated-cognito-calls",
        ))
        .load()
        .await;
    Client::new(&config)
}

#[tauri::command]
pub async fn sign_in(username: String, password: String) -> Result<AuthOutcome, String> {
    let cognito = cognito_client().await;
    let srp = SrpClient::new(
        User::new(USER_POOL_ID, &username, &password),
        CLIENT_ID,
        None,
    );
    let params = srp.get_auth_parameters();

    let initiate = cognito
        .initiate_auth()
        .client_id(CLIENT_ID)
        .auth_flow(AuthFlowType::UserSrpAuth)
        .auth_parameters("USERNAME", params.username)
        .auth_parameters("SRP_A", params.a)
        .send()
        .await
        .map_err(|err| format!("Couldn't start sign-in: {err:?}"))?;

    let challenge_params = initiate.challenge_parameters.unwrap_or_default();
    // A session token is not always present — for the single-round-trip
    // PASSWORD_VERIFIER challenge, continuity lives inside the opaque
    // SECRET_BLOCK instead. Only later challenges (e.g. NEW_PASSWORD_REQUIRED)
    // reliably need one carried forward, so this stays optional here.
    let session = initiate.session;

    let secret_block = challenge_params
        .get("SECRET_BLOCK")
        .ok_or_else(|| "Cognito's challenge was missing SECRET_BLOCK.".to_string())?;
    let salt = challenge_params
        .get("SALT")
        .ok_or_else(|| "Cognito's challenge was missing SALT.".to_string())?;
    let srp_b = challenge_params
        .get("SRP_B")
        .ok_or_else(|| "Cognito's challenge was missing SRP_B.".to_string())?;
    let user_id = challenge_params
        .get("USER_ID_FOR_SRP")
        .ok_or_else(|| "Cognito's challenge was missing USER_ID_FOR_SRP.".to_string())?;

    let VerificationParameters {
        password_claim_secret_block,
        password_claim_signature,
        timestamp,
    } = srp
        .verify(secret_block, user_id, salt, srp_b)
        .map_err(|err| format!("Couldn't verify the password: {err}"))?;

    let response = cognito
        .respond_to_auth_challenge()
        .client_id(CLIENT_ID)
        .challenge_name(ChallengeNameType::PasswordVerifier)
        .set_session(session)
        .challenge_responses("USERNAME", user_id.clone())
        .challenge_responses("PASSWORD_CLAIM_SECRET_BLOCK", password_claim_secret_block)
        .challenge_responses("PASSWORD_CLAIM_SIGNATURE", password_claim_signature)
        .challenge_responses("TIMESTAMP", timestamp)
        .send()
        .await
        .map_err(|err| describe_challenge_error(&err))?;

    if let Some(challenge) = &response.challenge_name {
        return if *challenge == ChallengeNameType::NewPasswordRequired {
            Ok(AuthOutcome::NewPasswordRequired {
                session: response.session,
                username,
            })
        } else {
            Err(format!(
                "Cognito asked for an unsupported next step: {challenge:?}"
            ))
        };
    }

    if let Some(result) = response.authentication_result.as_ref() {
        retain_initial_session(result)?;
        Ok(AuthOutcome::SignedIn { username })
    } else {
        Err("Cognito accepted the password but returned no tokens.".to_string())
    }
}

#[tauri::command]
pub async fn complete_new_password(
    username: String,
    new_password: String,
    session: Option<String>,
) -> Result<AuthOutcome, String> {
    let cognito = cognito_client().await;
    let response = cognito
        .respond_to_auth_challenge()
        .client_id(CLIENT_ID)
        .challenge_name(ChallengeNameType::NewPasswordRequired)
        .set_session(session)
        .challenge_responses("USERNAME", username.clone())
        .challenge_responses("NEW_PASSWORD", new_password)
        .send()
        .await
        .map_err(|err| describe_challenge_error(&err))?;

    if let Some(result) = response.authentication_result.as_ref() {
        retain_initial_session(result)?;
        Ok(AuthOutcome::SignedIn { username })
    } else {
        Err("Cognito accepted the new password but returned no tokens.".to_string())
    }
}

#[tauri::command]
pub async fn restore_session() -> Result<RestoreOutcome, String> {
    let refresh_token = match refresh_token_entry()?.get_password() {
        Ok(token) if !token.is_empty() => token,
        _ => return Ok(RestoreOutcome::SignedOut),
    };
    let response = cognito_client().await
        .get_tokens_from_refresh_token()
        .client_id(CLIENT_ID)
        .refresh_token(refresh_token)
        .send().await;
    let Ok(response) = response else {
        clear_refresh_token();
        return Ok(RestoreOutcome::SignedOut);
    };
    let Some(result) = response.authentication_result() else {
        clear_refresh_token();
        return Ok(RestoreOutcome::SignedOut);
    };
    retain_restored_session(result)?;
    Ok(RestoreOutcome::SignedIn)
}

#[tauri::command]
pub fn sign_out() -> Result<(), String> {
    clear_refresh_token();
    *ID_TOKEN.get_or_init(|| Mutex::new(None)).lock()
        .map_err(|_| "Sign-in session is unavailable.".to_string())? = None;
    Ok(())
}

/// Maps a few common, actionable Cognito errors to plain messages. Anything
/// else falls back to the SDK's own debug output rather than hiding it.
fn describe_challenge_error<E: std::fmt::Debug>(err: &E) -> String {
    let debug = format!("{err:?}");
    if debug.contains("NotAuthorizedException") {
        "Incorrect username or password.".to_string()
    } else if debug.contains("UserNotFoundException") {
        "No account found for that username.".to_string()
    } else if debug.contains("InvalidPasswordException") {
        "That password doesn't meet the account's password requirements.".to_string()
    } else {
        debug
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signed_in_outcome_never_serializes_token_material() {
        let json = serde_json::to_string(&AuthOutcome::SignedIn {
            username: "creator@example.com".to_string(),
        })
        .expect("auth outcome is serializable");
        assert_eq!(
            json,
            r#"{"outcome":"SignedIn","username":"creator@example.com"}"#
        );
        assert!(!json.contains("token"));
    }

    #[test]
    fn restored_outcomes_never_expose_credential_material() {
        assert_eq!(
            serde_json::to_string(&RestoreOutcome::SignedIn).expect("outcome is serializable"),
            r#"{"outcome":"SignedIn"}"#
        );
        assert_eq!(
            serde_json::to_string(&RestoreOutcome::SignedOut).expect("outcome is serializable"),
            r#"{"outcome":"SignedOut"}"#
        );
    }
}
