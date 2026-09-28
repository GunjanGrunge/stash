// Dev-only screen preview: renders the real app screens with sample data.
//   ?screen=Home|Files|Search|Recent Stashes|Offline|Transfers|Settings
//   &stash=1   open Stash it
//   ?view=welcome   the signed-out Welcome screen
import { StrictMode, useReducer } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/roboto-mono/400.css";
import "../src/styles.css";
import { Shell } from "../src/components/Shell";
import { NAV_ITEMS } from "../src/components/NavigationRail";
import { TitleBar } from "../src/components/TitleBar";
import { WelcomeScreen } from "../src/components/WelcomeScreen";
import { authReducer } from "../src/state/authMachine";
import { createPreviewGateway } from "./fakeGateway";

type Screen = typeof NAV_ITEMS[number];

const params = new URLSearchParams(location.search);
const gateway = createPreviewGateway();
const requested = params.get("screen") ?? "Home";
const screen = (NAV_ITEMS as readonly string[]).includes(requested) ? (requested as Screen) : "Home";

function Preview() {
  const [auth, dispatch] = useReducer(authReducer, { view: "welcome" });
  return (
    <div className="app-shell-root">
      <TitleBar gateway={gateway} />
      {params.get("view") === "welcome"
        ? <WelcomeScreen gateway={gateway} state={auth} dispatch={dispatch} />
        : <Shell gateway={gateway} username="Maya Chen" onSignOut={() => undefined} initialScreen={screen} initialStashOpen={params.get("stash") === "1"} />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Preview /></StrictMode>);
