# Task Brief: StashIdentityStack (Cognito)

Goal: Define the Cognito user pool and desktop app client that authenticate
STASH users.

Files (exclusive ownership boundary):
- `infra/lib/identity-stack.ts`
- `infra/test/identity-stack.test.ts`

**You are forbidden to touch `infra/bin/stash.ts`.** Task 13 owns it.

Interfaces — produce EXACTLY:
```ts
export class StashIdentityStack extends cdk.Stack {
  readonly userPool: cognito.UserPool;             // construct id "StashUserPool"
  readonly userPoolClient: cognito.UserPoolClient; // construct id "StashDesktopClient"
  constructor(scope: Construct, id: string, props?: cdk.StackProps);
}
```
Pool: sign-in by email; `mfa: cognito.Mfa.OPTIONAL`;
`mfaSecondFactor: { sms: false, otp: true }`; password policy minimum length
12 requiring lowercase, uppercase, digits and symbols;
`selfSignUpEnabled: false`; custom attribute `quota_bytes`
(`new cognito.NumberAttribute({ mutable: true })`); `removalPolicy: RETAIN`.
Client: `generateSecret: false`; `authFlows: { userSrp: true }`;
`accessTokenValidity: cdk.Duration.minutes(60)`;
`refreshTokenValidity: cdk.Duration.days(30)`; no hosted-UI OAuth flows.

Steps (TDD):
1. Write `infra/test/identity-stack.test.ts` asserting via `Template.fromStack`:
   `MfaConfiguration` is `"OPTIONAL"`; the user pool client has
   `GenerateSecret: false`; `ExplicitAuthFlows` INCLUDES
   `ALLOW_USER_SRP_AUTH` and EXCLUDES `ALLOW_USER_PASSWORD_AUTH`;
   `AdminCreateUserConfig.AllowAdminCreateUserOnly` is true; and the pool
   schema contains an attribute named `quota_bytes`.
2. Run `npx vitest run infra/test/identity-stack.test.ts` — confirm it FAILS
   on the unresolved module. Record the error.
3. Write `infra/lib/identity-stack.ts` to the interface above.
4. Run the test again — confirm it passes.
5. Verification: paste the passing output.

Acceptance Criteria: all assertions pass, with the no-client-secret and the
no-plain-password-auth assertions explicitly green. A desktop binary cannot
hold a client secret safely, and plain password auth would bypass SRP — both
are security requirements (PRD §12), not style choices.

Effort Budget: 35 tool calls.

Relevant Standing Rules (verbatim):
- Rule 7: `user_id` comes only from verified JWT claims — this stack is what
  makes those claims trustworthy, so do not weaken the auth flows.
- Rule 11: Every `cdk deploy` or mutating AWS CLI call is High severity.
  **This task never deploys and makes no AWS API call.**
- Rule 12: Never write AWS credentials into the repository or any artifact.
- MFA is OPTIONAL by explicit user decision on 2026-09-15 for a named 2-user
  beta. Do not "improve" it to required — that decision is the user's.

Working directory: `/mnt/c/Users/Bot/Desktop/stash`
Host Evidence: host=claude-code; subagent=stash-task-4-identity-stack.

Escalate, do not improvise, when: an unexpected dependency the brief did not mention; a file the brief did not list needing changes; a conflicting or already-modified file; a requirement ambiguous enough to support two different implementations; a missing tool, credential, or piece of environment; a test failing for a reason unrelated to this task; or the Effort Budget exceeded with the task still incomplete. Report status `blocked` with exactly what was found — improvising past any of them is scope creep even when it would probably work.
