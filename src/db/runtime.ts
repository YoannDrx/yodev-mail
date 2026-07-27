import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

function withVerifiedSsl(connectionString: string) {
  const url = new URL(connectionString);
  const sslMode = url.searchParams.get("sslmode");
  if (sslMode && ["prefer", "require", "verify-ca"].includes(sslMode)) {
    url.searchParams.set("sslmode", "verify-full");
  }
  return url.toString();
}

function createDatabasePool(databaseUrl: string) {
  return new Pool({
      connectionString: withVerifiedSsl(databaseUrl),
      max: 10,
    });
}

const initialDatabaseUrl = process.env.DATABASE_URL;

export const databasePool = initialDatabaseUrl
  ? createDatabasePool(initialDatabaseUrl)
  : null;

export const db = databasePool
  ? drizzle({ client: databasePool, schema })
  : null;

let lazyDatabasePool = databasePool;
let lazyDb = db;

export function requireDb() {
  if (!lazyDb && process.env.DATABASE_URL) {
    lazyDatabasePool = createDatabasePool(process.env.DATABASE_URL);
    lazyDb = drizzle({ client: lazyDatabasePool, schema });
  }
  if (!lazyDb) {
    throw new Error("DATABASE_URL is required for this operation.");
  }
  return lazyDb;
}
