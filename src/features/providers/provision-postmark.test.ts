import { describe, expect, it } from "vitest";
import { assertPostmarkServerDeliveryType } from "./provision-postmark";

describe("Postmark Server delivery type", () => {
  it("refuses an immutable Sandbox Server in production", () => {
    expect(() => assertPostmarkServerDeliveryType({ ID: 42, DeliveryType: "Sandbox" }, "prod"))
      .toThrow(/immutable/);
  });

  it("accepts only the delivery type expected for the environment", () => {
    expect(() => assertPostmarkServerDeliveryType({ ID: 42, DeliveryType: "Live" }, "prod")).not.toThrow();
    expect(() => assertPostmarkServerDeliveryType({ ID: 43, DeliveryType: "Sandbox" }, "dev")).not.toThrow();
  });
});
