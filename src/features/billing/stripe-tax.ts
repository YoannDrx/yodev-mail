export const stripeTaxModes = [
  "unconfigured",
  "franchise_base",
  "registered",
] as const;

export type StripeTaxMode = (typeof stripeTaxModes)[number];

export function validateStripeTaxConfiguration({
  activeRegistrationCountries,
  mode,
}: {
  activeRegistrationCountries: string[];
  mode: StripeTaxMode;
}) {
  if (mode === "unconfigured") return ["tax_mode_unconfigured"];
  if (mode === "franchise_base" && activeRegistrationCountries.length > 0) {
    return ["active_tax_registration_unexpected"];
  }
  if (mode === "registered" && activeRegistrationCountries.length === 0) {
    return ["active_tax_registration_missing"];
  }
  if (mode === "registered" && !activeRegistrationCountries.includes("FR")) {
    return ["french_tax_registration_missing"];
  }
  return [];
}

export function stripeAutomaticTax(mode: StripeTaxMode) {
  return mode === "registered" ? { automatic_tax: { enabled: true } as const } : {};
}
