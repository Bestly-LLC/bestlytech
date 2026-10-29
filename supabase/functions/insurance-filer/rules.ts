// Pure drafting rules for the insurance-filer edge function (no Deno APIs, so vitest can run them).
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

// ---- the words a draft may never carry (the SQL guard in ins_draft_ready checks again) ----------------------------------------------
const PLAN_TALK = /(host (damage )?responsibility|damage responsibility|deductible|out.of.pocket|protection plan|max earn|earn plan|turo plan|coverage limit|policy limit)/i;
const REVIEW_TALK = /\b(review|reviews|rating|ratings|stars?)\b/i;
export function guard(body: string, estimate: number | null): string | null {
  if (PLAN_TALK.test(body)) return "mentions Turo plan terms";
  if (REVIEW_TALK.test(body)) return "mentions reviews";
  for (const m of body.matchAll(/\$\s?([0-9][0-9,]*(?:\.[0-9]{2})?)/g)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (estimate == null || Math.abs(n - estimate) > 0.005) return "carries a dollar amount that is not the finalized estimate";
  }
  return null;
}
const SIG = "Thank you,\nClaims Closer, for Jared Best";
/** Take off any sign-off the model wrote, then put ours on. */
export function withSig(body: string): string {
  const t = body.replace(/\r/g, "").trim().replace(/\n+\s*(thank you|thanks|sincerely|best|regards|kind regards|best regards)[,.!]?\s*(\n[\s\S]*)?$/i, "").trim();
  return `${t}\n\n${SIG}`;
}

export function templateBody(c: Row): { subject: string; body: string } {
  const f: Row = c.facts ?? {};
  const att: Row[] = Array.isArray(c.attachments) ? c.attachments : [];
  const photos = att.filter((a) => a.source !== "estimate_doc").length;
  const hasEst = att.some((a) => a.source === "estimate_doc");
  const first = String(c.case?.adjuster_name ?? "").split(" ")[0] || "there";
  const lines: string[] = [`Hello ${first},`, ""];
  if (c.draft?.kind === "first_email") {
    lines.push(`I am writing to report a claim under your policyholder's policy ${c.case?.policy_no ?? ""}. A Turo rental, a ${f["vehicle.year"] ?? ""} Tesla ${f["vehicle.model"] ?? "Model 3"}, was damaged on ${f["loss.date"] ?? "the date of loss"} in ${[f["loss.city"], f["loss.state"]].filter(Boolean).join(", ")}.`);
    lines.push(`The damage: ${String(f["loss.damage"] ?? "see photos").toLowerCase()}.${f["loss.description"] ? " What happened: " + String(f["loss.description"]).replace(/\.$/, "") + "." : ""}`);
    if (photos || hasEst) lines.push(`Attached ${photos ? photos + " photo" + (photos === 1 ? "" : "s") + " of the damage" : ""}${photos && hasEst ? " and " : ""}${hasEst ? "the repair estimate" : ""}.`);
    lines.push("Please send me the claim number and the name of the adjuster who will handle it.");
  } else {
    lines.push(`Thank you for your email about claim ${c.case?.claim_no ?? ""}.`);
    if (photos || hasEst) lines.push(`Attached ${photos ? photos + " photo" + (photos === 1 ? "" : "s") + " of the damage" : ""}${photos && hasEst ? " and " : ""}${hasEst ? "the repair estimate" : ""}.`);
    lines.push("If you need anything else, reply to this email and I will send it right away.");
  }
  if (c.turo_claim_no) lines.push("", `For your records, Turo has a separate claim open for the same loss (Turo claim ${c.turo_claim_no}).`);
  const subj = String(c.draft?.subject ?? "").trim() || `Claim ${c.case?.claim_no ?? ""}`.trim();
  return { subject: subj, body: withSig(lines.join("\n")) };
}

