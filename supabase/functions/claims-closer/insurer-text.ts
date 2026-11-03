// Words Claims Closer uses with an insurer, and how it reads an adjuster's reply. Pure. Written from templates (no model): every sentence here
// is checked by canSend (no deductible or plan figure, no Turo voice, no reviews, only the amounts the caller allows) before it leaves.
// Jared, 2026-10-28: email comes from jared@bestly.tech with his Bestly signature (sendMail adds it), never Gmail; calls go through Ava.
import { settlementDecision } from "./autonomy.ts";

type Row = Record<string, any>;
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const carOf = (c: Row) => String(c.car ?? "2020 Tesla Model 3").replace(/\s+\(.*\)$/, "").replace(/^Tesla Model 3 2020$/, "2020 Tesla Model 3");

export type Mail = { subject: string; text: string };

export function openClaimEmail(c: Row, t: Row, o: { estimate: number | null; shop: string | null; lossDate: string | null; photos: number }): Mail {
  const insured = t.policy_holder ? `your insured, ${t.policy_holder}` : "your insured";
  const when = o.lossDate ? `on ${o.lossDate}` : "during a recent rental";
  const lines = [
    `Hello,`,
    `My ${carOf(c)}${c.vin ? ` (VIN ${c.vin})` : ""} was damaged ${when} while it was in the care of ${insured}, policy ${t.policy_no}. I would like to open a third-party property damage claim.`,
    o.estimate != null ? `I attached ${o.photos} photo${o.photos === 1 ? "" : "s"} of the damage and a repair estimate${o.shop ? ` from ${o.shop}` : ""} for ${usd(o.estimate)}.` : `I attached ${o.photos} photo${o.photos === 1 ? "" : "s"} of the damage.`,
    `Please reply with the claim number and the name and direct contact of the adjuster on this claim, and tell me anything else you need from me.`,
    `Thank you.`,
  ];
  return { subject: `New third-party claim: ${carOf(c)}, policy ${t.policy_no}`, text: lines.join("\n\n") };
}

export function sendEstimateEmail(c: Row, t: Row, o: { estimate: number; shop: string | null; photos: number }): Mail {
  return { subject: `Claim ${t.claim_no ?? ""} estimate and photos: ${carOf(c)}`.replace("  ", " "),
    text: [`Hello,`, `Attached are ${o.photos} photo${o.photos === 1 ? "" : "s"} of the damage and the repair estimate${o.shop ? ` from ${o.shop}` : ""} for ${usd(o.estimate)} on claim ${t.claim_no ?? "(number to follow)"}.`,
      `Please confirm you have them and let me know when to expect a decision.`, `Thank you.`].join("\n\n") };
}

export function chaseEmail(c: Row, t: Row, n: number): Mail {
  return { subject: `Following up: claim ${t.claim_no ?? ""} ${carOf(c)}`.replace("  ", " "),
    text: [`Hello,`, n >= 2 ? `Following up again on ${t.claim_no ? `claim ${t.claim_no}` : "this claim"} for my ${carOf(c)}. I have not heard back yet.` : `Following up on ${t.claim_no ? `claim ${t.claim_no}` : "this claim"} for my ${carOf(c)}.`,
      `Could you tell me where it stands and when payment will be issued? If you need anything else from me, tell me what and I will send it today.`, `Thank you.`].join("\n\n") };
}

export function acceptOfferEmail(c: Row, t: Row, amount: number): Mail {
  return { subject: `Claim ${t.claim_no ?? ""}: settlement accepted`.replace("  ", " "),
    text: [`Hello,`, `Thank you. I accept ${usd(amount)} as the settlement of ${t.claim_no ? `claim ${t.claim_no}` : "this claim"} for my ${carOf(c)}.`,
      `Please tell me how and when payment will be issued (check or direct deposit) and who it should be payable to.`, `Thank you.`].join("\n\n") };
}

export function holdForFullEmail(c: Row, t: Row, estimate: number): Mail {
  return { subject: `Claim ${t.claim_no ?? ""}: repair estimate`.replace("  ", " "),
    text: [`Hello,`, `Thank you for the update. The repair estimate for my ${carOf(c)} is ${usd(estimate)}. Could you look again at the full estimate and tell me what the difference is based on?`, `Thank you.`].join("\n\n") };
}

export function documentsEmail(c: Row, t: Row, o: { estimate: number | null; photos: number; sent: string[] }): Mail {
  return { subject: `Claim ${t.claim_no ?? ""}: requested documents`.replace("  ", " "),
    text: [`Hello,`, `As requested, attached: ${o.sent.join(" and ")}.${o.estimate != null ? ` The repair estimate total is ${usd(o.estimate)}.` : ""}`, `Let me know if you need anything else.`, `Thank you.`].join("\n\n") };
}

/** What the call script tells Ava when the insurer has a phone line and no email. */
export function openClaimCallScript(c: Row, t: Row, o: { estimate: number | null }): string {
  return `Call ${t.insurer_name}'s claims line to open a third-party property damage claim. The loss: Jared Best's ${carOf(c)}${c.vin ? ` (VIN ${c.vin})` : ""} was damaged while in the care of ${t.policy_holder ? `their insured ${t.policy_holder}` : "their insured"}, policy ${t.policy_no}.`
    + `${o.estimate != null ? ` A repair estimate of ${usd(o.estimate)} is ready to send.` : ""} Get the claim number, the adjuster's name, direct phone and email, and where to send the estimate and photos. Do not agree to any settlement or payment terms, and do not give bank details. Say Jared will follow up by email from jared@bestly.tech. Keep it short.`;
}

export function chaseCallScript(c: Row, t: Row): string {
  return `Call ${t.insurer_name} about ${t.claim_no ? `claim ${t.claim_no}` : `the third-party claim on policy ${t.policy_no}`} for Jared Best's ${carOf(c)}. Ask for the status, whether they have the estimate and photos, and when payment will be issued. Do not agree to any settlement amount or payment terms; say Jared will reply by email from jared@bestly.tech. Keep it short.`;
}

// ---------------------------------------------------------------- reading an adjuster's reply
export const INSURER_SYS = `You read an email from an insurance company about a car-damage claim made by the car's owner. Reply ONLY JSON:
{"kind": "offer"|"request"|"claim_number"|"payment_issued"|"denial"|"acknowledged"|"other", "amount": number|null, "claim_no": string|null,
 "asks": ["photos"|"estimate"|"registration"|"ownership"|"w9"|"statement"|"bank"|"other"], "adjuster_name": string|null, "adjuster_email": string|null, "adjuster_phone": string|null, "notes": string}
offer = they state a dollar amount they will pay. amount only if a dollar figure is written. payment_issued = a check or deposit is sent. denial = they refuse or deny. notes <= 160 chars. Never invent values.`;

export type InsurerRead = { kind: string; amount: number | null; claim_no: string | null; asks: string[]; adjuster_name: string | null; adjuster_email: string | null; adjuster_phone: string | null; notes: string };
/** Values must be written in the mail itself; anything the model made up is dropped. */
export function verifyInsurerRead(j: Row, mailText: string): InsurerRead {
  const text = String(mailText ?? ""), flat = text.replace(/,/g, "");
  const kinds = ["offer", "request", "claim_number", "payment_issued", "denial", "acknowledged", "other"];
  let amount = typeof j?.amount === "number" && j.amount > 0 ? j.amount : null;
  if (amount !== null && !(flat.includes(String(amount)) || flat.includes(amount.toFixed(2)) || flat.includes(String(Math.round(amount))))) amount = null;
  const claim = typeof j?.claim_no === "string" && j.claim_no.length >= 5 && text.includes(j.claim_no) ? j.claim_no.slice(0, 40) : null;
  const email = typeof j?.adjuster_email === "string" && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(j.adjuster_email) && text.toLowerCase().includes(j.adjuster_email.toLowerCase()) ? j.adjuster_email.toLowerCase() : null;
  const phoneDigits = typeof j?.adjuster_phone === "string" ? j.adjuster_phone.replace(/\D/g, "") : "";
  const phone = phoneDigits.length >= 10 && text.replace(/\D/g, "").includes(phoneDigits) ? j.adjuster_phone.slice(0, 30) : null;
  let kind = kinds.includes(j?.kind) ? j.kind : "other";
  if (kind === "offer" && amount === null) kind = "other";
  return { kind, amount, claim_no: claim, asks: Array.isArray(j?.asks) ? j.asks.filter((a: any) => typeof a === "string").slice(0, 6) : [], adjuster_name: typeof j?.adjuster_name === "string" ? j.adjuster_name.slice(0, 60) : null,
    adjuster_email: email, adjuster_phone: phone, notes: String(j?.notes ?? "").slice(0, 160) };
}

/** What to do with an offer. Under min_accept_pct of the chosen estimate: Jared decides, there is no counter. */
export function offerPlan(offer: number, estimate: number, minPct: number) { return settlementDecision(offer, estimate, minPct); }

/** an email address or phone typed in a note to Claims Closer, used ONLY as an address (the sentence itself is never sent anywhere) */
export function parseContactNote(note: string): { email: string | null; phone: string | null } {
  const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(note)?.[0]?.toLowerCase() ?? null;
  const ph = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.exec(note)?.[0] ?? null;
  return { email, phone: ph };
}
