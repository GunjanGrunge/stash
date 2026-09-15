import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";

export interface StashIdentityStackProps extends cdk.StackProps {}

/**
 * Per-user storage quota for the private beta: 1 TiB (PRD §14).
 *
 * Cognito custom attributes have no server-side default, so this is the value
 * the operator writes into `custom:quota_bytes` when creating each beta user,
 * and the value a handler falls back to when the claim is absent.
 */
const DEFAULT_QUOTA_BYTES = 1024 ** 4;

/**
 * Grace period during which a just-rotated refresh token still works, so a
 * desktop client that loses the response to a refresh can retry without
 * logging the creator out.
 */
const REFRESH_TOKEN_ROTATION_GRACE = cdk.Duration.seconds(30);

/**
 * STASH identity stack: the Cognito user pool that proves who a request
 * belongs to, and the desktop app client that talks to it. Nothing else — it
 * knows nothing about files, folders or storage (spec §3.1).
 *
 * Deliberately minimal per Addendum A1: the pool ships now because Rule 7
 * (`user_id` comes only from verified JWT claims) cannot be satisfied without
 * it, while the identity *product* surface — device flows, MFA, recovery,
 * groups — is deferred.
 *
 * The pool uses RemovalPolicy.RETAIN on purpose. A user's `sub` is the
 * `user_id` behind every DynamoDB partition key and every S3 object key, so
 * deleting the pool would orphan the retained library rather than merely
 * losing logins.
 */
export class StashIdentityStack extends cdk.Stack {
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;
  /** 1 TiB — the beta quota seeded into `custom:quota_bytes` (PRD §14). */
  readonly defaultQuotaBytes = DEFAULT_QUOTA_BYTES;

  constructor(scope: Construct, id: string, props?: StashIdentityStackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, "StashUserPool", {
      // Addendum A1: the 2 beta users are created by hand. Public registration
      // would let anyone mint a tenant against a billed account.
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      // Cognito supplies the `custom:` prefix itself; the claim the handlers
      // read is `custom:quota_bytes`.
      customAttributes: {
        quota_bytes: new cognito.NumberAttribute({ mutable: true }),
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      // Deferred per Addendum A1 — not "off forever". Revisit before the beta
      // takes real creator data.
      mfa: cognito.Mfa.OFF,
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // No hosted UI domain is created: the desktop client authenticates
    // natively over SRP, and a hosted UI would add a browser auth surface with
    // no owner.
    this.userPoolClient = this.userPool.addClient("StashDesktopClient", {
      // A desktop binary cannot hold a secret safely — it would ship inside
      // the installer and be extractable.
      generateSecret: false,
      // SRP only: the password never crosses the wire, so no password-carrying
      // flow is enabled alongside it.
      authFlows: { userSrp: true },
      // Enabling rotation makes CDK drop ALLOW_REFRESH_TOKEN_AUTH from the
      // explicit flows, because rotated refresh tokens are handled by the
      // rotation feature rather than by that flow.
      refreshTokenRotationGracePeriod: REFRESH_TOKEN_ROTATION_GRACE,
      enableTokenRevocation: true,
      preventUserExistenceErrors: true,
      // No hosted UI means no redirect surface; without this CDK defaults a
      // callback URL of https://example.com into the client.
      disableOAuth: true,
    });
  }
}
