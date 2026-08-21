import { describe, expect, it } from "vitest";
import {
  stripeAutomaticTax,
  validateStripeTaxConfiguration,
} from "@/features/billing/stripe-tax";

describe("Stripe tax configuration", () => {
  it("fails closed while the tax regime is unconfigured", () => {
    expect(validateStripeTaxConfiguration({
      activeRegistrationCountries: [],
      mode: "unconfigured",
    })).toEqual(["tax_mode_unconfigured"]);
  });

  it("accepts franchise en base only without an active Tax registration", () => {
    expect(validateStripeTaxConfiguration({
      activeRegistrationCountries: [],
      mode: "franchise_base",
    })).toEqual([]);
    expect(validateStripeTaxConfiguration({
      activeRegistrationCountries: ["FR"],
      mode: "franchise_base",
    })).toEqual(["active_tax_registration_unexpected"]);
    expect(stripeAutomaticTax("franchise_base")).toEqual({});
  });

  it("enables automatic tax only for a registered business", () => {
    expect(validateStripeTaxConfiguration({
      activeRegistrationCountries: [],
      mode: "registered",
    })).toEqual(["active_tax_registration_missing"]);
    expect(validateStripeTaxConfiguration({
      activeRegistrationCountries: ["FR"],
      mode: "registered",
    })).toEqual([]);
    expect(stripeAutomaticTax("registered")).toEqual({
      automatic_tax: { enabled: true },
    });
  });

  it("requires the active registration to match the French jurisdiction", () => {
    expect(validateStripeTaxConfiguration({
      activeRegistrationCountries: ["DE"],
      mode: "registered",
    })).toEqual(["french_tax_registration_missing"]);
  });
});
