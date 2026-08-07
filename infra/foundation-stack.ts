import { CfnOutput, Stack, type StackProps, Tags } from "aws-cdk-lib";
import { CfnBudget } from "aws-cdk-lib/aws-budgets";
import {
  OpenIdConnectProvider,
  type IOpenIdConnectProvider,
} from "aws-cdk-lib/aws-iam";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import type { Construct } from "constructs";

export interface YodevMailFoundationStackProps extends StackProps {
  alertEmail?: string;
  existingVercelOidcProviderArn?: string;
  vercelTeam: string;
}

export class YodevMailFoundationStack extends Stack {
  readonly alertTopic: Topic;
  readonly vercelOidcProvider: IOpenIdConnectProvider;

  constructor(scope: Construct, id: string, props: YodevMailFoundationStackProps) {
    super(scope, id, props);

    const issuerUrl = `https://oidc.vercel.com/${props.vercelTeam}`;
    const audience = `https://vercel.com/${props.vercelTeam}`;

    this.vercelOidcProvider = props.existingVercelOidcProviderArn
      ? OpenIdConnectProvider.fromOpenIdConnectProviderArn(
          this,
          "VercelOidc",
          props.existingVercelOidcProviderArn,
        )
      : new OpenIdConnectProvider(this, "VercelOidc", {
          url: issuerUrl,
          clientIds: [audience],
        });

    this.alertTopic = new Topic(this, "OperationsAlerts", {
      displayName: "Mail by Yodev operations alerts",
      topicName: "yodev-mail-operations-alerts",
    });

    if (props.alertEmail) {
      this.alertTopic.addSubscription(new EmailSubscription(props.alertEmail));
    }

    const subscribers = props.alertEmail
      ? [{ address: props.alertEmail, subscriptionType: "EMAIL" }]
      : [];

    new CfnBudget(this, "AccountMonthlyBudget", {
      budget: {
        budgetName: "yodev-mail-account-zero-cost",
        budgetType: "COST",
        costTypes: {
          includeCredit: false,
          includeRefund: false,
        },
        timeUnit: "MONTHLY",
        budgetLimit: { amount: 1, unit: "USD" },
      },
      notificationsWithSubscribers: subscribers.length
        ? [
            {
              notification: {
                comparisonOperator: "GREATER_THAN",
                notificationType: "ACTUAL",
                threshold: 0.01,
                thresholdType: "ABSOLUTE_VALUE",
              },
              subscribers,
            },
            {
              notification: {
                comparisonOperator: "GREATER_THAN",
                notificationType: "ACTUAL",
                threshold: 0.1,
                thresholdType: "ABSOLUTE_VALUE",
              },
              subscribers,
            },
            {
              notification: {
                comparisonOperator: "GREATER_THAN",
                notificationType: "FORECASTED",
                threshold: 0.5,
                thresholdType: "ABSOLUTE_VALUE",
              },
              subscribers,
            },
          ]
        : undefined,
    });

    Tags.of(this).add("Application", "yodev-mail");
    Tags.of(this).add("Product", "mail");
    Tags.of(this).add("Brand", "Yodev");
    Tags.of(this).add("managed-by", "aws-cdk");

    new CfnOutput(this, "OperationsAlertTopicArn", {
      value: this.alertTopic.topicArn,
    });
    new CfnOutput(this, "VercelOidcProviderArn", {
      value: this.vercelOidcProvider.openIdConnectProviderArn,
    });
  }
}
