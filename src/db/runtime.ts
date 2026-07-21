import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;

function withVerifiedSsl(connectionString: string) {
  const url = new URL(connectionString);
  const sslMode = url.searchParams.get("sslmode");
  if (sslMode && ["prefer", "require", "verify-ca"].includes(sslMode)) {
    url.searchParams.set("sslmode", "verify-full");
  }
  return url.toString();
}

export const databasePool = databaseUrl
  ? new Pool({
      connectionString: withVerifiedSsl(databaseUrl),
      max: 10,
    })
  : null;

export const db = databasePool
  ? drizzle({ client: databasePool, schema })
  : null;

export function requireDb() {
  if (!db) {
    throw new Error("DATABASE_URL is required for this operation.");
  }
  return db;
}
