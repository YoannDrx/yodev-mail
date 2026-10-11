"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireDb } from "@/db";
import { apiKeys, auditEvents } from "@/db/schema";
import { apiKeyAvailability } from "@/features/api-key/availability";
import { localized } from "@/i18n/config";
import { actionFailure, actionSuccess, formValues, type ActionState } from "@/lib/action-state";
import { ConsoleActionError, invalidForm, runConsoleAction } from "@/lib/console-action";
import { createApiKey } from "@/lib/crypto";
import { currentWorkspace } from "@/lib/current-workspace";
import { env } from "@/lib/env";

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  mode: z.enum(["test", "live"]),
  scopes: z.array(z.enum(["emails:send", "emails:read", "emails:send:raw", "attachments:write", "webhooks:manage"])).min(1),
});

export type ApiKeyFormState = ActionState<{ token: string; mode: "test" | "live" }>;

export async function createApiKeyFormAction(_: ApiKeyFormState, formData: FormData): Promise<ApiKeyFormState> {
  // Multi-valued checkboxes are echoed as one comma-separated value.
  const echoed = { scopes: formData.getAll("scopes").map(String).join(",") };
  return runConsoleAction(formData, ["name", "mode"], async (locale) => {
    const parsed = createSchema.safeParse({
      mode: formData.get("mode"),
      name: formData.get("name"),
      scopes: formData.getAll("scopes"),
    });
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0]);
        fieldErrors[field] ??= [localized(locale, field === "name"
          ? { fr: "Entre 2 et 120 caractères.", en: "Between 2 and 120 characters." }
          : field === "scopes"
            ? { fr: "Choisissez au moins une permission.", en: "Choose at least one permission." }
            : { fr: "Mode invalide.", en: "Invalid mode." })];
      }
      return actionFailure(localized(locale, invalidForm), { fieldErrors, values: { ...formValues(formData, ["name", "mode"]), ...echoed } });
    }
    const data = parsed.data;
    if (!env.API_KEY_PEPPER) {
      throw new ConsoleActionError({ fr: "La création de clés n’est pas configurée sur cet environnement.", en: "Key creation is not configured on this environment." });
    }
    const { workspace, userId } = await currentWorkspace({ admin: true });
    const availability = apiKeyAvailability(workspace);
    if (data.mode === "live" && !availability.live) {
      throw new ConsoleActionError(availability.liveReason === "workspace"
        ? { fr: "Les clés live nécessitent un workspace approuvé par Yodev.", en: "Live keys require a workspace approved by Yodev." }
        : { fr: "Les envois live sont fermés pour le moment : seules les clés de test peuvent être créées.", en: "Live sending is closed for now: only test keys can be created." }, "mode");
    }
    if (data.scopes.includes("emails:send:raw") && !availability.raw) {
      throw new ConsoleActionError({ fr: "L’envoi de HTML brut n’est pas autorisé pour ce workspace.", en: "Raw HTML sending is not allowed for this workspace." }, "scopes");
    }
    if (data.scopes.includes("attachments:write") && !availability.attachments) {
      throw new ConsoleActionError({ fr: "Les pièces jointes ne sont pas encore disponibles.", en: "Attachments are not available yet." }, "scopes");
    }
    const generated = createApiKey(data.mode, env.API_KEY_PEPPER);
    await requireDb().transaction(async (tx) => {
      await tx.insert(apiKeys).values({ workspaceId: workspace.id, name: data.name, mode: data.mode, prefix: generated.prefix, secretHash: generated.secretHash, scopes: data.scopes, createdBy: userId });
      await tx.insert(auditEvents).values({ workspaceId: workspace.id, actorUserId: userId, action: "api_key.created", entityType: "api_key", metadata: { mode: data.mode, scopes: data.scopes } });
    });
    revalidatePath("/dashboard/api-keys");
    return actionSuccess(localized(locale, { fr: "Clé créée.", en: "Key created." }), { token: generated.token, mode: data.mode });
  }, { values: echoed });
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
