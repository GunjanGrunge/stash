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
//! When the creator opts in, a rotating Cognito refresh token is kept in
//! Windows Credential Manager so the desktop app can restore a session after
//! restart. The password and the short-lived ID token are never persisted.
use aws_cognito_srp::{SrpClient, User, VerificationParameters};
use aws_sdk_cognitoidentityprovider::config::{Credentials, Region};
use aws_sdk_cognitoidentityprovider::types::{AuthFlowType, ChallengeNameType};
use aws_sdk_cognitoidentityprovider::Client;
use serde::Serialize;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const REGION: &str = "ap-south-1";
const USER_POOL_ID: &str = "ap-south-1_0ELYEOOy0";
const CLIENT_ID: &str = "6ovr480b8f4lhuvdvvonsk8atp";
const REFRESH_TOKEN_SERVICE: &str = "com.stash.desktop";
const REFRESH_TOKEN_ACCOUNT: &str = "cognito-refresh-token";

/// Cognito ID tokens live for one hour (the pool keeps the default). A webview
/// reload inside this window reuses the token; after it, the session is renewed
/// from the refresh token instead of sending the creator back to sign-in.
const ID_TOKEN_REUSE_WINDOW: Duration = Duration::from_secs(50 * 60);

/// The signed-in session, process-local only. Nothing here is part of
/// `AuthOutcome`, so Tauri never serializes it into the webview. The refresh
/// token is kept in memory for every sign-in, so reloading the window does not
/// sign the creator out; it reaches Credential Manager only when they opted in.
struct Session {
    id_token: String,
    obtained_at: Instant,
    refresh_token: Option<String>,
    remembered: bool,
}

static SESSION: OnceLock<Mutex<Option<Session>>> = OnceLock::new();

fn session() -> Result<std::sync::MutexGuard<'static, Option<Session>>, String> {
    SESSION
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| "Sign-in session is unavailable.".to_string())
}

pub(crate) fn id_token() -> Result<String, String> {
    session()?
        .as_ref()
        .map(|current| current.id_token.clone())
        .ok_or_else(|| "Please sign in again to access your STASH.".to_string())
}

fn is_fresh(obtained_at: Instant, now: Instant) -> bool {
    now.saturating_duration_since(obtained_at) < ID_TOKEN_REUSE_WINDOW
}

/// Replaces the in-memory session. A missing replacement refresh token keeps
/// the previous one: Cognito rotation normally supplies one, but omitting it
/// must not throw away a still-valid session.
fn retain_session(
    id_token: Option<&str>,
    refresh_token: Option<&str>,
    remembered: bool,
) -> Result<(), String> {
    let id_token = validated_id_token(id_token)?.to_owned();
    let mut current = session()?;
    let refresh_token = refresh_token
        .filter(|token| !token.is_empty())
        .map(str::to_owned)
        .or_else(|| current.as_mut().and_then(|previous| previous.refresh_token.take()));
    *current = Some(Session {
        id_token,
        obtained_at: Instant::now(),
        refresh_token,
        remembered,
    });
    Ok(())
}

fn validated_id_token(token: Option<&str>) -> Result<&str, String> {
    token
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Cognito accepted the password but returned no ID token.".to_string())
}

fn refresh_token_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(REFRESH_TOKEN_SERVICE, REFRESH_TOKEN_ACCOUNT)
        .map_err(|_| "STASH couldn't access Windows Credential Manager.".to_string())
}

trait RefreshTokenStore {
    fn read(&self) -> Result<Vec<u8>, ()>;
    fn store(&self, token: &[u8]) -> Result<(), ()>;
    fn clear(&self) -> Result<(), ()>;
}

struct CredentialManagerStore;

impl RefreshTokenStore for CredentialManagerStore {
    fn read(&self) -> Result<Vec<u8>, ()> {
        refresh_token_entry()
            .map_err(|_| ())?
            .get_secret()
            .map_err(|_| ())
    }

    fn store(&self, token: &[u8]) -> Result<(), ()> {
        refresh_token_entry()
            .map_err(|_| ())?
            // `set_password` converts text to UTF-16 before writing it. A rotated
            // Cognito token can then exceed Credential Manager's small blob limit.
            // It is opaque OAuth material, not a user password, so preserve it as
            // its original UTF-8 bytes instead.
            .set_secret(token)
            .map_err(|_| ())
    }

    fn clear(&self) -> Result<(), ()> {
        let entry = refresh_token_entry().map_err(|_| ())?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(()),
        }
    }
}

fn usable_refresh_token(bytes: Vec<u8>) -> Option<String> {
    String::from_utf8(bytes)
        .ok()
        .filter(|token| !token.is_empty())
}

fn required_refresh_token(token: Option<&str>) -> Result<&str, String> {
    token
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Cognito accepted the password but returned no refresh token.".to_string())
}

fn persist_initial_session<S: RefreshTokenStore>(
    id_token: Option<&str>,
    refresh_token: Option<&str>,
    remember: bool,
    store: &S,
) -> Result<String, String> {
    // Validate before any durable write. An incomplete Cognito response must
    // never leave a remembered credential behind.
    let id_token = validated_id_token(id_token)?;
    if remember {
        store
            .store(required_refresh_token(refresh_token)?.as_bytes())
            .map_err(|_| "STASH couldn't save your sign-in session.".to_string())?;
    } else {
        // Opting out must not turn a successful sign-in into a failure merely
        // because an old local entry is inaccessible. Cleanup is best-effort.
        let _ = store.clear();
    }
    Ok(id_token.to_owned())
}

fn restore_refresh_token<S: RefreshTokenStore>(store: &S) -> Option<String> {
    match store.read() {
        Ok(bytes) => match usable_refresh_token(bytes) {
            Some(token) => Some(token),
            None => {
                let _ = store.clear();
                None
            }
        },
        Err(_) => {
            // Delete directly rather than gating deletion on a successful
            // read: corrupt or unreadable Credential Manager entries can
            // still often be removed.
            let _ = store.clear();
            None
        }
    }
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
pub enum RestoreOutcome {
    SignedIn,
    SignedOut,
}

fn retain_initial_session(
    result: &aws_sdk_cognitoidentityprovider::types::AuthenticationResultType,
    remember: bool,
) -> Result<(), String> {
    let id_token = persist_initial_session(
        result.id_token(),
        result.refresh_token(),
        remember,
        &CredentialManagerStore,
    )?;
    retain_session(Some(&id_token), result.refresh_token(), remember)
}

fn retain_restored_session(
    result: &aws_sdk_cognitoidentityprovider::types::AuthenticationResultType,
    remembered: bool,
) -> Result<(), String> {
    retain_session(result.id_token(), result.refresh_token(), remembered)?;
    // Rotation normally supplies a replacement refresh token. If a provider
    // ever omits it, retain the existing Credential Manager entry instead of
    // throwing away a still-valid remembered session. A session the creator
    // did not ask to remember is never written to Credential Manager.
    if remembered
        && result
            .refresh_token()
            .is_some_and(|token| !token.is_empty())
    {
        CredentialManagerStore
            .store(required_refresh_token(result.refresh_token())?.as_bytes())
            .map_err(|_| "STASH couldn't save your sign-in session.".to_string())?;
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
pub async fn sign_in(
    username: String,
    password: String,
    remember: bool,
) -> Result<AuthOutcome, String> {
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
        retain_initial_session(result, remember)?;
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
    remember: bool,
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
        retain_initial_session(result, remember)?;
        Ok(AuthOutcome::SignedIn { username })
    } else {
        Err("Cognito accepted the new password but returned no tokens.".to_string())
    }
}

#[tauri::command]
pub async fn restore_session() -> Result<RestoreOutcome, String> {
    // STASH restores the session itself at launch while the window may ask
    // too. Two refreshes of one rotating token can invalidate each other, so
    // restores run one at a time; the second finds the fresh session.
    static RESTORING: OnceLock<tauri::async_runtime::Mutex<()>> = OnceLock::new();
    let _one_at_a_time = RESTORING.get_or_init(|| tauri::async_runtime::Mutex::new(())).lock().await;
    let store = CredentialManagerStore;
    // A window reload keeps the process, and with it the session: reuse it
    // rather than asking the creator to sign in again.
    let in_memory = {
        let current = session()?;
        match current.as_ref() {
            Some(live) if is_fresh(live.obtained_at, Instant::now()) => {
                return Ok(RestoreOutcome::SignedIn)
            }
            Some(live) => live.refresh_token.clone().map(|token| (token, live.remembered)),
            None => None,
        }
    };
    let Some((refresh_token, remembered)) =
        in_memory.or_else(|| restore_refresh_token(&store).map(|token| (token, true)))
    else {
        return Ok(RestoreOutcome::SignedOut);
    };
    let response = cognito_client()
        .await
        .get_tokens_from_refresh_token()
        .client_id(CLIENT_ID)
        .refresh_token(refresh_token)
        .send()
        .await;
    let result = response
        .ok()
        .and_then(|response| response.authentication_result().cloned());
    let Some(result) = result else {
        *session()? = None;
        if remembered {
            let _ = store.clear();
        }
        return Ok(RestoreOutcome::SignedOut);
    };
    retain_restored_session(&result, remembered)?;
    Ok(RestoreOutcome::SignedIn)
}

#[tauri::command]
pub fn sign_out(search: tauri::State<'_, crate::search::SearchController>) -> Result<(), String> {
    search.clear();
    *session()? = None;
    CredentialManagerStore
        .clear()
        .map_err(|_| "STASH couldn't remove the remembered sign-in from this device.".to_string())
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
    use std::cell::{Cell, RefCell};

    struct FakeStore {
        read: Result<Vec<u8>, ()>,
        store_error: bool,
        clear_error: bool,
        stored: RefCell<Vec<Vec<u8>>>,
        clears: Cell<usize>,
    }

    impl RefreshTokenStore for FakeStore {
        fn read(&self) -> Result<Vec<u8>, ()> {
            self.read.clone()
        }
        fn store(&self, token: &[u8]) -> Result<(), ()> {
            if self.store_error {
                Err(())
            } else {
                self.stored.borrow_mut().push(token.to_vec());
                Ok(())
            }
        }
        fn clear(&self) -> Result<(), ()> {
            self.clears.set(self.clears.get() + 1);
            if self.clear_error {
                Err(())
            } else {
                Ok(())
            }
        }
    }

    fn fake_store(read: Result<Vec<u8>, ()>) -> FakeStore {
        FakeStore {
            read,
            store_error: false,
            clear_error: false,
            stored: RefCell::new(Vec::new()),
            clears: Cell::new(0),
        }
    }

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

    #[test]
    fn only_nonempty_utf8_refresh_material_is_eligible_for_restore() {
        assert_eq!(
            usable_refresh_token(b"opaque-refresh-material".to_vec()).as_deref(),
            Some("opaque-refresh-material")
        );
        assert_eq!(usable_refresh_token(Vec::new()), None);
        assert_eq!(usable_refresh_token(vec![0xff]), None);
    }

    #[test]
    fn opted_in_persists_only_after_validating_the_id_token() {
        let store = fake_store(Err(()));
        assert_eq!(
            persist_initial_session(Some("id"), Some("refresh"), true, &store),
            Ok("id".to_string())
        );
        assert_eq!(store.stored.borrow().as_slice(), [b"refresh".to_vec()]);

        let store = fake_store(Err(()));
        assert!(persist_initial_session(None, Some("refresh"), true, &store).is_err());
        assert!(store.stored.borrow().is_empty());
    }

    #[test]
    fn opted_out_cleanup_is_best_effort_but_opted_in_storage_failure_is_reported() {
        let store = FakeStore {
            clear_error: true,
            ..fake_store(Err(()))
        };
        assert_eq!(
            persist_initial_session(Some("id"), None, false, &store),
            Ok("id".to_string())
        );
        assert_eq!(store.clears.get(), 1);

        let store = FakeStore {
            store_error: true,
            ..fake_store(Err(()))
        };
        assert!(persist_initial_session(Some("id"), Some("refresh"), true, &store).is_err());
    }

    #[test]
    fn invalid_or_unreadable_entries_are_cleared_before_restore_is_abandoned() {
        let invalid = fake_store(Ok(vec![0xff]));
        assert_eq!(restore_refresh_token(&invalid), None);
        assert_eq!(invalid.clears.get(), 1);

        let unreadable = fake_store(Err(()));
        assert_eq!(restore_refresh_token(&unreadable), None);
        assert_eq!(unreadable.clears.get(), 1);
    }

    #[test]
    fn a_reload_within_the_token_lifetime_reuses_the_session() {
        let signed_in = Instant::now();
        assert!(is_fresh(signed_in, signed_in + Duration::from_secs(10 * 60)));
        assert!(!is_fresh(signed_in, signed_in + Duration::from_secs(55 * 60)));
        // A clock that appears to run backwards must not panic.
        assert!(is_fresh(signed_in + Duration::from_secs(5), signed_in));
    }

    #[test]
    fn the_in_memory_session_keeps_its_refresh_token_across_renewal() {
        retain_session(Some("id-1"), Some("refresh-1"), false).unwrap();
        // Cognito may omit a rotated refresh token; the previous one survives.
        retain_session(Some("id-2"), None, false).unwrap();
        {
            let current = session().unwrap();
            let live = current.as_ref().unwrap();
            assert_eq!(live.id_token, "id-2");
            assert_eq!(live.refresh_token.as_deref(), Some("refresh-1"));
            assert!(!live.remembered);
        }
        assert_eq!(id_token().unwrap(), "id-2");
        *session().unwrap() = None;
        assert!(id_token().is_err());
    }
}
