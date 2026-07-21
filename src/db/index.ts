import "server-only";

import { attachDatabasePool } from "@vercel/functions";
import { databasePool } from "./runtime";

if (databasePool) attachDatabasePool(databasePool);

export { db, requireDb } from "./runtime";
