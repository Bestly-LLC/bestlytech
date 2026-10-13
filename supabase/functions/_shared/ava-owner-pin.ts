// Owner PIN helpers shared by ava-admin (the /verify route, the snapshot op, the hourly watchdog). Pure functions, no I/O, no Deno APIs,
// so they also run under `node --experimental-strip-types` for the unit test. Plan: docs/ava-owner-mode-opusplan.md.
//
// The PIN is six digits. On a phone call speech-to-text turns "zero three zero seven two nine" into "03/07/29" (a date), "three seven
// twenty nine", "March 7th 2029" or a bare run of digits. pinCandidates() turns whatever was heard into the few six-digit strings
// it could mean; the caller hashes each one and compares in constant time. Nothing here knows or stores the PIN.

const UNITS: Record<string, number> = { zero: 0, oh: 0, o: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const TEENS: Record<string, number> = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
  thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30,
};
const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sept: 9, sep: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

/** The spoken text as a list of number chunks, in order: "three seven twenty nine" -> ["3","7","29"]; "March 7th 2029" -> ["3","7","2029"]. */
export function numberChunks(spoken: string): string[] {
  const text = String(spoken ?? "").toLowerCase().slice(0, 240)
    .replace(/(\d)(st|nd|rd|th)\b/g, "$1")
    .replace(/[^a-z0-9]+/g, " ").trim();
  if (!text) return [];
  const toks = text.split(" ");
  const out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (/^\d+$/.test(t)) { out.push(t); continue; }
    if (t === "double" || t === "triple") {                       // "double one" -> 11
      const d = UNITS[toks[i + 1] ?? ""];
      if (d !== undefined) { out.push(String(d).repeat(t === "double" ? 2 : 3)); i++; }
      continue;
    }
    if (t in MONTHS) { out.push(String(MONTHS[t])); continue; }
    if (t in ORDINALS) {
      const o = ORDINALS[t];
      if (o === 20 || o === 30) { out.push(String(o)); continue; }
      out.push(String(o)); continue;
    }
    if (t in TEENS) {
      // "nineteen ninety nine" is two chunks; a teen alone is one
      out.push(String(TEENS[t])); continue;
    }
    if (t in TENS) {
      let v = TENS[t];
      const nx = toks[i + 1] ?? "";
      if (nx in UNITS && UNITS[nx] > 0 && nx !== "o" && nx !== "oh") { v += UNITS[nx]; i++; }
      else if (nx in ORDINALS && ORDINALS[nx] < 10) { v += ORDINALS[nx]; i++; }   // "twenty sixth"
      out.push(String(v)); continue;
    }
    if (t in UNITS) {
      const nx = toks[i + 1] ?? "";
      if (nx === "thousand" || nx === "hundred") {                // "two thousand twenty six" -> 2026, "one hundred" -> 100
        let v = UNITS[t] * (nx === "thousand" ? 1000 : 100); i++;
        if (nx === "thousand") {
          let k = toks[i + 1] ?? "";
          if (k in UNITS && UNITS[k] > 0 && (toks[i + 2] ?? "") === "hundred") { v += UNITS[k] * 100; i += 2; k = toks[i + 1] ?? ""; }
          if (k in TEENS) { v += TEENS[k]; i++; }
          else if (k in TENS) { v += TENS[k]; i++; const u = toks[i + 1] ?? ""; if (u in UNITS && UNITS[u] > 0) { v += UNITS[u]; i++; } }
          else if (k in UNITS && UNITS[k] > 0) { v += UNITS[k]; i++; }
        }
        out.push(String(v)); continue;
      }
      out.push(String(UNITS[t])); continue;
    }
    // anything else (pin, is, my, and, the, thanks ...) is ignored
  }
  return out;
}

const pad2 = (s: string) => s.padStart(2, "0");

/** Up to `max` distinct six-digit strings the caller could have meant, best guess first. */
export function pinCandidates(spoken: string, max = 6): string[] {
  const raw = String(spoken ?? "").slice(0, 240);
  const found: string[] = [];
  const add = (s: string | null | undefined) => { if (s && /^[0-9]{6}$/.test(s) && !found.includes(s)) found.push(s); };
  const digitsOnly = raw.replace(/\D/g, "");
  const chunks = numberChunks(raw);
  const concat = chunks.join("");

  // 1. a plain run of six digits typed or spelled as digits ("030729", "03-07-29", "0 3 0 7 2 9")
  if (digitsOnly.length === 6) add(digitsOnly);
  // 2. a date: MM DD YY or MM DD YYYY ("03/07/29", "March 7 2029", "three seven twenty twenty nine")
  if (chunks.length >= 3) {
    const mm = Number(chunks[0]), dd = Number(chunks[1]); const yr = chunks.slice(2).join("");
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 && (yr.length === 2 || yr.length === 4)) add(pad2(chunks[0]) + pad2(chunks[1]) + yr.slice(-2));
  }
  // 3. every chunk read out in order ("oh three oh seven twenty nine" -> 030729)
  if (concat.length === 6) add(concat);
  // 4. a date typed without separators, MMDDYYYY -> MMDDYY
  for (const d of [digitsOnly, concat]) if (d.length === 8) add(d.slice(0, 4) + d.slice(6));
  // 5. a longer run: the first six and the last six digits
  for (const d of [digitsOnly, concat]) if (d.length > 6 && d.length <= 14) { add(d.slice(0, 6)); add(d.slice(-6)); }
  return found.slice(0, max);
}

// ---------- the watchdog and the snapshot: find / redact a PIN-looking number sitting near the word PIN ----------
const PIN_WORD = /\b(pin|p\.i\.n|passcode|pass code|pass-code|security code|verification code|access code|owner code)\b/i;
const SIX = /(?<![0-9])[0-9]{6}(?![0-9])/g;
const DATEISH = /(?<![0-9])[0-9]{1,2}[\/.\-][0-9]{1,2}[\/.\-][0-9]{2}(?:[0-9]{2})?(?![0-9])/g;

/** Every PIN-looking number within `reach` characters of the word PIN / passcode / security code. */
export function pinHits(text: string, reach = 70): { at: number; len: number }[] {
  const t = String(text ?? ""); const hits: { at: number; len: number }[] = [];
  for (const re of [SIX, DATEISH]) {
    re.lastIndex = 0; let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      const ctx = t.slice(Math.max(0, m.index - reach), m.index + m[0].length + reach);
      if (PIN_WORD.test(ctx)) hits.push({ at: m.index, len: m[0].length });
    }
  }
  return hits.sort((a, b) => a.at - b.at);
}
export const hasPlainPin = (text: string) => pinHits(text).length > 0;

/** The same text with every PIN-looking number near the word PIN replaced by [redacted]. */
export function redactPins(text: string): string {
  const t = String(text ?? ""); const hits = pinHits(t);
  if (!hits.length) return t;
  let out = "", pos = 0;
  for (const h of hits) { if (h.at < pos) continue; out += t.slice(pos, h.at) + "[redacted]"; pos = h.at + h.len; }
  return out + t.slice(pos);
}

/** Deep-walk any JSON value and redact every string in it. Returns the redacted copy and how many strings changed. */
export function redactDeep<T>(v: T): { value: T; changed: number } {
  let changed = 0;
  const walk = (x: unknown): unknown => {
    if (typeof x === "string") { const r = redactPins(x); if (r !== x) changed++; return r; }
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x as Record<string, unknown>).map(([k, val]) => [k, walk(val)]));
    return x;
  };
  return { value: walk(v) as T, changed };
}
/** Count of PIN-looking numbers anywhere in a JSON value. */
export function countPlainPins(v: unknown): number {
  let n = 0;
  const walk = (x: unknown) => {
    if (typeof x === "string") n += pinHits(x).length;
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") Object.values(x as Record<string, unknown>).forEach(walk);
  };
  walk(v);
  return n;
}
