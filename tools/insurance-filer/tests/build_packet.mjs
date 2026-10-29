// Builds a claim packet OFFLINE, with the real SQL from the Insurance Filer migration run in an in-memory Postgres (PGlite).
// Used to rehearse the form filler on a case before the migration is live. Touches nothing outside this process.
//
//   node tools/insurance-filer/tests/build_packet.mjs <seed.json> <out.json>
//
// seed.json = {"case": {claim_cases columns}, "trip": {turo_trips columns}, "events": [{kind,title,detail,at}]}, read-only copies of live rows.
// Keep seed files and the output OUT of git (they hold real people's details).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const { PGlite } = createRequire(path.join(root, "package.json"))("@electric-sql/pglite");
const [seedPath, outPath] = process.argv.slice(2);
if (!seedPath || !outPath) { console.error("usage: build_packet.mjs <seed.json> <out.json>"); process.exit(2); }
const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const db = new PGlite();
await db.exec(read("src/components/admin/cc/__fixtures__/stuck-stubs.sql"));
await db.exec(read("src/components/admin/cc/__fixtures__/insurance-stubs.sql"));
await db.exec(read("supabase/migrations/20261027220000_stuck_card.sql"));
await db.exec(read("supabase/migrations/20261028190000_stuck_fix_buttons.sql"));
await db.exec(read("supabase/migrations/20261029140000_insurance_filer.sql"));

async function insert(table, row) {
  const cols = (await db.query("select column_name from information_schema.columns where table_schema='public' and table_name=$1", [table])).rows.map((r) => r.column_name);
  const keys = Object.keys(row).filter((k) => cols.includes(k));
  const vals = keys.map((k) => (row[k] !== null && typeof row[k] === "object" ? JSON.stringify(row[k]) : row[k]));
  await db.query(`insert into ${table} (${keys.join(",")}) values (${keys.map((_, i) => "$" + (i + 1)).join(",")})`, vals);
  return keys;
}
await insert("claim_cases", seed.case);
await insert("turo_trips", seed.trip);
for (const e of seed.events || []) await insert("claim_events", { case_id: seed.case.id, reservation_id: seed.case.reservation_id, ...e });
await db.query("update ins_settings set enabled = true where id");
await db.query("select ins_sweep()");
const r = await db.query("select ins_mac_packet_t('good-mac', $1::uuid) as v", [seed.case.id]);
fs.writeFileSync(outPath, JSON.stringify(r.rows[0].v, null, 2));
const pk = r.rows[0].v.packet;
console.log(`packet written: ${Object.keys(pk.values).length} values, ${pk.unknown.length} unknown (${pk.unknown.map((u) => u.key).join(", ")}), hash ${pk.hash}`);
await db.close();
