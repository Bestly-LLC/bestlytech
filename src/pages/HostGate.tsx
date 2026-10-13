/**
 * /g/:token — the host's one-page confirm screen for a guest's key (opened from the Turo pick-up Live Activity).
 * Look: iOS dark only (literal hex like admin/laxUi.tsx), inset grouped cards, 50 px primary buttons, safe areas, nothing truncated.
 * The token is per trip and unguessable; it only flips the two host confirmations (license, check-in) for that trip.
 * Below the steps: a link to the guest trip page (/t/<trip_token>, carrying the host pass ?dk= along) and one to the Turo trip photos.
 * Preview-safe: anywhere other than bestly.tech the buttons never POST. They only change what this page shows.
 */
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Car, Check, ChevronRight, ExternalLink, KeyRound, Loader2, MapPin, ShieldCheck } from "lucide-react";

const API = "https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/trip-gate";

type Info = { room?: string | null; front_desk?: string | null; parking?: string | null; eta?: string | null };
type Delivery = { short?: string | null; address?: string | null; name?: string | null; info?: Info | null; turo_instructions?: string | null };
type S = {
  reservation_id: number; first: string; starts_at: string; kind: string; license_ok: boolean; checkin_ok: boolean; released: boolean;
  trip_token?: string | null;
  // Added Oct 13 2026. All optional, so an older answer still renders.
  ends_at?: string | null; key_status?: string | null; place?: "home" | "lax" | "delivery" | null; delivery?: Delivery | null; home_address?: string | null;
  car?: string | null; override?: boolean; license_at?: string | null; checkin_at?: string | null; key_sent_at?: string | null; key_added_at?: string | null;
  key_on_car_at?: string | null; key_removed_at?: string | null; key_error?: string | null;
};

const LIVE = typeof window !== "undefined" && /^(www\.)?bestly\.tech$/.test(window.location.hostname);

// iOS dark system colors (same literals as admin/laxUi.tsx). `mute` is the gray for "nothing is happening" states.
const C = { bg: "#000000", card: "#1C1C1E", sep: "#38383A", label: "#FFFFFF", sec: "#EBEBF599", green: "#30D158", orange: "#FF9F0A", blue: "#0A84FF", red: "#FF453A", mute: "#8E8E93" };

const TZ = "America/Los_Angeles";
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const NB = " ";

/** A time (or any number with its unit) that never breaks across lines. */
const T = ({ children }: { children: ReactNode }) => <span className="whitespace-nowrap">{children}</span>;

/** "in 2 hr 15 min". Numbers and units are joined with a no-break space. */
function until(ms: number): string {
  const m = Math.max(1, Math.ceil(ms / 60000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}${NB}${d === 1 ? "day" : "days"}`);
  if (h) parts.push(`${h}${NB}hr`);
  if (mm && !d) parts.push(`${mm}${NB}min`);
  return `in ${parts.join(" ")}`;
}

const Card = ({ children }: { children: ReactNode }) => (
  <div className="overflow-hidden rounded-[22px]" style={{ background: C.card }}>{children}</div>
);
const Divider = () => <div className="ml-4 h-px" style={{ background: C.sep }} />;

export default function HostGate() {
  const { token = "" } = useParams();
  const dk = new URLSearchParams(window.location.search).get("dk");
  const [s, setS] = useState<S | null | undefined>(undefined);
  const [busyDo, setBusyDo] = useState<string | null>(null);
  const [flash, setFlash] = useState("");
  const [err, setErr] = useState("");
  const [armed, setArmed] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const seq = useRef(0);
  const inflight = useRef(false);
  const dirty = useRef(false); // preview only: the page was changed locally, so a refetch must not wipe it
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const r = await fetch(`${API}?g=${encodeURIComponent(token)}`);
      const j = await r.json();
      if (mine === seq.current && !inflight.current && !dirty.current) setS(j.state ?? null);
    } catch { setS((p) => p ?? null); }
  }, [token]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { document.title = "Guest key"; }, []);
  useEffect(() => {
    const again = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", again);
    window.addEventListener("focus", again);
    return () => { document.removeEventListener("visibilitychange", again); window.removeEventListener("focus", again); };
  }, [load]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);
  useEffect(() => () => { if (armTimer.current) clearTimeout(armTimer.current); }, []);

  const act = async (d: string) => {
    if (busyDo) return;
    setErr(""); setFlash(""); setArmed(null);
    const said = (released: boolean | undefined) => (released && (d === "license" || d === "checkin") ? "Done. Key released." : d.startsWith("undo") ? "Undone." : "Saved.");
    if (!LIVE) {
      // Preview: change what the page shows, send nothing.
      if (!s) return;
      dirty.current = true;
      const stamp = new Date().toISOString();
      const n: S = { ...s };
      if (d === "license") { n.license_ok = true; n.license_at = n.license_at ?? stamp; }
      if (d === "checkin") { n.checkin_ok = true; n.checkin_at = n.checkin_at ?? stamp; }
      if (d === "undo_license") { n.license_ok = false; n.license_at = null; }
      if (d === "undo_checkin") { n.checkin_ok = false; n.checkin_at = null; }
      n.released = !!n.override || (n.license_ok && n.checkin_ok);
      setS(n); setFlash(said(n.released));
      return;
    }
    setBusyDo(d); inflight.current = true; seq.current++;
    try {
      const r = await fetch(`${API}?g=${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ do: d }) });
      const j = await r.json();
      if (!r.ok) throw new Error("save failed");
      setS(j.state ?? null);
      setFlash(said(j.state?.released));
    } catch {
      setErr("Couldn't save. Check your signal and try again.");
    } finally { inflight.current = false; setBusyDo(null); }
  };

  const undo = (d: string) => {
    if (armed === d) { void act(d); return; }
    setArmed(d);
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = setTimeout(() => setArmed(null), 4000);
  };

  const busy = busyDo !== null;

  const primary = (d: string, text: string) => (
    <button type="button" disabled={busy} onClick={() => void act(d)}
      className="inline-flex h-11 flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[15px] font-semibold text-white active:opacity-80 disabled:opacity-60"
      style={{ background: C.blue }}>
      {busyDo === d ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{text}
    </button>
  );
  const undoBtn = (d: string) => (
    <button type="button" disabled={busy} onClick={() => undo(d)}
      className="flex min-h-[44px] flex-none items-center justify-end px-2 text-right text-[15px] font-medium leading-tight active:opacity-60 disabled:opacity-60"
      style={{ color: armed === d ? C.red : C.blue, maxWidth: 104 }}>
      {armed === d ? "Tap again to undo" : "Undo"}
    </button>
  );

  const step = (ok: boolean, title: string, sub: ReactNode, right: ReactNode) => (
    <div className="flex min-h-[60px] items-center gap-3 px-4 py-2">
      <span className="grid h-7 w-7 flex-none place-items-center rounded-full text-black" style={{ background: ok ? C.green : C.orange }}>
        {ok ? <Check className="h-4 w-4" strokeWidth={3} /> : <span className="text-[15px] font-bold leading-none">!</span>}
      </span>
      <div className="min-w-0 flex-1">
        <div className="break-words text-[17px] font-semibold leading-snug">{title}</div>
        <div className="break-words text-[13px] leading-snug" style={{ color: C.sec }}>{sub}</div>
      </div>
      {right}
    </div>
  );

  return (
    <div className="flex min-h-[100dvh] flex-col" style={{ background: C.bg, color: C.label, paddingLeft: 16, paddingRight: 16, paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)", paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)", fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif", WebkitTextSizeAdjust: "100%" }}>
      {!LIVE && (
        <div className="fixed inset-x-0 top-0 z-50 px-4 pb-2.5 text-center text-[13px] font-semibold" style={{ background: "#1C1C1EEE", color: C.orange, paddingTop: "calc(env(safe-area-inset-top, 0px) + 10px)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
          Preview. Buttons here don't save anything.
        </div>
      )}
      <main className="mx-auto flex w-full max-w-[520px] flex-1 flex-col gap-[10px]" style={!LIVE ? { paddingTop: 36 } : undefined}>
        {s === undefined && <div className="grid place-items-center pt-32"><Loader2 className="h-6 w-6 animate-spin" style={{ color: C.sec }} /></div>}
        {s === null && (<>
          <h1 className="mt-2 text-[28px] font-bold leading-[34px]">Link not found</h1>
          <p className="text-[15px]" style={{ color: C.sec }}>This trip link is not valid any more.</p>
        </>)}
        {s && (() => {
          const first = s.first || "Guest";
          const place = s.place ?? (s.kind === "lax" ? "lax" : "home");
          const car = s.car || "the Tesla";
          const subtitle = place === "delivery" ? `${car} · Delivery` : place === "lax" ? `${car} · LAX` : `${car} · Home pick-up`;
          const status = s.key_status ?? "";

          // Key status.
          let color = C.orange; let Icon = KeyRound; let text: ReactNode = "Key held. It unlocks when both steps below are done."; let more: string | null = null;
          if (status === "off") { color = C.mute; text = "Auto key is off for this trip."; }
          else if (status === "removed" || s.key_removed_at) { color = C.mute; text = <>Access removed{s.key_removed_at ? <> <T>{fmtTime(s.key_removed_at)}</T></> : ""}.</>; }
          else if (status === "failed") { color = C.red; text = "Key problem. Retrying by itself."; more = s.key_error || null; }
          else if (s.key_on_car_at || s.key_added_at || status === "accepted") { color = C.green; Icon = Car; const at = s.key_on_car_at ?? s.key_added_at; text = <>Key is on the car. {first} added it{at ? <> at <T>{fmtTime(at)}</T></> : ""}.</>; }
          else if (s.released && (status === "ready" || s.key_sent_at)) { color = C.blue; text = `Key sent to ${first}'s page. Waiting for ${first} to add it.`; }
          else if (s.released) { color = C.green; Icon = ShieldCheck; text = "Key released. Making it now."; }

          const wait = new Date(s.starts_at).getTime() - now;

          const d = s.delivery;
          const where = place === "lax" ? "LAX · Park My Share garage" : place === "delivery" ? (d?.short || d?.name || d?.address || "Delivery") : (s.home_address || "Home");
          const fullAddr = place === "delivery" && d?.address && d.address !== where ? d.address : null;
          const mapsAddr = place === "delivery" ? (d?.address || d?.short || "") : place === "home" ? (s.home_address || "") : "";
          const parts: string[] = [];
          if (place === "delivery") {
            const add = (l: string, v?: string | null) => { if (v && v.trim()) parts.push(`${l}${v.trim().replace(/\s*\n+\s*/g, " ")}`); };
            add("Room ", d?.info?.room); add("Parking from the front desk: ", d?.info?.front_desk); add("Parking: ", d?.info?.parking);
            add("Arrives ", d?.info?.eta); add("Turo instructions: ", d?.turo_instructions);
          }
          const notes = place === "delivery" ? (parts.length ? parts.join(" · ") : `No room or parking notes from ${first} yet.`) : null;

          return (<>
            <div>
              <h1 className="break-words text-[28px] font-bold leading-[34px]">{first}</h1>
              <p className="break-words text-[15px]" style={{ color: C.sec }}>{subtitle}</p>
            </div>

            <Card>
              <div className="flex items-center gap-3 p-[14px]">
                <div className="relative grid h-[72px] w-[72px] flex-none place-items-center" style={{ margin: -14 }}>
                  <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full" style={{ background: `radial-gradient(closest-side, ${color}66, ${color}26 55%, ${color}00)` }} />
                  <span className="relative grid h-11 w-11 place-items-center rounded-full" style={{ background: `${color}2E`, color }}><Icon className="h-6 w-6" /></span>
                </div>
                <div className="min-w-0 flex-1" style={{ marginLeft: 2 }}>
                  <p className="break-words text-[17px] font-semibold leading-snug">{text}</p>
                  {more && <p className="break-words text-[13px]" style={{ color: C.sec }}>{more}</p>}
                </div>
              </div>
            </Card>

            <Card>
              <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-x-3 px-4 py-1.5">
                <span className="flex items-center gap-2">
                  <span className="text-[17px]">Pick-up</span>
                  {wait > 0 && <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-[13px]" style={{ background: "#EBEBF51F", color: C.sec }}>{until(wait)}</span>}
                </span>
                <span className="text-right text-[17px]"><T>{fmtDate(s.starts_at)}</T> · <T>{fmtTime(s.starts_at)}</T></span>
              </div>
              {s.ends_at && (<>
                <Divider />
                <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-x-3 px-4 py-1.5">
                  <span className="text-[17px]">Return</span>
                  <span className="text-right text-[17px]"><T>{fmtDate(s.ends_at)}</T> · <T>{fmtTime(s.ends_at)}</T></span>
                </div>
              </>)}
            </Card>

            <Card>
              <div className="flex min-h-[52px] items-start gap-3 py-2.5 pl-4 pr-2">
                <MapPin className="mt-[3px] h-5 w-5 flex-none" style={{ color: C.blue }} />
                <div className="min-w-0 flex-1 py-px">
                  <div className="break-words text-[17px] font-semibold leading-snug">{where}</div>
                  {fullAddr && <div className="break-words text-[13px] leading-snug" style={{ color: C.sec }}>{fullAddr}</div>}
                  {notes && <div className="mt-1 break-words text-[13px] leading-snug [text-wrap:pretty]" style={{ color: C.sec }}>{notes}</div>}
                </div>
                {mapsAddr && (
                  <a href={`https://maps.apple.com/?q=${encodeURIComponent(mapsAddr)}`} className="-my-1 flex min-h-[44px] flex-none items-center px-2 text-[15px] font-medium active:opacity-60" style={{ color: C.blue }}>Maps</a>
                )}
              </div>
            </Card>

            {(flash || err) && (
              <p className="px-1 text-[13px] font-semibold" style={{ color: err ? C.red : C.green }} role="status">{err || flash}</p>
            )}

            <Card>
              {step(s.license_ok, "Driver's license checked",
                s.license_ok ? (s.license_at ? <>Checked at <T>{fmtTime(s.license_at)}</T></> : "Checked") : "Compare the license to the Turo profile.",
                s.license_ok ? undoBtn("undo_license") : primary("license", "Looks good"))}
              <Divider />
              {step(s.checkin_ok, "Check-in photos done",
                s.checkin_ok ? (s.checkin_at ? <>Done at <T>{fmtTime(s.checkin_at)}</T></> : "Done") : "Take the Turo check-in photos of the car.",
                s.checkin_ok ? undoBtn("undo_checkin") : primary("checkin", s.license_ok ? "Release key" : "Photos done"))}
            </Card>

            <div className={`grid gap-[10px] ${s.trip_token ? "grid-cols-2" : "grid-cols-1"}`}>
              {s.trip_token && (
                <a href={`/t/${s.trip_token}${dk ? `?dk=${encodeURIComponent(dk)}` : ""}`} className="inline-flex h-11 items-center justify-center gap-1 whitespace-nowrap rounded-full px-3 text-[15px] font-semibold active:opacity-60" style={{ background: "#0A84FF26", color: C.blue }}>
                  Trip page <ChevronRight className="h-4 w-4" />
                </a>
              )}
              <a href={`https://turo.com/us/en/reservation/${s.reservation_id}`} className="inline-flex h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[15px] font-semibold active:opacity-60" style={{ background: "#0A84FF26", color: C.blue }}>
                Turo photos <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          </>);
        })()}
      </main>
    </div>
  );
}
