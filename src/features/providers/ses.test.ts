import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/aws", () => ({ awsClients: async () => ({ ses: { send } }) }));
import { SesDeliveryProvider } from "./ses";

const input = {
  messageId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  externalAccountId: "ym-test",
  from: { email: "sender@example.test", name: "Sender" },
  to: { email: "recipient@example.test" },
  subject: "Subject", html: "<p>Hello</p>", text: "Hello", attachments: [],
};

describe("SES delivery contract", () => {
  beforeEach(() => { vi.stubEnv("SES_ENABLED", "true"); send.mockReset(); });
  afterEach(() => vi.unstubAllEnvs());

  it("uses the tenant, transactional configuration and only opaque tags with a bounded request", async () => {
    send.mockResolvedValue({ MessageId: "ses-1" });
    await expect(new SesDeliveryProvider().send(input)).resolves.toMatchObject({ providerMessageId: "ses-1" });
    const [command, options] = send.mock.calls[0];
    expect(command.input).toMatchObject({
      TenantName: "ym-test", ConfigurationSetName: "ym-test-txn",
      EmailTags: [{ Name: "ym_message_id", Value: input.messageId }, { Name: "ym_workspace_id", Value: input.workspaceId }],
    });
    expect(options?.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("does not contact SES while disabled", async () => {
    vi.stubEnv("SES_ENABLED", "false");
    await expect(new SesDeliveryProvider().send(input)).rejects.toMatchObject({ kind: "definitive", code: "ses_disabled" });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ["TooManyRequestsException", "transient"], ["ThrottlingException", "transient"],
    ["AccountSuspendedException", "definitive"], ["SendingPausedException", "definitive"],
    ["NotFoundException", "definitive"], ["AccessDeniedException", "definitive"],
    ["BadRequestException", "definitive"], ["MessageRejected", "definitive"],
    ["MailFromDomainNotVerifiedException", "definitive"],
    ["InternalServiceErrorException", "ambiguous"], ["ServiceUnavailableException", "ambiguous"],
    ["TimeoutError", "ambiguous"], ["AbortError", "ambiguous"],
  ])("classifies %s as %s without persisting provider PII", async (name, kind) => {
    send.mockRejectedValue(Object.assign(new Error("recipient@example.test secret body"), { name }));
    await expect(new SesDeliveryProvider().send(input)).rejects.toMatchObject({ kind });
    await expect(new SesDeliveryProvider().send(input)).rejects.not.toThrow("recipient@example.test");
  });

  it("treats a missing message ID and an unrecognized error name as uncertain", async () => {
    send.mockResolvedValueOnce({});
    await expect(new SesDeliveryProvider().send(input)).rejects.toMatchObject({ kind: "ambiguous" });
    send.mockRejectedValueOnce({ name: "recipient@example.test" });
    await expect(new SesDeliveryProvider().send(input)).rejects.toMatchObject({ kind: "ambiguous", code: "ses_unknown" });
  });
});
