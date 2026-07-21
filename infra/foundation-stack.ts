import { CfnOutput, Stack, type StackProps, Tags } from "aws-cdk-lib";
import { CfnBudget } from "aws-cdk-lib/aws-budgets";
import { OpenIdConnectProvider } from "aws-cdk-lib/aws-iam";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import type { Construct } from "constructs";

export interface VigieMailFoundationStackProps extends StackProps {
  alertEmail?: string;
  vercelTeam: string;
}

export class VigieMailFoundationStack extends Stack {
  readonly alertTopic: Topic;
  readonly vercelOidcProvider: OpenIdConnectProvider;

  constructor(scope: Construct, id: string, props: VigieMailFoundationStackProps) {
    super(scope, id, props);

    const issuerUrl = `https://oidc.vercel.com/${props.vercelTeam}`;
    const audience = `https://vercel.com/${props.vercelTeam}`;

    this.vercelOidcProvider = new OpenIdConnectProvider(this, "VercelOidc", {
      url: issuerUrl,
      clientIds: [audience],
    });

    this.alertTopic = new Topic(this, "OperationsAlerts", {
      displayName: "VigieMail operations alerts",
      topicName: "vigiemail-operations-alerts",
    });

    if (props.alertEmail) {
      this.alertTopic.addSubscription(new EmailSubscription(props.alertEmail));
    }

    const subscribers = props.alertEmail
      ? [{ address: props.alertEmail, subscriptionType: "EMAIL" }]
      : [];

    new CfnBudget(this, "AccountMonthlyBudget", {
      budget: {
        budgetName: "vigiemail-account-monthly",
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: 125, unit: "USD" },
      },
      notificationsWithSubscribers: subscribers.length
        ? [
            {
              notification: {
                comparisonOperator: "GREATER_THAN",
                notificationType: "ACTUAL",
                threshold: 50,
                thresholdType: "PERCENTAGE",
              },
              subscribers,
            },
            {
              notification: {
                comparisonOperator: "GREATER_THAN",
                notificationType: "ACTUAL",
                threshold: 80,
                thresholdType: "PERCENTAGE",
              },
              subscribers,
            },
            {
              notification: {
                comparisonOperator: "GREATER_THAN",
                notificationType: "FORECASTED",
                threshold: 100,
                thresholdType: "PERCENTAGE",
              },
              subscribers,
            },
          ]
        : undefined,
    });

    Tags.of(this).add("application", "vigiemail");
    Tags.of(this).add("managed-by", "aws-cdk");

    new CfnOutput(this, "OperationsAlertTopicArn", {
      value: this.alertTopic.topicArn,
    });
    new CfnOutput(this, "VercelOidcProviderArn", {
      value: this.vercelOidcProvider.openIdConnectProviderArn,
    });
  }
}
