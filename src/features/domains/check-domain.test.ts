import { beforeEach, describe, expect, it, vi } from "vitest";

const { send, resolveTxt, cancel } = vi.hoisted(() => ({ send: vi.fn(), resolveTxt: vi.fn(), cancel: vi.fn() }));
vi.mock("@/lib/aws", () => ({ awsClients: async () => ({ ses: { send } }) }));
vi.mock("node:dns/promises", () => ({ Resolver: class { resolveTxt = resolveTxt; cancel = cancel; } }));
import { checkSesDomain } from "./check-domain";

describe("SES domain readiness", () => {
  beforeEach(() => {
    send.mockReset();
    resolveTxt.mockReset().mockResolvedValue([["v=DMARC1; p=none"]]);
    cancel.mockReset();
  });
  it("bounds the SES request and cancels a stalled dedicated DNS resolver", async () => {
    vi.useFakeTimers();
    try {
      send.mockResolvedValue({});
      resolveTxt.mockImplementation(() => new Promise((_resolve, reject) => {
        cancel.mockImplementation(() => reject(new Error("cancelled")));
      }));
      const pending = checkSesDomain("example.test");
      await vi.advanceTimersByTimeAsync(3_000);
      expect(await pending).toMatchObject({ dmarcStatus: "missing", status: "pending" });
      expect(cancel).toHaveBeenCalledOnce();
      expect(send.mock.calls[0][1].abortSignal).toBeInstanceOf(AbortSignal);
    } finally {
      vi.useRealTimers();
    }
  });
  it.each(["PENDING", "FAILED", "TEMPORARY_FAILURE", undefined])("does not activate a domain with MAIL FROM status %s", async (status) => {
    send.mockResolvedValue({ VerifiedForSendingStatus: true, DkimAttributes: { Status: "SUCCESS" }, MailFromAttributes: { MailFromDomainStatus: status, BehaviorOnMxFailure: "REJECT_MESSAGE" } });
    expect(await checkSesDomain("example.test")).toMatchObject({ status: "pending" });
  });
  it("accepts a verified identity only with successful DKIM and MAIL FROM", async () => {
    send.mockResolvedValue({ VerifiedForSendingStatus: true, DkimAttributes: { Status: "SUCCESS" }, MailFromAttributes: { MailFromDomainStatus: "SUCCESS" } });
    expect(await checkSesDomain("example.test")).toMatchObject({ status: "verified", mailFromStatus: "verified", dkimStatus: "verified" });
  });
});
