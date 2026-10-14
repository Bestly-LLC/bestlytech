/**
 * Guests card on /admin/turo/lax-pass: every upcoming Turo trip (from turo_trips) with its private
 * LAX link (/lax/t/<token>), the guest's reminder email, and "Send reminder now".
 * Every trip gets a link automatically (lax_guest_sync): LAX trips see the garage page, home pickups (733 N Kings Rd)
 * see the home page with an automatic Tesla key (tesla_guest_keys, made 2h before pickup, removed 1h after the trip).
 * Reminders go out from support@bestly.tech (wallet-pass op remind_due, cron lax-guest-tick every 10 min).
 */
import { useCallback, useEffect, useState } from "react";
import { Activity, Car, ChevronDown, ExternalLink, House, KeyRound, Loader2, Mail, MessageCircleQuestion, Plane, RefreshCw, RotateCcw, Send, Zap } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CopyButton } from "@/components/CopyText";
import { cn } from "@/lib/utils";
import { btnTinted, card } from "./laxUi";
import { Lines } from "@/components/Lines";

export type Row = {
  reservation_id: number; pickup_battery?: number | null; pickup_battery_at?: string | null; first: string | null; last: string | null; starts_at: string; ends_at: string; lax: boolean;
  token: string | null; email: string | null; email_by: "guest" | "host" | null; reminder_at: string | null;
  reminder_sent_at: string | null; reminder_error: string | null; suggested_reminder_at: string; kind?: "lax" | "home";
  place?: "lax" | "home" | "delivery" | null; delivery_short?: string | null; delivery_ask?: string[] | null;
  delivery_info?: { room?: string | null; front_desk?: string | null; parking?: string | null; eta?: string | null; reported_at?: string | null; via?: string | null } | null;
  activity?: { views: number; first_seen: string | null; last_seen: string | null; devices: string[]; asks: number; unsure?: number; host?: number; recent: { kind: string; at: string; detail: Record<string, string> | null; actor?: string }[] } | null;
  key?: { status: string; error: string | null; ready_at: string | null; accepted_at: string | null; removed_at: string | null; driver: string | null; opens_at: string; license_ok?: boolean; checkin_ok?: boolean; override?: boolean; released?: boolean; gate_token?: string | null } | null;
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
  link_sent: "Trip link sent in Turo", driver_open: "Opened the extra-driver form", key_resend: "Key re-sent", key_self_removed: "Removed the car from their Tesla app",
  agent: "Helper fixed something", view: "Opened the page",
};
const ago = (iso: string) => { const m = Math.round((Date.now() - +new Date(iso)) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} hr ago` : `${Math.round(m / 1440)} d ago`; };

type Ev = { kind: string; at: string; device?: string | null; detail: Record<string, unknown> | null; actor?: string };
type Drive = { id: string; at: string; ended_at: string | null; miles: number | null; max_mph: number | null; from: string | null; to: string | null; basis: "key" | "booking" | "none"; driver: string | null };
type Qa = { at: string; q: string; a: string | null; source: string | null; unanswered: boolean; urgent: boolean };
const CLIMATE_NAME: Record<string, string> = { cool: "Cool it down (A/C)", warm: "Warm it up (heat)", seat: "Heated seat", off: "Turned climate off" };
/** One plain sentence per event: what exactly they did. */
function explain(e: Ev, home: boolean): { title: string; sub?: string } {
  const d = (e.detail ?? {}) as Record<string, string | boolean | Record<string, unknown> | null>;
  const where = home ? "733 N Kings Rd" : "the LAX garage";
  switch (e.kind) {
    case "video": return { title: `Watched “${d.title ?? "a Tesla how-to"}”`, sub: "A Tesla how-to video on the page" };
    case "directions": return { title: `Opened directions to ${d.to ?? where}`, sub: d.app ? `In ${d.app}` : "Map app opened from the page" };
    case "link_sent": return { title: "We sent their trip link in Turo's chat", sub: d.verified ? "Confirmed it's in the Turo thread (sent by the Mac mini)" : "Sent by the Mac mini" };
    case "key_tap": return { title: d.retry ? "Tapped Add the car again (retry)" : "Tapped Add the car", sub: "Opens the Tesla invite to add the car to their Tesla app" };
    case "have_app": return { title: "Said they have the Tesla app" };
    case "spot": return { title: "Looked at the exact parking spot", sub: home ? "Photo + pin at N Kings Rd" : "Level and spot in the LAX garage" };
    case "climate": return { title: CLIMATE_NAME[String(d.action)] ?? "Used A/C or heat" };
    case "driver_open": return { title: "Opened the extra driver form" };
    case "key_resend": return { title: d.by === "host" ? "You re-sent their key" : "Key re-sent", sub: "Old invite cancelled, new link on their page" };
    case "key_self_removed": return { title: "They removed the car from their Tesla app" };
    case "agent": {
      const r = d.result as { note?: string } | null;
      return { title: `Helper: ${String(d.note ?? d.action ?? "took an action")}`, sub: r?.note ? String(r.note) : undefined };
    }
    case "view": return { title: "Opened their trip page" };
    case "out_of_state": return { title: "Said they're leaving California", sub: `“${String(d.text ?? "")}” · you got a Scout alert` };
    case "geofence_block": return { title: `Tried to ${d.action === "flash" ? "flash the lights" : "honk"} from too far away`, sub: d.meters ? `About ${Math.round(Number(d.meters) * 3.281)} ft from the car · blocked` : "Blocked" };
    default: return { title: ACT[e.kind] ?? e.kind.replace(/_/g, " ") };
  }
}

/**
 * Who was driving, and how well we can say so.
 *
 * key    — a named Tesla account held a live digital key across the whole drive. This is the one
 *          worth showing Turo.
 * booking — all we know is that a trip was active. The car has no record of which key started a
 *          drive, so this cannot rule out the host.
 */
const BASIS: Record<Drive["basis"], { label: string; cls: string }> = {
  key: { label: "their phone key", cls: "bg-[#30D15826] text-[#30D158] bento:bg-[#34C7591f] bento:text-[#248A3D]" },
  booking: { label: "booking only", cls: "bg-[#FF9F0A26] text-[#FF9F0A] bento:bg-[#FF95001f] bento:text-[#C93400]" },
  none: { label: "unattributed", cls: "bg-white/[0.08] text-white/70 bento:bg-neutral-100 bento:text-neutral-500" },
};
function DriveList({ drives }: { drives: Drive[] }) {
  if (!drives.length) return null;
  const weak = drives.filter((d) => d.basis !== "key").length;
  return (
    <div className="border-b border-white/[0.06] bento:border-neutral-200">
      <p className="px-3.5 pt-2.5 text-[13px] font-semibold text-white bento:text-neutral-900">Drives</p>
      <ul className="px-3.5 pb-2.5">
        {drives.slice(0, 8).map((d) => {
          const b = BASIS[d.basis] ?? BASIS.none;
          return (
            <li key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1 text-[13px] text-white/70 bento:text-neutral-600">
              <span className="text-white bento:text-neutral-900">{d.from ?? "?"} → {d.to ?? "?"}</span>
              <span className="tabular-nums">{d.miles ? `${Math.round(d.miles)} mi` : ""}{d.max_mph ? ` · top ${Math.round(d.max_mph)} mph` : ""}</span>
              <span className={cn("rounded-full px-1.5 py-0.5 text-[11px] font-semibold", b.cls)}>
                {b.label}{d.basis === "key" && d.driver ? ` · ${d.driver}` : ""}
              </span>
              <time className="ml-auto shrink-0 text-[12px] tabular-nums text-white/45 bento:text-neutral-400" dateTime={d.at}>{ago(d.at)}</time>
            </li>
          );
        })}
      </ul>
      {weak > 0 && (
        <p className="px-3.5 pb-2.5 text-[12px] leading-snug text-white/50 bento:text-neutral-500">
          {weak} of these {weak === 1 ? "is" : "are"} attributed by the booking window alone — the car does not record which key started a drive, so on {weak === 1 ? "it" : "them"} we cannot rule out that you drove.
        </p>
      )}
    </div>
  );
}

/** Everything they did + every question they asked the helper (with the answer). Loads on open. */
function Timeline({ res, home }: { res: number; home: boolean }) {
  const [t, setT] = useState<{ events: Ev[]; questions: Qa[]; drives?: Drive[]; host_events?: number } | null>(null);
  useEffect(() => { void rpc("lax_guest_timeline", { p_reservation: res }).then(({ data }) => setT((data as never) ?? { events: [], questions: [] })); }, [res]);
  if (!t) return <div className="mt-2 h-16 animate-pulse rounded-xl bg-white/[0.04] bento:bg-neutral-100" />;
  const views = t.events.filter((e) => e.kind === "view");
  const items = [
    ...t.events.filter((e) => e.kind !== "view").map((e) => ({ at: e.at, node: (() => { const x = explain(e, home); return (
      <><p className="text-[15px] text-white bento:text-neutral-900">{x.title}
        {e.actor === "unsure" && <span className="ml-1.5 rounded-full bg-[#FF9F0A26] px-1.5 py-0.5 text-[11px] font-semibold text-[#FF9F0A] bento:bg-[#FF95001f] bento:text-[#C93400]">not confirmed as theirs</span>}</p>
        {x.sub && <p className="text-[13px] text-white/55 bento:text-neutral-500"><Lines>{x.sub}</Lines></p>}</>); })() })),
    ...t.questions.map((q) => ({ at: q.at, node: (
      <>
        <p className="flex items-start gap-1.5 text-[15px] text-white bento:text-neutral-900"><MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-[#409CFF] bento:text-[#007AFF]" aria-hidden /><span>“<Lines>{q.q}</Lines>”</span></p>
        {q.a ? <p className="mt-1 rounded-xl bg-white/[0.05] px-3 py-2 text-[13px] leading-relaxed text-white/70 bento:bg-neutral-100 bento:text-neutral-600"><Lines>{q.a}</Lines></p>
          : <p className="text-[13px] text-amber-300 bento:text-amber-700">No answer{q.unanswered ? " (flagged for you)" : ""}</p>}
      </>) })),
  ].sort((a, b) => +new Date(b.at) - +new Date(a.at));
  return (
    <div className="mt-2 overflow-hidden rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.06] bento:bg-white bento:ring-neutral-200">
      {views.length > 0 && <p className="border-b border-white/[0.06] px-3.5 py-2 text-[13px] text-white/55 bento:border-neutral-200 bento:text-neutral-500">
        Opened {views.length}× · first {when(views[views.length - 1].at)}{views[0].device ? ` · on ${views[0].device}` : ""}
        {!!t.host_events && <> · {t.host_events} of your own visit{t.host_events === 1 ? "" : "s"} left out</>}</p>}
      <DriveList drives={t.drives ?? []} />
      {items.length === 0 ? <p className="px-3.5 py-3 text-[13px] text-white/55 bento:text-neutral-500">Nothing tapped yet.</p> : (
        <ul className="divide-y divide-white/[0.06] bento:divide-neutral-200">
          {items.slice(0, 60).map((it, i) => (
            <li key={i} className="flex gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">{it.node}</div>
              <time className="shrink-0 pt-0.5 text-[12px] tabular-nums text-white/45 bento:text-neutral-400" dateTime={it.at} title={when(it.at)}>{ago(it.at)}</time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Did the guest — not you — actually use their page?
 *
 * The count here is only the visits the server attributed to the guest. Your own browsers are
 * excluded two ways: the client-side checks in lax/track.ts, and the server rule that a browser
 * seen on two different trip pages belongs to the host. Anything it cannot place is counted
 * separately and said out loud rather than folded into the guest's number.
 */
function ActivityRow({ a, res, home }: { a: Row["activity"]; res: number; home: boolean }) {
  const [open, setOpen] = useState(false);
  const unsure = a?.unsure ?? 0;
  const mine = a?.host ?? 0;
  if (!a || !a.last_seen) return (
    <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-white/55 bento:text-neutral-500">
      <Activity className="h-3.5 w-3.5" /> Guest hasn't opened their page yet.
      {(mine > 0 || unsure > 0) && <span>· {mine + unsure} visit{mine + unsure === 1 ? "" : "s"} here {mine > 0 && unsure === 0 ? "were yours" : "couldn't be placed as theirs"}</span>}
    </p>
  );
  return (
    <div className="mt-2 text-xs text-white/75 bento:text-neutral-600">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex min-h-[44px] w-full flex-wrap items-center gap-1.5 text-left sm:min-h-0">
        <Activity className="h-3.5 w-3.5 text-emerald-400" />
        <b className="text-white bento:text-neutral-900">Opened {a.views}×</b> · last seen {when(a.last_seen)} ({ago(a.last_seen)}){a.devices?.length ? ` · ${a.devices.join(", ")}` : ""}{a.asks ? ` · ${a.asks} question${a.asks === 1 ? "" : "s"}` : ""}
        {unsure > 0 && <span className="text-[#FF9F0A] bento:text-[#C93400]">· {unsure} not confirmed as theirs</span>}
        {mine > 0 && <span className="text-white/50 bento:text-neutral-500">· {mine} yours, not counted</span>}
        <span className="ml-auto inline-flex items-center gap-0.5 font-medium text-[#409CFF] bento:text-[#007AFF]">{open ? "Hide" : "What they did"}<ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden /></span>
      </button>
      {open && <Timeline res={res} home={home} />}
    </div>
  );
}

type Phase = { who: string; role: "driver" | "extra"; phase: "none" | "sent" | "added" | "phone_key" | "off"; added_at: string | null; proof_at: string | null; proof: string | null };
const PHASE: Record<Phase["phase"], { dot: string; text: string; ring?: boolean }> = {
  none: { dot: "bg-transparent", ring: true, text: "No key yet" },
  sent: { dot: "bg-transparent", ring: true, text: "Key link sent, not added yet" },
  added: { dot: "bg-[#FFD60A]", text: "Added to their Tesla app · not set up at the car yet" },
  phone_key: { dot: "bg-[#30D158]", text: "Phone key working" },
  off: { dot: "bg-white/25 bento:bg-neutral-300", text: "Access removed" },
};
/** Yellow = key added in their Tesla app. Green = they pressed Set Up at the car and the phone is now the key. */
function KeyDots({ res }: { res: number }) {
  const [p, setP] = useState<Phase[] | null>(null);
  useEffect(() => { void rpc("guest_key_phases", { p_reservation: res }).then(({ data }) => setP((data as Phase[]) ?? [])); }, [res]);
  if (!p || p.length === 0 || p.every((x) => x.phase === "none")) return null;
  return (
    <ul className="mt-3 space-y-1.5 rounded-xl bg-white/[0.03] px-3 py-2.5 bento:bg-neutral-50" aria-label="Phone keys">
      {p.map((x, i) => {
        const ph = PHASE[x.phase];
        return (
          <li key={i} className="flex items-center gap-2.5 text-sm" title={x.proof ? `Green because ${x.proof}` : undefined}>
            <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", ph.dot, ph.ring && "ring-[1.5px] ring-inset ring-white/35 bento:ring-neutral-400")} aria-hidden />
            <span className="font-medium text-white bento:text-neutral-900">{x.who}</span>
            <span className="text-[12px] text-white/45 bento:text-neutral-400">{x.role === "extra" ? "Extra driver" : "Driver"}</span>
            <span className="ml-auto text-right text-[13px] text-white/65 bento:text-neutral-600">{ph.text}</span>
          </li>
        );
      })}
    </ul>
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
  const gate = async (a: Record<string, boolean>, tag: string) => {
    setBusy(tag);
    const { error } = await rpc("guest_key_gate", { p_reservation: r.reservation_id, ...a });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Saved."); reload();
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
      {k && ["ready", "accepted", "creating", "scheduled"].includes(st) && (
        <div className="mt-2 rounded-lg bg-black/[0.03] p-2.5 bento:bg-white">
          <p className={cn("text-xs font-medium", k.released ? "text-emerald-300 bento:text-emerald-700" : "text-amber-300 bento:text-amber-700")}>{k.released ? "Key released to the guest" : "Key held until both are confirmed"}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={btn} disabled={!!busy} onClick={() => gate({ p_license: !k.license_ok }, "license")}>{k.license_ok ? "License ✓ (undo)" : "License looks good"}</button>
            <button type="button" className={btn} disabled={!!busy} onClick={() => gate({ p_checkin: !k.checkin_ok }, "checkin")}>{k.checkin_ok ? "Check-in ✓ (undo)" : "Check-in done"}</button>
            {k.gate_token && <a className={btn} href={`/g/${k.gate_token}`} target="_blank" rel="noreferrer">Open confirm page</a>}
          </div>
        </div>
      )}
      {k?.error && st === "failed" && <p className="mt-1 text-xs text-red-300/80 bento:text-red-600"><Lines>{k.error}</Lines></p>}
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
              {x.status === "requested" && res < 0 && <button type="button" className={btn} disabled={!!busy} onClick={() => void act(x.id, "simulate")}>Simulate Turo email (test)</button>}
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

type ChargeAdm = { total: number; idle: number; kwh: number; count: number; final: boolean; updated_at?: string | null; last_error?: string | null;
  sessions: { at: string; place?: string | null; kwh?: number | null; cost?: number | null; idle?: number | null; final?: boolean }[] };
/** Supercharging on this trip: TezLab estimate live, Tesla's billed amount after the trip. Copy line for Turo's reimbursement form. */
function ChargingAdmin({ res, first }: { res: number; first: string | null }) {
  const [c, setC] = useState<ChargeAdm | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const { data } = await rpc("trip_charges_admin", { p_reservation: res }); if (data) setC(data as ChargeAdm); }, [res]);
  useEffect(() => { void load(); }, [load]);
  if (!c) return null;
  const money = (n?: number | null) => `$${(n ?? 0).toFixed(2)}`;
  const copy = [`Supercharging during ${first ?? "the"} trip: ${money(c.total)} (${c.count} session${c.count === 1 ? "" : "s"}, ${c.kwh} kWh${c.idle > 0 ? `, incl. ${money(c.idle)} idle fees` : ""}).`,
    ...c.sessions.map((s) => `- ${when(s.at)} ${s.place ?? "Supercharger"}: ${money((s.cost ?? 0) + (s.idle ?? 0))}${s.kwh ? ` (${s.kwh} kWh)` : ""}`),
    c.final ? "Amounts are from Tesla's Supercharger billing." : "Amounts are estimates from the car's charging log."].join("\n");
  const btn = cn(btnTinted, "shrink-0 whitespace-nowrap px-4 [&_svg]:h-4 [&_svg]:w-4");
  const refresh = async () => { setBusy(true); const { error } = await rpc("trip_charges_refresh", { p_reservation: res }); if (error) toast.error(error.message); else { toast.success("Checking. Updates in about a minute."); window.setTimeout(() => { void load(); setBusy(false); }, 45000); return; } setBusy(false); };
  return (
    <div className="mt-3 rounded-xl bg-white/[0.03] px-3 py-2 text-sm text-white/80 bento:bg-neutral-50 bento:text-neutral-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5"><Zap className="h-4 w-4 shrink-0" />Supercharging <b className="tabular-nums">{money(c.total)}</b>
          <span className="text-xs text-white/50 bento:text-neutral-500">{c.count} stop{c.count === 1 ? "" : "s"} · {c.final ? "final from Tesla" : "estimate"}</span></span>
        <span className="flex gap-1.5">
          {c.count > 0 && <CopyButton text={copy} label="Copy for Turo" />}
          <button type="button" className={btn} disabled={busy} onClick={() => void refresh()}>{busy ? <><Loader2 className="animate-spin" aria-hidden />Checking…</> : <><RefreshCw aria-hidden />Check now</>}</button>
        </span>
      </div>
      {c.last_error && <p className="mt-1 text-xs text-amber-300 bento:text-amber-700"><Lines>{`Last check: ${c.last_error.includes("Scope") ? "Tesla needs the charging permission. Reconnect Tesla in Settings to get final amounts." : c.last_error}`}</Lines></p>}
    </div>
  );
}

const rpc = (fn: string, args?: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;

const SITE = "https://bestly.tech"; // short guest links: bestly.tech/t/<7 chars>
/** Opens a guest trip page from the admin. A plain target=_blank link to /t/... did nothing in the installed admin
 *  web app (its scope is /admin), so open the full URL ourselves and fall back to this tab if a new one is blocked. */
function openTrip(url: string) {
  let w: Window | null = null;
  // No "noopener" feature here: with it window.open always returns null and we could not tell a blocked popup apart.
  try { w = window.open(url, "_blank"); if (w) w.opener = null; } catch { /* blocked */ }
  if (!w) window.location.assign(url);
}
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Los_Angeles" });

export function GuestRow({ r, reload, compact }: { r: Row; reload: () => void; compact?: boolean }) {
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
  const delivery = r.place === "delivery";
  const dShort = r.delivery_short ?? "your location";
  const dInfo = r.delivery_info;
  const dNotes = delivery && dInfo ? [["Room", dInfo.room], ["Front desk", dInfo.front_desk], ["Parking", dInfo.parking], ["Train", dInfo.eta]].filter(([, v]) => v) as [string, string][] : [];
  const msg = !link ? "" : delivery
    ? `Hi ${r.first ?? ""}, thanks for booking my Model 3! You're all set for delivery to ${dShort}. When you check in, tell Leo your room number (or type it) on your trip page and let him know anything the front desk says about parking. When I arrive I'll take about 10 minutes of photos, then your phone key turns on. Your trip page: ${link}`
    : home
    ? `Hi ${r.first ?? ""}! Everything for picking up the Tesla is on this page: your phone key (it shows up 2 hours before pickup), where the car is parked, and A/C buttons. ${link}`
    : `Hi ${r.first ?? ""}! Here's how to pick up your Turo car at LAX, plus the QR code that opens the lobby door (you can add it to Apple or Google Wallet): ${link}`;
  const status = r.reminder_sent_at ? `Reminder sent ${when(r.reminder_sent_at)}`
    : r.reminder_error ? `Reminder failed: ${r.reminder_error.replace(/^gave up: /, "")}`
    : r.email && r.reminder_at ? `Reminder ${when(r.reminder_at)}${r.email_by === "guest" ? " (guest signed up)" : ""}`
    : `No email yet. Guests can add one on their page, or paste it here.`;
  return (
    <li className={compact ? "" : "py-4"}>
      {!compact && <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium text-white bento:text-neutral-900">
          {r.first ?? "Guest"} {r.last ? r.last.slice(0, 1) + "." : ""}
          {delivery ? <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-[#E2733A33] px-2 py-0.5 text-[11px] text-[#F0A070] bento:bg-[#E2733A1f] bento:text-[#A8480F]"><Car className="h-3 w-3" />Delivery · {dShort}</span>
            : r.lax ? <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-[#0A84FF26] px-2 py-0.5 text-[11px] text-[#409CFF] bento:bg-[#007AFF1a] bento:text-[#007AFF]"><Plane className="h-3 w-3" />LAX</span>
            : <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/60 bento:bg-neutral-100 bento:text-neutral-500"><House className="h-3 w-3" />Home pickup</span>}
        </p>
        <p className="text-sm text-white/55 bento:text-neutral-500">{when(r.starts_at)} → {when(r.ends_at)}</p>
      </div>
      {delivery && (
        <p className="mt-1 text-sm text-white/70 bento:text-neutral-600">
          {dNotes.length ? dNotes.map(([k, v], i) => <span key={k}>{i > 0 ? " · " : ""}<span className="text-white/45 bento:text-neutral-400">{k}</span> <Lines>{v}</Lines></span>)
            : <span className="text-white/45 bento:text-neutral-400">Waiting on {(r.delivery_ask ?? []).includes("eta") ? "the train time" : "the room number and front desk notes"} from the guest.</span>}
        </p>
      )}
      </>}
      {compact && delivery && (
        <p className="mt-1 text-sm text-white/70 bento:text-neutral-600">
          <span className="font-medium text-[#F0A070] bento:text-[#A8480F]">Delivery · {dShort}</span>
          {dNotes.length ? dNotes.map(([k, v]) => <span key={k}> · <span className="text-white/45 bento:text-neutral-400">{k}</span> <Lines>{v}</Lines></span>)
            : <span className="text-white/45 bento:text-neutral-400"> · waiting on {(r.delivery_ask ?? []).includes("eta") ? "the train time" : "the unit # and parking notes"} from the guest</span>}
        </p>
      )}
      {link ? (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <CopyButton text={msg} label="Copy message for Turo" />
            <CopyButton text={link} label="Copy link" />
            <button type="button" onClick={() => openTrip(link)}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-white/15 px-3.5 text-sm text-white hover:bg-white/[0.06] bento:border-neutral-200 bento:text-neutral-800">
              Open guest page <ExternalLink className="h-3.5 w-3.5" aria-hidden /></button>
          </div>
          {new Date(r.starts_at) <= new Date() && <ChargingAdmin res={r.reservation_id} first={r.first} />}
          <ActivityRow a={r.activity} res={r.reservation_id} home={home} />
          <KeyDots res={r.reservation_id} />
          {home && <KeyRow r={r} reload={reload} />}
          {<><div className="mt-3 flex flex-wrap items-center gap-2">
            <Mail className="h-4 w-4 text-white/40 bento:text-neutral-400" />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={home ? "guest email for the cool-down reminder (optional)" : "guest email (optional)"} type="email"
              className="h-9 w-64 max-w-full rounded-lg border border-white/10 bg-transparent px-2.5 text-sm text-white bento:border-neutral-200 bento:text-neutral-900" />
            {email !== (r.email ?? "") && (
              <button type="button" onClick={() => act("email", email)} disabled={!!busy} className="h-9 rounded-full bg-[#0A84FF] bento:bg-[#007AFF] px-4 text-sm font-medium text-white disabled:opacity-60">
                {busy === "email" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </button>
            )}
            {r.email && email === r.email && (
              <button type="button" onClick={() => act("send_now")} disabled={!!busy} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/15 px-4 text-sm text-white bento:border-neutral-200 bento:text-neutral-800">
                {busy === "send_now" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send reminder now
              </button>
            )}
          </div>
          <p className={cn("mt-1.5 text-xs", r.reminder_error ? "text-red-300 bento:text-red-600" : "text-white/45 bento:text-neutral-500")}><Lines>{status}</Lines></p></>}
        </>
      ) : (
        <button type="button" onClick={() => act("link")} disabled={!!busy} className="mt-2 text-sm text-[#409CFF] underline underline-offset-2 bento:text-[#007AFF]">
          {busy === "link" ? "Making…" : "Make guest link"}
        </button>
      )}
    </li>
  );
}

/** Guest rows for every upcoming trip (one RPC), for Turo Watch's trip cards. */
export function useGuestRows() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const load = useCallback(async () => {
    const { data, error } = await rpc("lax_guest_admin_list");
    if (error) { toast.error(error.message); return; }
    setRows((data as Row[]) ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { try { localStorage.setItem("bestly-host", "1"); } catch { /* private mode */ } }, []);
  return { rows, reload: load };
}


const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
/** "September 28, 2026" + "12:00 PM" -> "2026-09-28 12:00" (LA wall-clock; the database does the timezone). */
function localStamp(day: string, time: string): string | null {
  const d = day.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/); const t = time.match(/(\d{1,2}):(\d{2})\s*([AP])M/i);
  if (!d || !t) return null;
  const mo = MONTHS.indexOf(d[1].toLowerCase()) + 1; if (!mo) return null;
  let h = Number(t[1]) % 12; if (t[3].toUpperCase() === "P") h += 12;
  return `${d[3]}-${String(mo).padStart(2, "0")}-${d[2].padStart(2, "0")} ${String(h).padStart(2, "0")}:${t[2]}`;
}
/** Reads Turo's "X's trip is booked" message (email or app text). Anything it can't find stays blank for you to type. */
function parseBooking(text: string) {
  const first = text.match(/^\s*([^\n]+?)[’']s trip is booked/im)?.[1]?.trim() ?? "";
  const m = text.match(/from\s+(?:\w+day,\s*)?([A-Za-z]+\s+\d{1,2},\s*\d{4}),?\s*(\d{1,2}:\d{2}\s*[AP]M)\s+to\s+(?:\w+day,\s*)?([A-Za-z]+\s+\d{1,2},\s*\d{4}),?\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
  const earn = text.match(/earn\s+\$([\d,]+(?:\.\d+)?)/i)?.[1]?.replace(/,/g, "") ?? "";
  const res = text.match(/(?:reservation|trip)s?\/(\d{6,10})/i)?.[1] ?? text.match(/\b(\d{8})\b/)?.[1] ?? "";
  return { first, start: m ? localStamp(m[1], m[2]) ?? "" : "", end: m ? localStamp(m[3], m[4]) ?? "" : "", earn, res };
}

/** Fresh booking the Turo feed hasn't delivered yet: paste Turo's message, get the guest link now. */
function AddTrip({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [f, setF] = useState({ res: "", first: "", phone: "", start: "", end: "", earn: "", lax: false });
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ link: string; msg: string } | null>(null);
  const fld = "h-9 rounded-lg border border-white/10 bg-transparent px-2.5 text-sm text-white bento:border-neutral-200 bento:text-neutral-900";
  const onPaste = (v: string) => {
    setPaste(v); const p = parseBooking(v);
    setF((x) => ({ ...x, res: p.res || x.res, first: p.first || x.first, start: p.start || x.start, end: p.end || x.end, earn: p.earn || x.earn }));
  };
  const ready = /^\d{6,10}$/.test(f.res) && f.first.trim() && f.start && f.end;
  const submit = async () => {
    setBusy(true);
    const { data, error } = await rpc("lax_guest_add_trip", { p_reservation: Number(f.res), p_first: f.first, p_phone: f.phone, p_start_local: f.start, p_end_local: f.end, p_lax: f.lax, p_earnings: f.earn ? Number(f.earn) : null });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const token = (data as { token: string }).token; const link = `${SITE}/t/${token}`;
    const msg = f.lax
      ? `Hi ${f.first}! Here's how to pick up your Turo car at LAX, plus the QR code that opens the lobby door (you can add it to Apple or Google Wallet): ${link}`
      : `Hi ${f.first}! Everything for picking up the Tesla is on this page: your phone key (it shows up 2 hours before pickup), where the car is parked, and A/C buttons. ${link}`;
    setMade({ link, msg }); onDone();
  };
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="mt-3 text-sm font-medium text-[#409CFF] bento:text-[#007AFF]">+ Add a trip that isn't here yet</button>;
  return (
    <div className="mt-3 rounded-2xl bg-white/[0.04] p-3.5 ring-1 ring-white/[0.06] bento:bg-neutral-50 bento:ring-neutral-200">
      {made ? (
        <>
          <p className="text-sm font-semibold text-white bento:text-neutral-900">Link ready for {f.first}</p>
          <p className="mt-1 break-all text-sm text-white/70 bento:text-neutral-600">{made.link}</p>
          <div className="mt-2 flex flex-wrap gap-2"><CopyButton text={made.msg} label="Copy message for Turo" /><CopyButton text={made.link} label="Copy link" /></div>
          <button type="button" className="mt-3 text-sm text-white/55 bento:text-neutral-500" onClick={() => { setMade(null); setPaste(""); setF({ res: "", first: "", phone: "", start: "", end: "", earn: "", lax: false }); setOpen(false); }}>Done</button>
        </>
      ) : (
        <>
          <p className="text-sm font-semibold text-white bento:text-neutral-900">Add a trip</p>
          <p className="mt-0.5 text-xs text-white/50 bento:text-neutral-500"><Lines>Paste Turo's “trip is booked” message. Add the trip number from the trip page link (turo.com/reservation/<b>12345678</b>). Turo's own sync replaces this later.</Lines></p>
          <textarea value={paste} onChange={(e) => onPaste(e.target.value)} rows={4} placeholder="Paste the Turo booking message here" className={cn(fld, "mt-2 h-auto w-full py-2")} />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input className={fld} inputMode="numeric" placeholder="Trip number" value={f.res} onChange={(e) => setF({ ...f, res: e.target.value.replace(/\D/g, "") })} />
            <input className={fld} placeholder="Guest first name" value={f.first} onChange={(e) => setF({ ...f, first: e.target.value })} />
            <input className={fld} placeholder="Pickup: 2026-09-28 12:00" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
            <input className={fld} placeholder="Return: 2026-09-30 12:00" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />
            <input className={fld} inputMode="tel" placeholder="Guest phone (optional)" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
            <label className="flex h-9 items-center gap-2 text-sm text-white/75 bento:text-neutral-600"><input type="checkbox" checked={f.lax} onChange={(e) => setF({ ...f, lax: e.target.checked })} />LAX pickup (else home)</label>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button type="button" disabled={!ready || busy} onClick={() => void submit()} className="h-9 rounded-full bg-[#0A84FF] bento:bg-[#007AFF] px-4 text-sm font-medium text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Make guest link"}</button>
            <button type="button" className="text-sm text-white/55 bento:text-neutral-500" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </>
      )}
    </div>
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
      <p className="text-[17px] font-semibold text-white bento:text-neutral-900">Guests</p>
      <p className="mt-0.5 text-xs text-white/50 bento:text-neutral-500"><Lines>Each trip gets its own page: their name, times, weather, and the car's battery and cabin temp from an hour before pickup. Reminder emails come from support@bestly.tech.</Lines></p>
      <AddTrip onDone={load} />
      {!rows ? <Loader2 className="mt-4 h-5 w-5 animate-spin text-white/50" /> : rows.length === 0
        ? <p className="mt-4 text-sm text-white/55 bento:text-neutral-500">No upcoming trips.</p>
        : <ul className="mt-2 divide-y divide-white/[0.06] bento:divide-neutral-100">{rows.map((r) => <GuestRow key={r.reservation_id} r={r} reload={load} />)}</ul>}
    </div>
  );
}
