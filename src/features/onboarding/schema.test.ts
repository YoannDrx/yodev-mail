import { describe, expect, it } from "vitest";
import { onboardingFieldMessages, onboardingFields, onboardingLimits, onboardingSchema } from "@/features/onboarding/schema";

const valid = {
  abuseAccepted: "on", noCircumvention: "on", noColdEmail: "on", noMarketing: "on", noNewsletter: "on", noPurchasedLists: "on", suspensionAccepted: "on",
  applicationName: "Facturation", companyName: "Yodev SAS", companyAddress: "1 rue de Paris, 75001 Paris", websiteUrl: "https://example.com",
  domainNames: "notifications.example.com", categories: "Reçus de paiement",
  triggerDescription: "Paiement confirmé par le prestataire bancaire", recipientRelationship: "Clients ayant un compte actif",
  exampleContent: "Votre reçu n° 1234 est disponible dans votre espace.", errorPolicy: "Les rebonds suppriment l’adresse.",
  expectedMonthlyVolume: "1000", averageDailyVolume: "30", dailyPeakVolume: "120",
};

describe("onboarding dossier constraints", () => {
  it("accepts a complete dossier", () => {
    expect(onboardingSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects text that only meets the HTML minimum with padding spaces", () => {
    const result = onboardingSchema.safeParse({ ...valid, triggerDescription: `${" ".repeat(15)}court${" ".repeat(15)}` });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["triggerDescription"]);
  });

  it("documents every constrained field and echoes it back after a refusal", () => {
    for (const field of Object.keys(onboardingLimits)) {
      expect(onboardingFieldMessages[field]?.fr).toContain(String(onboardingLimits[field as keyof typeof onboardingLimits].min));
    }
    for (const field of Object.keys(onboardingSchema.shape)) {
      expect(onboardingFields).toContain(field);
      expect(onboardingFieldMessages[field]).toBeDefined();
    }
  });
});
