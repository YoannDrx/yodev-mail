"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireDb } from "@/db";
import {
  auditEvents,
  consentEvents,
  contactListMembers,
  contactLists,
  contacts,
} from "@/db/schema";
import { normalizeEmail } from "@/features/contacts/normalization";
import { currentWorkspace } from "@/lib/current-workspace";

const contactSchema = z.object({
  company: z.string().trim().max(180).optional(),
  consentSource: z.string().trim().max(500).optional(),
  email: z.string().email(),
  firstName: z.string().trim().max(120).optional(),
  lastName: z.string().trim().max(120).optional(),
  legalBasis: z.enum(["consent", "existing_customer", "legitimate_interest"]).optional(),
  listId: z.string().uuid().optional(),
  marketingConsent: z.boolean().default(false),
});

export async function createContactAction(formData: FormData) {
  const data = contactSchema.parse({
    ...Object.fromEntries(formData),
    legalBasis: formData.get("legalBasis") || undefined,
    listId: formData.get("listId") || undefined,
    marketingConsent: formData.get("marketingConsent") === "on",
  });
  if (data.marketingConsent && !data.consentSource) {
    throw new Error("Une source de consentement est obligatoire");
  }
  const { workspace, userId } = await currentWorkspace();
  const db = requireDb();
  await db.transaction(async (tx) => {
    if (data.listId) {
      const [list] = await tx
        .select({ id: contactLists.id })
        .from(contactLists)
        .where(and(eq(contactLists.id, data.listId), eq(contactLists.workspaceId, workspace.id)))
        .limit(1);
      if (!list) throw new Error("Liste introuvable");
    }
    const normalizedEmail = normalizeEmail(data.email);
    const [existing] = await tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.workspaceId, workspace.id), eq(contacts.normalizedEmail, normalizedEmail)))
      .limit(1);
    const canGrantConsent = Boolean(data.marketingConsent && existing?.status !== "unsubscribed" && existing?.status !== "suppressed");
    const [contact] = existing
      ? await tx
          .update(contacts)
          .set({
            company: data.company,
            consentSource: canGrantConsent ? data.consentSource : existing.consentSource,
            consentedAt: canGrantConsent ? new Date() : existing.consentedAt,
            firstName: data.firstName,
            lastName: data.lastName,
            legalBasis: data.legalBasis ?? existing.legalBasis,
            marketingConsent: canGrantConsent ? true : existing.marketingConsent,
            updatedAt: new Date(),
          })
          .where(and(eq(contacts.id, existing.id), eq(contacts.workspaceId, workspace.id)))
          .returning()
      : await tx.insert(contacts).values({
        company: data.company,
        consentSource: data.consentSource,
        consentedAt: data.marketingConsent ? new Date() : null,
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        legalBasis: data.legalBasis,
        marketingConsent: data.marketingConsent,
        normalizedEmail,
        workspaceId: workspace.id,
      }).returning();
    if (data.marketingConsent && contact.marketingConsent && !existing?.marketingConsent) {
      await tx.insert(consentEvents).values({
        action: "granted",
        consentText: "Consentement marketing déclaré lors de l’ajout manuel",
        contactId: contact.id,
        kind: "marketing",
        source: data.consentSource,
        workspaceId: workspace.id,
      });
    }
    if (data.listId) {
      await tx.insert(contactListMembers).values({
        workspaceId: workspace.id,
        listId: data.listId,
        contactId: contact.id,
      }).onConflictDoNothing();
    }
    await tx.insert(auditEvents).values({
      action: "contact.created_or_updated",
      actorUserId: userId,
      entityId: contact.id,
      entityType: "contact",
      workspaceId: workspace.id,
    });
  });
  revalidatePath("/dashboard/contacts");
}

export async function createContactListAction(formData: FormData) {
  const data = z.object({
    name: z.string().trim().min(2).max(140),
    description: z.string().trim().max(500).optional(),
  }).parse(Object.fromEntries(formData));
  const { workspace, userId } = await currentWorkspace();
  await requireDb().transaction(async (tx) => {
    const [list] = await tx.insert(contactLists).values({
      workspaceId: workspace.id,
      name: data.name,
      description: data.description,
    }).returning({ id: contactLists.id });
    await tx.insert(auditEvents).values({
      workspaceId: workspace.id,
      actorUserId: userId,
      action: "contact_list.created",
      entityType: "contact_list",
      entityId: list.id,
    });
  });
  revalidatePath("/dashboard/contacts");
}

export async function anonymizeContactAction(id: string) {
  const contactId = z.string().uuid().parse(id);
  const { workspace, userId } = await currentWorkspace({ admin: true });
  await requireDb().transaction(async (tx) => {
    const [contact] = await tx
      .update(contacts)
      .set({
        company: null,
        email: `anonymized+${contactId}@invalid.local`,
        firstName: null,
        lastName: null,
        marketingConsent: false,
        normalizedEmail: `anonymized+${contactId}@invalid.local`,
        status: "anonymized",
        tags: [],
        trackingConsent: false,
        updatedAt: new Date(),
      })
      .where(and(eq(contacts.id, contactId), eq(contacts.workspaceId, workspace.id)))
      .returning({ id: contacts.id });
    if (!contact) throw new Error("Contact not found");
    await tx.insert(auditEvents).values({
      action: "contact.anonymized",
      actorUserId: userId,
      entityId: contactId,
      entityType: "contact",
      workspaceId: workspace.id,
    });
  });
  revalidatePath("/dashboard/contacts");
}
