---
name: STASH
description: Windows-first desktop client experience contract for the private beta.
status: ready-for-review
sources:
  - STASH_PRD_v0.1.md
  - ../../../../uisamples/ (inspiration only; non-binding)
  - ../../../../brand/empty_states/
  - ../../../../brand/demo_thumbnails/
  - user-supplied brand exploration board (reference artifact; preserve unchanged)
updated: 2026-09-16
---

# STASH Desktop Experience Contract

## 1. Purpose and authority

This document defines how the STASH beta behaves across its authenticated
screens. It closes the gap between the current welcome/sign-in flow and the
full PRD §15 screen set while remaining implementation-neutral within the
approved client architecture. It is a UX contract for review, not a statement
that these screens are implemented.

The PRD is the source of product scope. PRD §15 supplies the beta screen list,
§16 supplies navigation and persistent controls, and §17 supplies the creator-
first visual direction. `DESIGN.md` supplies the visual tokens and component
rules. `AGENT.md` supplies non-negotiable product rules, including preserving
paths, separating File/Folder/Stash, deterministic search, verified commit
semantics, direct transfer boundaries, and STASH vocabulary.

`uisamples/` is explicitly inspiration only. It must not be used to infer
additional features, flows, or acceptance criteria.

## 2. Shared shell behavior

### Approved client architecture and capability boundary

STASH uses **Tauri 2** for the Windows-first desktop shell. The shared UI is
implemented in **React + TypeScript** and is designed for a future browser
build. Shared UI behavior includes navigation, screen structure, status and
recovery states, accessibility, STASH vocabulary, hierarchy-preserving
presentation, deterministic search presentation, and honest transfer/status
rendering.

Native filesystem, mounted-drive, and local-cache capabilities are desktop-only
capabilities exposed to the shared React UI through platform adapters. The Rust
core and WinFsp boundary remain intact; the UI does not create a second
filesystem boundary or call native platform APIs directly. A future browser
build may provide browser-appropriate adapters or explicit unavailable states,
but must not claim desktop mount or local-cache behavior that it cannot
provide.

### Authenticated desktop shell

Every authenticated desktop screen uses the same Tauri 2 shell:

- Native-feeling title bar with STASH wordmark and platform window controls.
- Persistent navigation: `Home`, `Files`, `Search`, `Recent Stashes`, `Offline`,
  `Transfers`, and `Settings`.
- Persistent primary action: `+ Stash it`.
- Persistent search entry point with the placeholder `Search your STASH...`.
- Compact storage indicator, for example `624 GB of 1 TB`.
- On desktop, explicit mount status: `Mounted`, `Not mounted`, `Mounting`, or
  `Mount unavailable`. Mount status is a desktop capability state; a future
  browser build must use an explicit unavailable or not-applicable treatment
  rather than imply that it controls a mounted drive.

The active navigation item is visible by text, contrast, and an additional
indicator. Navigation changes do not change the creator's hierarchy. The
browser's breadcrumb is a view into that hierarchy, not a generated category
system.

### Location and persistence

- Preserve the current section and folder location across ordinary navigation,
  resize, and returning from a detail panel.
- Preserve non-sensitive search query, sort choice, and selected view only for
  the current session unless product later approves account-level preference
  persistence.
- On relaunch, restore only approved UI preferences and the last safe location;
  do not persist passwords, raw payloads, or unverified transfer completion.
- Deep links from a notification or transfer row must land in the relevant
  context and provide a clear route back.

## 3. Screen contracts

Each screen below specifies purpose and behavior. Visual treatment follows
`DESIGN.md`; these are product-facing interaction commitments and should be
turned into implementation acceptance criteria only after review.

### 3.1 Welcome / Sign in

**Purpose:** establish the account session without making the first view feel
like an enterprise login portal.

**Entry and structure:** show a concise creator-library value proposition,
`Sign in`, and `Create account` if account creation is in beta scope. The
authenticated shell is not visible until authentication succeeds.

**Behavior:**

- Sign-in validates required fields locally, submits through the approved auth
  flow, and preserves focus on the first invalid field.
- A temporary-password response routes to `Set a new password`; it does not
  silently retry or expose the password in copy.
- Remember-device behavior is explicit and has a short explanation.
- Auth failure copy is actionable but does not reveal whether an account exists.
- On success, land on Home for a new session or the last safe authenticated
  location when the product approves that behavior.

**States:** initial, field validation, signing in, temporary password, invalid
credentials, service unavailable, and success. Busy state disables duplicate
submission while retaining the button label and announcing progress.

### 3.2 STASH Home

**Purpose:** give the creator a calm overview and a fast path to their next
useful action.

**Content:** a short welcome, storage usage, recent Stashes, current
transfers, offline/pinned summary where supported, and a prominent `+ Stash it`
area. On desktop, Home also shows mount status through the platform adapter;
a browser build must represent that desktop-only capability explicitly. The
page may use the strongest approved expressive treatment in the product, but
the working summaries remain compact and scannable.

**Behavior:** selecting a recent Stash opens its Stash/history context; selecting
an asset opens Asset details; selecting storage opens Storage & cache usage;
selecting `+ Stash it` opens the picker. Home never implies that a recent Stash
is a folder or that a transfer is committed before verification.

**States:** first-use empty Home with one clear `Stash it` prompt, populated
Home, transfer-in-progress, offline, partial data, and service failure with
retry. A missing optional summary must not blank the rest of Home.

### 3.3 Main filesystem browser (Files)

**Purpose:** browse the exact creator hierarchy and select files or folders.

**Structure:** breadcrumb, current folder title, optional search/filter context,
sortable table/list, and a selection/details region. Minimum columns are Name,
Type, Size, and an optional status/date column when useful.

**Behavior:**

- Folders open on activation and are represented as folders, not Stashes.
- Files open their Asset details or supported preview.
- Breadcrumb segments navigate to existing ancestors only.
- Sort changes presentation order, never hierarchy. Name sorting uses the
  displayed/original name and clearly indicates direction.
- Selection supports keyboard, single click, multi-select only where an
  approved action needs it, and a context/action surface with safe verbs.
- Duplicate content is not merged. Identical bytes in distinct Stashes remain
  distinct assets and retain their paths.

**States:** loading, empty root, empty folder, populated, selected, offline
snapshot, permission/service error, and stale data requiring refresh. Empty
copy explains how to use `+ Stash it`; it does not suggest creating categories.

### 3.4 Stash It picker / drop zone

**Purpose:** start an ingestion event from files or folders while preserving the
source hierarchy.

**Entry:** `+ Stash it` from any shell screen, or the approved desktop drag/drop
entry point. The shared picker/review behavior is UI-level; native filesystem
selection and desktop drag/drop are provided by the desktop platform adapter.

**Behavior:**

- Accept files and folders through a clear picker and, when supported, a drop
  zone. Show the selected source names and their original relative paths before
  confirmation.
- The review step identifies the event as a `Stash`, lists item count and
  estimated size, and warns about duplicate folder names or ambiguous matches
  without silently choosing a destination.
- The creator confirms with `Stash it`; cancel returns to the previous screen
  without mutating the library.
- The client shows authorization, direct transfer, verification, and final
  committed states separately. Only the verified final state uses `Stashed`.
- The UI must not promise that a checksum match reuses an existing asset.

**States:** idle, files selected, folder selected, scanning, duplicate-folder
warning, transfer preparation failure, offline, and ready to confirm. The drop
zone has a keyboard-accessible picker alternative.

### 3.5 Active Stash transfer / progress

**Purpose:** make an ingestion event observable and recoverable without making
unverified data look complete.

**Content:** Stash name or source summary, item/file counts, byte progress where
available, current phase, elapsed/remaining estimate when trustworthy, and
pause/cancel/retry actions supported by the product.

**Behavior:** represent phases as `Preparing`, `Stashing`, `Verifying`,
`Stashed`, or `Needs attention`. A transfer can be navigated away from; its
canonical state remains in Transfers and Home. The final success state appears
only after the control plane verifies the committed object/manifest result.

**States:** queued, active, paused, verification, verified success, partial
failure, canceled, offline-paused, and unrecoverable failure. Partial failure
must identify what can be retried and must not claim the whole Stash succeeded.

### 3.6 Duplicate folder warning

**Purpose:** prevent an ambiguous folder destination from silently splitting or
mis-parenting the creator's library.

**Content:** identify the source path, candidate existing folders, the reason
for ambiguity, and the safe choices. Preserve the creator's names exactly.

**Behavior:** `Review locations` shows candidates and context; `Choose this
folder` is available only when the destination is unambiguous; `Cancel Stash`
leaves the library unchanged. Never auto-create a same-name folder merely to
avoid asking. Never merge two existing folders based only on matching names or
checksums.

**States:** warning, candidate loading, candidate unavailable, explicit choice,
and canceled. The warning is blocking for the affected item and uses plain
language rather than an internal term such as `dedupe`.

### 3.7 Search and search results

**Purpose:** find assets without requiring the creator to remember the exact
folder location.

**Behavior:** the persistent field accepts deterministic lexical terms and
structured filters supported by the product. Submit shows query, active filters,
result count, and a clear way to remove filters. Results retain each asset's
original path and Stash context. Search never reorganizes the underlying
library and never states that a content hash proves identity.

**Result actions:** open preview/details, reveal in Files at the original path,
and use approved transfer/offline actions. No LLM or conversational search
language is implied.

**States:** initial guidance, searching, results, no results with query/filter
help, offline/unavailable, and stale results. Search errors preserve the query
so retry does not require re-entry.

### 3.8 Asset details and preview

**Purpose:** inspect one asset while retaining provenance and practical actions.

**Content:** name, asset type, original relative path, Stash provenance, size,
timestamps/status, preview when supported, and available actions. A Folder has
folder metadata and navigation; it does not masquerade as an asset.

**Behavior:** preview is safe and non-destructive. Unsupported or unavailable
previews show metadata, file type, and a useful action such as `Open in Files`
or `Reveal in mounted STASH` where supported on desktop. Close returns to the
prior list and selection. Asset actions must state whether they affect local
cache, offline availability, or the cloud record; desktop-only actions must be
represented as unavailable rather than implied in a browser build.

**States:** loading, preview-ready, preview-unavailable, offline metadata,
missing/permission error, and selected action confirmation.

### 3.9 Recent Stashes / history

**Purpose:** show ingestion events as events, with clear status and provenance.

**Structure:** chronological list or table with Stash date, source summary,
item count/size, destination context, and state.

**Behavior:** opening a row shows the Stash detail/transfer context; it does not
replace or flatten Files. `Stashed` appears only for verified committed events.
A failed or partial event offers retry/review without rewriting the history.

**States:** no Stashes yet, loading, populated, active, partial/failed, and
history unavailable. Empty copy points to `+ Stash it`.

### 3.10 Storage & cache usage

**Purpose:** explain cloud allocation and local cached/offline usage clearly.
The cloud allocation is shared UI behavior; local cache and offline usage are
desktop capability surfaces backed by the local-cache platform adapter.

**Content:** cloud storage total/used/available, local cache usage, offline or
pinned assets, and safe actions such as `Free up space` where supported.

**Behavior:** distinguish freeing local cache from deleting a cloud asset. Any
potentially destructive cloud action requires explicit product approval and a
clear confirmation. Usage values indicate when they are estimated or stale. A
browser build must not imply local cache controls it does not implement.

**States:** loading, populated, near limit, offline/stale, and unavailable.

### 3.11 Devices

**Purpose:** show the devices associated with the account and their STASH
connection/mount health.

**Content:** device name, platform, last seen, mount/connection status, and
approved management actions. Device labels are user-recognizable and do not
expose secrets.

**Behavior:** selecting a device opens its status details. Any sign-out/revoke
operation is explicit, scoped to the selected device, and explains impact.

**States:** no other devices, loading, populated, current device, offline, and
management failure. Whether the beta supports full device management remains a
product decision; the visual contract supports a read-only first version.

### 3.12 Settings

**Purpose:** provide predictable account, appearance, transfer, mount, and
accessibility preferences without becoming an admin console.

**Behavior:** group settings by task, use immediate save only for reversible
preferences, and show confirmation for account/session changes. Theme offers
Light, Dark, and System where supported; Light and Dark must remain equivalent
in capability. Settings copy uses plain language and names local-versus-cloud
impact.

**States:** loading, editable, saved, validation error, and unavailable.

### 3.13 Transfer/error recovery state

**Purpose:** give every interrupted operation a safe next step and an honest
state.

**Behavior:** error surfaces state what failed, whether any items were verified,
what remains safe, and the available action: `Retry`, `Review`, `Resume`,
`Cancel`, or `Contact support` when appropriate. Preserve source selection and
query context where safe. Do not use a generic `Something went wrong` as the
only message.

**States:** transient network failure, authorization expiry, invalid source,
insufficient local space, service unavailable, partial verification, canceled,
and unknown failure. The UI must distinguish retryable from non-retryable
errors and avoid duplicate submission while retry is in progress.

### 3.14 Offline / pinned assets

**Purpose:** show assets intentionally available locally and make cache state
understandable. This is a desktop capability surface backed by the local-cache
platform adapter; the shared UI must distinguish it from cloud identity and
folder structure.

**Content:** pinned/offline asset list, original path, local availability,
last sync/verification, and local-space impact.

**Behavior:** pin/unpin actions state that they affect local availability, not
cloud identity or folder structure. Offline browsing may show a clearly marked
snapshot. Actions requiring the network are disabled with an explanation, not
silently dropped. A future browser build must show an explicit unavailable state
when local pinning is not supported.

**States:** no offline assets, syncing, available offline, stale, local-space
warning, and offline action unavailable.

## 4. Cross-screen interaction patterns

### Navigation, focus, and selection

- Keyboard order follows visual order: shell navigation, page header/actions,
  content, then contextual details.
- `Tab` reaches every actionable control; arrow keys navigate table/list rows
  where the component pattern supports it; `Enter` opens and `Space` selects
  controls according to their role.
- Escape closes a dialog, picker, menu, or details panel before changing page
  location. Focus returns to the trigger.
- Selection is visible in light and dark mode and announced to assistive tech.
- Double-click is an optional accelerator, never the only way to open a folder
  or asset.

### Drag and drop

Drag/drop is an accelerator for Stash It, not the only entry point. The
shared interaction announces what can be dropped, previews the source list
before commit, and shows a keyboard-accessible equivalent. On desktop, native
drag/drop is provided by the platform adapter. Dragging an item within Files
must not imply that reorganization is supported unless that product capability
is separately approved.

### Menus, dialogs, and confirmation

Use menus for low-risk view/sort actions and dialogs for ambiguous destinations,
permission changes, or destructive consequences. Dialog copy names the object,
scope, consequence, and safe alternative. Do not place a critical explanation
only in hover text.

### Feedback and notifications

Use inline status for work-in-context, a toast for a brief completed auxiliary
action, and persistent Home/Transfers history for long-running work. Every
important status has a text label and survives long enough to be read. Live
regions announce phase changes without repeatedly announcing byte-level
progress.

## 5. Content and recovery language

Use the approved vocabulary consistently:

- `Stash it`, `Stashing`, `Stashed`, `Recent Stashes`, and `Free up space`.
- `Files`, `Folders`, and `assets` only where the concept is correct.
- `Mounted`, `Not mounted`, `Offline`, `Verifying`, and `Needs attention` for
  states.

Avoid `upload` as the primary product verb, `dedupe`, `bucket`, `cloud drive`,
`sync magic`, `move to category`, or copy that implies a checksum is identity.
Technical detail may appear in an expandable diagnostic area, not as the only
recovery instruction.

Recommended recovery sentence shape:

> **What happened.** [Concrete operation] could not finish. **What is safe.**
> [Verified result or no committed change]. **Next step.** [Retry, review,
> resume, or cancel].

## 6. Accessibility contract

The implementation must verify:

- WCAG AA contrast for normal text, status text, focus rings, controls, and
  selected states in both themes.
- Full keyboard operation for sign-in, shell navigation, Files, Search, Stash
  It, dialogs, transfer recovery, and settings.
- A logical focus order and focus restoration after dialogs, menus, and panels.
- Accessible names and roles for icon buttons, window actions, navigation,
  tables/lists, progress, mount state, and status badges.
- Live announcements for sign-in result, Stash phase changes, verification,
  errors, and completion; no noisy announcement for every incremental byte.
- No essential information conveyed by color, hover, animation, or sound alone.
- Reflow and usable controls at 200% text scaling and compact window sizes.
- Reduced-motion behavior and a non-animated equivalent for progress/feedback.
- Errors that identify the invalid field and preserve entered non-secret values.

Accessibility review must include keyboard-only and screen-reader smoke paths,
not just automated contrast or DOM checks.

## 7. Verification and approval criteria

The experience contract is ready for implementation planning when a reviewer
can walk through these scenarios without inventing behavior:

1. A new creator signs in, reaches Home, sees mount/storage state, and starts a
   Stash It flow.
2. A creator browses nested folders, opens an asset, and returns without the
   hierarchy changing.
3. A creator encounters an ambiguous duplicate folder and is blocked from an
   unsafe automatic choice.
4. A Stash moves from preparation through transfer and verification to
   `Stashed`, or to a truthful partial/recovery state.
5. Search finds an asset while retaining its original path and Stash context.
6. A creator distinguishes cloud storage from local cache and uses Offline/
   pinned assets without confusing pinning with deletion.
7. A network/authentication failure provides a specific, safe, retryable or
   non-retryable next step.
8. The same flows remain understandable in Light, Dark, compact, wide, keyboard
   only, reduced motion, and 200% text-size modes.

Review evidence should include annotated screen flows or prototypes for all
fourteen screens, a light/dark token check, a keyboard/accessibility pass, and
an explicit list of any product decisions deferred to engineering or product.

## 8. Resolved and unresolved decisions before implementation

1. Confirm whether account creation is in private-beta scope or whether Welcome
   should expose sign-in only.
2. **Resolved — client architecture:** STASH uses Tauri 2 for the
   Windows-first desktop shell, with a React + TypeScript shared UI designed
   for a future browser build. Native filesystem, mount, and local-cache
   capabilities are provided through platform adapters. The Rust core and
   WinFsp boundary remain intact.
3. Decide the first-beta preview formats and whether unsupported files can be
   opened through the host OS.
4. Decide whether Transfers is a full page, a persistent panel, or both, while
   retaining the PRD navigation label.
5. Confirm whether Devices is read-only in beta and which device actions are
   allowed.
6. Define the exact offline/pinning semantics, local cache eviction behavior,
   and any cloud deletion affordances.
7. Provide final approved logo/icon/empty-state assets and confirm font
   licensing/loading constraints.

Until the remaining decisions are resolved, implementation should use the
contracts above without silently adding product behavior.
