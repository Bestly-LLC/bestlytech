/**
 * "Before you walk away": live return checklist at the top of the Return steps (Home + LAX).
 * Reads the car (lax_return_check): parked in the right place, charged back to the pickup level, trunk/frunk shut, locked.
 * Each miss comes with its fix right there: Send the spot to the car, Send the charger to the car, Lock.
 * Plus Close windows (the car also closes them by itself when it locks).
 * Live from 48 hours before return until 30 minutes after (then the page shows "Trip ended"); while open it asks the car for a fresh reading every 90 s
 * (a TezLab status read, which never wakes the car).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronsUp, Circle, Loader2, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SendToCar } from "./KeyNext";
import { fmtWhen } from "./GuestExtras";
import type { TripKind } from "./places";
import { track } from "./track";

type Item = { id: "parked" | "charge" | "trunks" | "locked"; ok: boolean; label: string; detail: string };
type Check = { ok: boolean; live: boolean; opens_at?: string; items?: Item[]; observed_at?: string; fresh?: boolean; controls?: boolean };
type Run = (a: "refresh" | "lock" | "windows_close" | "nav_charger" | "nav_charger_lax" | "nav_garage_lax" | "nav_home", onStage?: (s: string) => void) => Promise<void>;

const ACCENT = "var(--trip-accent)";
const DEMO: Check = { ok: true, live: true, fresh: true, controls: true, observed_at: new Date(Date.now() - 60e3).toISOString(), items: [
  { id: "parked", ok: false, label: "Park at the return spot", detail: "About 0.4 miles away." },
  { id: "charge", ok: false, label: "Charge back to 90% (same as pickup)", detail: "It's at 82% now." },
  { id: "trunks", ok: true, label: "Trunk and frunk closed", detail: "Both closed." },
  { id: "locked", ok: false, label: "Locked", detail: "The car is unlocked." },
] };
const ago = (iso: string) => { const m = Math.max(0, Math.round((Date.now() - +new Date(iso)) / 60000)); return m < 1 ? "just now" : `${m} min ago`; };

export function ReturnChecklist({ token, kind, run, demo, endsAt, compact }: { token: string; kind: TripKind; run?: Run; demo?: boolean; endsAt?: string; compact?: boolean }) {
  // Demo follows the demo trip's clock: live only from 48 hours before return (like the real one).
  const demoCheck = (): Check => {
    const e = endsAt ? +new Date(endsAt) : Date.now();
    return Date.now() < e - 48 * 3600e3 ? { ok: true, live: false, opens_at: new Date(e - 48 * 3600e3).toISOString() } : DEMO;
  };
  const [c, setC] = useState<Check | null>(demo ? demoCheck() : null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (demo) setC(demoCheck()); }, [demo, endsAt]);
  const [local, setLocal] = useState<Partial<Record<Item["id"], boolean>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const lastRefresh = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const onScreen = useRef(true);
  useEffect(() => {
    const el = box.current; if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([en]) => { onScreen.current = en.isIntersecting; }, { threshold: 0.2 });
    io.observe(el); return () => io.disconnect();
  });

  const load = useCallback(async () => {
    if (demo) return;
    const { data } = await (supabase.rpc("lax_return_check" as never, { p_token: token } as never) as unknown as Promise<{ data: Check | null }>);
    if (data) setC(data);
  }, [token, demo]);
  useEffect(() => {
    if (demo) return;
    let stop = false;
    const tick = async () => {
      if (stop || document.visibilityState !== "visible" || !onScreen.current) return;
      await load();
      // Ask the car for a fresh reading (location, lock, trunks) at most every 90 s while this is on screen.
      if (run && Date.now() - lastRefresh.current > 90e3) { lastRefresh.current = Date.now(); run("refresh").then(load).catch(() => {}); }
    };
    void tick();
    const id = window.setInterval(tick, 30000);
    return () => { stop = true; window.clearInterval(id); };
  }, [load, run, demo]);

  if (!c?.ok) return null;
  if (!c.live && compact) return <p ref={box as never} className="mt-3 text-[13px] text-white/55">A live car check (parked, charged, locked) turns on here {c.opens_at ? fmtWhen(c.opens_at) : "2 days before your return"}.</p>;
  if (!c.live) return (
    <div className="rounded-3xl bg-white/[0.06] p-4 ring-1 ring-white/10">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: ACCENT }}>Return checklist</p>
      <p className="mt-1 text-[15px] text-white/80">It checks the car for you (parked, charged, locked). It turns on {c.opens_at ? fmtWhen(c.opens_at) : "2 days before your return"}.</p>
    </div>
  );

  // Right after a Lock tap the next car reading can lag a minute: show what we just did.
  const items = (c.items ?? []).map((i) => (local[i.id] && !i.ok ? { ...i, ok: true, detail: i.id === "locked" ? "Locked just now." : "Done just now." } : i));
  const done = items.filter((i) => i.ok).length, total = items.length;
  const all = done === total;
  const act = async (id: string, a: Parameters<Run>[0], okItem?: Item["id"]) => {
    if (!run) return;
    setBusy(id); setMsg(null);
    try { await run(a, (s) => setMsg(s)); setMsg(a === "lock" ? "Locked." : a === "windows_close" ? "Windows closing." : "Done."); if (okItem) setLocal((x) => ({ ...x, [okItem]: true })); track(token, "return_" + a); void load(); }
    catch (e) { setMsg((e as Error).message || "Couldn't reach the car."); }
    finally { setBusy(null); }
  };

  // Compact: one small live row inside the Park step. The other fixes (send spot / charger) live in their own steps.
  if (compact) {
    const short: Record<Item["id"], string> = { parked: "Parked", charge: "Charged", trunks: "Trunks", locked: "Locked" };
    return (
      <div ref={box} aria-label="Live car check" className={`mt-3 rounded-2xl px-2.5 py-2 ring-1 ${all ? "bg-emerald-400/10 ring-emerald-300/40" : "bg-white/[0.06] ring-white/10"}`}>
        <div className="flex items-center justify-between gap-2 px-0.5">
          <p className="text-[12px] font-bold text-white">{all ? "Car check · all set" : `Car check · ${done} of ${total}`}</p>
          <span className="text-[11px] text-white/50">{c.observed_at ? ago(c.observed_at) : ""}</span>
        </div>
        <ul className="mt-1.5 flex gap-1">
          {items.map((i) => (
            <li key={i.id} title={i.detail} className={`flex flex-auto items-center justify-center gap-0.5 whitespace-nowrap rounded-full px-1 py-1 text-[11px] font-semibold tracking-tight ${i.ok ? "bg-emerald-400/15 text-emerald-200" : "bg-amber-300/15 text-amber-100"}`}>
              {i.ok ? <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden /> : <Circle className="h-3 w-3 shrink-0" aria-hidden />}<span>{short[i.id]}</span>
              <span className="sr-only">{i.ok ? " done" : " not yet"}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <section aria-label="Return checklist" className={`rounded-3xl p-4 ring-1 ${all ? "bg-emerald-400/10 ring-emerald-300/40" : "bg-white/[0.07] ring-white/10"}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: all ? "#6ee7b7" : ACCENT }}>Before you walk away</p>
          <p className="mt-0.5 text-[20px] font-bold leading-tight text-white">{all ? "All set. You're good to go." : `${done} of ${total} done`}</p>
        </div>
        <Ring done={done} total={total} all={all} />
      </div>
      <ul className="mt-3 divide-y divide-white/10">
        {items.map((i) => (
          <li key={i.id} className="flex items-start gap-3 py-3">
            {i.ok ? <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-300" /> : <Circle className="mt-0.5 h-6 w-6 shrink-0 text-amber-200" />}
            <div className="min-w-0 flex-1">
              <p className={`text-[16px] font-semibold ${i.ok ? "text-white/70" : "text-white"}`}>{i.label}</p>
              <p className="text-[13px] text-white/60">{i.detail}</p>
              {!i.ok && i.id === "parked" && <SendToCar run={run} kind={kind} action={kind === "home" ? "nav_home" : "nav_garage_lax"} label="Send the return spot to the car" />}
              {!i.ok && i.id === "charge" && <SendToCar center run={run} kind={kind} label="Send nearest Supercharger to car" />}
              {!i.ok && i.id === "locked" && (
                <button type="button" onClick={() => void act("lock", "lock", "locked")} disabled={!run || !!busy}
                  className="mt-2 inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 text-[14px] font-bold text-[#1A1140] disabled:opacity-50" style={{ background: ACCENT }}>
                  {busy === "lock" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} Lock it
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
        <button type="button" onClick={() => void act("win", "windows_close")} disabled={!run || !!busy}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-white/10 px-3.5 text-[13px] font-semibold text-white ring-1 ring-white/15 disabled:opacity-50">
          {busy === "win" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronsUp className="h-4 w-4" />} Close windows
        </button>
        <span className="text-[12px] text-white/50">{c.observed_at ? `Car checked ${ago(c.observed_at)}` : ""}</span>
      </div>
      {msg && <p className="mt-2 text-[13px] text-white/70" aria-live="polite">{msg}</p>}
      {!run && <p className="mt-2 text-[12px] text-white/50">The car buttons work until your trip ends.</p>}
    </section>
  );
}

function Ring({ done, total, all }: { done: number; total: number; all: boolean }) {
  const r = 22, C = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 56 56" className="h-14 w-14 shrink-0" aria-hidden>
      <circle cx="28" cy="28" r={r} fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="6" />
      <circle cx="28" cy="28" r={r} fill="none" stroke={all ? "#34d399" : "var(--trip-accent)"} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={`${(done / total) * C} ${C}`} transform="rotate(-90 28 28)" style={{ transition: "stroke-dasharray 600ms cubic-bezier(.2,.8,.2,1)" }} />
      <text x="28" y="33" textAnchor="middle" fontSize="15" fontWeight="700" fill="#fff">{done}/{total}</text>
    </svg>
  );
}
