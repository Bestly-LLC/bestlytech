/**
 * Guests card on /admin/turo/lax-pass: every upcoming Turo trip (from turo_trips) with its private
 * LAX link (/lax/t/<token>), the guest's reminder email, and "Send reminder now".
 * Every trip gets a link automatically (lax_guest_sync): LAX trips see the garage page, home pickups (733 N Kings Rd)
 * see the home page with an automatic Tesla key (tesla_guest_keys, made 2h before pickup, removed 1h after the trip).
 * Reminders go out from support@bestly.tech (wallet-pass op remind_due, cron lax-guest-tick every 10 min).
 */
import { useCallback, useEffect, useState } from "react";
import { Activity, ExternalLink, House, KeyRound, Loader2, Mail, Plane, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CopyButton } from "@/components/CopyText";
import { cn } from "@/lib/utils";

type Row = {
  reservation_id: number; first: string | null; last: string | null; starts_at: string; ends_at: string; lax: boolean;
  token: string | null; email: string | null; email_by: "guest" | "host" | null; reminder_at: string | null;
  reminder_sent_at: string | null; reminder_error: string | null; suggested_reminder_at: string; kind?: "lax" | "home";
  activity?: { views: number; first_seen: string | null; last_seen: string | null; devices: string[]; asks: number; recent: { kind: string; at: string; detail: Record<string, string> | null }[] } | null;
  key?: { status: string; error: string | null; ready_at: string | null; accepted_at: string | null; removed_at: string | null; driver: string | null; opens_at: string } | null;
};
const KEY_TEXT: Record<string, string> = {
  scheduled: "Key is made automatically", creating: "Making the key now…", ready: "Key sent to their page, waiting for them to add it",
  accepted: "Guest added the key", expired: "Invite expired, a new one is being made", removing: "Removing access…",
  removed: "Access removed", failed: "Key problem, retrying", off: "Auto key is off for this trip",
};

const ACT: Record<string, string> = {
  key_tap: "Tapped Add the car", have_app: "Has the Tesla app", video: "Watched a video", directions: "Opened directions", spot: "Checked the exact spot",
  call: "Tapped a call button", email: "Signed up for the reminder", ask: "Asked the helper", climate: "Used A/C / heat", honk: "Honked", flash: "Flashed lights",
  unlock: "Used backup unlock", turo_app: "Opened the Turo app", app_link: "Opened an app link", reminder_click: "Opened the reminder email",
};
const ago = (iso: string) => { const m = Math.round((Date.now() - +new Date(iso)) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} hr ago` : `${Math.round(m / 1440)} d ago`; };

/** Did the guest (not you) actually use their page? Your own views never count (see lax/track.ts). */
function ActivityRow({ a }: { a: Row["activity"] }) {
  if (!a || !a.last_seen) return <p className="mt-2 flex items-center gap-1.5 text-xs text-white/55 bento:text-neutral-500"><Activity className="h-3.5 w-3.5" /> Guest hasn't opened their page yet.</p>;
  return (
    <div className="mt-2 text-xs text-white/75 bento:text-neutral-600">
      <p className="flex flex-wrap items-center gap-1.5"><Activity className="h-3.5 w-3.5 text-emerald-400" />
        <b className="text-white bento:text-neutral-900">Opened {a.views}×</b> · last seen {when(a.last_seen)} ({ago(a.last_seen)}){a.devices?.length ? ` · ${a.devices.join(", ")}` : ""}{a.asks ? ` · ${a.asks} question${a.asks === 1 ? "" : "s"}` : ""}
      </p>
      {a.recent?.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {a.recent.map((e, i) => <span key={i} className="rounded-full bg-white/[0.06] px-2 py-0.5 bento:bg-neutral-100">{ACT[e.kind] ?? e.kind} · {ago(e.at)}</span>)}
        </div>
      )}
    </div>
  );
}

function KeyRow({ r, reload }: { r: Row; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const k = r.key;
  const act = async (a: string) => {
    setBusy(a);
    const { error } = await rpc("tesla_key_admin", { p_reservation: r.reservation_id, p_action: a });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(a === "make" ? "Making the key now." : a === "resend" ? "Resetting: old invite cancelled, a fresh key link lands on their page in about a minute." : a === "remove" ? "Removing their access now." : a === "off" ? "Auto key off for this trip." : "Auto key on.");
    reload();
  };
  const st = k?.status ?? "scheduled";
  const line = st === "scheduled" ? `${KEY_TEXT.scheduled} ${when(k?.opens_at ?? r.starts_at)}`
    : st === "accepted" && k?.driver ? `${KEY_TEXT.accepted} (${k.driver})` : KEY_TEXT[st] ?? st;
  const btn = "inline-flex h-8 items-center gap-1 rounded-full border border-white/15 px-3 text-xs text-white disabled:opacity-50 bento:border-neutral-200 bento:text-neutral-800";
  return (
    <div className="mt-3 rounded-xl bg-white/[0.03] p-3 bento:bg-neutral-50">
      <p className={cn("flex items-center gap-1.5 text-sm", st === "failed" ? "text-red-300 bento:text-red-600" : "text-white/80 bento:text-neutral-700")}>
        <KeyRound className="h-4 w-4 shrink-0" /> {line}
      </p>
      {k?.error && st === "failed" && <p className="mt-1 text-xs text-red-300/80 bento:text-red-600">{k.error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {["scheduled", "failed", "expired"].includes(st) && <button type="button" className={btn} disabled={!!busy} onClick={() => act("make")}>{busy === "make" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Make key now</button>}
        {["ready", "accepted", "expired", "failed", "removed"].includes(st) && <button type="button" className={cn(btn, "border-amber-300/40 text-amber-200 bento:border-amber-300 bento:text-amber-700")} disabled={!!busy}
          onClick={() => { if (window.confirm("Resend the key? This cancels their current Tesla invite (and removes the car from their app if they added it), then sends a brand-new link to their trip page in about a minute.")) act("resend"); }}>
          {busy === "resend" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}Resend key</button>}
        {["ready", "accepted", "expired", "failed"].includes(st) && <button type="button" className={btn} disabled={!!busy} onClick={() => act("remove")}>{busy === "remove" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Remove access now</button>}
        {["scheduled", "failed", "removed"].includes(st) && <button type="button" className={btn} disabled={!!busy} onClick={() => act("off")}>Turn off auto key</button>}
        {st === "off" && <button type="button" className={btn} disabled={!!busy} onClick={() => act("on")}>Turn on auto key</button>}
      </div>
      <ExtraDriversAdmin res={r.reservation_id} />
    </div>
  );
}

type XDrv = { id: number; name: string; status: string; approved_by?: string | null; ack_at: string; approved_at?: string | null; driver_name?: string | null; last_error?: string | null; share_link?: string | null };
const X_TEXT: Record<string, string> = {
  requested: "Waiting on Turo's approval email (no key yet)", approved: "Turo approved, key being made", creating: "Making key", ready: "Key sent, waiting for them to tap",
  accepted: "Phone added", removing: "Removing", removed: "Removed", failed: "Key failed", cancelled: "Cancelled",
};
function ExtraDriversAdmin({ res }: { res: number }) {
  const [d, setD] = useState<{ drivers: XDrv[]; turo: { name: string; approved: boolean; at: string }[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => { const { data } = await rpc("extra_drivers_admin", { p_reservation: res }); if (data) setD(data as never); }, [res]);
  useEffect(() => { void load(); }, [load]);
  if (!d || (!d.drivers.length && !d.turo.length)) return null;
  const act = async (id: number, a: string) => {
    if (a === "approve" && !window.confirm("Only approve if you've checked Turo and this driver is added AND approved on this trip. Unapproved drivers aren't covered by Turo's protection. Approve?")) return;
    if (a === "remove" && !window.confirm("Remove this driver's Tesla access now?")) return;
    setBusy(`${id}${a}`);
    const { data, error } = await rpc("extra_driver_admin", { p_id: id, p_action: a });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    setD(data as never);
  };
  const btn = "inline-flex h-7 items-center gap-1 rounded-full border border-white/15 px-2.5 text-[11px] text-white disabled:opacity-50 bento:border-neutral-200 bento:text-neutral-800";
  return (
    <div className="mt-3 border-t border-white/10 pt-3 bento:border-neutral-200">
      <p className="text-xs font-medium text-white/60 bento:text-neutral-500">Extra drivers</p>
      {d.turo.length > 0 && <p className="mt-1 text-xs text-white/50 bento:text-neutral-500">Turo emails: {d.turo.map((t) => `${t.name}${t.approved ? " ✓ approved" : ""}`).join(", ")}</p>}
      <ul className="mt-1.5 space-y-1.5">
        {d.drivers.map((x) => (
          <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-white/80 bento:text-neutral-700">
            <span><b>{x.name}</b> · {X_TEXT[x.status] ?? x.status}{x.approved_by === "host" ? " (you approved)" : x.approved_by === "turo_email" ? " (Turo email)" : ""}
              <span className="block text-[11px] text-white/45 bento:text-neutral-400">Guest confirmed insurance terms {when(x.ack_at)}{x.driver_name ? ` · Tesla: ${x.driver_name}` : ""}{x.last_error ? ` · ${x.last_error}` : ""}</span></span>
            <span className="flex gap-1.5">
              {x.status === "requested" && <button type="button" className={btn} disabled={!!busy} onClick={() => void act(x.id, "approve")}>Approve (checked Turo)</button>}
              {["ready", "accepted", "failed"].includes(x.status) && <button type="button" className={btn} disabled={!!busy} onClick={() => void act(x.id, "remove")}>Remove access</button>}
              {["requested", "approved"].includes(x.status) && <button type="button" className={btn} disabled={!!busy} onClick={() => void act(x.id, "cancel")}>Cancel</button>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
const rpc = (fn: string, args?: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;
const card = "rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 bento:border-transparent bento:bg-[#fff] bento:rounded-[1.5rem]";
const SITE = "https://bestly.tech"; // short guest links: bestly.tech/t/<7 chars>
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Los_Angeles" });

function GuestRow({ r, reload }: { r: Row; reload: () => void }) {
  const [email, setEmail] = useState(r.email ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (action: string, p_email?: string) => {
    setBusy(action);
    const { error } = await rpc("lax_guest_admin_update", { p_reservation: r.reservation_id, p_action: action, p_email });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(action === "send_now" ? "Sending now from support@bestly.tech." : action === "email" ? "Saved. The reminder is scheduled." : "Link made.");
    reload();
  };
  const link = r.token ? `${SITE}/t/${r.token}` : null;
  const home = r.kind === "home";
  const msg = !link ? "" : home
    ? `Hi ${r.first ?? ""}! Everything for picking up the Tesla is on this page: your phone key (it shows up 2 hours before pickup), where the car is parked, and A/C buttons. ${link}`
    : `Hi ${r.first ?? ""}! Here's how to pick up your Turo car at LAX, plus the QR code that opens the lobby door (you can add it to Apple or Google Wallet): ${link}`;
  const status = r.reminder_sent_at ? `Reminder sent ${when(r.reminder_sent_at)}`
    : r.reminder_error ? `Reminder failed: ${r.reminder_error.replace(/^gave up: /, "")}`
    : r.email && r.reminder_at ? `Reminder ${when(r.reminder_at)}${r.email_by === "guest" ? " (guest signed up)" : ""}`
    : `No email yet. Guests can add one on their page, or paste it here.`;
  return (
    <li className="py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium text-white bento:text-neutral-900">
          {r.first ?? "Guest"} {r.last ? r.last.slice(0, 1) + "." : ""}
          {r.lax ? <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-violet-500/20 px-2 py-0.5 text-[11px] text-violet-200 bento:bg-violet-100 bento:text-violet-800"><Plane className="h-3 w-3" />LAX</span>
            : <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/60 bento:bg-neutral-100 bento:text-neutral-500"><House className="h-3 w-3" />Home pickup</span>}
        </p>
        <p className="text-sm text-white/55 bento:text-neutral-500">{when(r.starts_at)} → {when(r.ends_at)}</p>
      </div>
      {link ? (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <CopyButton text={msg} label="Copy message for Turo" />
            <CopyButton text={link} label="Copy link" />
            <a href={`/t/${r.token}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-white/60 hover:text-white bento:text-neutral-500">Open <ExternalLink className="h-3.5 w-3.5" /></a>
          </div>
          <ActivityRow a={r.activity} />
          {home && <KeyRow r={r} reload={reload} />}
          {<><div className="mt-3 flex flex-wrap items-center gap-2">
            <Mail className="h-4 w-4 text-white/40 bento:text-neutral-400" />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={home ? "guest email for the cool-down reminder (optional)" : "guest email (optional)"} type="email"
              className="h-9 w-64 max-w-full rounded-lg border border-white/10 bg-transparent px-2.5 text-sm text-white bento:border-neutral-200 bento:text-neutral-900" />
            {email !== (r.email ?? "") && (
              <button type="button" onClick={() => act("email", email)} disabled={!!busy} className="h-9 rounded-full bg-violet-500 px-4 text-sm font-medium text-white disabled:opacity-60">
                {busy === "email" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </button>
            )}
            {r.email && email === r.email && (
              <button type="button" onClick={() => act("send_now")} disabled={!!busy} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/15 px-4 text-sm text-white bento:border-neutral-200 bento:text-neutral-800">
                {busy === "send_now" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send reminder now
              </button>
            )}
          </div>
          <p className={cn("mt-1.5 text-xs", r.reminder_error ? "text-red-300 bento:text-red-600" : "text-white/45 bento:text-neutral-500")}>{status}</p></>}
        </>
      ) : (
        <button type="button" onClick={() => act("link")} disabled={!!busy} className="mt-2 text-sm text-violet-300 underline underline-offset-2 bento:text-violet-700">
          {busy === "link" ? "Making…" : "Make guest link"}
        </button>
      )}
    </li>
  );
}

export function LaxGuests() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const load = useCallback(async () => {
    const { data, error } = await rpc("lax_guest_admin_list");
    if (error) { toast.error(error.message); return; }
    setRows((data as Row[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);
  // This browser belongs to the host: its visits to guest pages never count as guest activity.
  useEffect(() => { try { localStorage.setItem("bestly-host", "1"); } catch { /* private mode */ } }, []);
  return (
    <div className={card}>
      <p className="text-sm font-medium text-white bento:text-neutral-900">Guests</p>
      <p className="mt-0.5 text-xs text-white/50 bento:text-neutral-500">Each trip gets its own page: their name, times, weather, and the car's battery and cabin temp from an hour before pickup. Reminder emails come from support@bestly.tech.</p>
      {!rows ? <Loader2 className="mt-4 h-5 w-5 animate-spin text-white/50" /> : rows.length === 0
        ? <p className="mt-4 text-sm text-white/55 bento:text-neutral-500">No upcoming trips.</p>
        : <ul className="mt-2 divide-y divide-white/[0.06] bento:divide-neutral-100">{rows.map((r) => <GuestRow key={r.reservation_id} r={r} reload={load} />)}</ul>}
    </div>
  );
}
