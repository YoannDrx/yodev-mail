import { describe, expect, it } from "vitest";
import { MAX_WEBHOOK_ATTEMPTS, nextWebhookAttemptAt } from "./retry-policy";

describe("customer webhook retry policy", () => {
  const start = new Date("2026-08-13T10:00:00.000Z");

  it("schedules eight attempts over at most 72 hours", () => {
    let cursor = start;
    for (let attempt = 1; attempt < MAX_WEBHOOK_ATTEMPTS; attempt += 1) {
      const next = nextWebhookAttemptAt(attempt, cursor);
      expect(next).not.toBeNull();
      cursor = next!;
    }
    expect(cursor.getTime() - start.getTime()).toBeLessThanOrEqual(72 * 60 * 60_000);
    expect(nextWebhookAttemptAt(MAX_WEBHOOK_ATTEMPTS, cursor)).toBeNull();
  });
});
