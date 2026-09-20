import { useRef, useState } from "react";
import type { AuthEvent, AuthState } from "../state/authMachine";
import { authOutcomeEvent, firstInvalidSignInField } from "../state/authMachine";
import type { DesktopGateway } from "../platform/contracts";
import { safeActionError } from "../platform/tauri/gateway";

type Props = { gateway: DesktopGateway; state: AuthState; dispatch: React.Dispatch<AuthEvent> };

export function WelcomeScreen({ gateway, state, dispatch }: Props) {
  const username = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);
  const newPassword = useRef<HTMLInputElement>(null);
  const [remember, setRemember] = useState(false);
  const [validation, setValidation] = useState("");
  const isSignIn = state.view === "signIn";

  async function submitSignIn(event: React.FormEvent) {
    event.preventDefault();
    const name = username.current?.value.trim() ?? "";
    const secret = password.current?.value ?? "";
    const invalidField = firstInvalidSignInField(name, secret);
    if (invalidField === "username") { setValidation("Enter your username and password to continue."); username.current?.focus(); return; }
    if (invalidField === "password") { setValidation("Enter your username and password to continue."); password.current?.focus(); return; }
    setValidation(""); dispatch({ type: "SIGN_IN_STARTED" });
    try { const result = await gateway.auth.signIn(name, secret, remember); dispatch(authOutcomeEvent(result, remember)); }
    catch (error) { dispatch({ type: "SIGN_IN_FAILED", message: safeActionError(error, "Sign-in is unavailable. Check your connection and try again.") }); }
  }

  const backToWelcome = () => { gateway.auth.clearPendingChallenge(); dispatch({ type: "BACK_TO_WELCOME" }); };

  async function submitNewPassword(event: React.FormEvent) {
    event.preventDefault();
    const next = newPassword.current?.value ?? "";
    if (next.length < 8) { setValidation("Choose a new password with at least 8 characters."); newPassword.current?.focus(); return; }
    if (state.view !== "newPassword") return;
    setValidation(""); dispatch({ type: "NEW_PASSWORD_STARTED" });
    try { const result = await gateway.auth.completeNewPassword(state.username, next, state.remember); dispatch(authOutcomeEvent(result, state.remember)); }
    catch (error) { dispatch({ type: "NEW_PASSWORD_FAILED", message: safeActionError(error, "We couldn't set your new password. Try again.") }); }
  }

  if (state.view === "restoring") return <main className="auth-stage"><section className="auth-card" aria-live="polite"><p className="eyebrow">Welcome</p><h1>Restoring your STASH.</h1><p className="value">Checking for a remembered sign-in on this device.</p><p className="status">Loading…</p></section></main>;
  if (state.view === "newPassword") return <main className="auth-stage"><section className="auth-card" aria-labelledby="new-password-heading"><p className="eyebrow">Set a new password</p><h1 id="new-password-heading">This account needs a new password.</h1><p className="value">Choose a new password to finish signing in.</p><form className="auth-form" onSubmit={submitNewPassword} noValidate><label className="field"><span>New password</span><input ref={newPassword} type="password" autoComplete="new-password" minLength={8} required /></label><div className="actions"><button className="button button-primary" type="submit" disabled={state.busy}>{state.busy ? "Setting your new password…" : "Set password and sign in"}</button><button className="button button-secondary" type="button" onClick={backToWelcome}>Back</button></div></form><Status message={validation || state.error} error={Boolean(validation || state.error)} /></section></main>;
  if (isSignIn) return <main className="auth-stage"><section className="auth-card" aria-labelledby="signin-heading"><p className="eyebrow">Sign in</p><h1 id="signin-heading">Welcome back.</h1><form className="auth-form" onSubmit={submitSignIn} noValidate><label className="field"><span>Username</span><input ref={username} type="text" autoComplete="username" required /></label><label className="field"><span>Password</span><input ref={password} type="password" autoComplete="current-password" required /></label><label className="remember-choice"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /><span>Remember me on this device</span></label><div className="actions"><button className="button button-primary" type="submit" disabled={state.busy}>{state.busy ? "Signing in…" : "Sign in"}</button><button className="button button-secondary" type="button" onClick={backToWelcome}>Back</button></div></form><Status message={validation || state.error} error={Boolean(validation || state.error)} /></section></main>;
  return <main className="auth-stage"><section className="auth-card" aria-labelledby="welcome-heading"><p className="eyebrow">Welcome</p><h1 id="welcome-heading">Your creator library, right where you work.</h1><p className="value">Stash it when you need room. Keep your folder structure intact, find your assets, and use them anywhere.</p><div className="actions"><button className="button button-primary" type="button" onClick={() => dispatch({ type: "OPEN_SIGN_IN" })}>Sign in</button><button className="button button-secondary" type="button" onClick={() => setValidation(gateway.unavailable("home"))}>Create account</button></div><Status message={validation || "Create account is coming next. No account connection has been made."} /></section></main>;
}

function Status({ message, error = false }: { message?: string; error?: boolean }) { return <p className={`status${error ? " status-error" : ""}`} role={error ? "alert" : "status"} aria-live="polite">{message}</p>; }
