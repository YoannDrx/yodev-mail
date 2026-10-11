import { isFeatureEnabled } from "@/lib/env";

export type ApiKeyAvailability = {
  live: boolean;
  /** Why live keys are unavailable: the platform gate is closed or the workspace is not approved. */
  liveReason: "gate" | "workspace" | null;
  attachments: boolean;
  raw: boolean;
};

/** What the console may offer at key creation; mirrors the gates enforced by POST /v1/emails. */
export function apiKeyAvailability(workspace: { status: string; contentPolicy: string }): ApiKeyAvailability {
  const gateOpen = isFeatureEnabled("LIVE_EMAIL_ACCEPTANCE_ENABLED");
  const approved = workspace.status === "approved";
  return {
    live: gateOpen && approved,
    liveReason: !gateOpen ? "gate" : !approved ? "workspace" : null,
    attachments: isFeatureEnabled("ATTACHMENTS_ENABLED"),
    raw: isFeatureEnabled("RAW_EMAIL_ENABLED") && workspace.contentPolicy === "hybrid",
  };
}
