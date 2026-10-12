import { and, eq, isNull } from "drizzle-orm";
import type { requireDb } from "@/db/runtime";
import {
  apiKeys,
  domainProviderBindings,
  messages,
  subscriptions,
  templates,
  transactionalProfiles,
  webhookEndpoints,
  workspaces,
} from "@/db/schema";

type Database = ReturnType<typeof requireDb>;

export type ActivationEvidence = {
  domainVerified: boolean;
  profileApproved: boolean;
  testKey: boolean;
  templateApproved: boolean;
  simulatedSend: boolean;
  webhook: boolean;
  workspaceStatus: string;
  billingStatus: string;
  pilotActive: boolean;
  liveKey: boolean;
};

const exists = (rows: unknown[]) => rows.length > 0;

/** Facts read from the workspace's own data; each query is scoped by workspaceId. */
export async function getActivationEvidence(db: Database, workspaceId: string, now = new Date()): Promise<ActivationEvidence> {
  const [domain, profile, testKey, template, simulated, webhook, workspace, subscription, liveKey] = await Promise.all([
    db.select({ id: domainProviderBindings.id }).from(domainProviderBindings).where(and(eq(domainProviderBindings.workspaceId, workspaceId), eq(domainProviderBindings.isActive, true), eq(domainProviderBindings.status, "verified"))).limit(1),
    db.select({ id: transactionalProfiles.id }).from(transactionalProfiles).where(and(eq(transactionalProfiles.workspaceId, workspaceId), eq(transactionalProfiles.status, "approved"))).limit(1),
    db.select({ id: apiKeys.id }).from(apiKeys).where(and(eq(apiKeys.workspaceId, workspaceId), eq(apiKeys.mode, "test"), isNull(apiKeys.revokedAt))).limit(1),
    db.select({ id: templates.id }).from(templates).where(and(eq(templates.workspaceId, workspaceId), eq(templates.reviewStatus, "approved"))).limit(1),
    db.select({ id: messages.id }).from(messages).where(and(eq(messages.workspaceId, workspaceId), eq(messages.sendMode, "test"), eq(messages.status, "simulated"))).limit(1),
    db.select({ id: webhookEndpoints.id }).from(webhookEndpoints).where(and(eq(webhookEndpoints.workspaceId, workspaceId), eq(webhookEndpoints.enabled, true))).limit(1),
    db.select({ status: workspaces.status }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1),
    db.select({ status: subscriptions.status, pilotAccessExpiresAt: subscriptions.pilotAccessExpiresAt }).from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1),
    db.select({ id: apiKeys.id }).from(apiKeys).where(and(eq(apiKeys.workspaceId, workspaceId), eq(apiKeys.mode, "live"), isNull(apiKeys.revokedAt))).limit(1),
  ]);
  return {
    domainVerified: exists(domain),
    profileApproved: exists(profile),
    testKey: exists(testKey),
    templateApproved: exists(template),
    simulatedSend: exists(simulated),
    webhook: exists(webhook),
    workspaceStatus: workspace[0]?.status ?? "sandbox",
    billingStatus: subscription[0]?.status ?? "inactive",
    pilotActive: Boolean(subscription[0]?.pilotAccessExpiresAt && subscription[0].pilotAccessExpiresAt > now),
    liveKey: exists(liveKey),
  };
}
