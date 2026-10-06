/**
 * /admin/claims: Claims Closer (team slug claims-closer). Migrations 20261005040000_claims_closer.sql, 20261006230000_claims_v2_core.sql,
 * 20261007000000_claims_v2_turo_book.sql; edge fn claims-closer; docs/claims-closer-v2-opusplan.md.
 * v2 is hands-off: guest messages, shop estimate requests and the Turo invoice go out on their own (Settings: "Ask me first" brings
 * the old tap-to-send back). The only thing that waits for Jared is Book it. This page shows what Claims Closer sees and did:
 * Turo's status, the evidence photos, the shop quotes and which one it chose, the booking, questions it needs answered, and a
 * read-only log of messages sent.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarCheck, CheckCircle2, CircleAlert, Copy, Loader2, RefreshCw, Send, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/admin/PageHeader";
import { btnPlain, btnPrimary, btnTinted, btnDestructivePlain, card, field, label, secondary, tertiary } from "./laxUi";

type Draft = { id: string; kind: string; body: string; reason: string | null; status: string; created_at: string; sent_at: string | null; last_error: string | null; verified: boolean | null };
type Ev = { id: number; at: string; kind: string; title: string | null; detail: Record<string, unknown> | null };
type Case = { id: string; reservation_id: number; guest_first: string | null; guest_last: string | null; status: string; path: string; opened_at: string;
  estimate_due_at: string | null; escalate_by: string | null; estimate_amount: number | null; guest_max: number | null; facts: string | null;
  insurer: Record<string, string>; invoices: { amount: number | null; due_text: string | null; paid: boolean }[]; trip_end: string | null;
  turo_claim_no: string | null; car: string | null; host_responsibility: number | null; recovered_amount: number | null; outcome: string | null;
  history: boolean; closed_at: string | null;
  turo_status: string | null; turo_next_action: string | null; turo_deadline: string | null; invoice_max: number | null; synced_at: string | null;
  guest_response: { submitted?: string; answers?: Record<string, string>; photos?: string } | null;
  damage_report: { submitted?: string; answers?: Record<string, string> } | null;
  turo_invoice: Record<string, unknown> | null; chosen_shop_id: string | null; chosen_estimate_id: string | null;
  repair_booking: { state?: string; dropoff_at?: string; pickup_at?: string; days?: number; notes?: string } | null };
type Evidence = { id: string; uuid: string; kind: string; step: string | null; taken_at: string | null; path: string };
type Estimate = { id: string; shop_id: string; shop: string; distance_mi: number | null; phone: string | null; channel: string; status: string; requested_at: string;
  replied_at: string | null; amount: number | null; oem: boolean | null; repair_vs_replace: string | null; notes: string | null; chosen: boolean; chosen_reason: string | null };
type Question = { id: string; question: string; options: { value: string; label: string }[]; answer: string | null; asked_at: string; answered_at: string | null; kind: string };
type TuroAction = { id: string; kind: string; status: string; payload: { amount?: number; dry_run?: boolean } | null; error: string | null; created_at: string; done_at: string | null };
type Shop = { id: string; name: string; distance_mi: number | null };
type Row = { case: Case; drafts: Draft[]; events: Ev[]; evidence: Evidence[]; estimates: Estimate[]; questions: Question[]; turo_actions: TuroAction[] };
type Data = { sender: { claims_enabled: boolean; links_enabled: boolean; seen_at: string | null; last_error: string | null } | null;
  beat: { at: string; ok: boolean; summary: string | null } | null; settings: { autonomy: "full" | "guest_approval"; max_shop_miles: number; shops_per_request: number } | null;
  reader: { seen_at: string | null; signed_in: boolean; version: string | null; last_error: string | null } | null; shops: Shop[]; cases: Row[] };

const rpc = <T,>(fn: string, args?: object) => supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: T | null; error: { message: string } | null }>;
const when = (iso?: string | null) => iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }) : "—";
const usd = (n?: number | null) => n == null ? "—" : `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const day = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric" }) : "—";
const KIND: Record<string, string> = { reply: "Reply", follow_up: "Follow-up", insurance_ask: "Insurance ask", estimate: "Estimate", escalation: "Escalation note", other: "Message" };
const EST: Record<string, string> = { requested: "Waiting for a quote", replied: "Replied, reading it", received: "Quote in", declined: "Declined", no_reply: "No reply", needs_visit: "Wants to see the car" };
const BOOK: Record<string, string> = { requested: "Calling the shop", calling: "Ava is on the phone with the shop", booked: "Booked", manual: "Booked by you", failed: "Needs your call", by_hand: "You are booking it" };
const STATUS: Record<string, string> = { open: "Open", waiting_guest: "Waiting on guest", insurance: "Through insurance", invoiced: "Invoiced", paid: "Paid", escalated: "Escalated to Turo", closed: "Closed" };

function DraftCard({ d, onDone }: { d: Draft; onDone: () => void }) {
  const [text, setText] = useState(d.body);
  const [busy, setBusy] = useState<"" | "approve" | "reject">("");
  const isNote = d.kind === "escalation";
  const decide = async (action: "approve" | "reject") => {
    setBusy(action);
    const { error } = await rpc("claims_draft_decide", { p_id: d.id, p_action: action, p_body: action === "approve" ? text : null });
    setBusy("");
    if (error) { toast.error(error.message); return; }
    toast.success(action === "reject" ? "Rejected" : isNote ? "Marked done" : "Approved. It goes out on the Link Sender's next pass (within 3 minutes).");
    onDone();
  };
  return (
    <div className="mt-3 rounded-2xl border border-[#0A84FF66] bg-[#0A84FF14] p-3.5 bento:border-[#007AFF55] bento:bg-[#007AFF0d]">
      <p className={cn("text-[13px] font-semibold", label)}>{isNote ? "For you to paste into Turo (Claims tab, Escalate)" : `${KIND[d.kind] ?? "Message"} waiting for your OK`}</p>
      {d.reason && <p className={cn("mt-0.5 text-[13px]", secondary)}>{d.reason}</p>}
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(10, Math.max(4, Math.ceil(text.length / 60)))}
        className={cn(field, "mt-2.5 w-full resize-y text-[15px] leading-snug")} aria-label="Message text" />
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {isNote ? (
          <>
            <button type="button" className={btnTinted} onClick={() => { void navigator.clipboard.writeText(text); toast.success("Copied"); }}><Copy className="h-4 w-4" /> Copy</button>
            <button type="button" className={btnPrimary} disabled={!!busy} onClick={() => decide("approve")}>{busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Done</button>
          </>
        ) : (
          <button type="button" className={btnPrimary} disabled={!!busy || text.trim().length < 2} onClick={() => decide("approve")}>
            {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {text.trim() === d.body.trim() ? "Approve & send" : "Send my edit"}
          </button>
        )}
        <button type="button" className={btnDestructivePlain} disabled={!!busy} onClick={() => decide("reject")}><X className="h-4 w-4" /> Reject</button>
      </div>
    </div>
  );
}

function Evidence({ c, items }: { c: Case; items: Evidence[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || !items.length || Object.keys(urls).length) return;
    void supabase.functions.invoke("claims-closer", { body: { op: "evidence_urls", case_id: c.id } }).then(({ data }) => { if (data?.urls) setUrls(data.urls); });
  }, [open, items.length, c.id, urls]);
  const guest = c.guest_response?.answers ?? {};
  const report = c.damage_report?.answers ?? {};
  const after = items.filter((i) => i.kind === "after"), before = items.filter((i) => i.kind === "before");
  return (
    <details className="mt-4" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className={cn("cursor-pointer text-[15px] font-medium", label)}>Evidence · <span className="whitespace-nowrap">{after.length} damage</span> · <span className="whitespace-nowrap">{before.length} before</span></summary>
      <div className="mt-3 space-y-3">
        {Object.keys(guest).length > 0 && (
          <div><p className={cn("text-[13px] font-semibold", label)}>{c.guest_first ?? "Guest"}&rsquo;s answers{c.guest_response?.submitted ? <span className={cn("font-normal", tertiary)}> · {c.guest_response.submitted}</span> : null}</p>
            <dl className="mt-1 space-y-1">{Object.entries(guest).map(([q, a]) => <div key={q}><dt className={cn("text-[12px]", tertiary)}>{q}</dt><dd className={cn("text-[13px]", secondary)}>{a}</dd></div>)}</dl></div>
        )}
        {Object.keys(report).length > 0 && (
          <div><p className={cn("text-[13px] font-semibold", label)}>Your damage report</p>
            <dl className="mt-1 space-y-1">{Object.entries(report).map(([q, a]) => <div key={q}><dt className={cn("text-[12px]", tertiary)}>{q}</dt><dd className={cn("text-[13px]", secondary)}>{a}</dd></div>)}</dl></div>
        )}
        {[["Damage found at check-in", after], ["Before the trip", before]].map(([title, list]) => (list as Evidence[]).length > 0 && (
          <div key={title as string}><p className={cn("text-[13px] font-semibold", label)}>{title as string}</p>
            <div className="mt-1.5 grid grid-cols-4 gap-1.5 sm:grid-cols-5">
              {(list as Evidence[]).map((i) => urls[i.id]
                ? <a key={i.id} href={urls[i.id]} target="_blank" rel="noreferrer"><img src={urls[i.id]} alt={`${title as string}`} loading="lazy" className="aspect-square w-full rounded-lg object-cover" /></a>
                : <div key={i.id} className="aspect-square w-full animate-pulse rounded-lg bg-white/10 bento:bg-black/5" />)}
            </div></div>
        ))}
      </div>
    </details>
  );
}

function Estimates({ row, shops, reload }: { row: Row; shops: Shop[]; reload: () => void }) {
  const c = row.case;
  const [shop, setShop] = useState(""); const [amt, setAmt] = useState(""); const [oem, setOem] = useState(false); const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    const { error } = await rpc("claims_estimate_add", { p_case: c.id, p_shop: shop, p_amount: Number(amt), p_oem: oem });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Estimate added. Claims Closer picks it up in a minute."); setAmt(""); reload();
  };
  const list = row.estimates;
  return (
    <div className="mt-4">
      <p className={cn("text-[15px] font-semibold", label)}>Estimates</p>
      {!list.length ? <p className={cn("mt-1 text-[13px]", secondary)}>No shops asked yet. Claims Closer asks the best-ranked shops as soon as the damage photos are in.</p> : (
        <ul className="mt-1.5 divide-y divide-white/[0.06] bento:divide-neutral-100">
          {list.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className={cn("text-[15px]", label)}>{e.shop}{e.chosen && <span className="ml-2 whitespace-nowrap rounded-full bg-[#30D15826] px-2 py-0.5 text-[12px] font-medium text-[#30D158] bento:text-[#248A3D]">Chosen</span>}</p>
                <p className={cn("text-[13px]", secondary)}>
                  {e.distance_mi != null && <><span className="whitespace-nowrap">{Number(e.distance_mi)} mi</span> · </>}{e.channel === "call" ? "Ava called" : e.channel === "email" ? "Emailed" : "Walk-in"} <span className="whitespace-nowrap">{when(e.requested_at)}</span> · {EST[e.status] ?? e.status}
                  {e.oem != null && <> · {e.oem ? "OEM parts" : "aftermarket parts"}</>}{e.repair_vs_replace && <> · {e.repair_vs_replace}</>}
                </p>
                {e.status === "needs_visit" && e.notes && <p className={cn("text-[13px]", secondary)}>{e.notes}</p>}
                {e.chosen_reason && <p className={cn("text-[13px]", secondary)}>{e.chosen_reason}</p>}
              </div>
              <span className={cn("shrink-0 whitespace-nowrap text-[15px] font-semibold", label)}>{usd(e.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      <details className="mt-2">
        <summary className={cn("cursor-pointer text-[13px] font-medium", tertiary)}>Add a quote I got myself</summary>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="block"><span className={cn("text-[12px]", tertiary)}>Shop</span>
            <select value={shop} onChange={(e) => setShop(e.target.value)} className={cn(field, "mt-1 w-56")}><option value="">Choose</option>{shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label className="block"><span className={cn("text-[12px]", tertiary)}>Total ($)</span>
            <input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} className={cn(field, "mt-1 w-28")} /></label>
          <label className={cn("flex min-h-[44px] items-center gap-1.5 text-[13px] sm:min-h-0", secondary)}><input type="checkbox" checked={oem} onChange={(e) => setOem(e.target.checked)} /> OEM parts</label>
          <button type="button" className={btnTinted} disabled={busy || !shop || !amt} onClick={add}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}</button>
        </div>
      </details>
    </div>
  );
}

function Booking({ row, reload }: { row: Row; reload: () => void }) {
  const c = row.case; const rb = c.repair_booking; const state = rb?.state ?? "";
  const chosen = row.estimates.find((e) => e.chosen);
  const [busy, setBusy] = useState(false); const [manual, setManual] = useState("");
  const book = async () => {
    setBusy(true); const { error } = await rpc("claims_book", { p_case: c.id }); setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Booking started. Ava is calling the shop."); reload();
  };
  const byHand = async () => {
    setBusy(true); const { error } = await rpc("claims_book_manual", { p_case: c.id, p_dropoff: new Date(manual).toISOString() }); setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Saved. I will remind you."); reload();
  };
  if (!chosen && !state) return null;
  return (
    <div className="mt-4 rounded-2xl border border-white/10 p-3.5 bento:border-black/10">
      <p className={cn("text-[15px] font-semibold", label)}>Repair</p>
      {chosen && <p className={cn("mt-0.5 text-[13px]", secondary)}>{chosen.shop} · <span className="whitespace-nowrap">{usd(chosen.amount)}</span>{chosen.distance_mi != null && <> · <span className="whitespace-nowrap">{Number(chosen.distance_mi)} mi</span></>}</p>}
      {state ? (
        <p className={cn("mt-2 flex items-start gap-1.5 text-[15px]", label)}>
          {["booked", "manual"].includes(state) ? <CalendarCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#30D158]" /> : ["requested", "calling"].includes(state) ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#FF9F0A]" />}
          <span>{BOOK[state] ?? state}{rb?.dropoff_at && <> · drop off <span className="whitespace-nowrap">{when(rb.dropoff_at)}</span></>}{rb?.pickup_at && <>, ready about <span className="whitespace-nowrap">{when(rb.pickup_at)}</span></>}</span>
        </p>
      ) : chosen && c.estimate_amount ? (
        <div className="mt-2">
          <button type="button" className={btnPrimary} disabled={busy} onClick={book}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />} Book it</button>
          <p className={cn("mt-1.5 text-[13px]", secondary)}>Ava calls {chosen.shop}, picks a drop-off when the car is free, and puts it on your calendar. Nothing is paid.</p>
        </div>
      ) : null}
      {(state === "failed" || state === "by_hand" || (!state && chosen)) && (
        <details className="mt-2"><summary className={cn("cursor-pointer text-[13px] font-medium", tertiary)}>I booked it myself</summary>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="block"><span className={cn("text-[12px]", tertiary)}>Drop-off</span><input type="datetime-local" value={manual} onChange={(e) => setManual(e.target.value)} className={cn(field, "mt-1 w-56")} /></label>
            <button type="button" className={btnTinted} disabled={busy || !manual} onClick={byHand}>Save</button>
          </div></details>
      )}
    </div>
  );
}

function Questions({ qs, reload }: { qs: Question[]; reload: () => void }) {
  const [busy, setBusy] = useState(""); const [text, setText] = useState<Record<string, string>>({});
  const open = qs.filter((q) => !q.answered_at && q.kind !== "fyi");
  if (!open.length) return null;
  const answer = async (id: string, a: string) => {
    setBusy(id); const { error } = await rpc("claims_answer", { p_id: id, p_answer: a }); setBusy("");
    if (error) { toast.error(error.message); return; }
    toast.success("Thanks. Claims Closer is on it."); reload();
  };
  return (
    <div className="mt-4 rounded-2xl border border-[#FF9F0A66] bg-[#FF9F0A14] p-3.5">
      <p className={cn("text-[15px] font-semibold", label)}>Claims Closer needs an answer</p>
      {open.map((q) => (
        <div key={q.id} className="mt-2">
          <p className={cn("text-[15px]", label)}>{q.question}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {(q.options ?? []).map((o) => <button key={o.value} type="button" className={btnTinted} disabled={busy === q.id} onClick={() => answer(q.id, o.value)}>{o.label}</button>)}
            {!(q.options ?? []).length && (<>
              <input value={text[q.id] ?? ""} onChange={(e) => setText({ ...text, [q.id]: e.target.value })} placeholder="Your answer" className={cn(field, "w-full sm:w-72")} aria-label="Your answer" />
              <button type="button" className={btnPrimary} disabled={busy === q.id || !(text[q.id] ?? "").trim()} onClick={() => answer(q.id, text[q.id])}>Send</button></>)}
          </div>
        </div>
      ))}
    </div>
  );
}

function CaseCard({ row, reload, autonomy, shops }: { row: Row; reload: () => void; autonomy: string; shops: Shop[] }) {
  const c = row.case;
  const [est, setEst] = useState(c.estimate_amount?.toString() ?? "");
  const [ins, setIns] = useState({ name: c.insurer?.name ?? "", policy: c.insurer?.policy_no ?? c.insurer?.policy ?? "", claim_no: c.insurer?.claim_no ?? "" });
  const [busy, setBusy] = useState("");
  const pending = row.drafts.filter((d) => d.status === "pending");
  const outgoing = row.drafts.filter((d) => ["approved", "sending", "failed"].includes(d.status));
  const sent = row.drafts.filter((d) => d.status === "sent");
  const invoice = row.turo_actions.find((a) => a.kind === "create_invoice" && !a.payload?.dry_run);
  const save = async (what: string, args: object) => {
    setBusy(what);
    const { error } = await rpc("claims_case_update", { p_id: c.id, ...args });
    setBusy("");
    if (error) { toast.error(error.message); return; }
    toast.success(what === "redraft" ? "Asked for a new draft" : "Saved");
    reload();
  };
  const daysLeft = c.escalate_by ? Math.ceil((Date.parse(c.escalate_by) - Date.now()) / 864e5) : null;
  return (
    <section className={card}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("text-[17px] font-semibold", label)}>{[c.guest_first, c.guest_last].filter(Boolean).join(" ") || "Guest"}</p>
          <p className={cn("text-[13px]", secondary)}>{c.turo_claim_no ? <>Turo claim <span className="whitespace-nowrap">{c.turo_claim_no}</span> · </> : null}Reservation {c.reservation_id} · <span className="whitespace-nowrap">{STATUS[c.status] ?? c.status}</span></p>
        </div>
        {daysLeft !== null && !["paid", "closed", "escalated"].includes(c.status) && (
          <span className={cn("shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium",
            daysLeft <= 4 ? "bg-[#FF9F0A26] text-[#FF9F0A]" : "bg-white/10 text-white/80 bento:bg-black/5 bento:text-black/70")}>{daysLeft} days to escalate</span>
        )}
      </div>

      {c.turo_next_action && (
        <p className={cn("mt-3 rounded-xl bg-white/5 px-3 py-2 text-[13px] bento:bg-black/5", secondary)}>
          Turo says: <span className={cn("font-medium", label)}>{c.turo_next_action}</span>{c.turo_deadline && <> · deadline <span className="whitespace-nowrap">{when(c.turo_deadline)}</span></>}
          {c.synced_at && <span className={tertiary}> · read <span className="whitespace-nowrap">{when(c.synced_at)}</span></span>}
        </p>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
        <div><dt className={tertiary}>Estimate due to guest</dt><dd className={cn("whitespace-nowrap", label)}>{when(c.estimate_due_at)}</dd></div>
        <div><dt className={tertiary}>Escalate to Turo by</dt><dd className={cn("whitespace-nowrap", label)}>{when(c.escalate_by)}</dd></div>
        <div><dt className={tertiary}>Chosen estimate</dt><dd className={cn("whitespace-nowrap", label)}>{usd(c.estimate_amount)}</dd></div>
        <div><dt className={tertiary}>Turo invoice cap</dt><dd className={cn("whitespace-nowrap", label)}>{usd(c.invoice_max ?? c.guest_max)}</dd></div>
        {c.host_responsibility != null && <div className="col-span-2"><dt className={tertiary}>Your damage responsibility if Turo takes over</dt><dd className={cn("whitespace-nowrap", label)}>{usd(c.host_responsibility)}</dd></div>}
        {invoice && <div className="col-span-2"><dt className={tertiary}>Turo invoice</dt><dd className={label}><span className="whitespace-nowrap">{usd(invoice.payload?.amount)}</span> · {invoice.status === "done" ? "posted" : invoice.status === "failed" ? `failed: ${invoice.error ?? "unknown"}` : "going up on the Pi"}</dd></div>}
        {c.invoices?.map((i, k) => (
          <div key={k} className="col-span-2"><dt className={tertiary}>Turo invoice</dt>
            <dd className={label}><span className="whitespace-nowrap">{usd(i.amount)}</span> · {i.paid ? "paid" : <>due <span className="whitespace-nowrap">{i.due_text ?? "—"}</span></>}</dd></div>
        ))}
      </dl>

      <Questions qs={row.questions} reload={reload} />
      <Booking row={row} reload={reload} />
      <Estimates row={row} shops={shops} reload={reload} />
      <Evidence c={c} items={row.evidence} />

      {pending.map((d) => <DraftCard key={d.id} d={d} onDone={reload} />)}
      {outgoing.map((d) => (
        <p key={d.id} className={cn("mt-3 flex items-start gap-1.5 text-[13px]", d.status === "failed" ? "text-[#FF453A] bento:text-[#FF3B30]" : secondary)}>
          {d.status === "failed" ? <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> : <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />}
          {d.status === "failed" ? `Send failed: ${d.last_error ?? "unknown"}. It retries on its own.` : "A message is going out to the guest."}
        </p>
      ))}
      {!pending.length && !outgoing.length && !["paid", "closed"].includes(c.status) && (
        <p className={cn("mt-3 text-[13px]", secondary)}>{autonomy === "full" ? "Nothing waiting on you." : "Nothing to approve right now."} Claims Closer writes to {c.guest_first ?? "the guest"} on its own when they reply or a follow-up is due.</p>
      )}

      {sent.length > 0 && (
        <details className="mt-4">
          <summary className={cn("cursor-pointer text-[15px] font-medium", label)}>Messages sent ({sent.length})</summary>
          <ul className="mt-2 divide-y divide-white/[0.06] bento:divide-neutral-100">
            {sent.map((d) => (
              <li key={d.id} className="py-2"><p className={cn("text-[12px]", tertiary)}>{KIND[d.kind] ?? "Message"} · <span className="whitespace-nowrap">{when(d.sent_at)}</span>{d.verified ? " · confirmed in Turo" : ""}</p>
                <p className={cn("whitespace-pre-wrap text-[13px]", secondary)}>{d.body}</p></li>
            ))}
          </ul>
        </details>
      )}

      <details className="mt-4">
        <summary className={cn("cursor-pointer text-[15px] font-medium", label)}>Case details</summary>
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="block"><span className={cn("text-[12px]", tertiary)}>Estimate override ($)</span>
              <input inputMode="decimal" value={est} onChange={(e) => setEst(e.target.value.replace(/[^0-9.]/g, ""))} className={cn(field, "mt-1 w-36")} /></label>
            <button type="button" className={btnTinted} disabled={!est || busy === "est"} onClick={() => save("est", { p_estimate: Number(est) })}>{busy === "est" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save estimate"}</button>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {(["name", "policy", "claim_no"] as const).map((k) => (
              <label key={k} className="block"><span className={cn("text-[12px]", tertiary)}>{k === "name" ? "Guest's insurer" : k === "policy" ? "Policy number" : "Insurance claim number"}</span>
                <input value={ins[k]} onChange={(e) => setIns({ ...ins, [k]: e.target.value })} className={cn(field, "mt-1 w-full")} /></label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnTinted} disabled={busy === "ins"} onClick={() => save("ins", { p_insurer: { name: ins.name, policy_no: ins.policy, claim_no: ins.claim_no }, p_status: ins.name ? "insurance" : null })}>Save insurer</button>
            <button type="button" className={btnTinted} disabled={busy === "redraft"} onClick={() => save("redraft", { p_redraft: true })}><RefreshCw className="h-4 w-4" /> New draft</button>
            {c.status !== "paid" && <button type="button" className={btnPlain} onClick={() => save("paid", { p_status: "paid" })}>Mark paid</button>}
            {c.status !== "closed" && <button type="button" className={btnDestructivePlain} onClick={() => save("closed", { p_status: "closed" })}>Close case</button>}
          </div>
          <ul className="divide-y divide-white/[0.06] bento:divide-neutral-100">
            {row.events.map((e) => (
              <li key={e.id} className="py-2 text-[13px]">
                <span className={label}>{e.title ?? e.kind}</span> <span className={cn("whitespace-nowrap", tertiary)}>{when(e.at)}</span>
                {typeof e.detail?.body === "string" && <p className={cn("mt-0.5 whitespace-pre-wrap", secondary)}>{e.detail.body as string}</p>}
              </li>
            ))}
          </ul>
        </div>
      </details>
    </section>
  );
}

function HistoryCard({ c }: { c: Case }) {
  const won = c.status === "paid";
  return (
    <details className="group border-b border-white/[0.06] py-3 last:border-0 bento:border-neutral-100">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("text-[15px] font-medium", label)}>{[c.guest_first, c.guest_last].filter(Boolean).join(" ") || "Guest"}</p>
          <p className={cn("text-[13px]", secondary)}><span className="whitespace-nowrap">{day(c.opened_at)}</span> · {c.car ?? "—"}{c.turo_claim_no ? <> · claim <span className="whitespace-nowrap">{c.turo_claim_no}</span></> : null}</p>
        </div>
        <span className={cn("shrink-0 whitespace-nowrap text-[15px] font-semibold", won ? "text-[#30D158] bento:text-[#248A3D]" : tertiary)}>
          {won ? (c.recovered_amount != null ? usd(c.recovered_amount) : "Settled") : "Not pursued"}
        </span>
      </summary>
      <div className={cn("mt-2 space-y-1.5 text-[13px]", secondary)}>
        {c.outcome && <p>{c.outcome}</p>}
        {c.facts && <p>{c.facts}</p>}
        <p className={tertiary}>Reservation {c.reservation_id}{c.host_responsibility != null ? <> · your damage responsibility <span className="whitespace-nowrap">{usd(c.host_responsibility)}</span></> : null}</p>
      </div>
    </details>
  );
}

export default function ClaimsCloser() {
  const [data, setData] = useState<Data | null>(null);
  const load = useCallback(async () => {
    const { data: d, error } = await rpc<Data>("claims_admin");
    if (error) { toast.error(error.message); return; }
    setData(d);
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 30000); return () => clearInterval(t); }, [load]);
  const toggle = async () => {
    const on = !data?.sender?.claims_enabled;
    const { error } = await rpc("claims_sender_set", { p_on: on });
    if (error) toast.error(error.message); else { toast.success(on ? "Claim messages can go out" : "Claim messages paused"); void load(); }
  };
  const open = data?.cases.filter((r) => !["paid", "closed"].includes(r.case.status)) ?? [];
  const byDate = (a: Row, b: Row) => Date.parse(b.case.opened_at) - Date.parse(a.case.opened_at);
  const won = (data?.cases.filter((r) => r.case.status === "paid") ?? []).sort(byDate);
  const dropped = (data?.cases.filter((r) => r.case.status === "closed") ?? []).sort(byDate);
  const wonTotal = won.reduce((n, r) => n + Number(r.case.recovered_amount ?? 0), 0);
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 pb-16 sm:px-0">
      <PageHeader title="Claims" description="Claims Closer handles each Turo damage claim: reads the evidence, asks shops for estimates, posts the Turo invoice and writes to the guest. You only tap Book it." />
      {!data ? <Loader2 className="h-5 w-5 animate-spin text-white/50" /> : (
        <>
          <div className={cn(card, "flex flex-wrap items-center justify-between gap-2 py-3")}>
            <p className={cn("text-[13px]", secondary)}>
              {data.sender?.claims_enabled ? "Approved messages send through the Link Sender" : "Claim messages are paused"}
              {data.sender?.last_error ? ` · Sender: ${data.sender.last_error}` : ""}
              {data.beat ? <> · Last check <span className="whitespace-nowrap">{when(data.beat.at)}</span>{data.beat.ok ? "" : " (problem)"}</> : ""}
            </p>
            <button type="button" className={btnPlain} onClick={toggle}>{data.sender?.claims_enabled ? "Pause sending" : "Turn sending on"}</button>
          </div>
          <div className={cn(card, "flex flex-wrap items-center justify-between gap-2 py-3")}>
            <p className={cn("text-[13px]", secondary)}>
              {data.settings?.autonomy === "guest_approval" ? "Ask me first: guest messages wait for your OK." : "Hands-off: guest messages, shop requests and the Turo invoice go out on their own."}
              {data.reader ? <> · Turo reader {data.reader.signed_in ? "signed in" : "signed out"}{data.reader.version ? <> <span className="whitespace-nowrap">v{data.reader.version}</span></> : null}</> : null}
            </p>
            <button type="button" className={btnPlain} onClick={async () => {
              const next = data.settings?.autonomy === "guest_approval" ? "full" : "guest_approval";
              const { error } = await rpc("claims_settings_set", { p_autonomy: next });
              if (error) toast.error(error.message); else { toast.success(next === "full" ? "Hands-off" : "Guest messages will wait for your OK"); void load(); }
            }}>{data.settings?.autonomy === "guest_approval" ? "Go hands-off" : "Ask me first"}</button>
          </div>
          {!open.length && <p className={cn("px-1 text-[15px]", secondary)}>No open claims. A case opens on its own when Turo emails that a claim started.</p>}
          {open.map((r) => <CaseCard key={r.case.id} row={r} reload={load} autonomy={data.settings?.autonomy ?? "full"} shops={data.shops ?? []} />)}
          {won.length > 0 && (
            <section className={card}>
              <div className="flex items-baseline justify-between gap-3">
                <p className={cn("text-[17px] font-semibold", label)}>Won</p>
                <p className={cn("text-[13px]", secondary)}><span className="whitespace-nowrap">{usd(wonTotal)}</span> recovered{won.some((r) => r.case.recovered_amount == null) ? " + total-loss settlement" : ""}</p>
              </div>
              <div className="mt-1">{won.map((r) => <HistoryCard key={r.case.id} c={r.case} />)}</div>
            </section>
          )}
          {dropped.length > 0 && (
            <details className={card}>
              <summary className={cn("cursor-pointer text-[15px] font-medium", label)}>Not followed through ({dropped.length})</summary>
              <div className="mt-1">{dropped.map((r) => <HistoryCard key={r.case.id} c={r.case} />)}</div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
