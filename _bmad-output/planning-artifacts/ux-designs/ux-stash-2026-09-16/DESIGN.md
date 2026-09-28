---
name: STASH
description: Windows-first creator cloud-drive design system for the private beta.
status: ready-for-review
sources:
  - STASH_PRD_v0.1.md
  - ../../../../uisamples/ (inspiration only; non-binding)
  - ../../../../brand/logos/
  - ../../../../brand/icons/
  - ../../../../brand/hero/
  - ../../../../brand/empty_states/
  - ../../../../brand/splash/
  - user-supplied brand exploration board (reference artifact; preserve unchanged)
updated: 2026-09-16
---

# STASH UX Design Contract

## 1. Contract status and authority

This is the visual and interaction-system contract for the Windows-first
Tauri 2 management client. It is ready for product, design, and accessibility
review; it is not an implementation claim beyond the approved client
architecture. The companion `EXPERIENCE.md` defines the screen-level behavior
and content contract.

The **approved product requirements** remain the PRD, especially §15 (beta
screens), §16 (dashboard information architecture), and §17 (design direction).
The STASH project contract in `AGENT.md` also remains binding: preserve the
creator's exact hierarchy, keep File/Folder/Stash distinct, use deterministic
search, never imply that an upload is committed before verification, and use
STASH vocabulary. This document makes visual and interaction decisions that
help implement those requirements; it does not add product scope silently.

`uisamples/` and the brand exploration artifacts are visual inspiration only.
They are not a requirements source and must not be treated as a screen-by-screen
acceptance contract.

## 2. Product-to-design boundary

| Binding product requirement | UX contract response |
| --- | --- |
| The beta includes the fourteen screens listed in PRD §15. | Each screen has a contract in `EXPERIENCE.md`; empty, loading, offline, failure, and success states are specified where relevant. |
| Main navigation is Home, Files, Search, Recent Stashes, Offline, Transfers, Settings. | The shell provides persistent navigation, a persistent `+ Stash it` action, persistent search access, and storage usage. |
| The product is creator-first, premium, modern, fast, uncluttered, and usable in light and dark environments. | Calm, dense working surfaces use restrained surfaces and strong hierarchy; expression is budgeted to Home, Stash it, previews, and asset accents. |
| A Stash is an ingestion event and does not replace a Folder. | UI labels, breadcrumbs, history rows, and progress surfaces keep `Stash` separate from files and folders. |
| The mounted drive and management app feel like one product. | The shell presents mount state consistently and never invents a second hierarchy or alternate naming system. |
| Payloads transfer directly between client and object storage. | Progress and recovery states describe transfer authorization and verification without implying that the app itself stores payload bytes. |

Anything not listed as a product requirement is a design proposal until
explicitly approved. In particular, visual polish must not become a reason to
rename, flatten, categorize, or move creator content.

### Approved client architecture and capability boundary

STASH uses **Tauri 2** for the Windows-first desktop shell. The shared UI is
implemented in **React + TypeScript** and is designed so the same UI behavior
and contracts can support a future browser build. Shared UI owns navigation,
screen states, accessibility behavior, STASH vocabulary, hierarchy-preserving
presentation, deterministic search presentation, and honest transfer/status
rendering.

Native filesystem, mounted-drive, and local-cache capabilities are desktop-only
capabilities exposed to the shared UI through platform adapters. The React UI
must not directly own platform APIs or create a second filesystem boundary. The
Rust core and WinFsp boundary remain intact; Tauri commands and platform
adapters mediate access to those capabilities. A future browser build may
provide browser-appropriate adapters or explicit unavailable states, but must
not claim desktop mount or local-cache behavior that it cannot provide.

## 3. Design principles

1. **Creator utility first.** The app should feel like a focused studio tool,
   not an enterprise administration console. Files, folders, assets, and
   transfer status are the primary content.
2. **Calm density.** Keep frequently used information visible in compact rows,
   tables, and rails. Use whitespace to group work, not to make routine work
   feel ceremonial.
3. **Expression has a budget.** Use the strongest color, illustration, motion,
   and large preview treatment on Home, `Stash it`, asset previews, and
   asset-type accents. Files, Search, Settings, and transfer tables stay quiet.
4. **Hierarchy is sacred.** Display `original_relative_path` as the creator
   supplied it. UI affordances may navigate and filter it but may not imply a
   reorganized library.
5. **State is always legible.** Mounted, syncing, verified, offline, paused,
   failed, and stale states use text plus color/icon treatment. Color is never
   the only signal.
6. **Fast without surprise.** Prefer immediate local navigation and optimistic
   selection, but never show `Stashed` or a completed transfer until the
   product has verified the committed result.
7. **Equal light and dark modes.** Dark mode is not an inverted afterthought;
   contrast, borders, preview surfaces, focus rings, and semantic colors are
   separately checked in both modes.
8. **Accessible by construction.** Keyboard operation, readable type, visible
   focus, reduced motion, screen-reader names, and adequate hit targets are
   part of the component contract.

## 4. Visual language

### 4.1 Surfaces and atmosphere

The base is a neutral, slightly cool workspace surface. Content surfaces are
opaque enough to preserve table readability; translucency and blur are optional
accents, never required for comprehension. Avoid generic AWS/cloud imagery,
chatbot patterns, crowded dashboards, cartoon clouds, and web-only uploader
metaphors.

Use a restrained cyan-to-violet brand range for primary emphasis. Violet is the
primary action color; cyan is a progress, link, or active-navigation accent.
Semantic colors are independent of the brand gradient:

- **Success / verified:** green with a text label such as `Verified` or
  `Stashed`.
- **Warning / attention:** amber with a concrete next action.
- **Error / recovery:** red with a recovery action and an explanation.
- **Offline / unavailable:** neutral blue-gray with explicit offline wording.

Gradients are reserved for the Home hero, `Stash it` drop-zone emphasis, and
small branded highlights. Never place body copy over a busy gradient.

### 4.2 Shape, depth, and iconography

- Use a 4px base spacing unit; common layout steps are 4, 8, 12, 16, 24,
  32, and 48px.
- Use 6px for controls, 8px for cards and panels, and 12px only for featured
  surfaces. Avoid excessive pill shapes; pills are for compact status labels.
- Use one low-contrast elevation level for floating menus and dialogs. Working
  surfaces should be separated primarily by spacing, borders, and tonal change.
- Icons are simple, geometric, and paired with text whenever the action is
  not universally understood. Folder, file type, transfer, mount, search,
  offline, and settings icons must have stable accessible names.
- Asset-type accents may distinguish audio, video, image, project, and generic
  files, but the accent never changes the meaning of a status color.

## 5. Tokens and typography

The implementation should define semantic tokens rather than hard-code colors
inside individual screens. Values below are the review baseline; final values
may be tuned after contrast testing without changing the semantic roles.

### 5.1 Semantic token contract

| Token | Light mode | Dark mode | Use |
| --- | --- | --- | --- |
| `surface.canvas` | `#F6F8FB` | `#0B1424` | App background |
| `surface.panel` | `#FFFFFF` | `#111E31` | Rail, cards, dialogs |
| `surface.subtle` | `#EDF2F7` | `#17263B` | Selected rows, inputs, secondary regions |
| `text.primary` | `#0B1424` | `#F8FAFC` | Headings and essential content |
| `text.secondary` | `#42526A` | `#C2CFDF` | Supporting copy and metadata |
| `text.disabled` | `#718096` | `#8292A8` | Disabled controls only |
| `border.default` | `#C9D3E2` | `#4B5B71` | Dividers and field borders |
| `action.primary` | `#6D32D2` | `#9B6BFF` | Primary action and selected CTA |
| `action.accent` | `#1597D0` | `#63C7F4` | Links, progress, active accent |
| `status.success` | `#18794E` | `#55D68A` | Verified/healthy |
| `status.warning` | `#9A6700` | `#F4C95D` | Needs attention |
| `status.error` | `#B42318` | `#FF8A80` | Failed/recovery |
| `focus.ring` | `#155EEF` | `#7DD3FC` | Keyboard focus |

Text and status colors must meet WCAG AA contrast for normal text. Do not use
opacity to communicate disabled state when it makes text unreadable.

### 5.2 Type scale

Use Inter (or an equivalent system sans fallback) for interface text and a
weight-controlled display face such as Space Grotesk only for Home and featured
headings. Typography is functional before it is branded.

| Role | Baseline | Weight / line height | Use |
| --- | --- | --- | --- |
| Display | 36px, min 30px in compact windows | 650 / 1.05 | Home only; short headline |
| Page title | 28px | 650 / 1.1 | Primary screen heading |
| Section title | 20px | 650 / 1.2 | Panel and dialog headings |
| Body | 15px | 400 / 1.45 | Explanatory copy |
| UI label | 14px | 600 / 1.25 | Buttons, navigation, table headers |
| Metadata | 12–13px | 400–500 / 1.35 | Size, dates, paths, secondary status |

Do not truncate names or paths without an accessible full-value treatment.
Use sentence case. Avoid all-caps labels except a small, optional eyebrow or
status category.

## 6. Application shell and navigation

The Tauri 2 window uses a native-feeling title bar area with the STASH wordmark
and platform window controls. The React + TypeScript UI supplies the shared
shell behavior; desktop-only filesystem, mount, and cache actions are reached
through the approved platform adapters rather than through UI-specific native
logic. The content shell is a two-region workspace:

1. **Navigation rail:** STASH wordmark, primary navigation, persistent
   `+ Stash it`, and a lower account/mount area.
2. **Main workspace:** page header, optional persistent search and usage summary,
   page content, and contextual detail/action regions.

The rail labels are exactly:

- Home
- Files
- Search
- Recent Stashes
- Offline
- Transfers
- Settings

`+ Stash it` is the primary CTA and remains reachable from every authenticated
screen. It opens the Stash It picker without changing the Files hierarchy.

The shell displays storage as a compact usage indicator, for example
`624 GB of 1 TB`. It links to Storage & cache usage, but never replaces the
screen's working content. Mount status is persistent and explicit: `Mounted`,
`Not mounted`, `Mounting`, or `Mount unavailable`.

On a narrow window, the rail becomes a collapsible drawer or top navigation;
the current section, `+ Stash it`, search, and mount status remain reachable
without horizontal scrolling. The exact breakpoint is implementation-tunable;
behavior, not a device-specific pixel value, is binding.

## 7. Component contract

- **Primary button:** one clear verb, filled brand action, visible disabled and
  busy states. Examples: `Stash it`, `Mount STASH`, `Retry transfer`.
- **Secondary button:** lower-emphasis alternative, never visually identical to
  destructive or primary actions.
- **Tertiary/icon action:** used for row actions and compact utilities only;
  always has an accessible name and a tooltip only as supplemental help.
- **Data table/list:** sortable columns expose their sort direction; rows have
  a keyboard focus target, selected state, and predictable double-click/open
  behavior. File, Folder, and Stash rows use distinct labels.
- **Status badge:** concise text plus icon/shape. `Stashed` means verified;
  `Stashing` means in progress; `Needs attention` means the user can act.
- **Dialog:** traps focus, has a descriptive heading, identifies the primary
  and cancel actions, and never hides a destructive consequence in a tooltip.
- **Toast/banner:** announces transient results but does not carry the only
  copy for an error or transfer state. Persistent errors remain in context.
- **Preview panel:** preserves the asset's original name/path and provides a
  safe preview when supported. Unsupported previews show metadata and the
  next useful action instead of a blank panel.

## 8. Responsive and window behavior

The target is a resizable Windows desktop window, with macOS parity where the
Tauri shell supports it. The design must remain usable at a compact working
window, not only maximized:

- At wide sizes, show rail, workspace header, content, and optional details
  panel together.
- At medium sizes, keep the rail and collapse secondary metadata before
  collapsing primary actions.
- At narrow sizes, use a drawer/top bar and stack toolbar controls. Tables may
  switch to dense cards, but must retain name, type, size, status, and actions.
- Never require horizontal scrolling for primary navigation, sign-in, Stash It,
  recovery, or a single asset's essential metadata.
- Respect OS scale settings and text zoom. Layouts must tolerate at least 200%
  text scaling without clipped controls.
- Preserve navigation location and non-sensitive form state across resize. Do
  not persist secrets or raw creator payloads in UI state.

## 9. Motion, focus, and state styling

Motion communicates a state change, not decoration. Use short transitions for
selection, opening a panel, and transfer progress. Home and Stash It may use a
single restrained ambient motion treatment. Honor `prefers-reduced-motion` by
removing nonessential movement and replacing progress animation with text and
static indicators.

Every interactive element has a visible `:focus-visible` ring. Hover must not
be the only indication of interactivity. Selected rows use surface and border
changes in addition to color. Busy controls retain their accessible name and
announce progress separately.

All screens define at least these visual states when applicable: loading,
empty, populated, selected, disabled, offline, error, and success/verified.
Skeletons may be used for predictable content; do not show fake file names,
false progress, or a completed state before verification.

## 10. Design verification and approval criteria

The contract is ready for implementation planning when reviewers can confirm:

- All fourteen PRD §15 screens map to a named contract in `EXPERIENCE.md`.
- Home, Stash It, previews, and asset accents are expressive while Files,
  Search, Settings, and tables remain calm and dense.
- Light and dark screenshots show equivalent hierarchy and pass contrast review.
- Navigation, `+ Stash it`, search access, usage, and mount state remain usable
  at compact and wide window sizes.
- No UI copy implies reorganization, checksum-based identity, or a committed
  Stash before verification.
- Keyboard-only flows, focus order, accessible names, reduced motion, and 200%
  text scaling are demonstrably usable.
- A reviewer can distinguish a visual decision from a product requirement and
  identify any unresolved product decision before implementation begins.

## 11. Implementation decisions and remaining questions

1. **Resolved — client architecture:** STASH uses Tauri 2 for the
   Windows-first desktop shell, with a React + TypeScript shared UI designed
   for a future browser build. Native filesystem, mount, and local-cache
   capabilities are provided through platform adapters. The Rust core and
   WinFsp boundary remain intact.
2. The exact breakpoint values and whether compact navigation uses a drawer or
   top bar need a platform review on Windows and macOS.
3. The final font licensing/loading strategy and the approved brand icon set
   need confirmation.
4. The supported preview codecs/file types and the detailed mounted-drive
   integration states need an engineering/product contract.
5. Whether the first beta exposes a full Devices screen or a constrained device
   list is a product scope decision, not a visual one.
