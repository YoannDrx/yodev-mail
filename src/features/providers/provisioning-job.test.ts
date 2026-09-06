import { describe, expect, it } from "vitest";
import { parseProvisioningJob } from "./provisioning-job";

const job = { workspaceId: "00000000-0000-4000-8000-000000000001", bindingId: "00000000-0000-4000-8000-000000000002" };
describe("provider provisioning queue contract", () => {
  it("accepts only opaque workspace and binding IDs", () => {
    expect(parseProvisioningJob(job)).toEqual(job);
  });
  it.each([null, {}, { bindingId: job.bindingId }, { ...job, workspaceId: "private@example.test" }, { ...job, html: "private body" }])("rejects invalid and oversized contracts without exposing their input", (value) => {
    expect(() => parseProvisioningJob(value)).toThrow(/^invalid_provider_provisioning_job$/);
  });
});
