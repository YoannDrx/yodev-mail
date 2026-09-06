import { describe, expect, it, vi } from "vitest";
const { send, stsSend } = vi.hoisted(() => ({ send: vi.fn(), stsSend: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { AWS_REGION: "eu-west-3" } }));
vi.mock("@/lib/aws", () => ({ awsClients: async () => ({ ses: { send } }) }));
vi.mock("@aws-sdk/client-sts", () => ({
  STSClient: class { send = stsSend; },
  GetCallerIdentityCommand: class {},
}));
import { provisionSesDomain, SES_REPUTATION_POLICY } from "./provision-ses-domain";

describe("SES tenant reputation policy", () => {
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
});
