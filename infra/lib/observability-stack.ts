import * as cdk from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import { Construct } from "constructs";

/**
 * The single custom metric namespace STASH publishes into.
 *
 * This string is load-bearing: `StashAppRoleStack` grants
 * `cloudwatch:PutMetricData` only under the condition
 * `cloudwatch:namespace == "STASH"`. A typo here does not fail a build — it
 * silently denies every handler's PutMetricData at runtime. It is exported so
 * handler code imports the constant instead of retyping the literal.
 */
export const STASH_METRIC_NAMESPACE = "STASH";

/**
 * The PRD §18 product measures that are observable server-side. Extraction,
 * search and cache measures are client-side and are not listed here.
 */
export const STASH_METRIC_NAMES = {
  /** One datum per Stash reaching `completed` — the successful-Stash rate. */
  stashCompleted: "StashCompleted",
  /** One datum per Stash abandoned or failed, the denominator's other half. */
  stashFailed: "StashFailed",
  /** One datum per upload that resumed after an interruption and committed. */
  uploadResumeSucceeded: "UploadResumeSucceeded",
  /** One datum per manifest-check that found an existing folder (PRD §7). */
  duplicateFolderDetected: "DuplicateFolderDetected",
  /** Control-plane handler latency, in milliseconds. */
  apiLatencyMs: "ApiLatencyMs",
  /** Bytes committed to S3, dimensioned by user for per-user cost maths. */
  bytesUploaded: "BytesUploaded",
} as const;

/**
 * Build a metric in the STASH namespace. Using this rather than a literal is
 * what keeps a dashboard query and a handler's PutMetricData in agreement.
 */
export function stashMetric(
  metricName: (typeof STASH_METRIC_NAMES)[keyof typeof STASH_METRIC_NAMES],
  props: cloudwatch.CommonMetricOptions = {},
): cloudwatch.Metric {
  return new cloudwatch.Metric({
    ...props,
    namespace: STASH_METRIC_NAMESPACE,
    metricName,
  });
}

/**
 * Handler log groups created by default. These mirror the route list in
 * `api-stack.ts` (function name = `stash-<name>`) and the `/aws/lambda/stash-*`
 * prefix the app role is allowed to write to. A Lambda writes to
 * `/aws/lambda/<function-name>`, so the names must agree exactly — otherwise
 * Lambda creates its own group at first invocation, with infinite retention.
 *
 * Two consequences the controller owns, because this stack deliberately does
 * not import the API stack:
 *  - keep this list in step with the API stack's routes, or override it via
 *    `handlerNames`;
 *  - deploy this stack BEFORE the API stack. If Lambda auto-creates a group
 *    first, CloudFormation cannot then create the same name here.
 */
const DEFAULT_HANDLER_NAMES: readonly string[] = [
  "create-download-lease",
  "trash-file",
  "list-trash",
  "restore-file",
  "get-file",
  "register-device",
  "revoke-device",
  "create-stash",
  "check-manifest",
  "register-files",
  "sign-parts",
  "complete-upload",
  "abort-upload",
  "complete-stash",
  "cancel-stash",
  "list-children",
  "list-stashes",
  "get-usage",
];

/** Lambda log-group name for a handler, matching the app role's grant. */
const logGroupNameFor = (handler: string): string =>
  `/aws/lambda/stash-${handler}`;

/**
 * Audit trail for sensitive operations (device revoke, quota change, upload
 * authorization) — spec §3.6. Separate from handler logs so its retention can
 * differ and so it is not truncated by ordinary log volume.
 */
const AUDIT_LOG_GROUP_NAME = "/stash/audit";

/**
 * 30 days for handler logs.
 *
 * Retention MUST be explicit: a log group left at the CloudWatch default keeps
 * data forever and bills forever, which is exactly the silent recurring cost
 * the beta is trying to measure. 30 days is chosen because it is one full
 * billing cycle — long enough to reconcile a monthly AWS invoice against the
 * requests that produced it (PRD §18), and to debug anything a 2-user beta
 * reports, without paying to store logs nobody will ever open.
 */
const HANDLER_LOG_RETENTION = logs.RetentionDays.ONE_MONTH;

/**
 * 180 days for the audit trail. Volume is negligible (a handful of events per
 * user per month), and "who authorized this upload / revoked this device" is a
 * question asked long after the fact. Still finite, for the same reason.
 */
const AUDIT_LOG_RETENTION = logs.RetentionDays.SIX_MONTHS;

/**
 * Default monthly budget, USD.
 *
 * Derived, not guessed: 2 beta users x 1 TiB S3 Standard in ap-south-1 at
 * ~$0.025/GB is ~$51/month at full quota, plus DynamoDB on-demand, Lambda,
 * API Gateway and egress for a 2-user workload. $100 leaves headroom for a
 * full-quota month while still alarming long before a runaway becomes
 * expensive. The controller overrides it once a real invoice exists.
 */
const DEFAULT_MONTHLY_BUDGET_USD = 100;

/** Alarm evaluation window. Long enough to batch, short enough to notice. */
const ALARM_PERIOD = cdk.Duration.minutes(5);

export interface StashObservabilityStackProps extends cdk.StackProps {
  /** The STASH single table — the DynamoDB throttling alarm is scoped to it. */
  readonly table: dynamodb.ITable;
  /**
   * Handler names to create log groups for, without the `stash-` prefix.
   * Defaults to the control-plane handlers in spec §4.
   */
  readonly handlerNames?: readonly string[];
  /** Monthly AWS spend limit in USD. Default: {@link DEFAULT_MONTHLY_BUDGET_USD}. */
  readonly monthlyBudgetUsd?: number;
  /**
   * Address to email budget and alarm notifications to. Omitted by default —
   * an address cannot be invented here, and a wrong one is worse than none.
   * Without it the alerts still reach the SNS topic, which an operator can
   * subscribe to by hand.
   */
  readonly alertEmail?: string;
}

/**
 * STASH observability stack (spec §3.6): explicit log retention, the alarms a
 * 2-user beta will actually act on, and the AWS Budget that lets the beta
 * answer PRD §18's commercial question — *real monthly AWS cost per active
 * 1 TB user*.
 *
 * Deliberately NOT here: dashboards (nobody reads a dashboard for 2 users;
 * the Budget and the alarms push instead of waiting to be visited), composite
 * alarms, and per-function alarm fan-out. Cost-allocation tags are applied
 * app-wide in `infra/bin/stash.ts`, so nothing is tagged again here.
 *
 * This stack takes what it needs as props and imports nothing from a sibling
 * stack.
 */
export class StashObservabilityStack extends cdk.Stack {
  /** Where every alarm and budget notification lands. */
  readonly alertTopic: sns.Topic;
  /** Handler log groups, keyed by handler name. */
  readonly handlerLogGroups: Record<string, logs.LogGroup> = {};
  /** Structured audit events for sensitive operations. */
  readonly auditLogGroup: logs.LogGroup;
  /** The namespace handlers must publish into. */
  readonly metricNamespace = STASH_METRIC_NAMESPACE;

  constructor(
    scope: Construct,
    id: string,
    props: StashObservabilityStackProps,
  ) {
    super(scope, id, props);

    const {
      table,
      handlerNames = DEFAULT_HANDLER_NAMES,
      monthlyBudgetUsd = DEFAULT_MONTHLY_BUDGET_USD,
      alertEmail,
    } = props;

    // 1. One notification hub. An alarm with no action is decoration.
    this.alertTopic = new sns.Topic(this, "StashAlerts", {
      displayName: "STASH beta alerts",
    });
    this.alertTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ["sns:Publish"],
        principals: [new iam.ServicePrincipal("budgets.amazonaws.com")],
        resources: [this.alertTopic.topicArn],
      }),
    );
    if (alertEmail !== undefined) {
      this.alertTopic.addSubscription(
        new snsSubscriptions.EmailSubscription(alertEmail),
      );
    }
    const alarmAction = new cwActions.SnsAction(this.alertTopic);

    // 2. Log groups with explicit, finite retention.
    //    RemovalPolicy.DESTROY on purpose: logs are diagnostics, not creator
    //    data. The RETAIN protection in the data stack exists so `cdk destroy`
    //    cannot delete a creator's library; keeping orphaned log groups billing
    //    after the stack is gone would be the same silent cost this stack is
    //    meant to prevent.
    for (const handler of handlerNames) {
      this.handlerLogGroups[handler] = new logs.LogGroup(
        this,
        `LogGroup-${handler}`,
        {
          logGroupName: logGroupNameFor(handler),
          retention: HANDLER_LOG_RETENTION,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        },
      );
    }
    this.auditLogGroup = new logs.LogGroup(this, "AuditLogGroup", {
      logGroupName: AUDIT_LOG_GROUP_NAME,
      retention: AUDIT_LOG_RETENTION,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 3. Alarms.
    //    The Lambda metrics are deliberately un-dimensioned: this account runs
    //    nothing but STASH, so the account-wide Sum answers "is anything
    //    broken?" with two alarms instead of two per function — and this stack
    //    does not import the API stack's functions to find out their names.
    //    treatMissingData: NOT_BREACHING everywhere, because an idle beta
    //    publishes no datapoints for most of the day and a MISSING-breaching
    //    alarm would sit in ALARM permanently and be ignored.
    const lambdaErrors = new cloudwatch.Metric({
      namespace: "AWS/Lambda",
      metricName: "Errors",
      statistic: cloudwatch.Stats.SUM,
      period: ALARM_PERIOD,
    });
    new cloudwatch.Alarm(this, "LambdaErrorsAlarm", {
      alarmName: `${this.stackName}-lambda-errors`,
      alarmDescription:
        "Any STASH handler invocation error in a 5-minute window.",
      metric: lambdaErrors,
      // Threshold 1: at 2 users there is no error budget to spend. One failed
      // Stash is one of the beta's few data points.
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(alarmAction);

    const lambdaThrottles = new cloudwatch.Metric({
      namespace: "AWS/Lambda",
      metricName: "Throttles",
      statistic: cloudwatch.Stats.SUM,
      period: ALARM_PERIOD,
    });
    new cloudwatch.Alarm(this, "LambdaThrottlesAlarm", {
      alarmName: `${this.stackName}-lambda-throttles`,
      alarmDescription:
        "STASH handlers are being throttled — concurrency limit reached.",
      metric: lambdaThrottles,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(alarmAction);

    // The table is on-demand, so throttling means a hot partition or the
    // account's per-table limit — not under-provisioning. Either way a Stash
    // is failing writes, so it is worth waking someone for.
    const tableThrottles = new cloudwatch.Metric({
      namespace: "AWS/DynamoDB",
      metricName: "ThrottledRequests",
      dimensionsMap: { TableName: table.tableName },
      statistic: cloudwatch.Stats.SUM,
      period: ALARM_PERIOD,
    });
    new cloudwatch.Alarm(this, "TableThrottleAlarm", {
      alarmName: `${this.stackName}-dynamodb-throttles`,
      alarmDescription:
        "The STASH table is throttling requests — hot partition or table limit.",
      metric: tableThrottles,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(alarmAction);

    // 4. The budget. PRD §18's headline question is a cost question, so the
    //    cost has to be watched, not just tagged. ACTUAL (not FORECASTED)
    //    thresholds: a 2-user beta's forecast from a few days of data is noise.
    const notification = (threshold: number): budgets.CfnBudget.NotificationWithSubscribersProperty => ({
      notification: {
        notificationType: "ACTUAL",
        comparisonOperator: "GREATER_THAN",
        threshold,
        thresholdType: "PERCENTAGE",
      },
      subscribers: [
        { subscriptionType: "SNS", address: this.alertTopic.topicArn },
      ],
    });

    new budgets.CfnBudget(this, "StashMonthlyBudget", {
      budget: {
        budgetName: `${this.stackName}-monthly`,
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: monthlyBudgetUsd, unit: "USD" },
      },
      // 80% is the "look at this now" signal; 100% is "the beta has already
      // cost more than it was meant to this month".
      notificationsWithSubscribers: [notification(80), notification(100)],
    });

    // 5. Surfaced so the API stack can pass the namespace to handlers as an
    //    environment variable rather than re-typing the literal.
    new cdk.CfnOutput(this, "MetricNamespace", {
      value: STASH_METRIC_NAMESPACE,
      description:
        "Custom metric namespace handlers must publish into; matches the app role's IAM condition.",
    });
    new cdk.CfnOutput(this, "AlertTopicArn", {
      value: this.alertTopic.topicArn,
      description: "SNS topic receiving STASH alarm and budget notifications.",
    });
    new cdk.CfnOutput(this, "AuditLogGroupName", {
      value: this.auditLogGroup.logGroupName,
      description: "Structured audit log group for sensitive operations.",
    });
  }
}
