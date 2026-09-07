import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { send, stsSend } = vi.hoisted(() => ({ send: vi.fn(), stsSend: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { AWS_REGION: "eu-west-3" } }));
vi.mock("@/lib/aws", () => ({ awsClients: async () => ({ ses: { send } }) }));
vi.mock("@aws-sdk/client-sts", () => ({
  STSClient: class { send = stsSend; },
  GetCallerIdentityCommand: class {},
}));
import { provisionSesDomain, SES_REPUTATION_POLICY } from "./provision-ses-domain";

beforeEach(() => {
  vi.stubEnv("DEPLOYMENT_ENVIRONMENT", "prod");
  send.mockReset().mockResolvedValue({ DkimAttributes: { Tokens: ["dkim-token"] } });
  stsSend.mockReset().mockResolvedValue({ Account: "123456789012" });
});
afterEach(() => vi.unstubAllEnvs());

const workspaceId = "00000000-0000-4000-8000-000000000002";

describe("SES tenant reputation policy", () => {
  it("shares one abort budget across SES and STS requests", async () => {
    const signal = new AbortController().signal;
    await provisionSesDomain({ workspaceId, domain: "example.test", signal });
    expect(send.mock.calls.every(([, options]) => options.abortSignal === signal)).toBe(true);
    expect(stsSend.mock.calls.every(([, options]) => options.abortSignal === signal)).toBe(true);
  });
  it("does not start with an expired provisioning budget", async () => {
    await expect(provisionSesDomain({ workspaceId, domain: "example.test", signal: AbortSignal.abort() })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    expect(stsSend).not.toHaveBeenCalled();
  });
  it("uses the AWS-recommended standard policy for new tenants", () => {
    expect(SES_REPUTATION_POLICY).toBe("standard");
  });
  it("returns the same complete identity ARN associated with the tenant when account ID is resolved at runtime", async () => {
    send.mockResolvedValue({ DkimAttributes: { Tokens: ["dkim-token"] } });
    stsSend.mockResolvedValue({ Account: "123456789012" });
    const result = await provisionSesDomain({ workspaceId, domain: "example.test" });
    expect(result.identityArn).toBe("arn:aws:ses:eu-west-3:123456789012:identity/example.test");
    expect(send.mock.calls.some(([command]) => command.input.ResourceArn === result.identityArn && command.input.TenantName === result.tenantName)).toBe(true);
  });
  it("reconciles the owned event destination when it already exists", async () => {
    send.mockImplementation(async (command) => {
      if (command.constructor.name === "CreateConfigurationSetEventDestinationCommand") {
        throw Object.assign(new Error("exists"), { name: "AlreadyExistsException" });
      }
      return {};
    });
    await provisionSesDomain({ workspaceId, domain: "example.test" });
    const updates = send.mock.calls.filter(([command]) => command.constructor.name === "UpdateConfigurationSetEventDestinationCommand");
    expect(updates).toHaveLength(1);
    expect(updates[0][0].input).toEqual({
      ConfigurationSetName: `ym-prod-${workspaceId}-txn`,
      EventDestinationName: "yodev-mail-eventbridge",
      EventDestination: {
        Enabled: true,
        EventBridgeDestination: { EventBusArn: "arn:aws:events:eu-west-3:123456789012:event-bus/default" },
        MatchingEventTypes: ["DELIVERY", "BOUNCE", "COMPLAINT", "REJECT", "DELIVERY_DELAY"],
      },
    });
  });
  it("does not hide failed reconciliation or associate an incompletely configured tenant", async () => {
    send.mockImplementation(async (command) => {
      if (command.constructor.name === "CreateConfigurationSetEventDestinationCommand") {
        throw Object.assign(new Error("exists"), { name: "AlreadyExistsException" });
      }
      if (command.constructor.name === "UpdateConfigurationSetEventDestinationCommand") throw new Error("denied");
      return {};
    });
    await expect(provisionSesDomain({ workspaceId, domain: "example.test" })).rejects.toThrow("denied");
    expect(send.mock.calls.some(([command]) => command.constructor.name === "CreateTenantResourceAssociationCommand")).toBe(false);
  });
  it("does not try to update after a non-conflict create failure", async () => {
    send.mockImplementation(async (command) => {
      if (command.constructor.name === "CreateConfigurationSetEventDestinationCommand") throw new Error("throttled");
      return {};
    });
    await expect(provisionSesDomain({ workspaceId, domain: "example.test" })).rejects.toThrow("throttled");
    expect(send.mock.calls.some(([command]) => command.constructor.name === "UpdateConfigurationSetEventDestinationCommand")).toBe(false);
  });

  it.each(["dev", "prod"])("names tenant and transactional configuration explicitly for %s", async (environment) => {
    vi.stubEnv("DEPLOYMENT_ENVIRONMENT", environment);
    const result = await provisionSesDomain({ workspaceId, domain: "example.test" });
    expect(result.tenantName).toBe(`ym-${environment}-${workspaceId}`);
    expect(result.configurationSets).toEqual([`ym-${environment}-${workspaceId}-txn`]);
    const tenant = send.mock.calls.find(([command]) => command.constructor.name === "CreateTenantCommand")![0];
    expect(tenant.input.TenantName).toBe(result.tenantName);
    const configuration = send.mock.calls.find(([command]) => command.constructor.name === "CreateConfigurationSetCommand")![0];
    expect(configuration.input.ConfigurationSetName).toBe(result.configurationSets[0]);
  });

  it.each([undefined, "", "production", "preview"])("refuses an unknown environment before any SES or STS side effect: %s", async (environment) => {
    vi.stubEnv("DEPLOYMENT_ENVIRONMENT", environment);
    await expect(provisionSesDomain({ workspaceId, domain: "example.test" })).rejects.toThrow("ses_resource_configuration_invalid");
    expect(send).not.toHaveBeenCalled();
    expect(stsSend).not.toHaveBeenCalled();
  });

  it("refuses a non-UUID workspace instead of generating a colliding name", async () => {
    await expect(provisionSesDomain({ workspaceId: "workspace-1", domain: "example.test" })).rejects.toThrow("ses_resource_configuration_invalid");
    expect(send).not.toHaveBeenCalled();
    expect(stsSend).not.toHaveBeenCalled();
  });

  it.each([`ym-dev-${workspaceId}`, `ym-${workspaceId}`, "ym-sandbox-cert", ""])("does not replace an existing account implicitly: %s", async (existingAccountId) => {
    await expect(provisionSesDomain({ workspaceId, domain: "example.test", existingAccountId })).rejects.toThrow("ses_account_mismatch");
    expect(send).not.toHaveBeenCalled();
    expect(stsSend).not.toHaveBeenCalled();
  });

  it("reuses the matching account for a second domain", async () => {
    const existingAccountId = `ym-prod-${workspaceId}`;
    const result = await provisionSesDomain({ workspaceId, domain: "example.test", existingAccountId });
    expect(result.tenantName).toBe(existingAccountId);
  });
});
