import { describe, expect, it } from "vitest";
import { parseEmailSendJob } from "./send-job";

const job = { workspaceId: "00000000-0000-4000-8000-000000000001", messageId: "00000000-0000-4000-8000-000000000002" };
describe("email send queue contract", () => {
  it("accepts only explicit opaque workspace and message identifiers", () => {
    expect(parseEmailSendJob(job)).toEqual(job);
  });
  it.each([null, {}, { messageId: job.messageId }, { workspaceId: job.workspaceId },
    { ...job, workspaceId: "private@example.test" }, { ...job, messageId: "private body" },
    { ...job, html: "private body" }, [job],
  ])("rejects invalid contracts without exposing their input", value => {
    expect(() => parseEmailSendJob(value)).toThrow(/^invalid_email_send_job$/);
  });
});
