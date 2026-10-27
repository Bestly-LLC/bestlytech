/**
 * Vera's case panel on a privacy ticket in /admin/maya. Reads admin_privacy_case(code); every change goes through the
 * admin_privacy_* RPCs. It never shows the person's email or phone (the ticket card above already does).
 * Times are 12-hour Pacific, a number never splits from its unit, nothing is truncated.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { rpcArgs } from "@/components/admin/roofguard/AvaShared";
import { whenWords } from "./mayaFormat";

const NB = " ";
const press = "motion-safe:transition-transform motion-safe:duration-100 motion-safe:active:scale-[0.97]";
const btn = cn("inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-50", press);
const btnPrimary = cn(btn, "bg-white text-black hover:bg-white/90");
const btnQuiet = cn(btn, "bg-white/[0.07] text-white ring-1 ring-white/10 hover:bg-white/[0.12]");

type Item = { table: string; column: string; action: "delete" | "blank" | "keep" | "review"; reason: string | null; count: number };
type Tab = { table: string; action: "delete" | "blank" | "keep" | "review"; rows: number };
type Scan = { owner?: boolean; items?: Item[]; tables?: Tab[]; total?: number; places?: number; keep_places?: number; review_places?: number; blast?: { table: string; rows: number }[] };
type Case = {
  status: "awaiting_verification" | "no_email" | "verified" | "ready" | "approved" | "done" | "could_not_verify" | "needs_jared" | "cancelled";
  action: "delete" | "export" | "correct" | "opt_out" | null;
  has_email: boolean; has_phone: boolean;
  created_at: string; verify_sent_at: string | null; reminded_at: string | null; verified_at: string | null; scanned_at: string | null;
  approved_at: string | null; executed_at: string | null; done_at: string | null;
  scan: Scan | null; review_ticked: string[] | null; note: string | null; result: { places?: number; deleted?: number; blanked?: number } | null;
  export_ready: boolean; redacted: boolean; last_error: string | null; auto_approved?: boolean;
};

const NAMES: Record<string, string> = {
  mail_contacts: "Mail contacts", cloud_leads: "Cloud leads", cloud_deals: "Cloud deals", cloud_shield_requests: "Shield requests",
  contact_submissions: "Contact form messages", device_registrations: "Registered devices", email_send_log: "Email send log",
  email_unsubscribe_tokens: "Unsubscribe links", hire_requests: "Hire requests", hoku_orders: "Hoku orders", lax_guest_links: "LAX guest links",
  notify_outbox: "Outgoing notifications", partners: "Partners", seller_intakes: "Seller intakes", shield_url_reports: "Shield URL reports",
  shop_orders: "Shop orders", shop_abandoned_checkouts: "Abandoned checkouts", shop_notifications: "Shop notifications", spam_claims: "Spam claims",
  spam_report_targets: "Spam report targets", subscriptions: "Subscriptions", support_tickets: "Support tickets", suppressed_emails: "Do-not-email list",
  turo_trips: "Turo trips", waitlist_subscribers: "Waitlist", webhook_events: "Webhook events", claim_shops: "Claimed shops",
  client_people: "Client contacts", approval_clients: "Approval clients", granted_access: "Granted access", guest_entry_attempts: "Guest entry attempts",
  activation_codes: "Activation codes", activation_code_attempts: "Activation attempts", webauthn_challenges: "Sign-in challenges",
};
export const placeName = (t: string): string =>
  NAMES[t] ?? (t.startsWith("ava_") ? "Ava call logs" : t.startsWith("rg_") ? "RoofGuard (Reese)" : t.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()));
const records = (n: number) => `${n}${NB}${n === 1 ? "record" : "records"}`;
const places = (n: number) => `${n}${NB}${n === 1 ? "place" : "places"}`;
const errText = (e: unknown) => (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "Something went wrong.");

const STEPS = ["Link sent", "Confirmed", "Found", "Approved", "Done"] as const;
function stepState(c: Case): { at: (string | null)[]; current: number } {
  const at = [c.verify_sent_at, c.verified_at, c.scanned_at, c.approved_at, c.done_at];
  let current = -1;
  at.forEach((v, i) => { if (v) current = i; });
  return { at, current };
}

type Mode = null | "approve" | "verify" | "cancel";

export function PrivacyCasePanel({ code, onChanged }: { code: string; onChanged?: () => void }) {
  const [c, setC] = useState<Case | null | undefined>(undefined);
  const [loadErr, setLoadErr] = useState(false);
  const [mode, setMode] = useState<Mode>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [auto, setAuto] = useState<boolean | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await rpcArgs<Case | null>("admin_privacy_case", { p_code: code });
    if (error) { setLoadErr(true); return; }
    setLoadErr(false); setC(data ?? null);
    const a = await rpcArgs<{ auto: boolean }>("admin_privacy_auto", {});
    if (!a.error && a.data) setAuto(a.data.auto === true);
  }, [code]);

  async function flipAuto() {
    if (auto === null) return;
    setAutoBusy(true); setErr(null);
    const { error } = await rpcArgs("admin_privacy_set_auto", { p_on: !auto });
    setAutoBusy(false);
    if (error) { setErr(errText(error)); return; }
    setAuto(!auto);
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 30000);
    return () => clearInterval(t);
  }, [load]);

  async function run(fn: string, args: Record<string, unknown>) {
    setBusy(true); setErr(null);
    const { error } = await rpcArgs(fn, args);
    setBusy(false);
    if (error) { setErr(errText(error)); return; }
    setMode(null); setNote("");
    await load(); onChanged?.();
  }

  if (c === undefined && !loadErr) return <div className="mt-3 h-16 rounded-xl bg-white/[0.04] motion-safe:animate-pulse" aria-hidden />;
  if (loadErr && c === undefined) return <p className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2 text-[14px] text-amber-100 ring-1 ring-amber-500/30" role="alert">Couldn't load Vera's case. It will try again in a minute.</p>;
  if (c === null || c === undefined) return <p className="mt-3 rounded-xl bg-white/[0.05] px-3 py-2 text-[14px] text-white/70">Vera hasn't opened a case yet. She checks every 10{NB}minutes.</p>;

  const { at, current } = stepState(c);
  const scan = c.scan ?? {};
  const tabs = scan.tables ?? [];
  const items = scan.items ?? [];
  const del = tabs.filter((t) => t.action === "delete");
  const blank = tabs.filter((t) => t.action === "blank");
  const keep = tabs.filter((t) => t.action === "keep");
  const reviewItems = items.filter((i) => i.action === "review");
  const reasonOf = (table: string) => Array.from(new Set(items.filter((i) => i.table === table && i.action === "keep" && i.reason).map((i) => i.reason as string))).join("; ");
  const blast = scan.blast ?? [];
  const isExport = c.action === "export";
  const canAct = c.status === "ready" && (c.action === "delete" || c.action === "export");
  const tickedCount = reviewItems.filter((i) => ticked.has(`${i.table}.${i.column}`)).reduce((s, i) => s + i.count, 0);
  const finished = c.status === "done" || c.status === "cancelled";

  const toggle = (k: string) => setTicked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const group = (title: string, rows: Tab[], tone: string, showReason = false) => rows.length > 0 && (
    <div>
      <h4 className={cn("text-[12px] font-semibold uppercase tracking-wide", tone)}>{title}</h4>
      <ul className="mt-1 space-y-1">
        {rows.map((r) => (
          <li key={r.table} className="text-[14px] text-white/90">
            <span className="font-medium">{placeName(r.table)}</span>
            <span className="text-white/60">{`, ${records(r.rows)}`}</span>
            {showReason && reasonOf(r.table) && <span className="block text-[13px] text-white/60">{reasonOf(r.table)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <section className="mt-3 rounded-xl bg-violet-500/[0.07] p-3 ring-1 ring-violet-400/20" aria-label={`Privacy case for ${code}`}>
      <h3 className="flex items-center gap-2 text-[14px] font-semibold text-violet-100"><ShieldCheck className="h-4 w-4" aria-hidden />Privacy case</h3>

      {auto !== null && (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-white/[0.05] px-3 py-2 ring-1 ring-white/10">
          <div className="min-w-0">
            <p className="text-[14px] font-medium text-white">Delete on her own</p>
            <p className="text-[13px] leading-snug text-white/70">{auto ? "On. Once someone confirms by email, Vera does the request and tells you after." : "Off. Vera waits for your tap on each request."}</p>
          </div>
          <button type="button" role="switch" aria-checked={auto} aria-label="Delete on her own" disabled={autoBusy} onClick={() => void flipAuto()}
            className={cn("relative inline-flex h-[44px] w-[64px] shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-50", press)}>
            <span className={cn("block h-[30px] w-[52px] rounded-full ring-1 ring-white/15 motion-safe:transition-colors motion-safe:duration-200", auto ? "bg-emerald-400/80" : "bg-white/15")} />
            <span className={cn("absolute top-1/2 h-[26px] w-[26px] -translate-y-1/2 rounded-full bg-white shadow motion-safe:transition-all motion-safe:duration-200", auto ? "left-[34px]" : "left-[8px]")} />
          </button>
        </div>
      )}

      <ol className="mt-2 grid grid-cols-5 gap-1" aria-label="Progress">
        {STEPS.map((s, i) => {
          const reached = i <= current && at[i];
          const here = i === current && c.status !== "cancelled";
          return (
            <li key={s} className="min-w-0" aria-current={here ? "step" : undefined}>
              <div className={cn("h-1.5 rounded-full", reached ? (here ? "bg-violet-300" : "bg-violet-300/50") : "bg-white/10")} />
              <p className={cn("mt-1 text-[12px] leading-tight", here ? "font-semibold text-white" : reached ? "text-white/75" : "text-white/60")}>{s}</p>
              {at[i] && <p className="text-[12px] leading-tight text-white/60">{whenWords(at[i] as string)}</p>}
            </li>
          );
        })}
      </ol>

      <div className="mt-3 space-y-2 text-[14px] leading-snug text-white/85">
        {c.status === "awaiting_verification" && <p>{c.verify_sent_at ? "I emailed them a link to confirm it was them. Waiting for them to tap it." : "I'm about to email them a link to confirm it was them."}{c.reminded_at ? ` I sent one reminder ${whenWords(c.reminded_at)}.` : ""}</p>}
        {c.status === "no_email" && <p>They didn't leave an email, so I can't send a link. Call them back to get one, or mark them verified yourself once you're sure who they are.</p>}
        {c.status === "could_not_verify" && <p>They never tapped the link in 14{NB}days. Call them back and resend the link, mark them verified if you've confirmed who they are, or cancel the request as unverifiable.</p>}
        {c.status === "verified" && <p>They confirmed. I'm looking up their records now.</p>}
        {c.status === "approved" && <p>{c.auto_approved ? "Approved automatically. " : "Approved. "}I'm {isExport ? "building their data file" : "deleting now"}. This page updates by itself.</p>}
        {c.status === "needs_jared" && <p>{scan.owner ? "This looks like one of us, so I won't touch anything. " : ""}{c.note ?? "This one needs you. Read the ticket and handle it by hand."}</p>}
        {c.status === "cancelled" && <p>Cancelled. {c.note ?? ""}</p>}
        {c.status === "done" && (
          <p>
            {c.action === "delete" && c.result ? `Done${c.auto_approved ? " automatically" : ""}. I removed or blanked their information from ${places(c.result.places ?? 0)} and emailed them.` : "Done. I emailed them."}
            {c.redacted ? " Their email and phone are no longer stored in this case." : ""}
          </p>
        )}
        {c.last_error && !finished && <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-amber-100 ring-1 ring-amber-500/30">I hit a problem and will retry: {c.last_error}</p>}
      </div>

      {c.status === "ready" && (
        <div className="mt-3 space-y-3">
          {scan.owner ? null : (del.length + blank.length + keep.length + reviewItems.length === 0) ? (
            <p className="text-[14px] text-white/85">I found nothing on file for them. {canAct ? "You can still approve it so I email them that nothing was found." : ""}</p>
          ) : (<>
            {group("Delete", del, "text-rose-200")}
            {group("Blank out", blank, "text-amber-200")}
            {group("Keep", keep, "text-emerald-200", true)}
            {reviewItems.length > 0 && !isExport && (
              <div>
                <h4 className="text-[12px] font-semibold uppercase tracking-wide text-sky-200">Your call</h4>
                <p className="text-[13px] text-white/60">Unchecked means I leave it alone.</p>
                <ul className="mt-1 space-y-1">
                  {reviewItems.map((i) => {
                    const k = `${i.table}.${i.column}`;
                    return (
                      <li key={k}>
                        <label className="flex min-h-[44px] cursor-pointer items-start gap-3 py-1 text-[14px] text-white/90">
                          <input type="checkbox" checked={ticked.has(k)} onChange={() => toggle(k)} className="mt-1 h-5 w-5 shrink-0 accent-violet-400" />
                          <span><span className="font-medium">{placeName(i.table)}</span><span className="text-white/60">{`, ${records(i.count)}`}</span>{i.reason && <span className="block text-[13px] text-white/60">{i.reason}</span>}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>)}
          {blast.length > 0 && (
            <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-[14px] text-rose-100 ring-1 ring-rose-400/30" role="alert">
              I stopped: {blast.map((b) => `${placeName(b.table)} has ${records(b.rows)} for one person`).join("; ")}. That's more than I will remove on my own. Check it by hand.
            </p>
          )}
        </div>
      )}

      {err && <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-[14px] text-rose-100 ring-1 ring-rose-400/30" role="alert">{err}</p>}

      {mode === "approve" && canAct && (
        <div className="mt-3 rounded-xl bg-white/[0.06] p-3 ring-1 ring-white/15" role="group" aria-label="Confirm">
          <p className="text-[15px] font-semibold text-white">{isExport ? "Send them their data file?" : `Delete their data from ${places((scan.places ?? 0) + (tickedCount ? reviewItems.filter((i) => ticked.has(`${i.table}.${i.column}`)).length : 0))}?`}</p>
          {!isExport && <p className="mt-1 text-[14px] text-white/80">{records((scan.total ?? 0) + tickedCount)} will be removed or blanked{(scan.keep_places ?? 0) > 0 ? `, and ${places(scan.keep_places ?? 0)} kept for legal reasons` : ""}. This can't be undone.</p>}
          {isExport && <p className="mt-1 text-[14px] text-white/80">I'll build one file with everything on the map and email them a link that works for 7{NB}days.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy} className={btnPrimary} onClick={() => void run("admin_privacy_approve", { p_code: code, p_review: Array.from(ticked) })}>
              {busy && <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden />}{isExport ? "Yes, send it" : "Yes, delete"}
            </button>
            <button type="button" disabled={busy} className={btnQuiet} onClick={() => setMode(null)}>Back</button>
          </div>
        </div>
      )}

      {(mode === "verify" || mode === "cancel") && (
        <div className="mt-3" role="group" aria-label={mode === "verify" ? "Mark verified" : "Cancel request"}>
          <label htmlFor={`pv-note-${code}`} className="text-[14px] font-medium text-white">
            {mode === "verify" ? "How did you confirm it was them? (required)" : "Why are you cancelling? (required)"}
          </label>
          <textarea id={`pv-note-${code}`} value={note} onChange={(e) => setNote(e.target.value)} rows={2}
            className="mt-1 w-full resize-y rounded-xl bg-white/[0.05] px-3 py-2 text-[15px] text-white outline-none ring-1 ring-white/10 placeholder:text-white/50 focus:ring-white/25" />
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy || !note.trim()} className={btnPrimary}
              onClick={() => void run(mode === "verify" ? "admin_privacy_mark_verified" : "admin_privacy_cancel", { p_code: code, p_note: note.trim() })}>
              {busy && <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden />}{mode === "verify" ? "Mark verified" : "Cancel request"}
            </button>
            <button type="button" disabled={busy} className={btnQuiet} onClick={() => { setMode(null); setNote(""); }}>Back</button>
          </div>
        </div>
      )}

      {mode === null && !finished && (
        <div className="mt-3 flex flex-wrap gap-2">
          {canAct && blast.length === 0 && (
            <button type="button" className={btnPrimary} onClick={() => setMode("approve")}>
              <Check className="h-4 w-4" aria-hidden />{isExport ? "Send their data" : "Delete now"}
            </button>
          )}
          {(c.status === "awaiting_verification" || c.status === "could_not_verify") && c.has_email && (
            <button type="button" disabled={busy} className={btnQuiet} onClick={() => void run("admin_privacy_resend", { p_code: code })}>
              {busy && <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden />}Resend link
            </button>
          )}
          {(c.status === "awaiting_verification" || c.status === "no_email" || c.status === "could_not_verify") && (
            <button type="button" className={btnQuiet} onClick={() => setMode("verify")}>I verified them</button>
          )}
          {c.status !== "approved" && (
            <button type="button" className={cn(btn, "px-3 text-white/70 hover:text-white")} onClick={() => setMode("cancel")}>Cancel request</button>
          )}
        </div>
      )}
    </section>
  );
}
