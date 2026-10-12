import { z } from "zod";
import type { Locale } from "@/i18n/config";

/** Single source for the dossier constraints, rendered as HTML attributes and enforced by zod. */
export const onboardingLimits = {
  companyName: { min: 2, max: 180 },
  applicationName: { min: 2, max: 180 },
  companyAddress: { min: 5, max: 500 },
  domainNames: { min: 3, max: 1000 },
  categories: { min: 3, max: 1000 },
  triggerDescription: { min: 20, max: 2000 },
  recipientRelationship: { min: 10, max: 2000 },
  exampleContent: { min: 20, max: 5000 },
  errorPolicy: { min: 10, max: 2000 },
} as const;

export const volumeLimits = { min: 1, max: 10_000_000 } as const;

export const attestationFields = [
  "noPurchasedLists",
  "noColdEmail",
  "noNewsletter",
  "noMarketing",
  "noCircumvention",
  "suspensionAccepted",
  "abuseAccepted",
] as const;

const text = (field: keyof typeof onboardingLimits) =>
  z.string().trim().min(onboardingLimits[field].min).max(onboardingLimits[field].max);
const volume = z.coerce.number().int().min(volumeLimits.min).max(volumeLimits.max);

export const onboardingSchema = z.object({
  abuseAccepted: z.literal("on"),
  applicationName: text("applicationName"),
  averageDailyVolume: volume,
  categories: text("categories"),
  companyAddress: text("companyAddress"),
  companyName: text("companyName"),
  dailyPeakVolume: volume,
  domainNames: text("domainNames"),
  errorPolicy: text("errorPolicy"),
  exampleContent: text("exampleContent"),
  expectedMonthlyVolume: volume,
  noCircumvention: z.literal("on"),
  noColdEmail: z.literal("on"),
  noMarketing: z.literal("on"),
  noNewsletter: z.literal("on"),
  noPurchasedLists: z.literal("on"),
  recipientRelationship: text("recipientRelationship"),
  suspensionAccepted: z.literal("on"),
  triggerDescription: text("triggerDescription"),
  websiteUrl: z.string().trim().url().max(500),
});

/** Every field echoed back after a refused submission (no secret in this form). */
export const onboardingFields = [
  ...Object.keys(onboardingLimits),
  "websiteUrl",
  "expectedMonthlyVolume",
  "averageDailyVolume",
  "dailyPeakVolume",
  ...attestationFields,
] as const;

function lengthCopy(min: number, max: number): Record<Locale, string> {
  return {
    fr: `Entre ${min} et ${max.toLocaleString("fr-FR")} caractères.`,
    en: `Between ${min} and ${max.toLocaleString("en-US")} characters.`,
  };
}

const volumeCopy = { fr: "Nombre entier d’au moins 1.", en: "Whole number of at least 1." };
const attestationCopy = { fr: "Cette attestation est obligatoire.", en: "This attestation is required." };

export const onboardingFieldMessages: Record<string, Record<Locale, string>> = {
  ...Object.fromEntries(
    Object.entries(onboardingLimits).map(([field, limit]) => [field, lengthCopy(limit.min, limit.max)]),
  ),
  websiteUrl: { fr: "Adresse complète commençant par https://.", en: "Full address starting with https://." },
  expectedMonthlyVolume: volumeCopy,
  averageDailyVolume: volumeCopy,
  dailyPeakVolume: volumeCopy,
  ...Object.fromEntries(attestationFields.map((field) => [field, attestationCopy])),
};
