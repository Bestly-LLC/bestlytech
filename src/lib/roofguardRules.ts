/**
 * RoofGuard's hard content rules, as a deterministic screen (no AI, no network). Ava says what is in ava_knowledge out loud
 * to real prospects, so a suggested fact is checked against the rules Ava must never break (docs/roofguard/caller-agent.md):
 *   1. "replacement" / "replace": the program term is roof RENEWAL
 *   2. calling RoofGuard insurance (a sentence that says it is NOT insurance is fine)
 *   3. naming or implying customers or partners RoofGuard does not have
 *   4. a deadline or limited-time offer
 *   5. a price, a percentage, or a savings / income / ROI claim (Eli gives the figure after a free assessment)
 * Warnings are advisory. They are shown to Eli as he types and to Jared on the review card; they never block a save.
 */

const SPLIT = /(?<=[.!?])\s+|\n+/;
const NEGATED = /\b(?:not|never|no|without|alongside|along with)\b|n't\b/i;

const REPLACE = /\b(replac(?:e|es|ed|ing|ement|ements))\b/i;
const INSURANCE = /\b(insurance|insured|insure|insurer|coverage|covered|policy|policies)\b/i;
const CUSTOMERS: RegExp[] = [
  /\b(?:our|existing|current|many|other|several|dozens of|hundreds of|happy|satisfied)\s+(?:customers|clients|partners|members)\b/i,
  /\b(?:trusted by|used by|chosen by|relied on by|partnered with|customers include|clients include|partners include)\b/i,
  /\b(?:we|they|she|he)\s+(?:already\s+)?(?:work|worked|working|partner|partnered)\s+with\b/i,
  /\b(?:companies|hospitals|schools|facilities|businesses|owners|properties|organizations|managers)\s+(?:like|such as)\s+(?:yours|you|[A-Z])/,
  /\b(?:testimonials?|case stud(?:y|ies)|references?|success stor(?:y|ies))\b/i,
  /\b(?:customers?|clients?|owners?)\s+(?:say|love|tell us|report|have seen)\b/i,
];
const DEADLINE = /\b(deadline|limited[- ]time|limited (?:spots?|slots?|offer|availability)|(?:only|just)\s+(?:\d+|a few|two|three|four|five)\s+(?:spots?|slots?)|spots?\s+(?:left|remaining)|act (?:now|fast|today)|hurry|today only|last chance|offer (?:ends|expires)|expires?|ends? soon|while (?:spots|supplies) last|sign up (?:by|before)|before (?:the )?(?:end of|it'?s too late)|discount|promo(?:tion|tional)?|special offer|early[- ]bird)\b/i;
const MONEY: RegExp[] = [
  /\$\s?\d[\d,.]*/,
  /\b\d[\d,.]*\s?(?:dollars|bucks|cents)\b/i,
  /\b\d+(?:\.\d+)?\s?(?:%|percent)/i,
  /\b(?:percent|percentage)\b/i,
  /\b\d[\d,.]*\s?(?:per|\/)\s?(?:sq\.?\s?(?:ft|foot)|square f(?:oo|ee)t|month|mo|year|yr)\b/i,
  /\b(?:save|saves|saved|saving|savings|roi|return on investment|payback|pays? for itself|break[- ]even|cuts? (?:your )?costs?|reduces? (?:your )?(?:costs?|spend)|cheaper|cheapest|lowest price)\b/i,
  /\b(?:income|profit|earn|earnings|revenue)\b/i,
];

const quote = (s: string) => `"${s.trim().toLowerCase()}"`;
const firstMatch = (res: RegExp[], s: string) => { for (const r of res) { const m = s.match(r); if (m) return m[0]; } return null; };

/** Plain-English warnings for one suggested fact. Empty list means nothing tripped. Each rule reports at most once. */
export function checkRoofguardFact(text: string): string[] {
  const out: string[] = [];
  const sentences = String(text ?? "").split(SPLIT).filter((s) => s.trim());

  const rep = sentences.map((s) => s.match(REPLACE)).find(Boolean);
  if (rep) out.push(`Says ${quote(rep[0])}. RoofGuard calls it roof renewal.`);

  const ins = sentences.map((s) => (NEGATED.test(s) ? null : s.match(INSURANCE))).find(Boolean);
  if (ins) out.push(`Says ${quote(ins[0])}. RoofGuard is a maintenance agreement, not insurance. Only say what it is not.`);

  const cust = sentences.map((s) => firstMatch(CUSTOMERS, s)).find(Boolean);
  if (cust) out.push(`Hints at other customers or partners (${quote(cust)}). RoofGuard has none to name or point to.`);

  const dl = sentences.map((s) => s.match(DEADLINE)).find(Boolean);
  if (dl) out.push(`Sounds like a deadline or special offer (${quote(dl[0])}). Ava never invents urgency.`);

  const money = sentences.map((s) => firstMatch(MONEY, s)).find(Boolean);
  if (money) out.push(`Has a price, percent or savings claim (${quote(money)}). Ava never gives a number. Eli gives the figure after a free assessment.`);

  return out;
}
