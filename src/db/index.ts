import "server-only";

import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;

const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      max: 10,
    })
  : null;

if (pool) attachDatabasePool(pool);

export const db = pool ? drizzle({ client: pool, schema }) : null;

export function requireDb() {
  if (!db) {
    throw new Error("DATABASE_URL is required for this operation.");
  }
  return db;
}
