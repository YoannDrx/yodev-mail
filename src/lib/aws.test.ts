import { afterEach, expect, it, vi } from "vitest";
import { SendEmailCommand } from "@aws-sdk/client-sesv2";

vi.mock("@/lib/env", () => ({ env: { AWS_REGION: "eu-west-3" } }));
import { awsClients } from "./aws";

afterEach(() => vi.unstubAllEnvs());

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
