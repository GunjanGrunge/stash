import { useEffect, useRef, useState } from "react";
import type { AuthEvent, AuthState } from "../state/authMachine";
import { authOutcomeEvent, firstInvalidSignInField } from "../state/authMachine";
import type { DesktopGateway } from "../platform/contracts";
import { safeActionError } from "../platform/tauri/gateway";
import appleIcon from "../assets/figma/welcome/apple.svg";
import audioWaveformIcon from "../assets/figma/welcome/audio-waveform.svg";
import chromeIcon from "../assets/figma/welcome/chrome.svg";
import layersIcon from "../assets/figma/welcome/layers-3.svg";
import platformDot from "../assets/figma/welcome/platform-dot.svg";
import videoStill from "../assets/figma/welcome/video-still.jpg";

type Props = { gateway: DesktopGateway; state: AuthState; dispatch: React.Dispatch<AuthEvent> };

/** Bar heights from the Figma "Waveform" frame (node 3:23504). */
const WAVE_BARS = [8, 15, 23, 12, 30, 20, 10, 25, 16, 28, 12, 21, 8, 18];

const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/** Figma "Welcome and sign in" (node 6:4): welcome story + sign-in card. */
export function WelcomeScreen({ gateway, state, dispatch }: Props) {
  return (
    <main className="welcome-layout">
      <WelcomeStory />
      <section className="welcome-signin-area">
        <SignInCard gateway={gateway} state={state} dispatch={dispatch} />
      </section>
    </main>
  );
}

function WelcomeStory() {
  return (
    <section className="welcome-story" aria-label="About STASH">
      <div className="welcome-brand">
        <span className="welcome-brand-mark" aria-hidden="true">S</span>
        <span className="welcome-brand-name">STASH</span>
      </div>
      <div className="welcome-hero">
        <p className="welcome-platform">
          <img src={platformDot} width={6} height={6} alt="" />
          Virtual cloud SSD · Windows + macOS
        </p>
        <h1 className="welcome-title">Your creative drive,<br />without the drive.</h1>
        <p className="welcome-description">
          Stash projects exactly where they are. Pull any asset back at SSD speed, on every workstation, without rebuilding your folder system.
        </p>
      </div>
      <div className="welcome-media" aria-hidden="true">
        <div className="welcome-media-card welcome-audio-card">
          <img src={audioWaveformIcon} width={20} height={20} alt="" />
          <div className="welcome-wave">
            {WAVE_BARS.map((height, index) => <span key={index} style={{ height }} />)}
          </div>
          <div className="welcome-media-meta">
            <span className="welcome-media-name">Kick_G#_128.wav</span>
            <span className="welcome-media-path">KSHMR Vol 5 / Kicks</span>
          </div>
        </div>
        <img className="welcome-video-still" src={videoStill} alt="" />
        <div className="welcome-media-card welcome-project-card">
          <img src={layersIcon} width={22} height={22} alt="" />
          <div className="welcome-media-meta">
            <span className="welcome-media-name">NOCTURNE_EDIT_07</span>
            <span className="welcome-media-detail">AE · LUTs · ProRes · 84.6 GB</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function SignInCard({ gateway, state, dispatch }: Props) {
  const emailInput = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);
  const newPassword = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [remember, setRemember] = useState(false);
  const [validation, setValidation] = useState("");

  useEffect(() => {
    setValidation("");
    if (state.view === "welcome") emailInput.current?.focus();
    if (state.view === "signIn") password.current?.focus();
    if (state.view === "newPassword") newPassword.current?.focus();
  }, [state.view]);

  function continueWithEmail(event: React.FormEvent) {
    event.preventDefault();
    const value = email.trim();
    if (!looksLikeEmail(value)) { setValidation("Enter the email address for your STASH account."); emailInput.current?.focus(); return; }
    setEmail(value);
    dispatch({ type: "OPEN_SIGN_IN" });
  }

  async function submitSignIn(event: React.FormEvent) {
    event.preventDefault();
    const secret = password.current?.value ?? "";
    const invalidField = firstInvalidSignInField(email, secret);
    if (invalidField === "username") { dispatch({ type: "BACK_TO_WELCOME" }); return; }
    if (invalidField === "password") { setValidation("Enter your password to continue."); password.current?.focus(); return; }
    setValidation(""); dispatch({ type: "SIGN_IN_STARTED" });
    try { const result = await gateway.auth.signIn(email, secret, remember); dispatch(authOutcomeEvent(result, remember)); }
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

  const comingSoon = (provider: string) => setValidation(`${provider} sign-in is coming soon. Continue with email for now.`);

  if (state.view === "restoring") {
    return (
      <div className="welcome-card" aria-live="polite">
        <CardHeading title="Welcome back" description="Checking for a remembered sign-in on this device…" />
      </div>
    );
  }

  if (state.view === "newPassword") {
    return (
      <form className="welcome-card" aria-labelledby="welcome-card-title" onSubmit={submitNewPassword} noValidate>
        <CardHeading title="Set a new password" description="This account needs a new password to finish signing in." />
        <label className="welcome-field">
          <span>New password</span>
          <input ref={newPassword} type="password" autoComplete="new-password" minLength={8} required />
        </label>
        <button className="button button-primary welcome-wide" type="submit" disabled={state.busy}>
          {state.busy ? "Setting your new password…" : "Set password and sign in"}
        </button>
        <button className="button button-secondary welcome-wide" type="button" onClick={backToWelcome}>Back</button>
        <Status message={validation || state.error} error={Boolean(validation || state.error)} />
      </form>
    );
  }

  if (state.view === "signIn") {
    return (
      <form className="welcome-card" aria-labelledby="welcome-card-title" onSubmit={submitSignIn} noValidate>
        <CardHeading title="Welcome back" description="Enter your password to mount your STASH on this device." />
        <div className="welcome-field">
          <span>Email</span>
          <div className="welcome-email-chip">
            <span>{email}</span>
            <button type="button" className="welcome-link" onClick={backToWelcome}>Change</button>
          </div>
        </div>
        <label className="welcome-field">
          <span>Password</span>
          <input ref={password} type="password" autoComplete="current-password" required />
        </label>
        <label className="welcome-remember">
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          <span>Remember me on this device</span>
        </label>
        <button className="button button-primary welcome-wide" type="submit" disabled={state.busy}>
          {state.busy ? "Signing in…" : "Sign in"}
        </button>
        <Status message={validation || state.error} error={Boolean(validation || state.error)} />
      </form>
    );
  }

  return (
    <form className="welcome-card" aria-labelledby="welcome-card-title" onSubmit={continueWithEmail} noValidate>
      <CardHeading title="Welcome back" description="Sign in to mount your STASH on this device." />
      <label className="welcome-field">
        <span>Email</span>
        <input ref={emailInput} type="email" autoComplete="username" placeholder="you@studio.com" value={email} onChange={(event) => setEmail(event.target.value)} required />
      </label>
      <button className="button button-primary welcome-wide" type="submit">Continue with email</button>
      <div className="welcome-divider" role="separator"><span>OR</span></div>
      <button className="button button-secondary welcome-wide" type="button" onClick={() => comingSoon("Apple")}>
        <img src={appleIcon} width={16} height={16} alt="" />
        Continue with Apple
      </button>
      <button className="button button-secondary welcome-wide" type="button" onClick={() => comingSoon("Google")}>
        <img src={chromeIcon} width={16} height={16} alt="" />
        Continue with Google
      </button>
      <Status message={validation} error={Boolean(validation)} />
      <p className="welcome-terms">By continuing, you agree to STASH Terms and Privacy Policy.</p>
    </form>
  );
}

function CardHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="welcome-card-heading">
      <h2 id="welcome-card-title">{title}</h2>
      <p>{description}</p>
    </div>
  );
}

function Status({ message, error = false }: { message?: string; error?: boolean }) {
  if (!message) return null;
  return <p className={`welcome-status${error ? " is-error" : ""}`} role={error ? "alert" : "status"} aria-live="polite">{message}</p>;
}
