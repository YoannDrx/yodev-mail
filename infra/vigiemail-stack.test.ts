import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, test } from "vitest";
import { VigieMailFoundationStack } from "./foundation-stack";
import { VigieMailStack } from "./vigiemail-stack";

let foundation: Template;
let workload: Template;

beforeAll(() => {
  const app = new App();
  const env = { account: "123456789012", region: "eu-west-3" };
  const foundationStack = new VigieMailFoundationStack(app, "Foundation", {
    alertEmail: "alerts@example.com",
    env,
    vercelTeam: "yoanndrxs-projects",
  });
  const workloadStack = new VigieMailStack(app, "Workload", {
    alertTopic: foundationStack.alertTopic,
    environment: "dev",
    env,
    vercelOidcProvider: foundationStack.vercelOidcProvider,
    vercelTeam: "yoanndrxs-projects",
  });
  foundation = Template.fromStack(foundationStack);
  workload = Template.fromStack(workloadStack);
});

describe("VigieMail AWS infrastructure", () => {
  test("uses the verified team-scoped Vercel OIDC claims", () => {
    foundation.hasResourceProperties("Custom::AWSCDKOpenIdConnectProvider", {
      ClientIDList: ["https://vercel.com/yoanndrxs-projects"],
      Url: "https://oidc.vercel.com/yoanndrxs-projects",
    });
    workload.hasResourceProperties(
      "AWS::IAM::Role",
      Match.objectLike({
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Condition: {
                StringEquals: {
                  "oidc.vercel.com/yoanndrxs-projects:aud":
                    "https://vercel.com/yoanndrxs-projects",
                  "oidc.vercel.com/yoanndrxs-projects:sub":
                    "owner:yoanndrxs-projects:project:vigie-mail:environment:preview",
                },
              },
            }),
          ]),
        }),
      }),
    );
  });

  test("encrypts every queue and alarms workers and backlogs", () => {
    const queues = workload.findResources("AWS::SQS::Queue");

    expect(Object.values(queues)).toHaveLength(8);
    for (const queue of Object.values(queues)) {
      expect(queue.Properties.SqsManagedSseEnabled).toBe(true);
    }
    workload.resourceCountIs("AWS::CloudWatch::Alarm", 28);
    workload.resourceCountIs("AWS::CloudWatch::Dashboard", 1);
  });

  test("caps email delivery without reserving scarce account concurrency", () => {
    workload.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      BatchSize: 1,
      ScalingConfig: { MaximumConcurrency: 2 },
    });
    for (const fn of Object.values(
      workload.findResources("AWS::Lambda::Function"),
    )) {
      expect(fn.Properties.ReservedConcurrentExecutions).toBeUndefined();
    }
  });

  test("creates cost alerts and a single shared operations topic", () => {
    foundation.resourceCountIs("AWS::Budgets::Budget", 1);
    foundation.resourceCountIs("AWS::SNS::Topic", 1);
    foundation.hasResourceProperties("AWS::Budgets::Budget", {
      Budget: Match.objectLike({
        BudgetLimit: { Amount: 125, Unit: "USD" },
      }),
      NotificationsWithSubscribers: Match.arrayWith([
        Match.objectLike({
          Notification: Match.objectLike({ Threshold: 80 }),
        }),
      ]),
    });
  });
});
