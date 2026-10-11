/**
 * One settlement claim card for /admin/settlements (Nickel). Answers "do I qualify?" at a glance:
 * Nickel's read (reasoning + verdict), who qualifies, the deadline and payouts are always visible;
 * the class period, places, exclusions, proof, evidence and the full class definition sit one tap deeper.
 * Tab-specific actions are passed in as `actions`; Archive / Restore lives in the card footer.
 */
import { ReactNode } from "react";
import { Archive, ArchiveRestore, CalendarClock, CheckCircle2, ChevronRight, CircleHelp, ExternalLink, FileText, Landmark, MapPin, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { btnPlain, card, label, pill, secondary, tertiary, tint } from "./laxUi";
import { Nb, dayFromYmd, daysUntil, shortDay, usd } from "./settlementsShared";

export type Evidence = { kind?: string; ref?: string; summary?: string };
export type Details = {
  who_qualifies?: string[]; class_period?: { start?: string | null; end?: string | null } | null; locations?: string[]; excluded?: string[];
  payout_no_proof?: string | null; payout_with_proof?: string | null; proof_examples?: string[]; how_to_check?: string | null;
  official_site?: string | null; claim_form?: string | null; basis?: "site" | "listing" | string; fetched_at?: string | null;
};
export type SettlementInfo = {
  name: string; defendant: string | null; administrator: string | null; claim_url: string | null; info_url: string | null;
  class_definition: string | null; proof_required: boolean | null; est_payout: string | null; deadline: string | null; status: string;
  details?: Details | null;
};
export type Claim = {
  id: string; status: string; match: string; evidence: Evidence[] | null; question: string | null; answer: boolean | null;
  approved_at: string | null; filed_at: string | null; confirmation: string | null; payout_method: string | null;
  needs_you_url: string | null; needs_you_why: string | null; amount_cents: number | null; paid_at: string | null;
  paid_via: "mail" | "email" | "button" | null; paid_source?: string | null; notes: string | null; settlement: SettlementInfo;
  fact_key?: string | null; reasoning?: string | null; archived_at?: string | null; created_at?: string | null; updated_at?: string | null;
};
export type Payment = { claim_id: string; source: string; amount_cents: number | null; posted_at: string | null; counterparty: string | null; txn_id: string };

const SOURCE: Record<string, string> = { mercury: "Mercury deposit", paypal: "PayPal", mail: "USPS mail scan", email: "Payment email", button: "You marked it" };

/** Verdict pill: how sure Nickel is that Jared is in the class, in words (never color alone). */
function Verdict({ c }: { c: Claim }) {
  const [text, cls, Icon] =
    c.match === "proven" ? ["Proven from your records", pill.green, CheckCircle2]
    : c.match === "likely" ? ["Likely from your records", pill.blue, Sparkles]
    : c.answer === true ? ["You said yes", pill.blue, CheckCircle2]
    : c.answer === false ? ["You said no", "bg-[#7676803d] text-[#EBEBF599] bento:bg-[#7676801f] bento:text-[#3C3C4399]", CircleHelp]
    : ["Needs your answer", pill.orange, CircleHelp];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-semibold", cls)}>
      <Icon className="h-3.5 w-3.5" aria-hidden /> {text}
    </span>
  );
}

function Chip({ icon: Icon, children, tone }: { icon?: typeof CalendarClock; children: ReactNode; tone?: "orange" | "red" }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-[8px] bg-[#ffffff0d] px-2 py-1 text-[12.5px] leading-tight bento:bg-[#0000000a]",
      tone === "red" ? tint.red : tone === "orange" ? tint.orange : secondary)}>
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />}
      <span>{children}</span>
    </span>
  );
}

function Deadline({ ymd }: { ymd: string | null }) {
  if (!ymd) return <Chip icon={CalendarClock}>No deadline listed</Chip>;
  const n = daysUntil(ymd);
  const left = n < 0 ? "deadline passed" : n === 0 ? "due today" : `${n} ${n === 1 ? "day" : "days"} left`;
  return (
    <Chip icon={CalendarClock} tone={n < 0 || n <= 3 ? "red" : n < 7 ? "orange" : undefined}>
      Due <span className="whitespace-nowrap">{dayFromYmd(ymd)}</span> · <span className="whitespace-nowrap">{left}</span>
    </Chip>
  );
}

const year = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
function period(p?: Details["class_period"]) {
  if (!p || (!p.start && !p.end)) return null;
  if (p.start && p.end) return <><span className="whitespace-nowrap">{year(p.start)}</span> to <span className="whitespace-nowrap">{year(p.end)}</span></>;
  return p.start ? <>From <span className="whitespace-nowrap">{year(p.start)}</span></> : <>Until <span className="whitespace-nowrap">{year(p.end!)}</span></>;
}

function List({ title, items, icon: Icon }: { title: string; items?: (string | null | undefined)[]; icon?: typeof MapPin }) {
  const xs = (items ?? []).filter((x): x is string => !!x && !!x.trim());
  if (!xs.length) return null;
  return (
    <div>
      <p className={cn("text-[12px] font-semibold uppercase tracking-[0.03em]", tertiary)}>{title}</p>
      <ul className="mt-1 space-y-1">
        {xs.map((t, i) => (
          <li key={i} className={cn("flex items-start gap-1.5 text-[14px] leading-snug", secondary)}>
            {Icon ? <Icon className="mt-[3px] h-3.5 w-3.5 shrink-0" aria-hidden /> : <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-current" aria-hidden />}
            <span><Nb text={t} /></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ClaimCard({ c, payments, actions, onArchive, highlight, children }: {
  c: Claim; payments?: Payment[]; actions?: ReactNode; onArchive?: (c: Claim, on: boolean) => void; highlight?: "orange" | "blue"; children?: ReactNode;
}) {
  const s = c.settlement;
  const d = s.details ?? {};
  const noProof = d.payout_no_proof || null;
  const withProof = d.payout_with_proof && d.payout_with_proof !== d.payout_no_proof ? d.payout_with_proof : null;
  const payout = !noProof && !withProof ? s.est_payout : null;
  const per = period(d.class_period);
  const places = (d.locations ?? []).filter(Boolean);
  const who = (d.who_qualifies ?? []).filter(Boolean);
  const evidence = (c.evidence ?? []).filter((e) => e.kind !== "answer" || e.summary);
  const site = d.official_site || s.info_url;
  const form = d.claim_form || s.claim_url;
  const archived = !!c.archived_at;
  const hasMore = !!(per || places.length || (d.excluded ?? []).length || (d.proof_examples ?? []).length || d.how_to_check || evidence.length || s.class_definition);

  return (
    <article className={cn(card, "p-4 sm:p-5",
      highlight === "orange" && "ring-1 ring-[#FF9F0A66] bento:ring-[#FF950066]",
      highlight === "blue" && "ring-1 ring-[#0A84FF66] bento:ring-[#007AFF66]")}>
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1 basis-56">
          <h3 className={cn("text-[16px] font-semibold leading-snug", label)}>{s.name}</h3>
          {(s.defendant || s.administrator) && (
            <p className={cn("mt-0.5 text-[13px] leading-snug", secondary)}>
              {[s.defendant && `Against ${s.defendant}`, s.administrator && `Run by ${s.administrator}`].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        {c.status !== "paid" && <Verdict c={c} />}
      </header>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <Deadline ymd={s.deadline} />
        {noProof && <Chip>No proof: <Nb text={noProof} /></Chip>}
        {withProof && <Chip>With proof: <Nb text={withProof} /></Chip>}
        {payout && <Chip>Payout: <Nb text={payout} /></Chip>}
        {s.proof_required != null && <Chip icon={FileText}>{s.proof_required ? "Proof needed" : "No proof needed"}</Chip>}
        {places.length > 0 && <Chip icon={MapPin}>{places.slice(0, 3).join(", ")}{places.length > 3 ? ` and ${places.length - 3} more` : ""}</Chip>}
      </div>

      {(c.reasoning || who.length > 0) && (
        <div className="mt-3 grid gap-3 rounded-[14px] bg-[#ffffff08] p-3 bento:bg-[#00000005] md:grid-cols-2">
          {who.length > 0 && <List title="Who qualifies" items={who.slice(0, 3)} />}
          {c.reasoning && (
            <div>
              <p className={cn("text-[12px] font-semibold uppercase tracking-[0.03em]", tertiary)}>Nickel&rsquo;s read</p>
              <p className={cn("mt-1 text-[14px] leading-snug", label)}>{c.reasoning}</p>
            </div>
          )}
        </div>
      )}

      {children}

      {hasMore && (
        <details className="group mt-2">
          <summary className={cn("flex min-h-[44px] cursor-pointer list-none items-center gap-1 text-[14px] font-medium sm:min-h-[32px]", tint.blue)}>
            <ChevronRight className="h-4 w-4 transition-transform duration-200 group-open:rotate-90" aria-hidden /> Everything about this settlement
          </summary>
          <div className="mt-1 grid gap-3 md:grid-cols-2">
            {per && (
              <div>
                <p className={cn("text-[12px] font-semibold uppercase tracking-[0.03em]", tertiary)}>Class period</p>
                <p className={cn("mt-1 text-[14px] leading-snug", secondary)}>{per}</p>
              </div>
            )}
            <List title="Places" items={places} icon={MapPin} />
            <List title="Not included" items={d.excluded} />
            <List title="Proof that works" items={d.proof_examples} />
            {d.how_to_check && <List title="How to check" items={[d.how_to_check]} />}
            <List title="Why Nickel matched it" items={evidence.map((e) => e.summary ?? e.ref)} icon={CheckCircle2} />
            {who.length > 3 && <List title="Also qualifies" items={who.slice(3)} />}
          </div>
          {s.class_definition && (
            <div className="mt-3">
              <p className={cn("text-[12px] font-semibold uppercase tracking-[0.03em]", tertiary)}>Official class definition</p>
              <p className={cn("mt-1 whitespace-pre-wrap rounded-[12px] bg-[#ffffff0d] px-3 py-2.5 text-[13.5px] leading-snug bento:bg-[#0000000a]", secondary)}><Nb text={s.class_definition} /></p>
            </div>
          )}
          {d.basis && (
            <p className={cn("mt-2 text-[12px]", tertiary)}>
              {d.basis === "site" ? "Read from the official settlement site" : "From the settlement listing (the official site blocked automated reading)"}
              {d.fetched_at ? <> · <span className="whitespace-nowrap">{shortDay(d.fetched_at)}</span></> : null}
            </p>
          )}
        </details>
      )}

      {payments && payments.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {payments.map((p) => (
            <li key={p.txn_id} className={cn("flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-[12px] bg-[#30D1581a] px-3 py-2 text-[13.5px] bento:bg-[#34C7591a]", label)}>
              <Landmark className={cn("h-4 w-4 shrink-0", tint.green)} aria-hidden />
              {p.amount_cents != null && <span className="whitespace-nowrap font-semibold tabular-nums">{usd(p.amount_cents)}</span>}
              <span className={secondary}>{SOURCE[p.source] ?? p.source}{p.counterparty ? ` from ${p.counterparty}` : ""}</span>
              {p.posted_at && <span className={cn("whitespace-nowrap", secondary)}>· {shortDay(p.posted_at)}</span>}
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#38383A] pt-3 bento:border-[#C6C6C8]">
        {actions}
        <span className="ml-auto flex flex-wrap items-center gap-x-4">
          {site && <a href={site} target="_blank" rel="noreferrer" className={cn(btnPlain, "text-[14px]")}>Official site <ExternalLink className="h-3.5 w-3.5" aria-hidden /></a>}
          {form && form !== site && <a href={form} target="_blank" rel="noreferrer" className={cn(btnPlain, "text-[14px]")}>Claim form <ExternalLink className="h-3.5 w-3.5" aria-hidden /></a>}
          {onArchive && (
            <button type="button" className={cn(btnPlain, "text-[14px]", secondary)} onClick={() => onArchive(c, !archived)}>
              {archived ? <><ArchiveRestore className="h-4 w-4" aria-hidden /> Restore</> : <><Archive className="h-4 w-4" aria-hidden /> Archive</>}
            </button>
          )}
        </span>
      </footer>
    </article>
  );
}
