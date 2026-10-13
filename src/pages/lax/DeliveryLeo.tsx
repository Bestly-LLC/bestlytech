/**
 * Leo on the delivery trip page (2026-10-12). Headless: no widget, no sheet. The orb IS Leo.
 *  - LeoHero: the orb (tap to talk, in place), what Leo is doing right now, his lines, "Type instead".
 *  - AskChips: the five "Ask me anything" questions from the printed card. Tapping one sends it to Leo.
 *  - LeoCard: read-only summaries of what Leo's tools return (charging, Superchargers, car, climate).
 * The session itself is useLeoSession.ts (the same code LeoScreen uses), so Leo behaves the same everywhere.
 *
 * The orb reacts to volume: Leo's voice while he talks, the guest's mic while Leo listens. Smoothed, written straight to
 * the element's transform (no re-render per frame), and scale only. Reduce Motion: no scale, the glow just brightens.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Keyboard, Loader2, Mic, MicOff, PhoneOff, Volume2 } from "lucide-react";
import type { Card, Item, useLeoSession } from "./useLeoSession";

type Sess = ReturnType<typeof useLeoSession>;
const nw = (s: ReactNode) => <span className="whitespace-nowrap">{s}</span>;

const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Orb + glow, driven by the session's volume. */
function Orb({ sess, onTap }: { sess: Sess; onTap: () => void }) {
  const orb = useRef<HTMLButtonElement>(null);
  const glow = useRef<HTMLSpanElement>(null);
  const live = sess.phase === "live";
  const wait = sess.phase === "connecting";
  const cur = useRef(sess); cur.current = sess; // read per frame, so the effect doesn't restart on every render
  useEffect(() => {
    const o = orb.current, g = glow.current;
    if (!o || !g) return;
    if (!live) { o.style.transform = ""; g.style.transform = ""; g.style.opacity = ""; return; }
    const calm = reduced();
    let raf = 0, v = 0;
    const tick = () => {
      const c = cur.current, l = c.levels();
      const target = Math.min(1, Math.max(0, c.speaking ? l.out * 1.6 : c.voice && !c.muted ? l.in * 1.1 : 0));
      v += (target - v) * 0.22; // smoothing: rises quickly, settles softly
      if (calm) { g.style.opacity = String(0.8 + v * 0.2); }
      else {
        o.style.transform = `scale(${(1 + v * 0.13).toFixed(4)})`;
        g.style.transform = `scale(${(0.98 + v * 0.28).toFixed(4)})`;
        g.style.opacity = String(Math.min(1, 0.78 + v * 0.3).toFixed(3));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live]);
  const label = wait ? "Connecting to Leo" : live ? (sess.voice ? (sess.muted ? "Unmute the microphone" : "Mute the microphone") : "Switch to voice") : "Talk to Leo";
  return (
    <div className="dl-stage" aria-hidden={false}>
      <span ref={glow} aria-hidden className={`dl-glow ${live ? "" : wait ? "dl-glow-wait" : "dl-glow-idle"}`} />
      <button ref={orb} type="button" className="dl-orb" data-live={live} onClick={onTap} disabled={wait} aria-label={label} aria-busy={wait || undefined}>
        {wait && <Loader2 className="h-8 w-8 animate-spin motion-reduce:animate-none" style={{ color: "rgba(74,34,8,.75)" }} aria-hidden />}
      </button>
    </div>
  );
}

export function LeoHero({ sess, line, typing, setTyping }: { sess: Sess; line: string; typing: boolean; setTyping: (v: boolean) => void }) {
  const { phase, voice, speaking, muted, working, locked } = sess;
  const input = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const live = phase === "live";
  const onTap = () => {
    if (phase === "connecting") return;
    if (!live) { void sess.start(true); return; }   // idle or ended: start a voice call
    void sess.toggleMic();                          // text session: switch to voice. voice call: mute / unmute
  };
  const status = phase === "connecting" ? "Connecting"
    : live ? (voice ? (speaking ? "Leo is talking" : muted ? "Muted. Tap to unmute" : "Listening. Go ahead") : "Chatting. Tap to talk instead")
    : phase === "ended" ? "Call ended. Tap to talk again" : "Tap to talk to me";
  const go = () => { const t = text.trim(); if (!t) return; setText(""); void sess.send(t); };
  useEffect(() => { if (typing) window.setTimeout(() => input.current?.focus(), 80); }, [typing]);
  // The newest line is the one on screen: bring it into view when it arrives.
  const end = useRef<HTMLDivElement>(null);
  const shown = sess.items.slice(1);
  useEffect(() => { if (shown.length) end.current?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "nearest" }); }, [shown.length, working]);

  return (
    <section id="leo" aria-label="Leo, your trip helper" className="scroll-mt-4">
      <Orb sess={sess} onTap={onTap} />
      <p className="-mt-1 text-center text-[15px] font-semibold" style={{ color: "var(--d-ink)" }} aria-live="polite">{status}</p>
      <h1 className="mt-3 text-center text-[46px] font-bold leading-[1.02] tracking-[-0.015em]" style={{ fontFamily: "var(--trip-title-font)", color: "var(--d-ink)" }}>Hi, I'm Leo.</h1>
      <p className="mx-auto mt-3 max-w-[20rem] text-center text-[18px] leading-snug" style={{ color: "var(--d-body)" }}>{line}</p>

      {live && voice && (
        <div className="mt-4 flex items-center justify-center gap-2.5">
          <button type="button" onClick={() => void sess.toggleMic()} aria-pressed={muted}
            className="flex min-h-[48px] items-center gap-2 rounded-full bg-white/70 px-5 text-[15px] font-semibold ring-1 ring-[rgba(19,40,42,0.16)] active:scale-[0.97]">
            {muted ? <MicOff className="h-4 w-4" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}{muted ? "Unmute" : "Mute"}
          </button>
          <button type="button" onClick={() => void sess.endCall()}
            className="flex min-h-[48px] items-center gap-2 rounded-full bg-[#13282A] px-5 text-[15px] font-semibold text-white active:scale-[0.97]">
            <PhoneOff className="h-4 w-4" aria-hidden />End call
          </button>
        </div>
      )}
      {locked && (
        <button type="button" onClick={sess.unlockAudio}
          className="mx-auto mt-4 flex min-h-[52px] w-full max-w-xs items-center justify-center gap-2 rounded-2xl bg-[#E2733A] text-[16px] font-bold text-[#13282A] shadow-md active:scale-[0.99]">
          <Volume2 className="h-5 w-5" aria-hidden />Tap to hear Leo
        </button>
      )}

      {(shown.length > 0 || working) && (
        <div className="mt-5 flex flex-col gap-2.5" aria-live="polite" aria-label="Conversation with Leo">
          {shown.slice(-6).map((it) => <Line key={it.id} it={it} />)}
          {working && <p className="dl-enter flex items-center gap-2 text-[15px]" style={{ color: "var(--d-body)" }}><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />{working}</p>}
          <div ref={end} />
        </div>
      )}

      {typing ? (
        <form className="mt-4 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); go(); }}>
          <label className="sr-only" htmlFor="leo-type">Message Leo</label>
          <textarea id="leo-type" ref={input} rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder="Message Leo"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } }}
            className="max-h-32 min-h-[48px] min-w-0 flex-1 resize-none rounded-3xl border-0 bg-white px-4 py-3 text-[16px] leading-snug text-[#13282A] ring-1 ring-[rgba(19,40,42,0.18)] placeholder:text-[#6A7371] focus:outline-none focus:ring-2 focus:ring-[#13282A]" />
          <button type="submit" aria-label="Send" disabled={!text.trim()}
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#13282A] text-white active:scale-95 disabled:opacity-40">
            <ArrowUp className="h-5 w-5" aria-hidden />
          </button>
        </form>
      ) : (
        <div className="mt-3 flex justify-center">
          <button type="button" onClick={() => setTyping(true)} className="flex min-h-[44px] items-center gap-2 rounded-full px-4 text-[15px] font-semibold underline decoration-[rgba(19,40,42,0.35)] underline-offset-4" style={{ color: "var(--d-ink)" }}>
            <Keyboard className="h-4 w-4" aria-hidden />Type instead
          </button>
        </div>
      )}
    </section>
  );
}

function Line({ it }: { it: Item }) {
  if (it.kind === "card") return <LeoCard card={it.card} />;
  if (it.kind === "note") return <p role={it.tone === "error" ? "alert" : undefined} className="dl-enter rounded-2xl bg-white/70 px-4 py-3 text-[15px] leading-snug ring-1 ring-[rgba(179,38,30,0.35)]" style={{ color: "#8C1C16" }}>{it.text}</p>;
  return <p className={`dl-enter dl-bubble ${it.kind === "you" ? "dl-bubble-you" : "dl-bubble-leo"}`}>{it.text}</p>;
}

/** The questions printed on the back of the card. `ask` is what Leo is sent. */
export const ASK: { label: string; ask: (where: string) => string }[] = [
  { label: "Phone key not working", ask: () => "My phone key isn't working. Can you help?" },
  { label: "Where to eat + what to do", ask: (w) => `Where should I eat, and what is there to do near ${w}?` },
  { label: "Superchargers + what it costs", ask: () => "Where are the nearest Superchargers, and what do they cost?" },
  { label: "Self-driving + valet how-to", ask: () => "How do I use self-driving and valet mode?" },
  { label: "Return steps + charge needed", ask: () => "What are the return steps, and how much charge do I need?" },
];

export function AskChips({ where, onAsk }: { where: string; onAsk: (q: string) => void }) {
  return (
    <section aria-label="Ask me anything" className="mt-6">
      <p className="px-1 text-[12px] font-semibold uppercase tracking-[0.24em]" style={{ color: "var(--d-label)" }}>Ask me anything</p>
      <ul className="mt-2.5 grid gap-1.5">
        {ASK.map((a) => (
          <li key={a.label}>
            <button type="button" onClick={() => onAsk(a.ask(where))}
              className="flex min-h-[48px] w-full items-center gap-3.5 rounded-2xl bg-white/[0.66] px-4 text-left text-[16px] font-medium leading-snug ring-1 ring-[rgba(19,40,42,0.10)] transition-transform duration-100 active:scale-[0.985] motion-reduce:transition-none"
              style={{ color: "var(--d-ink)" }}>
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--d-dot)" }} />
              <span className="min-w-0 flex-1">{a.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const money = (n: unknown) => `$${Number(n ?? 0).toFixed(2)}`;
const mi = (n: unknown) => (n == null ? "" : Number(n) < 10 ? Number(n).toFixed(1) : String(Math.round(Number(n))));
type Any = Record<string, unknown>;

/** What a Leo tool returned, shown under the orb as a quiet card. Read-only: Leo (or the page's own buttons) does the acting. */
function LeoCard({ card }: { card: Card }) {
  const sub = { color: "var(--d-body)" } as const;
  const box = (title: string, children: ReactNode) => (
    <section className="dl-enter rounded-3xl bg-white/[0.72] p-4 ring-1 ring-[rgba(19,40,42,0.10)]">
      <p className="text-[12px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--d-label)" }}>{title}</p>
      <div className="mt-1.5">{children}</div>
    </section>
  );
  switch (card.type) {
    case "climate": {
      const on = !!card.on && card.mode !== "off", mode = String(card.mode ?? "off");
      const head = !on ? <>Climate is off</> : mode === "cool" ? <>A/C on, cooling to {nw("68°F")}</> : mode === "warm" ? <>Heat on, warming to {nw("74°F")}</> : <>Driver seat heater on</>;
      return box("Climate", <><p className="text-[19px] font-semibold leading-snug">{head}</p>
        <p className="mt-1 text-[14px]" style={sub}>{card.pending ? "Sent. The car can take up to a minute." : on && card.until ? `Turns off by itself at ${String(card.until)}` : on ? "Turns off by itself after 20 minutes" : "Ask me to start it any time."}</p></>);
    }
    case "car": {
      const locked = card.locked as boolean | null;
      return box("Your car", <div className="grid grid-cols-3 gap-2 text-center">
        <Stat big={card.battery != null ? `${card.battery}%` : "--"} small={card.range_mi != null ? `${mi(card.range_mi)} mi` : ""} />
        <Stat big={card.inside_f != null ? `${card.inside_f}°F` : "--"} small="inside" />
        <Stat big={locked == null ? "--" : locked ? "Locked" : "Open"} small={card.outside_f != null ? `${card.outside_f}°F out` : ""} />
      </div>);
    }
    case "lock": case "unlock":
      return box("Locks", <p className="text-[19px] font-semibold">{card.pending ? (card.type === "unlock" ? "Unlocking now" : "Locking now") : card.type === "lock" && card.locked ? "The car is locked" : "The car is unlocked"}</p>);
    case "superchargers": {
      const sites = (card.sites ?? []) as Any[];
      return box("Nearby Superchargers", <ul className="divide-y divide-[rgba(19,40,42,0.12)]">
        {sites.map((s) => (
          <li key={String(s.name)} className="py-2">
            <p className="text-[16px] font-semibold leading-snug">{String(s.name)}</p>
            <p className="text-[14px]" style={sub}>{nw(`${mi(s.miles)} mi`)}{s.open != null && s.total != null && <> · {nw(`${s.open} of ${s.total} open`)}</>}</p>
          </li>))}
      </ul>);
    }
    case "nav":
      return box("Navigation", <><p className="text-[18px] font-semibold leading-snug">{String(card.destination)}</p><p className="mt-1 text-[14px]" style={sub}>{card.pending ? "Sent. It shows on the car's screen in a moment." : "It's on the car's screen."}</p></>);
    case "charging": {
      const sessions = (card.sessions ?? []) as Any[];
      return box("Supercharging this trip", <>
        <p className="text-[28px] font-semibold leading-none tracking-[-0.02em]">{money(card.total)}</p>
        <p className="mt-1.5 text-[14px]" style={sub}>{nw(`${card.count ?? 0} ${Number(card.count) === 1 ? "stop" : "stops"}`)}{card.kwh ? <> · {nw(`${Number(card.kwh).toFixed(1)} kWh`)}</> : null}</p>
        {sessions.length > 0 && <ul className="mt-2 divide-y divide-[rgba(19,40,42,0.12)]">{sessions.map((x, i) => (
          <li key={i} className="flex items-baseline gap-3 py-2 text-[15px]"><span className="min-w-0 flex-1">{String(x.site ?? "")}<span className="block text-[13px]" style={sub}>{String(x.when ?? "")}</span></span><span className="whitespace-nowrap font-semibold">{x.cost != null ? money(x.cost) : ""}</span></li>))}</ul>}
        <p className="mt-2 text-[13px]" style={sub}>Billed through Turo after your trip.</p></>);
    }
    case "notice":
      return box("Good to know", <p className="text-[16px] leading-snug">{String(card.text ?? "")}</p>);
  }
  return null;
}

function Stat({ big, small }: { big: string; small: string }) {
  return (
    <div className="rounded-2xl bg-[rgba(19,40,42,0.05)] px-2 py-3">
      <p className="whitespace-nowrap text-[19px] font-semibold leading-none">{big}</p>
      {small && <p className="mt-1.5 whitespace-nowrap text-[13px]" style={{ color: "var(--d-body)" }}>{small}</p>}
    </div>
  );
}
