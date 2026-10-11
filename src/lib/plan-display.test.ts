import { describe, expect, it } from "vitest";
import { planCatalog } from "@/lib/plans";
import { betaPlanDisplay } from "./plan-display";

const normalize = (value: string) => value.replace(/[  ]/g, " ");

describe("betaPlanDisplay", () => {
  it("formats the catalog prices in French", () => {
    const display = betaPlanDisplay("fr");
    expect(normalize(display.monthly)).toBe("29 €");
    expect(normalize(display.perEmail)).toBe("0,0025 €");
    expect(normalize(display.perThousand)).toBe("2,50 €");
  });

  it("formats the catalog prices in English", () => {
    const display = betaPlanDisplay("en");
    expect(display.monthly).toBe("€29");
    expect(display.perEmail).toBe("€0.0025");
    expect(display.perThousand).toBe("€2.50");
  });

  it("exposes the catalog limits rather than copies of them", () => {
    const display = betaPlanDisplay("fr");
    expect(display.domains).toBe(planCatalog.beta.domains);
    expect(display.members).toBe(planCatalog.beta.members);
    expect(display.dailyLimit).toBe(planCatalog.beta.dailyLimit);
  });
});
