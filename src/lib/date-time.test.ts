import { describe, expect, it } from "vitest";
import { dateTimeFormatter, nextDay, safeTimeZone, zonedDayStart } from "@/lib/date-time";

describe("console date helpers", () => {
  it("starts a Paris day at the right UTC instant in winter and summer", () => {
    expect(zonedDayStart("2026-01-15", "Europe/Paris")?.toISOString()).toBe("2026-01-14T23:00:00.000Z");
    expect(zonedDayStart("2026-07-15", "Europe/Paris")?.toISOString()).toBe("2026-07-14T22:00:00.000Z");
  });

  it("handles daylight-saving transition days", () => {
    expect(zonedDayStart("2026-03-29", "Europe/Paris")?.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(zonedDayStart("2026-10-25", "Europe/Paris")?.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(zonedDayStart("2026-03-08", "America/New_York")?.toISOString()).toBe("2026-03-08T05:00:00.000Z");
  });

  it("rejects impossible days and unknown zones", () => {
    expect(zonedDayStart("2026-02-30", "Europe/Paris")).toBeNull();
    expect(zonedDayStart("not-a-day", "Europe/Paris")).toBeNull();
    expect(safeTimeZone("Mars/Olympus")).toBe("Europe/Paris");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });

  it("always prints the time zone with the time", () => {
    const value = new Date("2026-07-14T10:00:00Z");
    expect(dateTimeFormatter("fr", "Europe/Paris").format(value)).toMatch(/12:00.*UTC\+2/);
    expect(dateTimeFormatter("en", "UTC").format(value)).toMatch(/10:00.*UTC/);
  });
});
