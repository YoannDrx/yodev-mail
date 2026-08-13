export function logWorkerResult(input: {
  worker: string;
  correlationId: string;
  outcome: "completed" | "failed" | "skipped";
  code?: string;
}) {
  console.log(JSON.stringify({
    level: input.outcome === "failed" ? "error" : "info",
    message: "worker.record_processed",
    worker: input.worker,
    correlationId: input.correlationId,
    outcome: input.outcome,
    ...(input.code ? { code: input.code } : {}),
  }));
}
