import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/aws", () => ({ awsClients: async () => ({ ses: { send } }) }));
import { SesDeliveryProvider } from "./ses";

const input = {
  messageId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  externalAccountId: "ym-prod-00000000-0000-4000-8000-000000000002",
  from: { email: "sender@example.test", name: "Sender" },
  to: { email: "recipient@example.test" },
  subject: "Subject", html: "<p>Hello</p>", text: "Hello", attachments: [],
};

describe("SES delivery contract", () => {
  beforeEach(() => { vi.stubEnv("SES_ENABLED", "true"); vi.stubEnv("DEPLOYMENT_ENVIRONMENT", "prod"); send.mockReset(); });
  afterEach(() => vi.unstubAllEnvs());

  it("uses the tenant, transactional configuration and only opaque tags with a bounded request", async () => {
    send.mockResolvedValue({ MessageId: "ses-1" });
    await expect(new SesDeliveryProvider().send(input)).resolves.toMatchObject({ providerMessageId: "ses-1" });
    const [command, options] = send.mock.calls[0];
    expect(command.input).toMatchObject({
      TenantName: input.externalAccountId, ConfigurationSetName: `${input.externalAccountId}-txn`,
      EmailTags: [{ Name: "ym_message_id", Value: input.messageId }, { Name: "ym_workspace_id", Value: input.workspaceId }, { Name: "ym_environment", Value: "prod" }],
    });
    expect(options?.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("does not contact SES while disabled", async () => {
    vi.stubEnv("SES_ENABLED", "false");
    await expect(new SesDeliveryProvider().send(input)).rejects.toMatchObject({ kind: "definitive", code: "ses_disabled" });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "production", "preview"])("refuses an ambiguous deployment environment: %s", async (environment) => {
    vi.stubEnv("DEPLOYMENT_ENVIRONMENT", environment);
    await expect(new SesDeliveryProvider().send(input)).rejects.toMatchObject({ kind: "definitive", code: "ses_environment_invalid" });
    expect(send).not.toHaveBeenCalled();
  });

  it("tags development explicitly without deriving it from a workspace or tenant name", async () => {
    vi.stubEnv("DEPLOYMENT_ENVIRONMENT", "dev");
    send.mockResolvedValue({ MessageId: "ses-dev" });
    await new SesDeliveryProvider().send({ ...input, externalAccountId: `ym-dev-${input.workspaceId}` });
    expect(send.mock.calls[0][0].input.EmailTags).toContainEqual({ Name: "ym_environment", Value: "dev" });
  });

  it.each([
    `ym-dev-${input.workspaceId}`,
    "ym-prod-00000000-0000-4000-8000-000000000003",
    `ym-${input.workspaceId}`,
    "ym-sandbox-cert",
    "",
  ])("refuses a mismatched or legacy account before sending: %s", async (externalAccountId) => {
    await expect(new SesDeliveryProvider().send({ ...input, externalAccountId })).rejects.toMatchObject({
      kind: "definitive", code: "ses_account_mismatch",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("does not sanitize an arbitrary workspace into a sendable tenant name", async () => {
    await expect(new SesDeliveryProvider().send({ ...input, workspaceId: "not-a-uuid", externalAccountId: "ym-prod-not-a-uuid" })).rejects.toMatchObject({
      kind: "definitive", code: "ses_account_mismatch",
    });
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

  it.each([
    ["x@other.test, Bob", '"x@other.test, Bob" <recipient@example.test>'],
    ['Bob" <evil@other.test>', '"Bob\\" <evil@other.test>" <recipient@example.test>'],
    ["back\\slash", '"back\\\\slash" <recipient@example.test>'],
    ["Zoé", "=?UTF-8?B?Wm/DqQ==?= <recipient@example.test>"],
    ["📬 Équipe", "=?UTF-8?B?8J+TrCDDiXF1aXBl?= <recipient@example.test>"],
  ])("formats a hostile or non-ASCII display name as a single recipient: %s", async (name, expected) => {
    send.mockResolvedValue({ MessageId: "ses-1" });
    await new SesDeliveryProvider().send({ ...input, from: { email: "sender@example.test", name }, to: { email: "recipient@example.test", name } });
    const command = send.mock.calls[0][0];
    expect(command.input.Destination.ToAddresses).toEqual([expected]);
    expect(command.input.FromEmailAddress).toBe(expected.replace("recipient@", "sender@"));
  });
});
