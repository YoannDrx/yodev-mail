import { beforeEach, describe, expect, it, vi } from "vitest";
const { send, stsSend } = vi.hoisted(() => ({ send: vi.fn(), stsSend: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { AWS_REGION: "eu-west-3" } }));
vi.mock("@/lib/aws", () => ({ awsClients: async () => ({ ses: { send } }) }));
vi.mock("@aws-sdk/client-sts", () => ({
  STSClient: class { send = stsSend; },
  GetCallerIdentityCommand: class {},
}));
import { provisionSesDomain, SES_REPUTATION_POLICY } from "./provision-ses-domain";

beforeEach(() => {
  send.mockReset().mockResolvedValue({ DkimAttributes: { Tokens: ["dkim-token"] } });
  stsSend.mockReset().mockResolvedValue({ Account: "123456789012" });
});

describe("SES tenant reputation policy", () => {
  it("shares one abort budget across SES and STS requests", async () => {
    const signal = new AbortController().signal;
    await provisionSesDomain({ workspaceId: "workspace-1", domain: "example.test", signal });
    expect(send.mock.calls.every(([, options]) => options.abortSignal === signal)).toBe(true);
    expect(stsSend.mock.calls.every(([, options]) => options.abortSignal === signal)).toBe(true);
  });
  it("does not start with an expired provisioning budget", async () => {
    await expect(provisionSesDomain({ workspaceId: "workspace-1", domain: "example.test", signal: AbortSignal.abort() })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    expect(stsSend).not.toHaveBeenCalled();
  });
  it("uses the AWS-recommended standard policy for new tenants", () => {
    expect(SES_REPUTATION_POLICY).toBe("standard");
  });
  it("returns the same complete identity ARN associated with the tenant when account ID is resolved at runtime", async () => {
    send.mockResolvedValue({ DkimAttributes: { Tokens: ["dkim-token"] } });
    stsSend.mockResolvedValue({ Account: "123456789012" });
    const result = await provisionSesDomain({ workspaceId: "workspace-1", domain: "example.test" });
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
    await provisionSesDomain({ workspaceId: "workspace-1", domain: "example.test" });
    const updates = send.mock.calls.filter(([command]) => command.constructor.name === "UpdateConfigurationSetEventDestinationCommand");
    expect(updates).toHaveLength(1);
    expect(updates[0][0].input).toEqual({
      ConfigurationSetName: "ym-workspace-1-txn",
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
    await expect(provisionSesDomain({ workspaceId: "workspace-1", domain: "example.test" })).rejects.toThrow("denied");
    expect(send.mock.calls.some(([command]) => command.constructor.name === "CreateTenantResourceAssociationCommand")).toBe(false);
  });
  it("does not try to update after a non-conflict create failure", async () => {
    send.mockImplementation(async (command) => {
      if (command.constructor.name === "CreateConfigurationSetEventDestinationCommand") throw new Error("throttled");
      return {};
    });
    await expect(provisionSesDomain({ workspaceId: "workspace-1", domain: "example.test" })).rejects.toThrow("throttled");
    expect(send.mock.calls.some(([command]) => command.constructor.name === "UpdateConfigurationSetEventDestinationCommand")).toBe(false);
  });
});
