import { z } from "zod";
import { maxExpectedMonthlyVolume } from "@/features/applications/constants";
import { localized, type Locale } from "@/i18n/config";

export const betaApplicationFields = [
  "company",
  "contactName",
  "workEmail",
  "websiteUrl",
  "useCase",
  "expectedMonthlyVolume",
] as const;

export {
  betaApplicationContactEmail,
  betaApplicationHoneypotField,
  maxExpectedMonthlyVolume,
} from "@/features/applications/constants";

export function betaApplicationSchema(locale: Locale) {
  const copy = localized(locale, {
    fr: {
      company: "Indiquez le nom de votre entreprise.",
      contactName: "Indiquez votre nom.",
      workEmail: "Indiquez une adresse email professionnelle valide.",
      websiteUrl: "Indiquez une adresse de site complète, par exemple https://exemple.fr.",
      useCase: "Décrivez vos emails transactionnels en au moins 20 caractères.",
      useCaseLong: "Limitez la description à 2 000 caractères.",
      volume: "Indiquez un volume mensuel entre 0 et 10 000 000.",
      consent: "Votre accord est nécessaire pour étudier la candidature.",
    },
    en: {
      company: "Enter your company name.",
      contactName: "Enter your name.",
      workEmail: "Enter a valid work email address.",
      websiteUrl: "Enter a full website address, for example https://example.com.",
      useCase: "Describe your transactional emails in at least 20 characters.",
      useCaseLong: "Keep the description under 2,000 characters.",
      volume: "Enter a monthly volume between 0 and 10,000,000.",
      consent: "Your consent is required to review the application.",
    },
  });
  return z.object({
    company: z.string().trim().min(2, copy.company).max(180, copy.company),
    contactName: z.string().trim().min(2, copy.contactName).max(140, copy.contactName),
    workEmail: z.string().trim().toLowerCase().max(320, copy.workEmail).pipe(z.email(copy.workEmail)),
    websiteUrl: z
      .string()
      .trim()
      .max(2_048, copy.websiteUrl)
      .refine((value) => value === "" || /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(value), copy.websiteUrl)
      .transform((value) => value || null),
    useCase: z.string().trim().min(20, copy.useCase).max(2_000, copy.useCaseLong),
    expectedMonthlyVolume: z
      .string()
      .trim()
      .transform((value) => value.replace(/[\s\u00a0\u202f]/g, ""))
      .pipe(z.string().regex(/^\d{1,8}$/, copy.volume))
      .transform(Number)
      .pipe(z.number().int().min(0).max(maxExpectedMonthlyVolume, copy.volume)),
    consent: z.literal("on", { error: copy.consent }),
  });
}

export type BetaApplicationInput = z.output<ReturnType<typeof betaApplicationSchema>>;
