import { beforeEach, describe, expect, it, vi } from "vitest";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/aws", () => ({ awsClients: async () => ({ ses: { send } }) }));
vi.mock("node:dns/promises", () => ({ resolveTxt: async () => [["v=DMARC1; p=none"]] }));
import { checkSesDomain } from "./check-domain";

describe("SES domain readiness", () => {
  beforeEach(() => send.mockReset());
  it.each(["PENDING", "FAILED", "TEMPORARY_FAILURE", undefined])("does not activate a domain with MAIL FROM status %s", async (status) => {
    send.mockResolvedValue({ VerifiedForSendingStatus: true, DkimAttributes: { Status: "SUCCESS" }, MailFromAttributes: { MailFromDomainStatus: status, BehaviorOnMxFailure: "REJECT_MESSAGE" } });
    expect(await checkSesDomain("example.test")).toMatchObject({ status: "pending" });
  });
  it("accepts a verified identity only with successful DKIM and MAIL FROM", async () => {
    send.mockResolvedValue({ VerifiedForSendingStatus: true, DkimAttributes: { Status: "SUCCESS" }, MailFromAttributes: { MailFromDomainStatus: "SUCCESS" } });
    expect(await checkSesDomain("example.test")).toMatchObject({ status: "verified", mailFromStatus: "verified", dkimStatus: "verified" });
  });
});
