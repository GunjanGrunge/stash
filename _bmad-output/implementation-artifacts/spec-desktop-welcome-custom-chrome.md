---
title: 'Refine the STASH welcome window chrome and composition'
type: 'feature'
created: '2026-09-16'
status: 'in-review'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'cdf489f476582b4c8840390306d6df5832f7c137'
context:
  - 'AGENT.md'
  - '_bmad-output/implementation-artifacts/spec-initial-desktop-welcome-screen.md'
  - 'brand/BRAND-KIT.md'
  - 'desktop/apps/stash-desktop/src-tauri/tauri.conf.json'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The first visible Welcome screen exposes the native Windows title
bar above the designed surface, while the full splash art embeds a second,
oversized STASH lockup behind the content. The result is visually noisy,
overlapping, and does not feel like a deliberate desktop product.

**Approach:** Replace native chrome with a STASH-designed Windows-aware title
bar: compact app identity and a drag area on the left, then accessible
minimize, maximize/restore, and close icon buttons on the right. Remove the
embedded-logo splash art from this screen without cropping or altering it;
keep it available for a future dedicated splash experience. Recompose Welcome
as a quiet, single-hierarchy surface using restrained brand-color depth.

**Decision:** Use right-aligned STASH-styled Windows controls, not Mac-style
traffic lights. The custom window remains resizable and maximizable so the
maximize control is real; essential content must remain usable when resized.

## Boundaries & Constraints

**Always:** preserve native Windows behavior (drag, minimize, maximize/
restore, close, Alt+F4, and resizing); give title-bar controls descriptive
accessible names, visible focus, sufficient contrast, and no drag-region
overlap; expose only the minimum Tauri window permissions required; retain the
actual supplied wordmark unchanged; ensure 1280×720 is a good initial size,
not a clipping constraint.

**Never:** use macOS traffic-light visuals; crop, edit, or delete canonical
brand assets; use the large splash on Welcome; add account/API/AWS/Cognito/
filesystem/mount behavior; broaden filesystem or shell permissions beyond
window control; add a second screen, tray, installer, or analytics.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Window drag | Pointer on empty title bar | Window drags normally | Buttons and account actions never initiate a drag |
| Window controls | Pointer or keyboard on icon buttons | Minimize, maximize/restore, and close perform their native actions | Each has an accessible name and focus indicator |
| Maximized state | User maximizes then restores | Content reflows without overlap; control state/icon remains understandable | Resize never hides essential actions |
| Narrow or scaled view | User resizes or uses enlarged Windows text | Welcome content scrolls/reflows safely | No fixed canvas, clipped controls, or overlapping art |
| Branded composition | Welcome renders light or dark | One supplied wordmark is visible; no ghost wordmark or full splash competes with content | Theme contrast remains legible |

</frozen-after-approval>

## Code Map

- `desktop/apps/stash-desktop/src-tauri/tauri.conf.json` -- change native
  decorations/window constraints and declare no broader permissions.
- `desktop/apps/stash-desktop/src-tauri/capabilities/default.json` -- new
  least-privilege capability for drag/minimize/toggle-maximize/close only.
- `desktop/apps/stash-desktop/ui/index.html` -- title-bar semantics, controls,
  and simplified content composition.
- `desktop/apps/stash-desktop/ui/styles.css` -- desktop chrome, responsive
  layout, focus/hover/close-danger treatment, and remove splash placement.
- `desktop/apps/stash-desktop/ui/welcome.js` -- local Tauri window-control
  bindings plus current harmless account-action status behavior.
- `desktop/apps/stash-desktop/tests/welcome-contract.test.mjs` -- extend
  static/runtime contracts without requiring network, Cognito, or mount tests.
- `desktop/apps/stash-desktop/README.md` -- document that custom chrome is
  Windows behavior, not authentication or mount integration.

## Tasks & Acceptance

**Execution:**
- [x] `tauri.conf.json` and `capabilities/default.json` -- remove system
  decorations; make the window resize/maximize capable; grant only specific
  Tauri window commands needed by the title bar.
- [x] `ui/index.html`, `styles.css`, and `welcome.js` -- build the custom
  title bar and clean Welcome composition; wire native controls and preserve
  keyboard/focus behavior without changing account-action semantics.
- [x] `tests/welcome-contract.test.mjs` -- verify window config, exact
  capabilities, controls, drag exclusions, accessible names, no splash use,
  no API/network integration, and safe responsive rules.
- [x] `README.md` -- update the visual/manual test procedure for drag, each
  control, maximize/restore, and both themes.

**Acceptance Criteria:**
- Given the Welcome app opens on Windows, when the user sees its top edge,
  then no native title bar or ghost/splash wordmark competes with the STASH
  interface.
- Given a user operates the three title controls, when using pointer or
  keyboard, then each native window action works and account actions still do
  not trigger window movement.
- Given the window is maximized, restored, resized, or used with enlarged
  text, when content reflows, then the Welcome message and actions remain
  usable without overlap.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence and route |
|---|---|---|
| R1: nonstandard drag attribute | medium | Verified in `index.html`; **patch** use Tauri's supported data attribute while retaining the explicit JS fallback. |
| R2 / E1: any mouse button can begin a drag | medium | Verified in `welcome.js`; **patch** accept the primary button only. |
| R3: window-controls lacks a semantic group role | low | Verified; **patch** add `role="group"`. |
| R4: rejected native window promises are unhandled | medium | Verified; **patch** await/catch and expose a non-sensitive local status failure. |
| R5: maximize state is not reflected | medium | Verified; **patch** add the narrowly-required state query permission and update accessible label/icon after toggle. |
| R6: future splash copies are not hash-checked | low | Verified; **patch** retain hash checks while asserting Welcome does not render them. |
| E2: card padding causes horizontal overflow at 480px | false | Refuted by the existing universal `* { box-sizing: border-box; }` rule. |
| V1: native controls have mock-only automated coverage | medium | Real gap; a full Windows GUI harness is not present. **defer** manual smoke test is required before this story is presented; a future Windows UI-test harness should automate it. |
| V2: minimum size is untested | low | Verified; **patch** assert 480×480 config values. |
| V3: responsive layout is source-pattern, not rendered | medium | Real gap; no browser/GUI test harness exists in this UI-free shell. **defer** retain manual minimum-size/scaled-text smoke check and add a future rendered UI test harness. |

## Design Notes

The chrome should feel quiet and precise: a 46px structural bar, a small
symbol plus STASH name, and thin icon controls. Close may receive restrained
Windows-red hover feedback; minimize and maximize stay neutral. A soft
cyan-to-violet atmospheric glow may support the page, but it cannot carry text
or duplicate the supplied wordmark.

## Verification

**Commands:**
- `cargo check --manifest-path desktop/Cargo.toml -p stash-desktop` --
  expected: the Tauri shell and capability configuration compile.
- `node --test desktop/apps/stash-desktop/tests/welcome-contract.test.mjs` --
  expected: all visual/window-control contracts pass.

**Manual checks:**
- Launch `cargo run --manifest-path desktop/Cargo.toml -p stash-desktop`;
  drag the blank bar, use all three controls, maximize/restore, resize, tab
  through controls/actions, and inspect light/dark modes for overlap.
