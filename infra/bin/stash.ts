#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { StashDataStack } from "../lib/data-stack";

/**
 * STASH CDK app entry point.
 *
 * Only the data stack exists today; the Identity, Api and Observability stacks
 * are not written yet and are deliberately NOT stubbed here.
 *
 * The region is pinned so that `cdk synth` is environment-agnostic with
 * respect to account credentials (Rule 11: synth only, never deploy).
 */
const app = new cdk.App();

new StashDataStack(app, "StashDataStack", {
  env: { region: "ap-south-1" },
});

app.synth();
