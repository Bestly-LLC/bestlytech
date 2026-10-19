// Seeds Jared's letter to Elizabeth into email_library as the first "built" email.
// It carries her board link (an access token), so it is NOT in a migration: this script reads the link from the
// letter file and prints SQL to stdout (or --out file). Run the SQL in the Supabase SQL editor / execute_sql.
//
//   node scripts/email-builder/seed-elizabeth.mjs <letter.html> <recipient@email> [--out file.sql]
// Needs Node 22.18+ (runs the TypeScript renderer directly).
import { readFileSync, writeFileSync } from "node:fs";
import { KITS } from "./kits.mjs";
import { elizabethDoc } from "./elizabeth-blocks.mjs";
import { renderEmail, renderText, resolveKit } from "../../supabase/functions/_shared/email-render.ts";

const [, , file, email, flag, out] = process.argv;
if (!file || !email) { console.error("usage: seed-elizabeth.mjs <letter.html> <recipient@email> [--out file.sql]"); process.exit(1); }
const src = readFileSync(file, "utf8");
const link = src.match(/href="(https:\/\/studio\.bestly\.tech\/centering-you\?c=[^"]+)"/)?.[1];
if (!link) { console.error("board link not found in the letter"); process.exit(1); }

const rows = Object.fromEntries(KITS.map((k) => [k.slug, k]));
const kit = resolveKit(rows.bestly, rows);
const doc = elizabethDoc(link);
const html = renderEmail(kit, doc);
const text = renderText(kit, doc);
const q = (s) => `$q$${s}$q$`;
const sql = `insert into public.email_library (brand_kit, title, subject, preheader, blocks, html, text_body, source, brief, recipient_name, recipient_email, status)
select 'bestly', ${q("Elizabeth: two new things on your board")}, ${q(doc.subject)}, ${q(doc.preheader)}, ${q(JSON.stringify(doc.blocks))}::jsonb, ${q(html)}, ${q(text)}, 'built',
  ${q("Letter to Elizabeth before the next day's call: the call is now on her board, and she can send videos to comment on.")}, 'Elizabeth O''Brien', ${q(email)}, 'draft'
where not exists (select 1 from public.email_library where title = ${q("Elizabeth: two new things on your board")});
`;
if (flag === "--out") { writeFileSync(out, sql); console.log("wrote", out, sql.length); } else process.stdout.write(sql);
