/**
 * Hermes (Mail Clerk) on his Team card (2026-10-19, Jared). No page of its own: this block sits inside the card's detail sheet.
 *
 * Shows what he filed from the iPostal1 Mailroom, the asks waiting for a tap (the same ones in Needs you), his sign-ins at
 * iPostal1 (every one is logged), and the health of the guard that keeps those emails out of the inbox. Read-only except the
 * Approve / Not now buttons and "Open and scan", each of which is a tap by Jared.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Loader2, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { card, label, secondary, tertiary, tint, btnTinted } from "./laxUi";
import { Lines } from "@/components/Lines";
import { HERMES_DECIDED, HermesAskButtons } from "@/components/admin/HermesAsk";

const db = supabase as unknown as {
  from: (t: string) => {
    select: (c: string) => { order: (c: string, o: object) => { limit: (n: number) => Promise<{ data: unknown[] | null; error: unknown }> } };
  };
  rpc: (fn: string, args?: object) => Promise<{ data: unknown; error: { message: string } | null }>;
};

interface State { enabled: boolean; cred_state: string; guard_beat_at: string | null; last_poll_at: string | null; guard_moved_run: number }
interface Item { id: string; received_at: string; label: string | null; sender: string | null; mail_type: string | null; event: string; summary: string | null; amount_cents: number | null; due_date: string | null; status: string; is_test: boolean; verified: boolean; subject: string | null }
interface Ask { id: string; action: string; reason: string | null; status: string; proposed_at: string; item: { sender: string | null; mail_type: string | null; is_test: boolean } | null }
interface Login { id: number; at: string; purpose: string; ok: boolean; egress_ip: string | null; note: string | null }

const clock = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }) : "never";
const At = ({ iso }: { iso: string | null | undefined }) => <span className="whitespace-nowrap">{clock(iso)}</span>;
const money = (c: number) => <span className="whitespace-nowrap">${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
const AGE = (iso: string | null) => (iso ? (Date.now() - Date.parse(iso)) / 60000 : Infinity);

const ACTION_WORD: Record<string, string> = { scan: "Open and scan", deposit_check: "Deposit the check", package: "Handle the package", shred: "Shred", forward: "Forward", recycle: "Recycle" };

export function HermesPanel({ focusAsk }: { focusAsk?: string | null }) {
  const [state, setState] = useState<State | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [asks, setAsks] = useState<Ask[]>([]);
  const [logins, setLogins] = useState<Login[]>([]);
  const [busyItem, setBusyItem] = useState<string | null>(null);

  const load = useCallback(async () => {
    const st = await (supabase as unknown as { from: (t: string) => { select: (c: string) => { eq: (c: string, v: boolean) => { maybeSingle: () => Promise<{ data: unknown }> } } } })
      .from("hermes_state").select("*").eq("id", true).maybeSingle();
    setState((st.data as State | null) ?? null);
    const it = await db.from("hermes_items").select("id,received_at,label,sender,mail_type,event,summary,amount_cents,due_date,status,is_test,verified,subject").order("received_at", { ascending: false }).limit(12);
    setItems((it.data ?? []) as Item[]);
    const ak = await db.from("hermes_actions").select("id,action,reason,status,proposed_at,item:hermes_items(sender,mail_type,is_test)").order("proposed_at", { ascending: false }).limit(20);
    setAsks(((ak.data ?? []) as Ask[]).filter((a) => a.status === "proposed"));
    const lg = await db.from("hermes_logins").select("id,at,purpose,ok,egress_ip,note").order("at", { ascending: false }).limit(4);
    setLogins((lg.data ?? []) as Login[]);
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(load, 60_000);
    window.addEventListener(HERMES_DECIDED, load);
    return () => { window.clearInterval(t); window.removeEventListener(HERMES_DECIDED, load); };
  }, [load]);

  async function requestScan(item: Item) {
    setBusyItem(item.id);
    const { error } = await db.rpc("hermes_action_request", { p_item: item.id, p_action: "scan" });
    setBusyItem(null);
    if (error) { toast.error(error.message || "Couldn't ask for that"); return; }
    toast.success("Approved. Hermes opens and scans it on its next pass, within 5 minutes. iPostal1 may charge for it.");
    await load();
  }

  if (!state) return null;
  const guardAge = AGE(state.guard_beat_at);
  const guardOk = guardAge < 10;
  const loginWord = ({ missing: "Not saved yet", saved: "Saved, being checked", working: "Working", rejected: "Refused by iPostal1", trouble: "Trouble signing in" } as Record<string, string>)[state.cred_state] ?? state.cred_state;

  return (
    <div className="space-y-4">
      <dl className="divide-y divide-[#38383A] rounded-[14px] bg-[#2C2C2E] px-4 text-[15px] bento:divide-[#C6C6C8] bento:bg-[#fff]">
        <HRow k="Mail guard" v={<span className={guardOk ? undefined : tint.orange}>{state.guard_beat_at ? (guardOk ? <>Watching, checked in <At iso={state.guard_beat_at} /></> : <>Quiet since <At iso={state.guard_beat_at} /></>) : "Not started yet"}</span>} />
        <HRow k="Last Mailroom pass" v={<At iso={state.last_poll_at} />} />
        <HRow k="iPostal1 login" v={
          state.cred_state === "missing" || state.cred_state === "rejected"
            ? <Link to="/admin/security#ipostal1" className={cn("inline-flex items-center gap-1", tint.blue)}>{loginWord}. Add it <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /></Link>
            : loginWord} />
      </dl>

      {asks.length > 0 && (
        <div className="space-y-2">
          <h4 className={cn("px-1 text-[13px] font-semibold uppercase tracking-[0.02em]", secondary)}>Waiting for your tap</h4>
          <ul className="space-y-2">
            {asks.map((a) => (
              <li key={a.id} className={cn("space-y-2 rounded-[14px] bg-[#2C2C2E] px-4 py-3 bento:bg-[#fff]", focusAsk === a.id && "ring-2 ring-[#0A84FF]")}>
                <p className={cn("text-[15px] font-medium", label)}>{ACTION_WORD[a.action] ?? a.action}{a.item?.sender ? <>, {a.item.sender}</> : null}</p>
                <p className={cn("text-[13px] leading-snug", secondary)}><Lines>{(a.reason ?? "") + ". iPostal1 may charge for this. Nothing happens until you tap Approve."}</Lines></p>
                {state.cred_state === "missing" || state.cred_state === "rejected"
                  ? <p className={cn("text-[13px]", tint.orange)}>Add the iPostal1 login first, then this can be approved.</p>
                  : <HermesAskButtons id={a.id} />}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        <h4 className={cn("px-1 text-[13px] font-semibold uppercase tracking-[0.02em]", secondary)}>Filed from the Mailroom</h4>
        {items.length === 0 ? (
          <p className={cn("px-1 text-[13px]", tertiary)}><Lines>Nothing yet. The next iPostal1 alert that lands is filed here within 5 minutes.</Lines></p>
        ) : (
          <ul className={cn(card, "divide-y divide-[#38383A] !p-0 bento:divide-[#E5E5EA]")}>
            {items.map((i) => (
              <li key={i.id} className="space-y-1 px-4 py-3">
                <p className={cn("text-[15px] font-medium", label)}>
                  {i.verified ? (i.label ?? i.subject ?? "iPostal1 notice") : "Blocked: not really from iPostal1"}
                  {i.is_test && <span className={cn("ml-2 text-[12px] font-semibold", tint.orange)}>TEST</span>}
                </p>
                <p className={cn("text-[13px] leading-snug", secondary)}>
                  <At iso={i.received_at} />
                  {i.amount_cents != null && <> · {money(i.amount_cents)}</>}
                  {i.due_date && <> · due <span className="whitespace-nowrap">{new Date(i.due_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span></>}
                </p>
                {i.summary && <p className={cn("text-[13px] leading-snug", tertiary)}><Lines>{i.summary}</Lines></p>}
                {i.verified && !i.is_test && i.status === "filed" && i.mail_type && i.mail_type !== "junk" && state.cred_state !== "missing" && state.cred_state !== "rejected" && (
                  <button type="button" disabled={busyItem === i.id} onClick={() => requestScan(i)} className={cn(btnTinted, "!min-h-[36px] !px-3 text-[13px]")}>
                    {busyItem === i.id ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <ScanLine className="h-4 w-4" aria-hidden />}
                    Open and scan
                  </button>
                )}
                {i.status === "acted" && <p className={cn("text-[13px]", tint.green)}>Done</p>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {logins.length > 0 && (
        <div className="space-y-2">
          <h4 className={cn("px-1 text-[13px] font-semibold uppercase tracking-[0.02em]", secondary)}>Sign-ins to iPostal1</h4>
          <ul className="space-y-1.5">
            {logins.map((l) => (
              <li key={l.id} className={cn("flex flex-wrap items-baseline justify-between gap-x-3 rounded-[12px] bg-[#2C2C2E] px-4 py-2 text-[13px] bento:bg-[#fff]", secondary)}>
                <span className={label}><At iso={l.at} /> · {l.purpose === "action" ? "approved step" : "checking the mailbox"}</span>
                <span className={l.ok ? tint.green : tint.orange}>{l.ok ? "Signed in" : (l.note || "Did not sign in")}{l.egress_ip ? <> · <span className="whitespace-nowrap">{l.egress_ip}</span></> : null}</span>
              </li>
            ))}
          </ul>
          <p className={cn("px-1 text-[12px]", tertiary)}><Lines>Every sign-in Hermes makes is logged here. Ares raises an alert if iPostal1 reports a sign-in that Hermes didn&rsquo;t make.</Lines></p>
        </div>
      )}
    </div>
  );
}

function HRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5">
      <dt className={secondary}>{k}</dt>
      <dd className={cn("text-right", label)}>{v}</dd>
    </div>
  );
}
