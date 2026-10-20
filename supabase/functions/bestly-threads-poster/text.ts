// Threads post text: pure functions, no network. Used by bestly-threads-poster and unit-tested on their own.
//
// Rules (Jared, 2026-10-19):
//  - Threads text max 500 characters (emoji count as their UTF-8 bytes, so they are counted as 4).
//  - Keep the "More: minutenewsdaily.com" line when the caption has it.
//  - Threads' API has no documented AI-content flag, so when the clip has an AI voice the LAST LINE says "AI voice".
//  - Never cut with "..." : the body is trimmed at a sentence end, else a word boundary.
//  - Hashtags are not left in the text: the first one becomes the single Threads topic tag.

export const AI_LINE = "AI voice";
export const MAX_TEXT = 500;

export function tlen(s: string): number {
  let n = 0;
  for (const ch of s) n += (ch.codePointAt(0) ?? 0) > 0xffff ? 4 : 1;
  return n;
}

const HASHTAG_LINE = /^(\s*#[\p{L}\p{N}_]+\s*)+$/u;
const MORE_LINE = /^\s*more:\s*(https?:\/\/)?(www\.)?minutenewsdaily\.com\/?\s*$/i;
const AI_LINE_RE = /^\s*ai voice\s*\.?\s*$/i;

function cleanTag(t: string): string | null {
  const x = t.replace(/^#/, "").replace(/[.&]/g, "").trim().slice(0, 50);
  return x || null;
}

function cutBody(body: string, budget: number): string {
  if (tlen(body) <= budget) return body;
  let acc = "", n = 0;
  for (const ch of body) {
    const w = (ch.codePointAt(0) ?? 0) > 0xffff ? 4 : 1;
    if (n + w > budget) break;
    acc += ch; n += w;
  }
  const sent = Math.max(acc.lastIndexOf(". "), acc.lastIndexOf("! "), acc.lastIndexOf("? "), acc.lastIndexOf(".\n"));
  if (sent > acc.length * 0.4) return acc.slice(0, sent + 1).trim();
  const sp = acc.lastIndexOf(" ");
  return (sp > acc.length * 0.4 ? acc.slice(0, sp) : acc).trim().replace(/[,;:\-–—]+$/, "").trim();
}

export function threadsText(caption: string, aiLabel: boolean, max = MAX_TEXT): { text: string; topic: string | null; trimmed: boolean } {
  const lines = String(caption ?? "").replace(/\r\n?/g, "\n").split("\n");
  let topic: string | null = null;
  let more: string | null = null;
  const keep: string[] = [];
  for (const raw of lines) {
    if (HASHTAG_LINE.test(raw) && raw.trim()) {
      const first = raw.trim().split(/\s+/)[0];
      if (!topic) topic = cleanTag(first);
      continue;
    }
    if (MORE_LINE.test(raw)) { more = "More: minutenewsdaily.com"; continue; }
    if (AI_LINE_RE.test(raw)) continue;   // re-added last, below
    keep.push(raw.replace(/\s+$/, ""));
  }
  const body = keep.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const tail = [more, aiLabel ? AI_LINE : null].filter(Boolean) as string[];
  const tailText = tail.join("\n");
  const sep = body && tailText ? "\n\n" : "";
  const budget = max - tlen(tailText) - tlen(sep);
  const cut = cutBody(body, Math.max(budget, 0));
  const text = (cut + (cut && tailText ? sep : "") + tailText).trim();
  return { text, topic, trimmed: cut.length < body.length };
}
