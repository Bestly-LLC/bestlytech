// PGlite harness: runs the REAL autonomy migrations against a stub of production's tables, so the SQL is tested, not a copy of it.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");
export async function makeDb() {
  const db = new PGlite();
  await db.exec(fs.readFileSync(path.join(__dirname, "stub-schema.sql"), "utf8"));
  await db.exec(fs.readFileSync(path.join(root, "supabase/migrations/20261028151000_claims_autonomy_core.sql"), "utf8"));
  await db.exec(fs.readFileSync(path.join(root, "supabase/migrations/20261028151100_claims_autonomy_functions.sql"), "utf8"));
  const q = async (sql: string, params: any[] = []) => (await db.query(sql, params)).rows as any[];
  const notices = () => q("select * from test_notices order by id");
  return { db, q, notices };
}
