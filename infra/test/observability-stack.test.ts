import { describe, expect, it } from "vitest";
import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Match, Template } from "aws-cdk-lib/assertions";
import {
  STASH_METRIC_NAMESPACE,
  StashObservabilityStack,
  type StashObservabilityStackProps,
} from "../lib/observability-stack";

const ENV = { account: "111122223333", region: "ap-south-1" };
const TABLE_ARN = `arn:aws:dynamodb:${ENV.region}:${ENV.account}:table/StashTable`;

type Overrides = Omit<StashObservabilityStackProps, "table" | "env">;

function synth(overrides: Overrides = {}): Template {
  const app = new cdk.App();
  const host = new cdk.Stack(app, "Fixtures", { env: ENV });
  const table = dynamodb.Table.fromTableArn(host, "T", TABLE_ARN);
  const stack = new StashObservabilityStack(app, "TestStashObservability", {
    env: ENV,
    table,
    ...overrides,
  });
  return Template.fromStack(stack);
}

interface AlarmProps {
  MetricName?: string;
  Namespace?: string;
  Statistic?: string;
  Period?: number;
  Threshold?: number;
  EvaluationPeriods?: number;
  ComparisonOperator?: string;
  TreatMissingData?: string;
  Dimensions?: Array<{ Name: string; Value: unknown }>;
  AlarmActions?: unknown[];
}

function alarms(template: Template): AlarmProps[] {
  return Object.values(template.findResources("AWS::CloudWatch::Alarm")).map(
    (r) => r.Properties as AlarmProps,
  );
}

function alarmFor(
  template: Template,
  namespace: string,
  metricName: string,
): AlarmProps {
  const hits = alarms(template).filter(
    (a) => a.Namespace === namespace && a.MetricName === metricName,
  );
  expect(hits).toHaveLength(1);
  return hits[0]!;
}

describe("log-group retention", () => {
  it("sets an explicit, finite retention on EVERY log group", () => {
    const groups = Object.values(
      synth().findResources("AWS::Logs::LogGroup"),
    ) as Array<{ Properties: { RetentionInDays?: unknown } }>;

    // Default-infinite retention is a silent recurring cost: the point of the
    // requirement is that no group is left without an explicit value.
    expect(groups.length).toBeGreaterThan(1);
    for (const g of groups) {
      const retention = g.Properties.RetentionInDays;
      expect(typeof retention).toBe("number");
      expect(Number.isFinite(retention as number)).toBe(true);
      expect(retention as number).toBeGreaterThan(0);
    }
  });

  it("keeps handler logs for 30 days and audit logs longer", () => {
    const template = synth();
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: "/aws/lambda/stash-create-stash",
      RetentionInDays: 30,
    });
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: "/stash/audit",
      RetentionInDays: 180,
    });
  });

  it("creates one log group per handler name supplied, under the granted stash- prefix", () => {
    const template = synth({ handlerNames: ["alpha", "beta"] });
    const names = Object.values(
      template.findResources("AWS::Logs::LogGroup"),
    ).map((r) => (r.Properties as { LogGroupName: string }).LogGroupName);
    expect(names).toContain("/aws/lambda/stash-alpha");
    expect(names).toContain("/aws/lambda/stash-beta");
    expect(names).toContain("/stash/audit");
    expect(names).toHaveLength(3);
  });

  it("retains log groups on stack destroy only if asked; default deletes them", () => {
    // Logs are diagnostic, not creator data: Rule/RETAIN protection applies to
    // the table and bucket, not to log groups.
    const groups = Object.values(synth().findResources("AWS::Logs::LogGroup"));
    for (const g of groups) {
      expect((g as { DeletionPolicy?: string }).DeletionPolicy).toBe("Delete");
    }
  });
});

describe("Lambda alarms", () => {
  it("alarms on any Lambda error", () => {
    const a = alarmFor(synth(), "AWS/Lambda", "Errors");
    expect(a.Statistic).toBe("Sum");
    expect(a.Period).toBe(300);
    expect(a.Threshold).toBe(1);
    expect(a.EvaluationPeriods).toBe(1);
    expect(a.ComparisonOperator).toBe("GreaterThanOrEqualToThreshold");
    // No invocations means no data. Alarming on missing data would fire
    // continuously in a 2-user beta that is idle most of the day.
    expect(a.TreatMissingData).toBe("notBreaching");
    expect(a.AlarmActions).toBeDefined();
    expect(a.AlarmActions!.length).toBeGreaterThan(0);
  });

  it("alarms on Lambda throttles", () => {
    const a = alarmFor(synth(), "AWS/Lambda", "Throttles");
    expect(a.Statistic).toBe("Sum");
    expect(a.Period).toBe(300);
    expect(a.Threshold).toBe(1);
    expect(a.EvaluationPeriods).toBe(1);
    expect(a.ComparisonOperator).toBe("GreaterThanOrEqualToThreshold");
    expect(a.TreatMissingData).toBe("notBreaching");
    expect(a.AlarmActions!.length).toBeGreaterThan(0);
  });

  it("aggregates across the account rather than naming functions it does not own", () => {
    for (const metricName of ["Errors", "Throttles"]) {
      const a = alarmFor(synth(), "AWS/Lambda", metricName);
      expect(a.Dimensions ?? []).toEqual([]);
    }
  });
});

describe("DynamoDB throttling alarm", () => {
  it("alarms on throttled requests against the STASH table", () => {
    const a = alarmFor(synth(), "AWS/DynamoDB", "ThrottledRequests");
    expect(a.Statistic).toBe("Sum");
    expect(a.Threshold).toBe(1);
    expect(a.ComparisonOperator).toBe("GreaterThanOrEqualToThreshold");
    expect(a.TreatMissingData).toBe("notBreaching");
    expect(a.Dimensions).toEqual([{ Name: "TableName", Value: "StashTable" }]);
  });
});

describe("custom metric namespace", () => {
  it("is exactly the string the app role's condition allows", () => {
    // A typo here silently breaks every handler's PutMetricData, because the
    // role grant is conditioned on cloudwatch:namespace == "STASH".
    expect(STASH_METRIC_NAMESPACE).toBe("STASH");
  });

  it("is published as a stack output so handlers can be wired to it", () => {
    const outputs = synth().findOutputs("*");
    const values = Object.values(outputs).map(
      (o) => (o as { Value: unknown }).Value,
    );
    expect(values).toContain("STASH");
  });
});

describe("AWS Budget", () => {
  it("creates a monthly cost budget with a documented default limit", () => {
    synth().hasResourceProperties("AWS::Budgets::Budget", {
      Budget: Match.objectLike({
        BudgetType: "COST",
        TimeUnit: "MONTHLY",
        BudgetLimit: { Amount: 100, Unit: "USD" },
      }),
    });
  });

  it("honours a caller-supplied monthly limit", () => {
    synth({ monthlyBudgetUsd: 42 }).hasResourceProperties(
      "AWS::Budgets::Budget",
      {
        Budget: Match.objectLike({
          BudgetLimit: { Amount: 42, Unit: "USD" },
        }),
      },
    );
  });

  it("notifies at 80% and 100% of actual spend, to the alert topic", () => {
    const budgets = Object.values(
      synth().findResources("AWS::Budgets::Budget"),
    );
    expect(budgets).toHaveLength(1);
    const notifications = (
      budgets[0]!.Properties as {
        NotificationsWithSubscribers: Array<{
          Notification: {
            NotificationType: string;
            Threshold: number;
            ComparisonOperator: string;
            ThresholdType: string;
          };
          Subscribers: Array<{ SubscriptionType: string; Address: unknown }>;
        }>;
      }
    ).NotificationsWithSubscribers;

    const thresholds = notifications.map((n) => n.Notification.Threshold);
    expect(thresholds).toContain(80);
    expect(thresholds).toContain(100);
    for (const n of notifications) {
      expect(n.Notification.NotificationType).toBe("ACTUAL");
      expect(n.Notification.ThresholdType).toBe("PERCENTAGE");
      expect(n.Notification.ComparisonOperator).toBe("GREATER_THAN");
      expect(n.Subscribers).toHaveLength(1);
      expect(n.Subscribers[0]!.SubscriptionType).toBe("SNS");
    }
  });

  it("adds an email subscriber only when an address is supplied", () => {
    const withEmail = Object.values(
      synth({ alertEmail: "beta-ops@example.com" }).findResources(
        "AWS::SNS::Subscription",
      ),
    );
    expect(withEmail).toHaveLength(1);
    expect(withEmail[0]!.Properties).toMatchObject({
      Protocol: "email",
      Endpoint: "beta-ops@example.com",
    });
    expect(
      Object.values(synth().findResources("AWS::SNS::Subscription")),
    ).toHaveLength(0);
  });
});

describe("alert topic", () => {
  it("lets AWS Budgets publish to it", () => {
    const template = synth();
    template.resourceCountIs("AWS::SNS::Topic", 1);
    template.hasResourceProperties(
      "AWS::SNS::TopicPolicy",
      Match.objectLike({
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: "sns:Publish",
              Principal: { Service: "budgets.amazonaws.com" },
            }),
          ]),
        }),
      }),
    );
  });
});
