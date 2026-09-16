import * as path from "node:path";
import * as fs from "node:fs";
import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpUserPoolAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Construct } from "constructs";

export interface StashApiStackProps extends cdk.StackProps {
  /** The Cognito pool that proves who a request belongs to (spec §3.1). */
  readonly userPool: cognito.IUserPool;
  /** The desktop app client; its id is the JWT audience the authorizer accepts. */
  readonly userPoolClient: cognito.IUserPoolClient;
  /** The STASH single table. Its NAME reaches handlers by environment variable. */
  readonly table: dynamodb.ITable;
  /** The STASH object bucket. Its NAME reaches handlers by environment variable. */
  readonly bucket: s3.IBucket;
  /**
   * The ONE shared execution role from `StashAppRoleStack` (Addendum A5,
   * superseding spec §3.5). This stack creates no role of its own.
   */
  readonly role: iam.IRole;
  /**
   * Log group per handler name, from `StashObservabilityStack`.
   *
   * Without this, Lambda creates `/aws/lambda/stash-<name>` itself at first
   * invocation with INFINITE retention — the silent recurring cost spec §3.6
   * exists to prevent — and the observability stack can then never create a
   * group that already exists. Handing each function its own group removes
   * that race instead of relying on deploy ordering to avoid it.
   *
   * Optional so the stack stays independently testable; a name with no entry
   * falls back to Lambda's own default.
   */
  readonly logGroups?: Record<string, logs.ILogGroup>;
}

/**
 * Function names live under this prefix because `StashAppRoleStack` scopes its
 * CloudWatch Logs grant to `/aws/lambda/stash-*`. A function named outside the
 * prefix would deploy, run, and be UNABLE TO WRITE A SINGLE LOG LINE — a
 * failure that is invisible until something goes wrong and there is no trace
 * of it. Asserted in `infra/test/api-stack.test.ts`.
 */
const FUNCTION_NAME_PREFIX = "stash-";

/** Environment variable names the entry modules read. Never read from a request. */
const TABLE_NAME_VAR = "STASH_TABLE_NAME";
const BUCKET_NAME_VAR = "STASH_BUCKET_NAME";

/** Where the entry modules live, relative to the repository root. */
const ENTRYPOINT_DIR = path.join("services", "entrypoints", "src");

/**
 * Sizing. A read handler answers from one or two queries; a write handler
 * couples a state change to a quota movement in one transaction.
 *
 * `registerFiles` is the outlier and is sized separately below: it resolves
 * folders one lookup at a time and then writes transaction-sized chunks
 * SEQUENTIALLY (Addendum A3), so a real creator folder of thousands of files
 * is a long chain of round trips rather than a single call.
 */
const READ_TIMEOUT = cdk.Duration.seconds(10);
const READ_MEMORY_MB = 256;
const WRITE_TIMEOUT = cdk.Duration.seconds(30);
const WRITE_MEMORY_MB = 512;
const REGISTER_TIMEOUT = cdk.Duration.minutes(5);
const REGISTER_MEMORY_MB = 1024;

interface RouteDefinition {
  /** Entry module basename in `services/entrypoints/src`, and the function suffix. */
  readonly name: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly timeout: cdk.Duration;
  readonly memoryMb: number;
}

/**
 * The approved route set — Addendum A2 exactly. `getFile` and the device
 * routes from spec §3.4 are deferred and deliberately absent.
 *
 * PATH PARAMETER NAMES ARE LOAD-BEARING. Each one is the name the handler
 * actually reads, verified against the handler source, not against §3.4's
 * prose:
 *   - `{id}`      — `stashIdFromPath` reads `pathParameters.id`
 *   - `{file_id}` — `fileIdFromEvent` reads `pathParameters.file_id`
 *   - `{folderId}`— `listChildren` reads `pathParameters.folderId`
 * A mismatch here produces an endpoint that fails 100% of the time in
 * production while every unit test still passes, because the handler tests
 * synthesize the event themselves.
 */
const ROUTES: readonly RouteDefinition[] = [
  { name: "create-download-lease", method: HttpMethod.POST, path: "/files/{id}/download-url", timeout: READ_TIMEOUT, memoryMb: READ_MEMORY_MB },
  {
    name: "trash-file",
    method: HttpMethod.DELETE,
    path: "/files/{id}",
    timeout: WRITE_TIMEOUT,
    memoryMb: WRITE_MEMORY_MB,
  },
  {
    name: "list-trash",
    method: HttpMethod.GET,
    path: "/trash",
    timeout: READ_TIMEOUT,
    memoryMb: READ_MEMORY_MB,
  },
  {
    name: "restore-file",
    method: HttpMethod.POST,
    path: "/files/{id}/restore",
    timeout: WRITE_TIMEOUT,
    memoryMb: WRITE_MEMORY_MB,
  },
  {
    name: "get-file",
    method: HttpMethod.GET,
    path: "/files/{id}",
    timeout: READ_TIMEOUT,
    memoryMb: READ_MEMORY_MB,
  },
  {
    name: "register-device",
    method: HttpMethod.POST,
    path: "/devices",
    timeout: WRITE_TIMEOUT,
    memoryMb: WRITE_MEMORY_MB,
  },
  {
    name: "revoke-device",
    method: HttpMethod.DELETE,
    path: "/devices/{id}",
    timeout: WRITE_TIMEOUT,
    memoryMb: WRITE_MEMORY_MB,
  },
  {
    name: "create-stash",
    method: HttpMethod.POST,
    path: "/stashes",
    timeout: WRITE_TIMEOUT,
    memoryMb: WRITE_MEMORY_MB,
  },
  {
    name: "check-manifest",
    method: HttpMethod.POST,
    path: "/stashes/{id}/manifest-check",
    timeout: WRITE_TIMEOUT,
    memoryMb: WRITE_MEMORY_MB,
  },
  {
    name: "register-files",
    method: HttpMethod.POST,
    path: "/stashes/{id}/files",
    timeout: REGISTER_TIMEOUT,
    memoryMb: REGISTER_MEMORY_MB,
  },
  {
    name: "complete-stash",
    method: HttpMethod.POST,
    path: "/stashes/{id}/complete",
    timeout: WRITE_TIMEOUT,
    memoryMb: WRITE_MEMORY_MB,
  },
  {
    name: "cancel-stash",
    method: HttpMethod.POST,
    path: "/stashes/{id}/cancel",
    timeout: WRITE_TIMEOUT,
    memoryMb: WRITE_MEMORY_MB,
  },
  {
    name: "sign-parts",
    method: HttpMethod.POST,
    path: "/uploads/{file_id}/parts",
    timeout: WRITE_TIMEOUT,
    memoryMb: WRITE_MEMORY_MB,
  },
  {
    name: "complete-upload",
    method: HttpMethod.POST,
    path: "/uploads/{file_id}/complete",
    timeout: WRITE_TIMEOUT,
    memoryMb: WRITE_MEMORY_MB,
  },
  {
    name: "abort-upload",
    method: HttpMethod.POST,
    path: "/uploads/{file_id}/abort",
    timeout: WRITE_TIMEOUT,
    memoryMb: WRITE_MEMORY_MB,
  },
  {
    name: "list-children",
    method: HttpMethod.GET,
    path: "/folders/{folderId}/children",
    timeout: READ_TIMEOUT,
    memoryMb: READ_MEMORY_MB,
  },
  {
    name: "list-stashes",
    method: HttpMethod.GET,
    path: "/stashes",
    timeout: READ_TIMEOUT,
    memoryMb: READ_MEMORY_MB,
  },
  {
    name: "get-usage",
    method: HttpMethod.GET,
    path: "/me/usage",
    timeout: READ_TIMEOUT,
    memoryMb: READ_MEMORY_MB,
  },
];

/** PascalCase construct id from a kebab-case entry module name. */
function constructId(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * The repository root, found by walking up from the current directory.
 *
 * Resolved rather than hard-coded relative to this file because the same stack
 * is synthesized from `cdk synth` (tsx, CommonJS) and from vitest (ESM), which
 * disagree about `__dirname` and `import.meta`. Walking up for a marker that
 * only the repository root has works identically under both.
 */
function repositoryRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (fs.existsSync(path.join(dir, ENTRYPOINT_DIR))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        `could not locate ${ENTRYPOINT_DIR} above ${process.cwd()}`,
      );
    }
    dir = parent;
  }
}

/**
 * STASH API stack: the HTTP API creators talk to, and one Lambda per route.
 *
 * HTTP API rather than REST API (spec §3.4): lower cost per request and a
 * native JWT authorizer, both of which matter for a cost-instrumented beta.
 *
 * Three properties hold across the whole stack and are asserted in tests:
 *
 * 1. **Every route is authorized.** The authorizer is the API's DEFAULT, so a
 *    route added later inherits it instead of shipping open. There is no
 *    public route — not a health check, not a version endpoint. `user_id`
 *    reaches a handler only as `requestContext.authorizer.jwt.claims.sub`
 *    (Rule 7), which exists only because the authorizer verified the token.
 * 2. **Every function assumes the ONE shared role** from `StashAppRoleStack`
 *    (Addendum A5). This stack creates no IAM role and no IAM policy.
 * 3. **Every function is named `stash-*`**, matching the role's log-group
 *    grant. See `FUNCTION_NAME_PREFIX`.
 *
 * The API is public and JWT-only — no IP allow-list (Addendum A2). Acceptable
 * for a 2-user private beta; revisit before any wider release.
 */
export class StashApiStack extends cdk.Stack {
  readonly httpApi: HttpApi;
  /** The invoke URL of the default stage, also emitted as a CfnOutput. */
  readonly apiUrl: string;
  /** Every route handler, keyed by its entry module name. */
  readonly handlers: Record<string, nodejs.NodejsFunction> = {};

  constructor(scope: Construct, id: string, props: StashApiStackProps) {
    super(scope, id, props);

    const { userPool, userPoolClient, table, bucket, role, logGroups } = props;
    const root = repositoryRoot();

    // Audience is the desktop client id: a token minted for some other client
    // of the same pool is rejected, so the audience is a real bound and not
    // decoration.
    const authorizer = new HttpUserPoolAuthorizer("StashJwtAuthorizer", userPool, {
      userPoolClients: [userPoolClient],
      authorizerName: "stash-jwt-authorizer",
    });

    this.httpApi = new HttpApi(this, "StashHttpApi", {
      apiName: "stash-api",
      description: "STASH control plane — public, JWT-only (Addendum A2).",
      // The default authorizer is the safety property: it applies to every
      // route unless a route explicitly opts out, and nothing here opts out.
      defaultAuthorizer: authorizer,
    });

    for (const route of ROUTES) {
      const fn = new nodejs.NodejsFunction(this, constructId(route.name), {
        functionName: `${FUNCTION_NAME_PREFIX}${route.name}`,
        entry: path.join(root, ENTRYPOINT_DIR, `${route.name}.ts`),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        architecture: lambda.Architecture.ARM_64,
        timeout: route.timeout,
        memorySize: route.memoryMb,
        // See StashApiStackProps.logGroups: owning the group here is what
        // stops Lambda minting an infinite-retention one at first invocation.
        logGroup: logGroups?.[route.name],
        // Addendum A5: the shared role. Passing a role explicitly is also what
        // stops NodejsFunction from minting one of its own.
        role,
        // Configuration, never request input: a table or bucket name taken
        // from a request would let a caller point a handler at storage that is
        // not theirs, which no amount of IAM scoping fixes afterwards.
        environment: {
          [TABLE_NAME_VAR]: table.tableName,
          [BUCKET_NAME_VAR]: bucket.bucketName,
        },
        bundling: {
          // ESM, matching the handler packages' own module format.
          format: nodejs.OutputFormat.ESM,
          target: "node20",
          sourceMap: true,
          // The Node 20 runtime ships AWS SDK v3, so bundling it would add
          // megabytes to every cold start for no behavioural gain.
          externalModules: ["@aws-sdk/*", "@smithy/*"],
          // esbuild emits `await` at top level for ESM interop shims; without
          // this banner the CJS-style `require` shim is undefined at runtime.
          banner:
            "import{createRequire}from'module';const require=createRequire(import.meta.url);",
        },
      });
      this.handlers[route.name] = fn;

      this.httpApi.addRoutes({
        path: route.path,
        methods: [route.method],
        integration: new HttpLambdaIntegration(
          `${constructId(route.name)}Integration`,
          fn,
        ),
      });
    }

    // `url` is optional on HttpApi only because an API with no default stage
    // has none; this one always creates a default stage.
    this.apiUrl = this.httpApi.url ?? this.httpApi.apiEndpoint;

    new cdk.CfnOutput(this, "ApiUrl", {
      value: this.apiUrl,
      description: "STASH control-plane base URL (JWT required on every route).",
    });
  }
}
