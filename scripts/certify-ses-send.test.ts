import { describe, expect, test, vi } from "vitest";
import type { GetEmailIdentityCommandOutput } from "@aws-sdk/client-sesv2";
import { assertSendIdentity, executeSendScenario, sendClientOptions, sendScenarios } from "./certify-ses-send.mjs";

const run = "20260910a";
const identity = (): GetEmailIdentityCommandOutput => ({
  $metadata: {}, IdentityType: "DOMAIN", VerifiedForSendingStatus: true,
  Tags: [{ Key: "yodev:environment", Value: "dev" }],
  DkimAttributes: { Status: "SUCCESS", SigningEnabled: true },
  MailFromAttributes: { MailFromDomain: "bounce.dev.ses-probe-20260910a.yodev.fr", MailFromDomainStatus: "SUCCESS", BehaviorOnMxFailure: "REJECT_MESSAGE" },
});

describe("isolated SES send certification", () => {
  test("only targets the success simulator, with synthetic content and no tags or recipients elsewhere", () => {
    for (const environment of ["dev", "prod"] as const) {
      const cases = sendScenarios(environment, run);
      expect(cases).toHaveLength(6);
      expect(cases.filter(scenario => scenario.allow)).toHaveLength(1);
      for (const scenario of cases) {
        expect(scenario.input.Destination).toEqual({ ToAddresses: ["success@simulator.amazonses.com"] });
        expect(scenario.input.FromEmailAddress).toMatch(/^probe@(dev|prod)\.ses-probe-20260910a\.yodev\.fr$/);
        expect(scenario.input.EmailTags).toBeUndefined();
        expect(scenario.input.ReplyToAddresses).toBeUndefined();
        expect(scenario.input.Content?.Simple?.Body?.Text?.Data).toContain("No customer data");
      }
    }
    expect(() => sendScenarios("dev", "arbitrary.example")).toThrow();
  });

  test("tests missing tenant and each cross-environment input separately", () => {
    const cases = sendScenarios("dev", run);
    expect(cases[0].input.TenantName).toBe("ym-dev-ses-probe-20260910a");
    expect(cases[1].input.TenantName).toBeUndefined();
    expect(cases[2].input.TenantName).toBe("ym-prod-ses-probe-20260910a");
    expect(cases[3].input.ConfigurationSetName).toBe("ym-prod-ses-probe-20260910a-txn");
    expect(cases[4].input.FromEmailAddress).toBe("probe@prod.ses-probe-20260910a.yodev.fr");
    expect(cases[5].input.TenantName).toBe(cases[2].input.TenantName);
    expect(cases[5].input.ConfigurationSetName).toBe(cases[3].input.ConfigurationSetName);
    expect(cases[5].input.FromEmailAddress).toBe(cases[4].input.FromEmailAddress);
  });

  test("requires ownership, verification, signing and fail-closed verified MAIL FROM", () => {
    expect(() => assertSendIdentity("dev", run, identity())).not.toThrow();
    const mailFrom = identity().MailFromAttributes!;
    const invalid: Partial<GetEmailIdentityCommandOutput>[] = [
      { IdentityType: "EMAIL_ADDRESS" }, { Tags: [] }, { Tags: [{ Key: "yodev:environment", Value: "prod" }] },
      { VerifiedForSendingStatus: false }, { DkimAttributes: { Status: "PENDING", SigningEnabled: true } },
      { DkimAttributes: { Status: "SUCCESS", SigningEnabled: false } },
      { MailFromAttributes: { ...mailFrom, MailFromDomainStatus: "PENDING" } },
      { MailFromAttributes: { ...mailFrom, BehaviorOnMxFailure: "USE_DEFAULT_VALUE" } },
      { MailFromAttributes: { ...mailFrom, MailFromDomain: "unrelated.yodev.fr" } },
    ];
    for (const overrides of invalid) expect(() => assertSendIdentity("dev", run, { ...identity(), ...overrides })).toThrow();
  });

  test("requires both HTTP 200 and a message ID; unexpected acceptance stops", async () => {
    const [own, denied] = sendScenarios("dev", run);
    const accepted = async () => ({ $metadata: { httpStatusCode: 200, requestId: "request" }, MessageId: "opaque-id" });
    expect(await executeSendScenario(own, accepted)).toMatchObject({ passed: true, stop: false, result: "accepted", messageId: "opaque-id" });
    expect(await executeSendScenario(denied, accepted)).toMatchObject({ passed: false, stop: true });
    expect(await executeSendScenario(own, async () => ({ $metadata: { httpStatusCode: 200 } }))).toMatchObject({ passed: false, stop: true, result: "unknown" });
  });

  test("only actual IAM 403 is an expected denial", async () => {
    const [own, denied] = sendScenarios("dev", run);
    const reject = async () => { throw { name: "AccessDeniedException", message: "private payload", $metadata: { httpStatusCode: 403, requestId: "request" } }; };
    expect(await executeSendScenario(denied, reject)).toEqual({ passed: true, stop: false, result: "iam-denied", code: "AccessDeniedException", status: 403, requestId: "request" });
    expect(await executeSendScenario(own, reject)).toMatchObject({ passed: false });
  });

  test("validation, throttling and uncertain outcomes stop without retry or logging payload", async () => {
    expect(sendClientOptions).toMatchObject({ region: "eu-west-3", maxAttempts: 1, ignoreConfiguredEndpointUrls: true });
    for (const name of ["BadRequestException", "MailFromDomainNotVerifiedException", "TooManyRequestsException", "TimeoutError", "AbortError", "UnknownError"]) {
      const execute = vi.fn(async () => { throw { name, message: "private payload", Credentials: "secret" }; });
      const result = await executeSendScenario(sendScenarios("dev", run)[1], execute);
      expect(result).toMatchObject({ passed: false, stop: true, result: "inconclusive" });
      expect(execute).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result)).not.toMatch(/private|secret|Credentials/);
    }
  });
});
