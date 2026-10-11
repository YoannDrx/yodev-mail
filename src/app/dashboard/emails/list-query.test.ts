import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, parseEmailListFilters } from "./list-query";

describe("email list parameters", () => {
  it("keeps only known statuses and calendar days", () => {
    expect(parseEmailListFilters({ status: "simulated", from: "2026-10-01", to: "2026-10-11" })).toEqual({ status: "simulated", from: "2026-10-01", to: "2026-10-11", cursor: undefined });
    expect(parseEmailListFilters({ status: "drop table", from: "yesterday", to: ["2026-10-01"] })).toEqual({ status: undefined, from: undefined, to: undefined, cursor: undefined });
  });

  it("round-trips an exact cursor and ignores forged ones", () => {
    const row = { exactCreatedAt: "2026-10-11T08:00:00.123456Z", id: "6f4bd0b2-3b31-4b55-9a59-6a5c8ef7c8d1" };
    expect(decodeCursor(encodeCursor(row))).toEqual({ createdAt: row.exactCreatedAt, id: row.id });
    expect(decodeCursor(Buffer.from("2026-10-11'; --|x").toString("base64url"))).toBeNull();
    expect(decodeCursor("%%%")).toBeNull();
  });
});
