import { afterEach, describe, expect, it, vi } from "vitest";
import { authTestDatabaseUrl } from "./database";

afterEach(() => vi.unstubAllEnvs());

describe("authenticated E2E database safety boundary", () => {
  it("never falls back to an application database", () => {
    vi.stubEnv("TEST_DATABASE_URL", undefined);
    vi.stubEnv("DATABASE_URL", "postgres://user@production.invalid/app");
    expect(authTestDatabaseUrl).toThrow("TEST_DATABASE_URL is required");
  });

  it.each([
    "postgres://user@production.invalid/yodev_mail_auth_e2e",
    "postgres://user@127.0.0.1/yodev_mail_test",
    "postgres://user@127.0.0.1/postgres",
    "postgres://user@127.0.0.1/yodev_mail_auth_e2e?host=production.invalid",
    "https://localhost/yodev_mail_auth_e2e",
  ])("rejects an unsafe target: %s", (url) => {
    vi.stubEnv("TEST_DATABASE_URL", url);
    expect(authTestDatabaseUrl).toThrow("local disposable");
  });

  it.each(["127.0.0.1", "localhost", "[::1]"])("accepts the dedicated local database at %s", (host) => {
    const url = `postgres://postgres@${host}:55441/yodev_mail_auth_e2e`;
    vi.stubEnv("TEST_DATABASE_URL", url);
    expect(authTestDatabaseUrl()).toBe(url);
  });
});
