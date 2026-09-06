import { Pool } from "pg";

// Never fall back to DATABASE_URL: developers commonly have production in .env.local.
export function authTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) throw new Error("TEST_DATABASE_URL is required for authenticated browser tests.");
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || url.pathname !== "/yodev_mail_auth_e2e"
    || url.searchParams.size > 0) {
    throw new Error("Authenticated browser tests require the local disposable yodev_mail_auth_e2e database.");
  }
  return value;
}

export function authTestPool() {
  return new Pool({ connectionString: authTestDatabaseUrl(), max: 2 });
}
