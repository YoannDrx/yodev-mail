import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
export async function GET(){let database:"ok"|"unconfigured"|"error"="unconfigured";if(db){try{await db.execute(sql`select 1`);database="ok"}catch{database="error"}}return NextResponse.json({status:database==="error"?"degraded":"ok",database,version:process.env.VERCEL_GIT_COMMIT_SHA?.slice(0,7)??"local"},{status:database==="error"?503:200})}
