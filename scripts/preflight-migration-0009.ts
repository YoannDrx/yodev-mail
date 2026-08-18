import { Pool } from "pg";

function verifiedConnectionString(value: string) {
  const url = new URL(value);
  if (["prefer", "require", "verify-ca"].includes(url.searchParams.get("sslmode") ?? "")) {
    url.searchParams.set("sslmode", "verify-full");
  }
  return url.toString();
}

async function main() {
  const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL is required");
  const pool = new Pool({ connectionString: verifiedConnectionString(connectionString), max: 1 });
  try {
    const result = await pool.query<{
      duplicate_admin_reviews: string;
      duplicate_domains: string;
      overlapping_cross_workspace_domains: string;
    }>(`
      select
        (select count(*) from (
          select workspace_id from admin_reviews group by workspace_id having count(*) > 1
        ) duplicate_reviews) as duplicate_admin_reviews,
        (select count(*) from (
          select lower(name) from domains group by lower(name) having count(*) > 1
        ) duplicate_names) as duplicate_domains,
        (select count(*) from domains left_domain
          join domains right_domain on left_domain.id < right_domain.id
            and left_domain.workspace_id <> right_domain.workspace_id
            and (
              lower(left_domain.name) = lower(right_domain.name)
              or lower(left_domain.name) like '%.' || lower(right_domain.name)
              or lower(right_domain.name) like '%.' || lower(left_domain.name)
            )
        ) as overlapping_cross_workspace_domains
    `);
    const counts = result.rows[0];
    if (!counts) throw new Error("Migration preflight returned no result");
    const failures = Object.entries(counts).filter(([, count]) => Number(count) !== 0);
    if (failures.length) {
      throw new Error(`Migration 0009 preflight failed: ${failures.map(([name, count]) => `${name}=${count}`).join(", ")}`);
    }
    console.log("Migration 0009 preflight passed: duplicate and overlapping tenant constraints are clean.");
  } finally {
    await pool.end();
  }
}

void main();
