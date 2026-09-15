# STASH — SIA Project Skill Manifest

Generated 2026-09-15. Makes project adaptation auditable and distinguishes a
*generated* project skill from a *static* SIA guide.

## Skill: `stash-sia`

| Field | Value |
|---|---|
| **Path (host-neutral source)** | `skills/stash-sia/SKILL.md` |
| **Host-discovery copy** | `.claude/skills/stash-sia/SKILL.md` (Claude Code) |
| **Purpose** | Re-establish the STASH project contract, approved stack, PRD invariants and the delegation/evidence gate at the start of any STASH session |
| **Generated** | 2026-09-15 |
| **Generation reason** | Immediately after project `AGENT.md` authoring, per `sia/guides/writing-project-skills.md` |
| **Type** | Generated (project-derived) — not a static SIA guide, not a copied domain pack |

### Project Evidence Used

| Evidence | Extent | What it contributed |
|---|---|---|
| `STASH_PRD_v0.1.md` | read in full (715 lines) | Product invariants §4.1–4.5, §7, §11, §13, §19 vocabulary |
| `_bmad-output/planning-artifacts/specs/2026-09-15-aws-control-plane-design.md` | authored + approved this session | Stack, scope boundary, acceptance checks |
| `AGENT.md` (project) | authored this session | Authority order, severity threshold, execution gate |
| `_bmad-output/planning-artifacts/2026-09-15-sia-intake-record.md` | authored this session | Knowns/unknowns; prevents claiming unread BMAD files as understood |
| User decisions, 2026-09-15 | conversation | CDK, TypeScript, SSE-S3, versioning off, Standard, MFA optional, deploy-for-real |

**Not used, and deliberately not invented:** the ~4,000 vendored BMAD skill
files (shape observed, contents unread), the desktop client technology, and
the mounted-drive approach — all still unknown and recorded as such.

### Attribution Record

| Field | Value |
|---|---|
| Mode | `both` (public-distribution default; no user override) |
| README path | `README.md` — **pending creation**, owned as a task in the first plan |
| Badge | `[![Powered by SIA — Self-Improving Agents](https://img.shields.io/badge/Powered%20by-SIA%20%E2%80%94%20Self--Improving%20Agents-007BFF?style=flat-square)](https://github.com/GunjanGrunge/SIA_package)` |
| Commit trailers | `Assisted-by: SIA — Self-Improving Agents` + `SIA-Run: <evidence path>` |
| Git identity | Preserved: `ZmaRk Hacker <stdevilgunjan@gmail.com>` — never altered |

### Reviewer Note

Smallest useful skill set: **one** project operating skill. No second skill
was generated — no distinct workflow yet justifies one. An execution skill
will be generated or this one extended once the implementation plan is
approved, per `sia/guides/writing-project-skills.md`.

The skill links to `AGENT.md` as the authority rather than duplicating it,
carries no secrets, tokens or `.env` values, and states explicitly that
`AGENT.md` wins on conflict.

**Regeneration trigger:** a material change to the approved spec, the plan,
or the active standing rules in `AGENT.md` §4. Record the reason; do not
overwrite silently.

---

## Skills added 2026-09-15 (user-requested: "make sure we have skill files for aws, ui backend and also architecture")

| Skill | Path | Host copy | Purpose | Project evidence used |
|---|---|---|---|---|
| `stash-architecture` | `skills/stash-architecture/SKILL.md` | `.claude/skills/stash-architecture/SKILL.md` | Component boundaries, control/data-plane split, single-table model, both state machines, and the in-scope decision procedure | Approved spec §2–§4; PRD §11, §14, §20 |
| `stash-aws` | `skills/stash-aws/SKILL.md` | `.claude/skills/stash-aws/SKILL.md` | Account-safety gates (every apply is High severity), credential handling, the 8 settled resource decisions, IAM rules enforced by tests, cost telemetry | Approved spec §3.3/§3.5/§3.6/§8; user decisions 2026-09-15; verified env (no AWS MCP server; creds invalid) |
| `stash-backend` | `skills/stash-backend/SKILL.md` | `.claude/skills/stash-backend/SKILL.md` | Handler security + correctness invariants, TDD contract, shared-library signatures | Approved spec §3.4/§5/§6/§7; PRD §12, §13 |
| `stash-ui` | `skills/stash-ui/SKILL.md` | `.claude/skills/stash-ui/SKILL.md` | **Guard skill** — no UI scope approved, no UX contract exists; mockups non-binding; PRD §19 vocabulary binding on any future UI | PRD §15, §16, §19; AFR-003 |

**Reviewer note:** `stash-ui` is deliberately a *guard* rather than an
implementation skill. There is no approved UI scope and no UX contract, so a
skill that helped write UI code would invite exactly the scope invention that
AFR-003 exists to prevent. It will be rewritten as an implementation skill
when a client scope and a real design contract exist.

All five skills defer to `AGENT.md` on conflict, carry no secrets, and are
committed project artifacts.
