const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for integration tests.");
}

const parsed = new URL(databaseUrl);
if (!["127.0.0.1", "localhost", "postgres"].includes(parsed.hostname)) {
  throw new Error("Integration tests only accept an explicitly local PostgreSQL host.");
}

process.env.DATABASE_URL = databaseUrl;
process.env.DATABASE_URL_UNPOOLED = databaseUrl;
