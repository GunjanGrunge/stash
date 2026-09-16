# STASH — AWS-Native Repo, CI/CD, and Dev/Prod Environments (Design Spec)

**Date:** 2026-09-16
**Status:** APPROVED 2026-09-16 (design presented in chat across two sections, user-approved)
**Source of truth:** `STASH_PRD_v0.1.md` §11 (AWS-First Architecture); this project's `AGENT.md`
**SIA stage:** Pipeline step 3 (Spec authoring)
**Scope owner decisions:** AWS CodeCatalyst for repo + CI/CD (not AWS CodeCommit — closed to new
customers since 2024); single AWS account for now, with a designed migration path to two accounts
as the project scales beyond private beta.

---

## 1. Problem / Goal

STASH currently has no CI/CD and no live AWS deployment — every CDK stack has only been
synthesized locally (`cdk synth`), never deployed (`_bmad-output/implementation-artifacts/sdd/progress.md`,
Task F3-ROLE: "Deploy NOT run — separate High-severity approval"). Source control is on GitHub.

The user wants:
1. A repo and CI/CD pipeline hosted in AWS instead of GitHub.
2. Separate dev and prod environments for the control plane.
3. A design that scales past a solo-developer, 2-user private beta without a rewrite later.

**In scope**
- Choice of AWS-native Git hosting + CI/CD service and why (given CodeCommit's status).
- Environment topology for dev/prod: account structure now, and the migration path as the team
  or user base grows.
- CDK application changes needed to support named, isolated dev/prod deployments (`Stage` construct).
- CI/CD workflow shape: what runs on every push, what runs on merge, what requires manual approval.
- Identity/secrets model for the pipeline (no long-lived AWS keys in CI).

**Explicitly out of scope for this spec**
- Actually creating the CodeCatalyst space/project, migrating the Git repository, or running any
  `cdk deploy` — every one of those is a mutating/billable action and is its own High-severity
  approval per this project's Rule 11, taken one at a time, not bundled into this spec's approval.
- The `StashRetentionStack` (trash/restore/purge) — tracked separately per the
  2026-09-16 sprint change proposal; this spec's environment/pipeline design must accommodate a
  6th stack being added, but does not implement it.
- Multi-account AWS Organizations setup mechanics (Control Tower, SCPs) — deferred to the point
  the team actually scales past solo/private-beta; Section 4 records the trigger condition and the
  shape of that follow-on work so it isn't a surprise later.

**Definition of done for this scope**
A reviewer can read this spec and the resulting CDK changes and see: (a) how a push results in
tests+typecheck+synth running automatically, (b) how a merge results in a Dev deployment without
a human touching the AWS console, (c) how a Prod deployment is gated on explicit human approval,
and (d) exactly what changes when the project later needs Prod in its own AWS account — without
that migration requiring new application code.

---

## 2. Why Not GitHub, and Why Not CodeCommit

**Not GitHub (for this decision):** the user's goal is to keep the entire security boundary —
repo access, build permissions, deploy permissions — inside one identity system (AWS IAM) with one
audit trail (CloudTrail), rather than split across GitHub (repo/Actions) and AWS (deploy target).
This is a legitimate simplification for a solo developer handling other people's creator asset
payloads, even though a private GitHub repo is not inherently easier to compromise than an
AWS-hosted one — access control, not platform, is what determines exposure. Recorded here so a
future reader does not mistake this for a claim that GitHub-private repos are insecure.

**Not AWS CodeCommit:** CodeCommit has been closed to new customers since mid-2024 (existing
CodeCommit customers retain access; new AWS accounts cannot create CodeCommit repositories). Since
this AWS account has no prior CodeCommit repos, CodeCommit is not an available option.

**Chosen: AWS CodeCatalyst.** CodeCatalyst is AWS's current Git-hosting + CI/CD service: it
provides a Git repository, a Workflow engine (YAML pipelines backed by CodeBuild), and IAM-role-based
(not long-lived-key-based) deployment identity, all inside the AWS account/IAM boundary.

---

## 3. Environment Topology

### Now: single AWS account, two CDK Stages

The existing CDK app (`infra/bin/stash.ts`) currently instantiates each stack once. This changes to
instantiate a `Stage` construct twice:

```
App
 ├─ StashDevStage   (env: this account, ap-south-1)
 │   ├─ StashDev-IdentityStack
 │   ├─ StashDev-DataStack
 │   ├─ StashDev-ApiStack
 │   ├─ StashDev-AppRoleStack
 │   ├─ StashDev-ObservabilityStack
 │   └─ StashDev-RetentionStack   (once F3/trash work lands)
 └─ StashProdStage  (env: this account, ap-south-1)
     ├─ StashProd-IdentityStack
     ├─ StashProd-DataStack
     ├─ StashProd-ApiStack
     ├─ StashProd-AppRoleStack
     ├─ StashProd-ObservabilityStack
     └─ StashProd-RetentionStack
```

Both stages deploy into the **same AWS account**, distinguished entirely by the `Stash{Dev,Prod}-`
stack-name prefix and by cost-allocation tags (`Environment: dev|prod`) that the `AppRoleStack`
already applies. This keeps cost and setup minimal for a solo developer and a 2-user private beta,
matching PRD §18's cost-telemetry goal (per-environment cost is queryable in Cost Explorer by tag,
without needing separate accounts).

**Trade-off, stated plainly:** a misconfigured IAM policy or a runaway script in Dev could
theoretically reach Prod resources, since both are in one account. This is accepted for now because
the blast radius is the developer's own 2 beta users, and is mitigated by the existing least-privilege
`AppRoleStack` design and Rule 11 (every `cdk deploy` is individually approved).

### Migration trigger and path: two-account isolation

**Trigger condition** (recorded now so it's not re-litigated ad hoc later): move to a two-account
model when any of the following becomes true — (a) a second person gets deploy access, (b) STASH
exits private beta (i.e., the 2-user/1-TB constraint in PRD §3 is lifted), or (c) real customer
payment/billing data enters the system.

**Path when triggered:** because `StashProdStage` is already a CDK `Stage`, not a bare set of
stacks, promoting it to its own AWS account is a configuration change, not a rewrite:
1. Create a second AWS account under AWS Organizations.
2. `cdk bootstrap` that account with a trust relationship back to the CodeCatalyst deploy role.
3. Change `StashProdStage`'s `env: { account, region }` to the new account ID.
4. Convert the CodeCatalyst Workflow's deploy action to CDK Pipelines' cross-account deploy stage
   (the self-mutating pipeline pattern), which handles the cross-account IAM assumption.

No stack logic, Lambda code, or data model changes are required for this migration — this is the
specific reason the CDK `Stage` construct is used now instead of flat stacks, even though the
extra structure has no runtime benefit for a single account today.

---

## 4. CI/CD Workflow

One CodeCatalyst repo (migrated from the current GitHub remote, preserving full Git history), one
CodeCatalyst project, one Workflow:

| Trigger | Action |
|---|---|
| Every push (any branch) | `npm ci && npx vitest run && npm run typecheck && npm run synth` — the same integration-phase check SIA's own pipeline already runs manually. Fails the workflow (blocks merge) on any red step. |
| Merge to `main` | Auto-deploy `StashDevStage` (`cdk deploy StashDev-*`) using a Dev-scoped deploy role. |
| After Dev deploy succeeds | Manual-approval action in the workflow — an explicit human click, not a timer — before Prod deploy proceeds. This is the CI/CD-level enforcement of Rule 11 (every `cdk deploy` is High severity), rather than relying on a human remembering to gate it by convention. |
| On approval | Deploy `StashProdStage` (`cdk deploy StashProd-*`) using a separate Prod-scoped deploy role. |

**Identity/secrets:** the CodeCatalyst Workflow assumes an IAM role via CodeCatalyst's built-in
AWS account connection (OIDC-style trust), scoped narrowly per stage — the Dev deploy role can only
touch `StashDev-*` stacks/resources; the Prod deploy role is a distinct role, only assumable from
the post-approval workflow step. No AWS access key or secret is ever stored as a CodeCatalyst
secret or committed to the repo, consistent with Rule 12 (never write AWS credentials into the
repository, a skill file, a session log, or a task brief).

---

## 5. What This Spec Does Not Decide Yet

- The exact CodeCatalyst space/project name and account linkage — decided at implementation time,
  since creating the space is itself a user-facing action outside this document's scope.
- Whether the existing GitHub repo is archived, made read-only, or deleted after migration — a
  separate, explicit decision the user makes once the CodeCatalyst repo is verified working,
  never assumed here.
- The `StashRetentionStack` design itself — tracked under the 2026-09-16 sprint change proposal;
  this spec only ensures the environment/pipeline shape has room for a 6th stack.

---

## Appendix A: Rejected Approach — Keep GitHub, Add AWS CI/CD Only

A GitHub-hosted repo with AWS CodePipeline/CodeBuild wired via a GitHub App connection was
considered. It is the fastest path to automated deploys and keeps a familiar PR review flow, but it
does not satisfy the user's stated goal of moving the repository itself into AWS — GitHub would
remain the source of truth and a second identity/audit boundary. Not chosen, recorded here so it
isn't silently reconsidered without noting why it was set aside.
