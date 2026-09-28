import { useEffect, useMemo, useReducer, useState } from "react";
import { TitleBar } from "../components/TitleBar";
import { WelcomeScreen } from "../components/WelcomeScreen";
import { Shell } from "../components/Shell";
import { SplashScreen } from "../components/SplashScreen";
import { authReducer, initialAuthState } from "../state/authMachine";
import { createTauriGateway, safeActionError } from "../platform/tauri/gateway";

export function App() {
  const gateway = useMemo(() => createTauriGateway(), []);
  const [auth, dispatch] = useReducer(authReducer, initialAuthState);
  const [showSplash, setShowSplash] = useState(true);
  const [signOutError, setSignOutError] = useState("");

  useEffect(() => {
    let active = true;
    void gateway.auth.restoreSession().then((result) => {
      if (!active) return;
      dispatch(result.outcome === "SignedIn" ? { type: "RESTORE_SIGNED_IN", username: "Your STASH" } : { type: "RESTORE_SIGNED_OUT" });
    }).catch(() => { if (active) dispatch({ type: "RESTORE_SIGNED_OUT" }); });
    return () => { active = false; };
  }, [gateway]);

  const signOut = async () => {
    setSignOutError("");
    try { await gateway.auth.signOut(); dispatch({ type: "RESTORE_SIGNED_OUT" }); }
    catch (error) { setSignOutError(safeActionError(error, "We couldn't sign you out. Try again.")); }
  };

  if (showSplash) {
    return <SplashScreen onComplete={() => setShowSplash(false)} />;
  }

  return (
    <div className="app-shell-root">
      <TitleBar gateway={gateway} />
      {auth.view === "signedIn" ? (
        <Shell gateway={gateway} username={auth.username} onSignOut={() => void signOut()} signOutError={signOutError} />
      ) : (
        <WelcomeScreen gateway={gateway} state={auth} dispatch={dispatch} />
      )}
    </div>
  );
}
