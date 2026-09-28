import type { AuthOutcome, AuthView } from "../domain/types";

export type AuthState =
  | { view: "restoring" }
  | { view: "welcome" }
  | { view: "signIn"; busy: boolean; error?: string }
  | { view: "newPassword"; busy: boolean; username: string; remember: boolean; error?: string }
  | { view: "signedIn"; username: string };

export type AuthEvent =
  | { type: "RESTORE_SIGNED_IN"; username: string }
  | { type: "RESTORE_SIGNED_OUT" }
  | { type: "OPEN_SIGN_IN" }
  | { type: "BACK_TO_WELCOME" }
  | { type: "SIGN_IN_STARTED" }
  | { type: "SIGN_IN_FAILED"; message: string }
  | { type: "NEW_PASSWORD_REQUIRED"; username: string; remember: boolean }
  | { type: "SIGNED_IN"; username: string }
  | { type: "NEW_PASSWORD_STARTED" }
  | { type: "NEW_PASSWORD_FAILED"; message: string };

export const initialAuthState: AuthState = { view: "restoring" };

export function authReducer(state: AuthState, event: AuthEvent): AuthState {
  switch (event.type) {
    case "RESTORE_SIGNED_IN": return { view: "signedIn", username: event.username };
    case "RESTORE_SIGNED_OUT": return { view: "welcome" };
    case "OPEN_SIGN_IN": return { view: "signIn", busy: false };
    case "BACK_TO_WELCOME": return { view: "welcome" };
    case "SIGN_IN_STARTED": return state.view === "signIn" ? { ...state, busy: true, error: undefined } : state;
    case "SIGN_IN_FAILED": return state.view === "signIn" ? { ...state, busy: false, error: event.message } : state;
    case "NEW_PASSWORD_REQUIRED": return { view: "newPassword", busy: false, username: event.username, remember: event.remember };
    case "SIGNED_IN": return { view: "signedIn", username: event.username };
    case "NEW_PASSWORD_STARTED": return state.view === "newPassword" ? { ...state, busy: true, error: undefined } : state;
    case "NEW_PASSWORD_FAILED": return state.view === "newPassword" ? { ...state, busy: false, error: event.message } : state;
  }
}

export function authOutcomeEvent(result: AuthOutcome, remember: boolean): AuthEvent {
  return result.outcome === "SignedIn"
    ? { type: "SIGNED_IN", username: result.username }
    : { type: "NEW_PASSWORD_REQUIRED", username: result.username, remember };
}

export function firstInvalidSignInField(username: string, password: string): "username" | "password" | null {
  if (!username.trim()) return "username";
  if (!password) return "password";
  return null;
}

export function authView(state: AuthState): AuthView {
  return state.view;
}
