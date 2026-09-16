const status = document.querySelector("#account-status");
const appWindow = window.__TAURI__?.window?.getCurrentWindow?.();
const invoke = window.__TAURI__?.core?.invoke;

const windowActions = {
  minimize: () => appWindow?.minimize(),
  "toggle-maximize": () => appWindow?.toggleMaximize(),
  close: () => appWindow?.close(),
};

document.querySelectorAll("[data-window-action]").forEach((control) => {
  control.addEventListener("click", () => {
    windowActions[control.dataset.windowAction]?.();
  });
});

document.querySelector(".titlebar")?.addEventListener("mousedown", (event) => {
  if (event.target.closest("button, [data-account-action]")) return;
  appWindow?.startDragging();
});

const welcomeCard = document.querySelector(".welcome-card");
const signinCard = document.querySelector("#signin-card");
const newPasswordCard = document.querySelector("#new-password-card");
const signinForm = document.querySelector("#signin-form");
const signinStatus = document.querySelector("#signin-status");
const newPasswordForm = document.querySelector("#new-password-form");
const newPasswordStatus = document.querySelector("#new-password-status");

// Carries the session token between the sign-in attempt and the
// new-password challenge, if the account requires one. Never a token that
// grants access on its own.
let pendingNewPassword = null;

function showCard(card) {
  [welcomeCard, signinCard, newPasswordCard].forEach((section) => {
    if (section) section.hidden = section !== card;
  });
}

function setStatus(element, message, tone) {
  if (!element) return;
  element.textContent = message;
  if (tone) element.dataset.tone = tone;
  else delete element.dataset.tone;
}

function showBrowserAfterSignIn() {
  if (typeof window.dispatchEvent !== "function" || typeof window.CustomEvent !== "function") return;
  window.dispatchEvent(new CustomEvent("stash:signed-in"));
}

document.querySelectorAll("[data-account-action]").forEach((action) => {
  action.addEventListener("click", () => {
    const kind = action.dataset.accountAction;
    if (kind === "sign-in") {
      setStatus(signinStatus, "");
      showCard(signinCard);
      return;
    }
    if (kind === "cancel-sign-in") {
      showCard(welcomeCard);
      return;
    }
    const label = kind === "create-account" ? "Create account" : "Sign in";
    status.textContent = `${label} is coming next. No account connection has been made.`;
  });
});

signinForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!invoke) {
    setStatus(signinStatus, "Sign-in isn't available in this build.", "error");
    return;
  }
  const username = document.querySelector("#signin-username")?.value ?? "";
  const password = document.querySelector("#signin-password")?.value ?? "";
  setStatus(signinStatus, "Signing in...");
  try {
    const result = await invoke("sign_in", { username, password });
    if (result.outcome === "SignedIn") {
      setStatus(signinStatus, `Signed in as ${result.username}.`);
      showBrowserAfterSignIn();
    } else if (result.outcome === "NewPasswordRequired") {
      pendingNewPassword = { session: result.session, username: result.username };
      setStatus(newPasswordStatus, "");
      showCard(newPasswordCard);
    }
  } catch (error) {
    setStatus(signinStatus, String(error), "error");
  }
});

newPasswordForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!invoke || !pendingNewPassword) {
    setStatus(newPasswordStatus, "Sign-in isn't available in this build.", "error");
    return;
  }
  const newPassword = document.querySelector("#new-password")?.value ?? "";
  setStatus(newPasswordStatus, "Setting your new password...");
  try {
    const result = await invoke("complete_new_password", {
      username: pendingNewPassword.username,
      newPassword,
      session: pendingNewPassword.session,
    });
    if (result.outcome === "SignedIn") {
      pendingNewPassword = null;
      setStatus(newPasswordStatus, `Signed in as ${result.username}.`);
      showBrowserAfterSignIn();
    }
  } catch (error) {
    setStatus(newPasswordStatus, String(error), "error");
  }
});

// A remembered session is restored by Rust from Windows Credential Manager.
// No password or token reaches this webview.
(async () => {
  if (!invoke) return;
  try {
    const result = await invoke("restore_session");
    if (result?.outcome === "SignedIn") showBrowserAfterSignIn();
  } catch (_) {
    // Credential access failures leave the normal sign-in path available.
  }
})();
