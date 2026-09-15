#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { StashAppRoleStack } from "../lib/app-role-stack";
import { StashDataStack } from "../lib/data-stack";
import { StashIdentityStack } from "../lib/identity-stack";

/**
 * STASH CDK app entry point.
 *
 * The data stack and the shared application role stack exist today; the
 * Identity, Api and Observability stacks are not written yet and are
 * deliberately NOT stubbed here.
 *
 * The region is pinned so that `cdk synth` is environment-agnostic with
 * respect to account credentials (Rule 11: synth only, never deploy).
 */
const ENV: cdk.Environment = { region: "ap-south-1" };

/**
 * Cost-allocation tags (PRD §18 cost telemetry). Applied at App level so every
 * taggable resource in every stack inherits them.
 */
const APP_TAGS: Record<string, string> = {
  Project: "STASH",
  Env: "beta",
  Component: "control-plane",
  ManagedBy: "CDK",
  CostCenter: "stash-beta",
};

export function buildApp(): cdk.App {
  const app = new cdk.App();

  const data = new StashDataStack(app, "StashDataStack", { env: ENV });
  const identity = new StashIdentityStack(app, "StashIdentityStack", {
    env: ENV,
  });

  new StashAppRoleStack(app, "StashAppRoleStack", {
    env: ENV,
    table: data.table,
    bucket: data.bucket,
    // Now that the Identity stack exists, the Cognito grant is scoped to this
    // one pool. It stayed unset until there was a real ARN to scope it to —
    // an unscoped Cognito grant was never acceptable.
    userPoolArn: identity.userPool.userPoolArn,
  });

  for (const [key, value] of Object.entries(APP_TAGS)) {
    cdk.Tags.of(app).add(key, value);
  }

  return app;
}

buildApp().synth();
