import { describe, expect, it } from "vitest";
import { parseWebhookDeliveryJob } from "./delivery-job";

const job = { workspaceId: "00000000-0000-4000-8000-000000000001", deliveryId: "00000000-0000-4000-8000-000000000002" };
describe("webhook delivery queue contract", () => {
  it("accepts only explicit opaque workspace and delivery identifiers", () => {
    expect(parseWebhookDeliveryJob(job)).toEqual(job);
  });
  it.each([null, {}, { deliveryId: job.deliveryId }, { workspaceId: job.workspaceId },
    { ...job, workspaceId: "private@example.test" }, { ...job, deliveryId: "private body" },
    { ...job, html: "private body" }, [job],
  ])("rejects invalid contracts without exposing their input", value => {
    expect(() => parseWebhookDeliveryJob(value)).toThrow(/^invalid_webhook_delivery_job$/);
  });
});
