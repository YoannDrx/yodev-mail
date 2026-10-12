import { Pool } from "pg";

const defaultDatabaseName = "yodev_mail_auth_e2e";

// A developer may run several disposable databases side by side; another local
// name must be declared explicitly, so a stray TEST_DATABASE_URL is refused.
function allowedDatabaseNames() {
  const extra = process.env.E2E_DISPOSABLE_DATABASE;
  return extra && /^[a-z0-9_]{1,63}$/.test(extra) ? [defaultDatabaseName, extra] : [defaultDatabaseName];
}

// Never fall back to DATABASE_URL: developers commonly have production in .env.local.
export function authTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) throw new Error("TEST_DATABASE_URL is required for authenticated browser tests.");
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || !allowedDatabaseNames().includes(url.pathname.slice(1))
    || url.searchParams.size > 0) {
    throw new Error("Authenticated browser tests require the local disposable yodev_mail_auth_e2e database (or the one named in E2E_DISPOSABLE_DATABASE).");
  }
  return value;
}

export function authTestPool() {
  return new Pool({ connectionString: authTestDatabaseUrl(), max: 2 });
}
