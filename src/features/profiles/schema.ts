import { z } from "zod";
import type { Locale } from "@/i18n/config";

export const profileKeyPattern = "[a-z][a-z0-9_]{1,79}";

export const profileLimits = {
  name: { min: 2, max: 160 },
  triggerDescription: { min: 20, max: 2000 },
  recipientRelationship: { min: 20, max: 2000 },
  contentExample: { min: 20, max: 10_000 },
} as const;

const text = (field: keyof typeof profileLimits) =>
  z.string().trim().min(profileLimits[field].min).max(profileLimits[field].max);

export const profileSchema = z.object({
  key: z.string().trim().toLowerCase().regex(new RegExp(`^${profileKeyPattern}$`)),
  name: text("name"),
  triggerDescription: text("triggerDescription"),
  recipientRelationship: text("recipientRelationship"),
  expectedMonthlyVolume: z.coerce.number().int().min(1).max(10_000_000),
  contentExample: text("contentExample"),
});

export const profileFields = ["key", "name", "expectedMonthlyVolume", "triggerDescription", "recipientRelationship", "contentExample"] as const;

const length = (field: keyof typeof profileLimits): Record<Locale, string> => ({
  fr: `Entre ${profileLimits[field].min} et ${profileLimits[field].max.toLocaleString("fr-FR")} caractères.`,
  en: `Between ${profileLimits[field].min} and ${profileLimits[field].max.toLocaleString("en-US")} characters.`,
});

export const profileFieldMessages: Record<string, Record<Locale, string>> = {
  key: {
    fr: "Minuscules, chiffres et _ uniquement, en commençant par une lettre (2 à 80 caractères).",
    en: "Lowercase letters, digits and _ only, starting with a letter (2 to 80 characters).",
  },
  name: length("name"),
  triggerDescription: length("triggerDescription"),
  recipientRelationship: length("recipientRelationship"),
  contentExample: length("contentExample"),
  expectedMonthlyVolume: { fr: "Nombre entier entre 1 et 10 000 000.", en: "Whole number between 1 and 10,000,000." },
};
