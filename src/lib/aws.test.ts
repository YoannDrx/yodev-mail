import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SendEmailCommand } from "@aws-sdk/client-sesv2";

const dependencies = vi.hoisted(() => ({
  send: vi.fn(),
  environment: { AWS_REGION: "eu-west-3", AWS_PROVIDER_PROVISIONING_QUEUE_URL: "", AWS_EMAIL_QUEUE_URL: "" },
}));
vi.mock("@/lib/env", () => ({ env: dependencies.environment }));
vi.mock("@aws-sdk/client-sqs", async (original) => ({
  ...await original<typeof import("@aws-sdk/client-sqs")>(),
  SQSClient: class { send = dependencies.send; },
}));

import { awsClients, enqueueMessage, enqueueMessages, enqueueProviderProvisioning } from "./aws";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const bindingId = "00000000-0000-4000-8000-000000000002";
beforeEach(() => { dependencies.send.mockReset().mockResolvedValue({}); });
afterEach(() => {
  dependencies.environment.AWS_PROVIDER_PROVISIONING_QUEUE_URL = "";
  dependencies.environment.AWS_EMAIL_QUEUE_URL = "";
  vi.unstubAllEnvs();
});

describe("email queue producers", () => {
  it("publishes the explicit workspace with every individual message", async () => {
    dependencies.environment.AWS_EMAIL_QUEUE_URL = "https://sqs.eu-west-3.amazonaws.com/123456789012/synthetic";
    await expect(enqueueMessage(workspaceId, bindingId)).resolves.toEqual({ local: false });
    expect(JSON.parse(dependencies.send.mock.calls[0][0].input.MessageBody)).toEqual({ workspaceId, messageId: bindingId });
  });
  it("validates even when no queue is configured", async () => {
    await expect(enqueueMessage(workspaceId, bindingId)).resolves.toEqual({ local: true });
    await expect(enqueueMessage("private@example.test", bindingId)).rejects.toThrow(/^invalid_email_send_job$/);
    expect(dependencies.send).not.toHaveBeenCalled();
  });
  it("validates all batch identifiers before publishing any batch", async () => {
    dependencies.environment.AWS_EMAIL_QUEUE_URL = "https://sqs.eu-west-3.amazonaws.com/123456789012/synthetic";
    await expect(enqueueMessages(workspaceId, [...Array(10).fill(bindingId), "private body"])).rejects.toThrow(/^invalid_email_send_job$/);
    expect(dependencies.send).not.toHaveBeenCalled();
  });
  it("splits batches at ten and preserves workspace IDs", async () => {
    dependencies.environment.AWS_EMAIL_QUEUE_URL = "https://sqs.eu-west-3.amazonaws.com/123456789012/synthetic";
    await enqueueMessages(workspaceId, Array(11).fill(bindingId));
    expect(dependencies.send).toHaveBeenCalledTimes(2);
    expect(dependencies.send.mock.calls.map(([command]) => command.input.Entries.length)).toEqual([10, 1]);
    for (const [command] of dependencies.send.mock.calls) {
      for (const entry of command.input.Entries) expect(JSON.parse(entry.MessageBody)).toEqual({ workspaceId, messageId: bindingId });
    }
  });
  it("does not report a partially rejected SQS batch as successful", async () => {
    dependencies.environment.AWS_EMAIL_QUEUE_URL = "https://sqs.eu-west-3.amazonaws.com/123456789012/synthetic";
    dependencies.send.mockResolvedValue({ Failed: [{ Id: "0", Message: "private diagnostic" }] });
    await expect(enqueueMessages(workspaceId, Array(11).fill(bindingId))).rejects.toThrow(/^email_enqueue_batch_failed$/);
    expect(dependencies.send).toHaveBeenCalledTimes(1);
  });
});

it("does not retry an uncertain SES send inside the SDK", async () => {
  vi.stubEnv("AWS_ACCESS_KEY_ID", "test-access-key");
  vi.stubEnv("AWS_SECRET_ACCESS_KEY", "test-secret-key");
  const { ses } = await awsClients();
  const handle = vi.spyOn(ses.config.requestHandler, "handle").mockRejectedValue(
    Object.assign(new Error("connection reset"), { name: "TimeoutError" }),
  );
  try {
    await expect(ses.send(new SendEmailCommand({
      FromEmailAddress: "sender@example.test",
      Destination: { ToAddresses: ["recipient@example.test"] },
      Content: { Simple: { Subject: { Data: "Test" }, Body: { Text: { Data: "Test" } } } },
    }))).rejects.toMatchObject({ name: "TimeoutError" });
    expect(handle).toHaveBeenCalledTimes(1);
  } finally {
    ses.destroy();
  }
});

describe("provider provisioning enqueue", () => {
  it("emits only the explicit workspace and binding identifiers", async () => {
    dependencies.environment.AWS_PROVIDER_PROVISIONING_QUEUE_URL = "https://sqs.eu-west-3.amazonaws.com/123456789012/synthetic";
    await expect(enqueueProviderProvisioning(workspaceId, bindingId)).resolves.toEqual({ local: false });
    const command = dependencies.send.mock.calls[0][0];
    expect(command.input.QueueUrl).toBe(dependencies.environment.AWS_PROVIDER_PROVISIONING_QUEUE_URL);
    expect(JSON.parse(command.input.MessageBody)).toEqual({ workspaceId, bindingId });
  });
  it("keeps the local path explicit when no queue is configured", async () => {
    await expect(enqueueProviderProvisioning(workspaceId, bindingId)).resolves.toEqual({ local: true });
    expect(dependencies.send).not.toHaveBeenCalled();
  });
  it("rejects invalid identifiers before any queue access", async () => {
    await expect(enqueueProviderProvisioning("private@example.test", bindingId)).rejects.toThrow("invalid_provider_provisioning_job");
    expect(dependencies.send).not.toHaveBeenCalled();
  });
});
