---
title: 'Launch the STASH Windows welcome screen'
type: 'feature'
created: '2026-09-16'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'a8b41e88036db5195946819aade4c50d8ad900ae'
context:
  - 'AGENT.md'
  - 'STASH_PRD_v0.1.md'
  - '_bmad-output/planning-artifacts/architecture/architecture-stash-2026-09-16/ARCHITECTURE-SPINE.md'
  - 'brand/BRAND-KIT.md'
  - 'brand/fonts/FONT-SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Windows-first STASH desktop client has a proven Rust mount
spike but no graphical entry point. A beta tester cannot yet open a branded
desktop application or understand how to begin safely.

**Approach:** Create exactly one launchable Tauri desktop shell containing the
Welcome / Sign in screen required by PRD §15. It presents STASH’s identity,
explains the mounted-drive value in restrained creator-first language, and
offers inert visual sign-in and account-creation actions. Authentication,
Cognito configuration, API calls, tray behavior, and all later screens remain
separate work.

## Boundaries & Constraints

**Always:** keep the Tauri package independent of the Rust filesystem adapter;
use the supplied SVG wordmark, Windows `.ico`, and matching light/dark splash
without cropping, stretching, or retyping the logo; use the documented ink,
white, cyan, and violet tokens; support system light/dark preference and a
keyboard-visible focus state; keep the first window usable at 1280×720 and
respect Windows text scaling. User-facing copy uses STASH vocabulary: “Stash
it”, “Stashed”, and “Free up space” only where those concepts appear.

**Never:** connect to Cognito, the STASH API, S3, WinFsp, or the mount service;
store tokens/credentials; add a web application, Home/files browser, transfer
UI, tray, auto-update, installer, analytics, or a custom filesystem workflow;
modify the existing `stash-core`, `stash-windows-fs`, mount-spike, root npm
workspaces, backend, infrastructure, supplied brand assets, or non-binding
`uisamples` mockups.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| First launch | Tauri app opens on Windows | One focused Welcome / Sign in window renders its wordmark, concise value statement, and two visible actions | No network or account operation occurs |
| Theme choice | OS is light or dark | Matching background, wordmark, splash/art treatment, and AA-readable controls render | Theme changes cannot remove focus visibility or contrast |
| Narrow desktop | Window is reduced to 1280×720 or text is enlarged | Essential copy and both actions remain visible without cropped branding | Decorative art may yield space before actions do |
| Keyboard navigation | Tab / Shift+Tab / Enter | Focus order reaches both actions and activation remains harmless | A visible non-error status explains that account connection is coming next |
| Missing optional font | Inter/Space Grotesk binaries are not yet vendored | System fallback typography renders predictably | Do not download a font at runtime |

</frozen-after-approval>

## Code Map

- `desktop/Cargo.toml` -- independent desktop Cargo workspace; add only the
  Tauri shell’s Rust package member, leaving the existing mount crates intact.
- `desktop/apps/stash-desktop/` -- new isolated application package: static
  webview assets, Tauri configuration, Rust window bootstrap, and UI tests.
- `desktop/crates/stash-core/` and `desktop/crates/stash-windows-fs/` -- do
  not import or change them for this UI-only screen.
- `brand/logos/primary/STASH_primary_light.svg` and
  `brand/logos/primary/STASH_primary_dark.svg` -- header wordmarks.
- `brand/logos/symbol/STASH_symbol_gradient.svg` -- small decorative mark only.
- `brand/splash/STASH_splash_light_2480x1200.png` and
  `brand/splash/STASH_splash_dark_2480x1200.png` -- uncropped background art.
- `brand/icons/windows/STASH.ico` -- Windows executable/window identity.
- `brand/BRAND-KIT.md` and `brand/fonts/FONT-SPEC.md` -- placement, color,
  typography, and fallback rules.

## Tasks & Acceptance

**Execution:**
- [x] `desktop/Cargo.toml` and `desktop/apps/stash-desktop/src-tauri/` -- add
  the smallest Tauri 2 Windows shell, app icon/config, and a single fixed-size
  launch window; it must own no filesystem or cloud dependency.
- [x] `desktop/apps/stash-desktop/ui/` -- implement one responsive static
  Welcome / Sign in screen with semantic HTML, theme-aware CSS variables,
  supplied assets, keyboard focus styling, and no runtime font/network fetch.
- [x] `desktop/apps/stash-desktop/src-tauri/src/lib.rs` -- expose only the
  window bootstrap; actions may update local, non-sensitive UI state but make
  no external invocation.
- [x] `desktop/apps/stash-desktop/tests/` -- add static/UI contract checks for
  both actions, accessible labels/focus, asset references, prohibited network
  identifiers, and light/dark token coverage.
- [x] `desktop/apps/stash-desktop/README.md` -- document prerequisites and the
  exact local command to launch this screen; distinguish it from the mount
  spike and from future Cognito wiring.

**Acceptance Criteria:**
- Given a Windows beta tester launches the desktop shell, when the window is
  ready, then they see STASH Welcome / Sign in—not a mount/debug window—and
  can identify the next available account actions.
- Given either supported color scheme, when the screen renders, then supplied
  logo/art assets and legible themed controls appear without modifying brand
  files.
- Given a tester activates an account action, when no authentication has been
  wired, then no network request, token persistence, or false sign-in success
  occurs.

## Implementation Notes

2026-09-16: Added an isolated Tauri 2 shell. The welcome surface is static,
uses byte-verified copies of the supplied launch assets for packaging, and its
account actions only change an in-memory live-status message. Review repairs
made the window genuinely fixed-size, disabled bundling, denied all network
connections in CSP, made scaled text scroll safely, and expanded the
dependency-free Node contract checks. Full Cargo tests (17) and Node checks
(7) passed. A live `cargo run -p stash-desktop` process opened the titled,
responsive Windows window; manual light/dark and visual inspection remain
human-facing confirmation, not a claim of authentication or mount readiness.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence and route |
|---|---|---|
| E1: enlarged text can clip because the body hides overflow | medium | Verified in `styles.css`: 720px minimum plus `overflow: hidden` leaves no recovery path. **patch** overflow/layout and add a regression assertion. |
| E2 / B2: the shell is declared resizable although the task calls for a fixed-size launch window | medium | Verified in `tauri.conf.json`: `resizable` is `true`. **patch** set it false and retain 1280×720. |
| B1: `targets: all` permits installer artifacts although an installer is excluded | low | Verified; a Tauri bundle build would create platform packages. **patch** disable bundling for this shell. |
| B3: the card width can become impractically narrow at high text scaling | medium | Verified: `48vw` combines badly with rem-based padding. **patch** make the card viewport-safe and assert the responsive rule. |
| B4: CSP does not explicitly deny connections | medium | Verified: `default-src 'self'` permits same-origin connections. **patch** add `connect-src 'none'` and a contract test. |
| B5: source scanning misses several network-capable APIs | medium | Verified in the test. **patch** broaden the prohibited-API scan across shell sources and config. |
| B6 / V1: account actions have no executed interaction test and root Vitest does not discover this Node test | medium | Verified by the current source-only test and `vitest.config.ts`. **patch** add a dependency-free runtime interaction test to the documented desktop Node test command; keep it outside the root npm workspace by design. |
| B7 / B11: copied UI assets can be absent, substituted, or stale relative to canonical brand assets | medium | Verified: names alone are asserted while separate copies ship. **patch** hash-compare every copied asset to its canonical source in the desktop contract test. |
| B8: static tests do not prove the visual 1280×720/theme/scaling result | low | Partly true: CSS/config assertions cover constraints, while actual WebView rendering needs the specified manual launch. **patch** strengthen static layout assertions; retain manual visual validation. |
| B9: README omits the Node test command | low | Verified. **patch** document the exact contract-test command. |

## Design Notes

The welcome screen is intentionally a calm utility surface: logo and promise
establish the brand, while the account actions remain the visual endpoint.
The gradient is reserved for the supplied mark/art, never small text or state.
No filesystem health status is shown: this is a UI shell, not evidence that
the real cloud mount is ready.

## Verification

**Commands:**
- `cargo test --manifest-path desktop/Cargo.toml` -- expected: existing mount
  crates and the new shell’s Rust checks pass.
- `cargo check --manifest-path desktop/Cargo.toml -p stash-desktop` --
  expected: the Tauri bootstrap compiles on Windows without importing mount
  crates.
- `cargo tauri dev --config desktop/apps/stash-desktop/src-tauri/tauri.conf.json`
  -- expected: one welcome window opens locally; no AWS or network activity.

**Manual checks:**
- Launch with Windows light and dark themes, tab through both account actions,
  and resize to 1280×720; confirm visible focus, unclipped essential content,
  matching art, and no outgoing sign-in behavior.
