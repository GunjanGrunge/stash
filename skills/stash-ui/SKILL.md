---
name: stash-ui
description: Use when writing STASH client, UI or user-facing copy. Currently a GUARD skill — no UI scope is approved and no UX contract exists, so it defines what may not be built yet and the vocabulary any future UI must use.
---

# STASH — UI Skill

**Authority:** `AGENT.md` outranks this file.

## Status: No UI Scope Is Approved

The currently approved scope is the **AWS control plane — backend only**. No
client technology has been chosen, and **no UX design contract exists.**

**Do not write client UI code, components or screens under the current scope.**
If asked to, say so and ask for a UI scope to be opened first.

### The mockups are not a spec

`uisamples/` contains 4 images that are a **design exploration, not an
approved UI/UX contract** (user, 2026-09-15: *"these are just mock up not real
features this is a design idea not a final product ui/ux"*). **Never derive a
requirement, story, component or acceptance criterion from them** — see
`AGENT.md` AFR-003.

The only binding UI requirements are **PRD §15** (14 beta screens) and
**PRD §16** (information architecture: Home, Files, Search, Recent Stashes,
Offline, Transfers, Settings; persistent `+ Stash it`; persistent search;
storage indicator).

## Before Any UI Work Begins

1. A client technology decision (Electron+TS / Tauri+Rust / native per-OS) —
   which should follow a mounted-drive spike, since the filesystem layer, not
   the UI, is the deciding constraint.
2. A real UX design contract (`DESIGN.md` + `EXPERIENCE.md`).
3. An approved spec for the client scope.

## Vocabulary (PRD §19 — binding on all user-facing text)

| Generic | STASH |
|---|---|
| Upload | **Stash it** |
| Uploading | **Stashing** |
| Uploaded | **Stashed** |
| Upload batch | **Stash** |
| Upload history | **Recent Stashes** |
| Remove cached copy | **Free up space** |
| Cloud drive | **STASH** |
| Search | **Search your STASH** |

Do **not** brand generic concepts — Files, Folders, Search, Settings and
Devices stay familiar. Never say "Delete" for an operation that only removes
a local cached copy.

## Product Truths Any UI Must Respect

- Never imply STASH reorganizes a library — it preserves hierarchy exactly.
- Communicate network-dependent states honestly; do not pretend cloud latency
  does not exist.
- File states are Cloud / Available / Keep on this device / Stashing /
  Syncing / Issue.
- No chatbot, no generative-AI assistant surface (PRD §14).
