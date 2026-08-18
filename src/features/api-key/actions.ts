"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireDb } from "@/db";
import { apiKeys, auditEvents } from "@/db/schema";
import { createApiKey } from "@/lib/crypto";
import { currentWorkspace } from "@/lib/current-workspace";
import { env } from "@/lib/env";
const createSchema = z.object({
  name: z.string().min(2).max(120),
  mode: z.enum(["test", "live"]),
  scopes: z.array(z.enum(["emails:send", "emails:read", "emails:send:raw", "attachments:write", "webhooks:manage"])).min(1),
});

export async function createApiKeyAction(input: z.infer<typeof createSchema>) {
  const data = createSchema.parse(input);
  if (!env.API_KEY_PEPPER) throw new Error("API key pepper is not configured");
  const { workspace, userId } = await currentWorkspace({ admin: true });
  if (data.mode === "live" && workspace.status !== "approved") throw new Error("Live keys require an approved workspace");
  if (data.scopes.includes("emails:send:raw") && workspace.contentPolicy !== "hybrid") throw new Error("Raw sending has not been approved for this workspace");
  const generated = createApiKey(data.mode, env.API_KEY_PEPPER);
  await requireDb().transaction(async (tx) => {
    await tx.insert(apiKeys).values({ workspaceId: workspace.id, name: data.name, mode: data.mode, prefix: generated.prefix, secretHash: generated.secretHash, scopes: data.scopes, createdBy: userId });
    await tx.insert(auditEvents).values({ workspaceId: workspace.id, actorUserId: userId, action: "api_key.created", entityType: "api_key", metadata: { mode: data.mode, scopes: data.scopes } });
  });
  revalidatePath("/dashboard/api-keys");
  return { token: generated.token };
}
export type ApiKeyFormState = { token: string; error: string };

export async function createApiKeyFormAction(_: ApiKeyFormState, formData: FormData): Promise<ApiKeyFormState> {
  try {
    const result = await createApiKeyAction({
      mode: formData.get("mode"),
      name: formData.get("name"),
      scopes: formData.getAll("scopes"),
    } as z.infer<typeof createSchema>);
    return { token: result.token, error: "" };
  } catch (error) {
    return { token: "", error: error instanceof Error ? error.message : "Création impossible" };
  }
}
export async function revokeApiKeyAction(id: string) {
  const keyId = z.string().uuid().parse(id);
  const { workspace, userId } = await currentWorkspace({ admin: true });
  await requireDb().transaction(async (tx) => {
    const revoked = await tx.update(apiKeys).set({ revokedAt: new Date(), updatedAt: new Date() }).where(and(
      eq(apiKeys.id, keyId),
      eq(apiKeys.workspaceId, workspace.id),
    )).returning({ id: apiKeys.id });
    if (!revoked.length) throw new Error("API key not found");
    await tx.insert(auditEvents).values({ workspaceId: workspace.id, actorUserId: userId, action: "api_key.revoked", entityType: "api_key", entityId: keyId });
  });
  revalidatePath("/dashboard/api-keys");
}
