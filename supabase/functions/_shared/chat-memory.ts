// _shared/chat-memory.ts — admin-chat v91 (2026-11-02), Scout's per-thread working-memory brief.
// Fixes thread d42608b1-adce-4158-9b35-5b503f21b925 (Nov 1, 4:00-4:09 PM): "continue" tripped supersededSince
// and dropped an 8-step run; the free agent only sees 10 messages so "try now" lost the task; actionLedger
// listed calls but not results, so Scout re-read the same files and tables; adhdShape only stripped a
// line-start OPTIONS:, so a second one printed. Pulled out here (not left inline in admin-chat/index.ts,
// which has no exports) so these pieces can be unit tested the way the rest of _shared/ is.

/** A continuation nudge ("continue", "try now", ...), never a fresh task. */
export const FOLLOW_UP = /^\s*(continue|keep going|go on|try (?:it )?now|try again|again|go|retry|any luck\??)[.!]?\s*$/i;
export function isFollowUpPhrase(text: string): boolean {
  return FOLLOW_UP.test(String(text ?? "").trim());
}

export interface ChatBrief { goal?: string; facts?: string[]; done?: string[]; open?: string[]; decisions?: string[]; avoid?: string[] }
export const BRIEF_CHARS = 1800;

/** Rewrites a follow-up to the model so it carries the live goal instead of a bare "continue". His raw words are never changed in storage - this only touches what the model sees. */
export function followUpRewrite(raw: string, b: ChatBrief | null): string {
  if (!b?.goal) return raw;
  const next = b.open?.[0] ? ` Next: ${b.open[0]}.` : "";
  return `${raw.trim()} = keep working on: ${b.goal}.${next}`;
}

/** The "This chat so far" prompt block, capped at BRIEF_CHARS. "" when there is no goal yet. */
export function briefBlock(b: ChatBrief | null): string {
  if (!b?.goal) return "";
  const section = (label: string, items: string[] | undefined, n: number) =>
    items?.length ? `${label}:\n${items.slice(0, n).map((x) => `- ${x}`).join("\n")}` : "";
  const body = [
    `Goal: ${b.goal}`,
    section("Facts", b.facts, 12), section("Done", b.done, 10), section("Open", b.open, 4),
    section("Decisions", b.decisions, 6), section("Avoid", b.avoid, 4),
  ].filter(Boolean).join("\n").slice(0, BRIEF_CHARS);
  return `\n\n# This chat so far (your working memory - trust it, don't redo it)\n${body}\n`;
}

/** One line of what a tool call actually found - read_file/run_sql/search_code/db_write; "" for anything else
 * or a failed call. Lets the action ledger show a result, not just that a call happened (item D). */
export function resultDigest(tool: string, result: unknown): string {
  const r = result as any;
  if (!r || r.ok === false) return "";
  try {
    switch (tool) {
      case "read_file": {
        const lines = typeof r.content === "string" ? r.content.split("\n").length : Number(r.total_lines ?? 0) || 0;
        return `${r.path ?? ""} (${lines} lines)`.trim();
      }
      case "run_sql": {
        const rows = Array.isArray(r.rows) ? r.rows : [];
        const first = rows[0] ? JSON.stringify(rows[0]).slice(0, 120) : "";
        return `${rows.length} row${rows.length === 1 ? "" : "s"}${first ? `, first: ${first}` : ""}`;
      }
      case "search_code": {
        const hits = [...(r.name_hits ?? []), ...(r.content_hits ?? [])].slice(0, 3).map((h: any) => h?.path ?? h?.name ?? String(h));
        return hits.length ? hits.join(", ") : "no matches";
      }
      case "db_write": return `${r.count ?? r.rows ?? r.affected ?? 1} row(s)`;
      default: return "";
    }
  } catch { return ""; }
}

/** Pulls every `OPTIONS: ...` fragment out of a reply - anywhere, even mid-sentence, even a second one - and
 * returns the clean body plus the merged, de-duped option list (item F: adhdShape used to leave a stray one
 * in place and then add its own, printing OPTIONS twice). `clean` shapes one raw option the same way adhdShape
 * does before filtering (trim separators/ellipsis); callers still apply their own length/generic-option filter. */
export function stripOptions(reply: string, clean: (o: unknown) => string = (o) => String(o ?? "").trim()): { body: string; options: string[] } {
  const all = [...String(reply ?? "").matchAll(/OPTIONS:\s*([^\n]*)/g)];
  const options = [...new Set(all.flatMap((m) => m[1].split("|").map(clean)).filter(Boolean))];
  const body = String(reply ?? "").replace(/OPTIONS:\s*[^\n]*/g, "").trim();
  return { body, options };
}

/** Before adding a row, provider, job or file: check it doesn't already exist (item E - a duplicate
 * "local-llm" row got created in thread d42608b1 when "local" already did the same job). */
export const CHECK_EXISTS_RULE = "\n\nBefore adding a row, provider, job or file, check whether one already exists (search_code, run_sql or list_files first) and reuse it instead of creating a near-duplicate.";
