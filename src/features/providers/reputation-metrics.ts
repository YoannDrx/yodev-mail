export type ReputationMetricName = "ProviderAccepted" | "ProviderHardBounce" | "ProviderComplaint";

/** CloudWatch namespace and metric names shared with the alarms in infra. */
export const reputationMetricNamespace = "Yodev/Mail";
export const reputationMetricNames = {
  accepted: "ProviderAccepted",
  hardBounce: "ProviderHardBounce",
  complaint: "ProviderComplaint",
} as const satisfies Record<string, ReputationMetricName>;

/**
 * Platform-wide reputation counters per provider, as CloudWatch Embedded
 * Metric Format on the Lambda log stream. Dimensions are the deployment
 * environment and provider only: never a workspace, address or content.
 */
export function emitReputationMetric(name: ReputationMetricName, provider: "ses" | "postmark", value = 1) {
  console.log(JSON.stringify({
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [{
        Namespace: reputationMetricNamespace,
        Dimensions: [["Environment", "Provider"]],
        Metrics: [{ Name: name, Unit: "Count" }],
      }],
    },
    Environment: process.env.DEPLOYMENT_ENVIRONMENT ?? "unknown",
    Provider: provider,
    [name]: value,
  }));
}
