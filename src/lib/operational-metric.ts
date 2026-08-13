export function emitOperationalMetric(name: "AttachmentPurgeFailure" | "AttachmentScanRejected" | "CustomerWebhookTerminalFailure" | "ProviderOutcomeUnknown", value = 1) {
  console.log(JSON.stringify({
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [{
        Namespace: "Yodev/Mail",
        Dimensions: [["Environment"]],
        Metrics: [{ Name: name, Unit: "Count" }],
      }],
    },
    Environment: process.env.DEPLOYMENT_ENVIRONMENT ?? "unknown",
    [name]: value,
  }));
}
