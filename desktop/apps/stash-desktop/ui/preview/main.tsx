// Dev-only screen preview: renders the real app screens with sample data.
//   ?screen=Home|Files|Search|Recent Stashes|Offline|Transfers|Settings
//   &stash=1   open Stash it
//   &q=…       start Search with this query
//   ?view=welcome   the signed-out Welcome screen
//   ?view=asset     Asset details for a sample kick (a generated tone)
import { StrictMode, useReducer } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/roboto-mono/400.css";
import "../src/styles.css";
import "../src/figma-screens.css";
import { AssetDetailsScreen } from "../src/components/AssetDetailsScreen";
import { Shell } from "../src/components/Shell";
import type { SettingsSection } from "../src/components/SettingsScreen";
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
      {params.get("view") === "asset"
        ? <main className="app-main"><AssetDetailsScreen gateway={gateway} mounted asset={{ fileId: "k1", name: "Kick_G#_128.wav", sizeBytes: 4_800_000, folders: ["KSHMR Vol 5", "Kicks"] }} onBack={() => undefined} /></main>
        : params.get("view") === "welcome"
        ? <WelcomeScreen gateway={gateway} state={auth} dispatch={dispatch} />
        : <Shell gateway={gateway} username="Maya Chen" onSignOut={() => undefined} initialScreen={screen} initialStashOpen={params.get("stash") === "1"} initialSettingsSection={(params.get("section") ?? "General") as SettingsSection} initialSearchQuery={params.get("q") ?? ""} />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Preview /></StrictMode>);
