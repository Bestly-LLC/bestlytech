// Claims Closer text guards. Pure (no Deno, no network) so vitest runs them under src/.
//
// Every message that leaves the building passes these, whoever wrote it (the model, a template, a shop answer):
//   - no reviews, ratings or stars               (reviewGuard)
//   - no Turo voice, no deductible / plan cap    (planGuard)
//   - no dollar figures except the ones allowed  (moneyGuard)
//   - nothing copied from what Jared typed to us (sharesRunWith / overlapsAnswers)  <- 2026-10-28, see answers.ts

// Guest messages never mention reviews, ratings or stars, in any form (Jared, 2026-10-26).
export function reviewGuard(text: string): { ok: boolean; cleaned: string } {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((s) => !/\b(review\w*|rating\w*|rate you|stars?)\b/i.test(s));
  return { ok: kept.length === sentences.length, cleaned: kept.join(" ").trim() };
}

// Jared's rule: hosts never tell a guest their deductible / plan cap / out-of-pocket max, and never speak for Turo (its plans, policies,
// processes, payment options). Same wording list the SQL watchdog (claims_guard_watch) uses, slightly stricter.
export const TURO_VOICE = /deductible|out[-\s]of[-\s]pocket|protection|\bplan\s+(max|cap)|\b(turo|coverage|insurance)\s+plan|\bcap(s|ped)?\b|\bmax(imum)?\b|\bturo['’]s\b|\b(through|via|in|on|using|with)\s+(the\s+)?turo\b|\bturo\s+(app|polic|process|team|support|insurance|rules?|claims?)|clause\s*2\.6|car[-\s]sharing agreement|terms of service/i;
export function planGuard(text: string): boolean { return !TURO_VOICE.test(text); }

// dollar figures: only the allowed amounts may appear
export function moneyGuard(text: string, allowed: number[]): boolean {
  for (const m of text.matchAll(/\$\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)/g)) {
    const v = Number(m[1].replace(/,/g, ""));
    if (!allowed.some((a) => Math.abs(a - v) < 0.01)) return false;
  }
  return true;
}

// ---------------------------------------------------------------- "nothing Jared typed leaves the building"
// Jared's answers are instructions to Claims Closer. On 2026-10-28 an answer ("Skip we got an estimate from tesla") was emailed word for word to three
// body shops. This is the backstop that makes that impossible even if a code path forgets: any outbound text that shares a run of 4 words, or 20
// characters, with something Jared typed is blocked.
export const OVERLAP_WORDS = 4;
export const OVERLAP_CHARS = 20;

export function normalizeWords(t: string): string[] {
  return t.toLowerCase().replace(/[‘’']/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
}

/** longest run of consecutive words two texts share */
export function longestSharedWords(a: string, b: string): number {
  const x = normalizeWords(a), y = normalizeWords(b);
  if (!x.length || !y.length) return 0;
  let best = 0, prev = new Array(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    const cur = new Array(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j++) if (x[i - 1] === y[j - 1]) { cur[j] = prev[j - 1] + 1; if (cur[j] > best) best = cur[j]; }
    prev = cur;
  }
  return best;
}

/** longest run of consecutive characters the two texts share, after lowercasing and squeezing everything that is not a letter or digit */
export function longestSharedChars(a: string, b: string): number {
  const x = normalizeWords(a).join(" "), y = normalizeWords(b).join(" ");
  if (!x || !y) return 0;
  let best = 0, prev = new Array(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    const cur = new Array(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j++) if (x[i - 1] === y[j - 1]) { cur[j] = prev[j - 1] + 1; if (cur[j] > best) best = cur[j]; }
    prev = cur;
  }
  return best;
}

export function sharesRunWith(outbound: string, typed: string): boolean {
  return longestSharedWords(outbound, typed) >= OVERLAP_WORDS || longestSharedChars(outbound, typed) >= OVERLAP_CHARS;
}

/** true when the outbound text copies a run from any of the answers. Single-word answers (yes, retry, walk_in) are button values, not prose. */
export function overlapsAnswers(outbound: string, answers: string[]): { hit: boolean; answer?: string } {
  for (const a of answers) {
    if (!a || normalizeWords(a).length < 2) continue;
    if (sharesRunWith(outbound, a)) return { hit: true, answer: a };
  }
  return { hit: false };
}

// Words a message to a shop may never carry when it was written because of one of Jared's answers: a competing source, or any amount.
export function mentionsCompetingSource(text: string, otherShopNames: string[] = []): boolean {
  if (/\b(tesla\s+(service|collision|body)|tesla\b(?!\s+model)|another shop|other shops?|someone else|elsewhere|competitor|cheaper|better (price|quote)|already (got|have|received)|got an? (estimate|quote))\b/i.test(text)) return true;
  const low = text.toLowerCase();
  return otherShopNames.some((n) => n && n.length > 3 && low.includes(n.toLowerCase().replace(/\s+\(.*\)$/, "")));
}
