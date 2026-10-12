import { beforeEach, describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({ values: {} as Record<string, boolean> }));
vi.mock("@/lib/env", () => ({ isFeatureEnabled: (name: string) => flags.values[name] === true }));

import { apiKeyAvailability } from "@/features/api-key/availability";

beforeEach(() => { flags.values = {}; });

describe("API key options follow the delivery gates", () => {
  it("offers test keys only while live acceptance is closed", () => {
    expect(apiKeyAvailability({ status: "approved", contentPolicy: "template_only" })).toEqual({ live: false, liveReason: "gate", attachments: false, raw: false });
  });

  it("requires an approved workspace once the live gate is open", () => {
    flags.values.LIVE_EMAIL_ACCEPTANCE_ENABLED = true;
    expect(apiKeyAvailability({ status: "pending_review", contentPolicy: "template_only" })).toMatchObject({ live: false, liveReason: "workspace" });
    expect(apiKeyAvailability({ status: "approved", contentPolicy: "template_only" })).toMatchObject({ live: true, liveReason: null });
  });

  it("offers attachments and raw HTML only behind their gates", () => {
    flags.values.ATTACHMENTS_ENABLED = true;
    expect(apiKeyAvailability({ status: "approved", contentPolicy: "hybrid" })).toMatchObject({ attachments: true, raw: false });
    flags.values.RAW_EMAIL_ENABLED = true;
    expect(apiKeyAvailability({ status: "approved", contentPolicy: "hybrid" }).raw).toBe(true);
    expect(apiKeyAvailability({ status: "approved", contentPolicy: "template_only" }).raw).toBe(false);
  });
});
