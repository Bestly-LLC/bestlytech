/**
 * Guests card on /admin/turo/lax-pass: every upcoming Turo trip (from turo_trips) with its private
 * LAX link (/lax/t/<token>), the guest's reminder email, and "Send reminder now".
 * Every trip gets a link automatically (lax_guest_sync): LAX trips see the garage page, home pickups (733 N Kings Rd)
 * see the home page with an automatic Tesla key (tesla_guest_keys, made 2h before pickup, removed 1h after the trip).
 * Reminders go out from support@bestly.tech (wallet-pass op remind_due, cron lax-guest-tick every 10 min).
 */
import { useCallback, useEffect, useState } from "react";
import { Activity, ChevronDown, ExternalLink, House, KeyRound, Loader2, Mail, MessageCircleQuestion, Plane, RefreshCw, RotateCcw, Send, Zap } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CopyButton } from "@/components/CopyText";
import { cn } from "@/lib/utils";
import { btnTinted, card } from "./laxUi";

export type Row = {
  reservation_id: number; pickup_battery?: number | null; pickup_battery_at?: string | null; first: string | null; last: string | null; starts_at: string; ends_at: string; lax: boolean;
  token: string | null; email: string | null; email_by: "guest" | "host" | null; reminder_at: string | null;
  reminder_sent_at: string | null; reminder_error: string | null; suggested_reminder_at: string; kind?: "lax" | "home";
  activity?: { views: number; first_seen: string | null; last_seen: string | null; devices: string[]; asks: number; unsure?: number; host?: number; recent: { kind: string; at: string; detail: Record<string, string> | null; actor?: string }[] } | null;
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
  link_sent: "Trip link sent in Turo", driver_open: "Opened the extra-driver form", key_resend: "Key re-sent", key_self_removed: "Removed the car from their Tesla app",
  agent: "Helper fixed something", view: "Opened the page",
};
const ago = (iso: string) => { const m = Math.round((Date.now() - +new Date(iso)) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} hr ago` : `${Math.round(m / 1440)} d ago`; };

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
    case "geofence_block": return { title: `Tried to ${d.action === "flash" ? "flash the lights" : "honk"} from too far away`, sub: d.meters ? `About ${Math.round(Number(d.meters) * 3.281)} ft from the car · blocked` : "Blocked" };
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
              <span className="tabular-nums">{d.miles ? `${Math.round(d.miles)} mi` : ""}{d.max_mph ? ` · top ${Math.round(d.max_mph)} mph` : ""}</span>
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
        {x.sub && <p className="text-[13px] text-white/55 bento:text-neutral-500">{x.sub}</p>}</>); })() })),
    ...t.questions.map((q) => ({ at: q.at, node: (
      <>
        <p className="flex items-start gap-1.5 text-[15px] text-white bento:text-neutral-900"><MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-[#409CFF] bento:text-[#007AFF]" aria-hidden />“{q.q}”</p>
        {q.a ? <p className="mt-1 rounded-xl bg-white/[0.05] px-3 py-2 text-[13px] leading-relaxed text-white/70 bento:bg-neutral-100 bento:text-neutral-600">{q.a}</p>
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

type LinkMsg = { status: string; sent_at?: string | null; verified?: boolean; error?: string | null; attempts?: number; source?: string; queued_at?: string } | null;
/** Did the "here's your trip page" message go out in Turo? (sent by the Mac mini through Chrome) */
function LinkSentRow({ res }: { res: number }) {
  const [m, setM] = useState<LinkMsg | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (action?: string) => {
    if (action) setBusy(true);
    const { data, error } = await rpc("turo_link_admin", { p_reservation: res, p_action: action ?? null });
    setBusy(false);
    if (error) { if (action) toast.error(error.message); return; }
    setM((data as LinkMsg) ?? null);
    if (action) toast.success("Queued. The Mac mini sends it in Turo within ~3 minutes.");
  }, [res]);
  useEffect(() => { void load(); }, [load]);
  if (m === undefined || res < 0) return null;
  const btn = "inline-flex h-7 items-center gap-1 rounded-full border border-white/15 px-2.5 text-[11px] text-white disabled:opacity-50 bento:border-neutral-200 bento:text-neutral-800";
  const text = !m ? "Trip link not sent in Turo yet"
    : m.status === "sent" ? `Trip link sent in Turo ${m.sent_at ? when(m.sent_at) : ""}${m.verified ? " ✓ confirmed in thread" : ""}`
    : m.status === "queued" || m.status === "sending" ? "Trip link message queued (sends within ~3 min)"
    : m.status === "skipped" ? "Trip link message skipped"
    : `Trip link message failed${m.error ? `: ${m.error}` : ""} (retrying)`;
  return (
    <div className={cn("mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/[0.03] px-3 py-2 text-sm bento:bg-neutral-50",
      m?.status === "failed" ? "text-red-300 bento:text-red-600" : "text-white/80 bento:text-neutral-700")}>
      <span className="flex items-center gap-1.5"><Send className="h-4 w-4 shrink-0" />{text}</span>
      <button type="button" className={btn} disabled={busy} onClick={() => { if (!m || window.confirm("Send the trip page message in Turo again?")) void load(m ? "resend" : "send"); }}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{m ? "Send again" : "Send now"}
      </button>
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
  const copy = [`Supercharging during ${first ?? "the"} trip: ${money(c.total)} (${c.count} session${c.count === 1 ? "" : "s"}, ${c.kwh} kWh${c.idle > 0 ? `, incl. ${money(c.idle)} idle fees` : ""}).`,
    ...c.sessions.map((s) => `- ${when(s.at)} ${s.place ?? "Supercharger"}: ${money((s.cost ?? 0) + (s.idle ?? 0))}${s.kwh ? ` (${s.kwh} kWh)` : ""}`),
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
      {c.last_error && <p className="mt-1 text-xs text-amber-300 bento:text-amber-700">Last check: {c.last_error.includes("Scope") ? "Tesla needs the charging permission. Reconnect Tesla in Settings to get final amounts." : c.last_error}</p>}
    </div>
  );
}

const rpc = (fn: string, args?: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;

const SITE = "https://bestly.tech"; // short guest links: bestly.tech/t/<7 chars>
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
  const msg = !link ? "" : home
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
          {r.lax ? <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-[#0A84FF26] px-2 py-0.5 text-[11px] text-[#409CFF] bento:bg-[#007AFF1a] bento:text-[#007AFF]"><Plane className="h-3 w-3" />LAX</span>
            : <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/60 bento:bg-neutral-100 bento:text-neutral-500"><House className="h-3 w-3" />Home pickup</span>}
        </p>
        <p className="text-sm text-white/55 bento:text-neutral-500">{when(r.starts_at)} → {when(r.ends_at)}</p>
      </div>
      </>}
      {link ? (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <CopyButton text={msg} label="Copy message for Turo" />
            <CopyButton text={link} label="Copy link" />
            <a href={`/t/${r.token}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-white/60 hover:text-white bento:text-neutral-500">Open <ExternalLink className="h-3.5 w-3.5" /></a>
          </div>
          <LinkSentRow res={r.reservation_id} />
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
          <p className={cn("mt-1.5 text-xs", r.reminder_error ? "text-red-300 bento:text-red-600" : "text-white/45 bento:text-neutral-500")}>{status}</p></>}
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
      <p className="mt-0.5 text-xs text-white/50 bento:text-neutral-500">Each trip gets its own page: their name, times, weather, and the car's battery and cabin temp from an hour before pickup. Reminder emails come from support@bestly.tech.</p>
      {!rows ? <Loader2 className="mt-4 h-5 w-5 animate-spin text-white/50" /> : rows.length === 0
        ? <p className="mt-4 text-sm text-white/55 bento:text-neutral-500">No upcoming trips.</p>
        : <ul className="mt-2 divide-y divide-white/[0.06] bento:divide-neutral-100">{rows.map((r) => <GuestRow key={r.reservation_id} r={r} reload={load} />)}</ul>}
    </div>
  );
}
