import { describe, expect, it } from "vitest";
import { SES_REPUTATION_POLICY } from "./provision-ses-domain";

describe("SES tenant reputation policy", () => {
  it("uses the AWS-recommended standard policy for new tenants", () => {
    expect(SES_REPUTATION_POLICY).toBe("standard");
  });
});
