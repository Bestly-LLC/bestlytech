/**
 * /admin/claims: Claims Closer (team slug claims-closer). Migration 20261005040000_claims_closer.sql, edge fn claims-closer.
 * Every message to a guest waits here for Jared: Approve & send (as written or edited), or Reject.
 * Approved messages go out through the Link Sender on the Mac mini (claims-only mode).
 * Also: add the body shop estimate / insurer details, ask for a new draft, close a case.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, CircleAlert, Copy, Loader2, RefreshCw, Send, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/admin/PageHeader";
import { btnPlain, btnPrimary, btnTinted, btnDestructivePlain, card, field, label, secondary, tertiary } from "./laxUi";

type Draft = { id: string; kind: string; body: string; reason: string | null; status: string; created_at: string; sent_at: string | null; last_error: string | null; verified: boolean | null };
type Ev = { id: number; at: string; kind: string; title: string | null; detail: Record<string, unknown> | null };
type Case = { id: string; reservation_id: number; guest_first: string | null; guest_last: string | null; status: string; path: string; opened_at: string;
  estimate_due_at: string | null; escalate_by: string | null; estimate_amount: number | null; guest_max: number | null; facts: string | null;
  insurer: Record<string, string>; invoices: { amount: number | null; due_text: string | null; paid: boolean }[]; trip_end: string | null };
type Row = { case: Case; drafts: Draft[]; events: Ev[] };
type Data = { sender: { claims_enabled: boolean; links_enabled: boolean; seen_at: string | null; last_error: string | null } | null;
  beat: { at: string; ok: boolean; summary: string | null } | null; cases: Row[] };

const rpc = <T,>(fn: string, args?: object) => supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: T | null; error: { message: string } | null }>;
const when = (iso?: string | null) => iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }) : "—";
const usd = (n?: number | null) => n == null ? "—" : `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const KIND: Record<string, string> = { reply: "Reply", follow_up: "Follow-up", insurance_ask: "Insurance ask", estimate: "Estimate", escalation: "Escalation note", other: "Message" };
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

function CaseCard({ row, reload }: { row: Row; reload: () => void }) {
  const c = row.case;
  const [est, setEst] = useState(c.estimate_amount?.toString() ?? "");
  const [ins, setIns] = useState({ name: c.insurer?.name ?? "", policy: c.insurer?.policy ?? "", claim_no: c.insurer?.claim_no ?? "" });
  const [busy, setBusy] = useState("");
  const pending = row.drafts.filter((d) => d.status === "pending");
  const outgoing = row.drafts.filter((d) => ["approved", "sending", "failed"].includes(d.status));
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
          <p className={cn("text-[13px]", secondary)}>Reservation {c.reservation_id} · <span className="whitespace-nowrap">{STATUS[c.status] ?? c.status}</span></p>
        </div>
        {daysLeft !== null && !["paid", "closed", "escalated"].includes(c.status) && (
          <span className={cn("shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium",
            daysLeft <= 4 ? "bg-[#FF9F0A26] text-[#FF9F0A]" : "bg-white/10 text-white/80 bento:bg-black/5 bento:text-black/70")}>{daysLeft} days to escalate</span>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
        <div><dt className={tertiary}>Estimate due to guest</dt><dd className={cn("whitespace-nowrap", label)}>{when(c.estimate_due_at)}</dd></div>
        <div><dt className={tertiary}>Escalate to Turo by</dt><dd className={cn("whitespace-nowrap", label)}>{when(c.escalate_by)}</dd></div>
        <div><dt className={tertiary}>Estimate</dt><dd className={cn("whitespace-nowrap", label)}>{usd(c.estimate_amount)}</dd></div>
        <div><dt className={tertiary}>Guest plan max</dt><dd className={cn("whitespace-nowrap", label)}>{usd(c.guest_max)}</dd></div>
        {c.invoices?.map((i, k) => (
          <div key={k} className="col-span-2"><dt className={tertiary}>Turo invoice</dt>
            <dd className={label}><span className="whitespace-nowrap">{usd(i.amount)}</span> · {i.paid ? "paid" : <>due <span className="whitespace-nowrap">{i.due_text ?? "—"}</span></>}</dd></div>
        ))}
      </dl>

      {pending.map((d) => <DraftCard key={d.id} d={d} onDone={reload} />)}
      {outgoing.map((d) => (
        <p key={d.id} className={cn("mt-3 flex items-start gap-1.5 text-[13px]", d.status === "failed" ? "text-[#FF453A] bento:text-[#FF3B30]" : secondary)}>
          {d.status === "failed" ? <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> : <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />}
          {d.status === "failed" ? `Send failed: ${d.last_error ?? "unknown"}. It retries on its own.` : "Approved message is going out through the Link Sender."}
        </p>
      ))}
      {!pending.length && !outgoing.length && !["paid", "closed"].includes(c.status) && (
        <p className={cn("mt-3 text-[13px]", secondary)}>Nothing waiting on you. Claims Closer drafts the next message when {c.guest_first ?? "the guest"} replies or a follow-up is due.</p>
      )}

      <details className="mt-4">
        <summary className={cn("cursor-pointer text-[15px] font-medium", label)}>Case details</summary>
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="block"><span className={cn("text-[12px]", tertiary)}>Body shop estimate ($)</span>
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
            <button type="button" className={btnTinted} disabled={busy === "ins"} onClick={() => save("ins", { p_insurer: ins, p_status: ins.name ? "insurance" : null })}>Save insurer</button>
            <button type="button" className={btnTinted} disabled={busy === "redraft"} onClick={() => save("redraft", { p_redraft: true })}><RefreshCw className="h-4 w-4" /> New draft</button>
            {c.status !== "paid" && <button type="button" className={btnPlain} onClick={() => save("paid", { p_status: "paid" })}>Mark paid</button>}
            {c.status !== "closed" && <button type="button" className={btnDestructivePlain} onClick={() => save("closed", { p_status: "closed" })}>Close case</button>}
          </div>
          <ul className="divide-y divide-white/[0.06] bento:divide-neutral-100">
            {row.events.map((e) => (
              <li key={e.id} className="py-2 text-[13px]">
                <span className={label}>{e.title ?? e.kind}</span> <span className={cn("whitespace-nowrap", tertiary)}>{when(e.at)}</span>
                {typeof e.detail?.body === "string" && <p className={cn("mt-0.5 line-clamp-3", secondary)}>{e.detail.body as string}</p>}
              </li>
            ))}
          </ul>
        </div>
      </details>
    </section>
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
  const done = data?.cases.filter((r) => ["paid", "closed"].includes(r.case.status)) ?? [];
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 pb-16 sm:px-0">
      <PageHeader title="Claims" description="Claims Closer watches each Turo damage claim, drafts every message to the guest, and waits for your OK before anything is sent." />
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
          {!open.length && <p className={cn("px-1 text-[15px]", secondary)}>No open claims. A case opens on its own when Turo emails that a claim started.</p>}
          {open.map((r) => <CaseCard key={r.case.id} row={r} reload={load} />)}
          {done.length > 0 && (
            <details className="px-1"><summary className={cn("cursor-pointer text-[15px]", secondary)}>Closed ({done.length})</summary>
              <div className="mt-3 space-y-4">{done.map((r) => <CaseCard key={r.case.id} row={r} reload={load} />)}</div></details>
          )}
        </>
      )}
    </div>
  );
}
