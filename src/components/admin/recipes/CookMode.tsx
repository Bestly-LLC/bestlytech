import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Ico } from "./Ico";
import { RxPortal, Segs, call, supportsSpeech, type RecipeCommand, type RecipeRow, type WorkState } from "./rx";
import { amountOf, durRange, getSteps, machineChips, planOf, pluralLead, resolve, shortName, usedIds } from "@/lib/recipes/scale";
import { unlockAudio } from "./useTimers";

interface SpeechRec {
  continuous: boolean; interimResults: boolean; lang: string; start: () => void; stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null;
}
const makeRec = (): SpeechRec | null => {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return C ? new C() : null;
};

export interface CookProps {
  r: RecipeRow; work: WorkState; setWork: (p: Partial<WorkState>) => void; voiceOn: boolean;
  onClose: () => void; onLog: (note: string) => Promise<void>;
  startTimer: (key: string, label: string, sec: number, max: number | null | undefined, recipeId: number) => void;
  stopTimer: (key?: string) => boolean;
  onFermentStart: () => Promise<void>;
  register: (h: ((c: RecipeCommand) => void) | null) => void;
}

export function CookMode(p: CookProps) {
  const { r, work } = p;
  const doc = r.doc;
  const pl = planOf(doc, work);
  const steps = useMemo(() => getSteps(doc, pl, null), [doc, pl]);
  const n = steps.length;
  const [i, setI] = useState(0);
  const [done, setDone] = useState(false);
  const [dir, setDir] = useState<"next" | "back" | "">("next");
  const [mic, setMic] = useState(false);
  const [heard, setHeard] = useState("");
  const [wake, setWake] = useState(false);
  const mainRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<SpeechRec | null>(null);
  const micOn = useRef(false);
  const live = useRef({ i, done, n });
  live.current = { i, done, n };

  /* screen stays on */
  const lockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const wakeOn = useCallback(async () => {
    try {
      const nav = navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void>; addEventListener: (e: string, f: () => void) => void }> } };
      if (nav.wakeLock && !lockRef.current) {
        const l = await nav.wakeLock.request("screen");
        lockRef.current = l; setWake(true);
        l.addEventListener("release", () => { lockRef.current = null; setWake(false); });
      }
    } catch { lockRef.current = null; setWake(false); }
  }, []);
  useEffect(() => {
    unlockAudio();
    void wakeOn();
    const vis = () => { if (document.visibilityState === "visible") void wakeOn(); };
    document.addEventListener("visibilitychange", vis);
    return () => { document.removeEventListener("visibilitychange", vis); void lockRef.current?.release().catch(() => undefined); lockRef.current = null; };
  }, [wakeOn]);

  /* tell Basil cook mode is open, so "Hey Scout, next step" reaches this page */
  useEffect(() => {
    const ping = (active: boolean) => void call("recipe_cook_ping", { p_recipe_id: r.id, p_step: live.current.i, p_active: active }).catch(() => undefined);
    ping(true);
    const iv = setInterval(() => ping(true), 45_000);
    return () => { clearInterval(iv); ping(false); };
  }, [r.id]);
  useEffect(() => { void call("recipe_cook_ping", { p_recipe_id: r.id, p_step: i, p_active: true }).catch(() => undefined); }, [i, r.id]);

  const go = useCallback((d: 1 | -1) => {
    const L = live.current;
    if (L.done) return;
    if (d > 0) { if (L.i >= L.n - 1) { setDone(true); setDir("next"); return; } setI(L.i + 1); setDir("next"); }
    else if (L.i > 0) { setI(L.i - 1); setDir("back"); }
    mainRef.current?.scrollTo({ top: 0 });
  }, []);

  const step = steps[i];
  const f = pl.eff;
  const used = useMemo(() => usedIds(doc, steps), [doc, steps]);
  const inCount = used.filter((id) => work.checked[id]).length;

  const readAloud = useCallback(() => {
    const L = live.current; const st = steps[L.i]; if (!st) return;
    const plain = st.title + ". " + resolve(doc, st.text, f).plain;
    try {
      if ("speechSynthesis" in window) { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(plain)); }
      else toast("Reading aloud isn't available in this browser");
    } catch { /* no speech */ }
  }, [steps, doc, f]);

  const timerForStep = useCallback(() => {
    const st = steps[live.current.i];
    if (!st?.timer_sec) { toast("There is no timer on this step"); return false; }
    p.startTimer(`${r.id}|c|${live.current.i}`, st.title, st.timer_sec, st.timer_max_sec, r.id);
    return true;
  }, [steps, r.id, p]);
  const stopStepTimer = useCallback(() => { p.stopTimer(`${r.id}|c|${live.current.i}`); }, [p, r.id]);

  /* commands from Basil (Hey Scout over the voice path) arrive through Realtime */
  const seen = useRef<Set<number>>(new Set());
  useEffect(() => {
    p.register((c) => {
      if (seen.current.has(c.id)) return;
      seen.current.add(c.id);
      if (c.action === "next") go(1);
      else if (c.action === "back") go(-1);
      else if (c.action === "repeat") readAloud();
      else if (c.action === "start_timer") timerForStep();
      else if (c.action === "stop_timer") stopStepTimer();
      void call("recipe_command_done", { p_id: c.id }).catch(() => undefined);
    });
    return () => p.register(null);
  }, [p, go, readAloud, timerForStep, stopStepTimer]);

  /* keys */
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === "ArrowRight") go(1); else if (e.key === "ArrowLeft") go(-1); else if (e.key === "Escape") p.onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [go, p]);

  /* voice, in this browser */
  const stopMic = useCallback(() => { micOn.current = false; setMic(false); try { recRef.current?.stop(); } catch { /* already stopped */ } recRef.current = null; }, []);
  useEffect(() => stopMic, [stopMic]);
  const voiceCmd = useCallback((t: string) => {
    if (/start (the )?timer/.test(t)) timerForStep();
    else if (/stop (the )?timer|cancel (the )?timer/.test(t)) stopStepTimer();
    else if (/\b(next|continue|forward)\b/.test(t)) go(1);
    else if (/\b(back|previous|go back)\b/.test(t)) go(-1);
    else if (/\b(repeat|again|say that)\b/.test(t)) readAloud();
  }, [go, readAloud, timerForStep, stopStepTimer]);
  const toggleMic = () => {
    if (micOn.current) { stopMic(); return; }
    const rec = makeRec();
    if (!rec) { toast("Voice commands need Safari or Chrome", { description: "Use Back and Next for now." }); return; }
    try {
      rec.continuous = true; rec.interimResults = false; rec.lang = "en-US";
      rec.onresult = (e) => { const res = e.results[e.results.length - 1][0].transcript.trim().toLowerCase(); setHeard(res); voiceCmd(res); };
      rec.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { stopMic(); toast("I can't hear you yet", { description: "Allow the microphone for this page, or use Next and Back." }); } };
      rec.onend = () => { if (micOn.current) { try { rec.start(); } catch { /* restarting */ } } };
      rec.start(); recRef.current = rec; micOn.current = true; setMic(true);
    } catch { stopMic(); toast("Voice could not start", { description: "Use Back and Next for now." }); }
  };

  /* swipe */
  const sw = useRef<{ x: number; y: number; dx: number } | null>(null);
  const stepEl = () => mainRef.current?.firstElementChild as HTMLElement | null;
  const onDown = (e: React.PointerEvent) => { if ((e.target as HTMLElement).closest("button")) return; sw.current = { x: e.clientX, y: e.clientY, dx: 0 }; };
  const onMove = (e: React.PointerEvent) => {
    const s = sw.current; if (!s) return;
    s.dx = e.clientX - s.x;
    if (Math.abs(s.dx) > 10 && Math.abs(s.dx) > Math.abs(e.clientY - s.y)) {
      const el = stepEl(); if (el) { el.style.transition = ""; el.style.transform = `translateX(${(s.dx * 0.45) / (1 + Math.abs(s.dx) / 260)}px)`; }
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const s = sw.current; if (!s) return; sw.current = null;
    const el = stepEl(); if (el) { el.style.transition = "transform .25s cubic-bezier(.2,.9,.3,1)"; el.style.transform = ""; }
    const dy = e.clientY - s.y;
    if (Math.abs(s.dx) > 70 && Math.abs(s.dx) > Math.abs(dy) * 1.5) go(s.dx < 0 ? 1 : -1);
  };

  const speech = supportsSpeech();
  const line = !speech ? "Voice isn't available in this browser. Tap Next and Back, or swipe."
    : mic ? (heard ? `Heard “${heard}”. ` : "Listening. ") + "Say next, back, repeat, start timer or stop timer."
    : "Tap the mic to use your voice: next, back, repeat, start timer, stop timer.";
  const C = 2 * Math.PI * 26;
  const last = !done && i === n - 1;
  const t = step ? resolve(doc, step.text, f) : null;
  const ids = step ? usedIds(doc, [step]) : [];
  const mc = pl.omni && step ? machineChips(step.omni) : [];

  return (
    <RxPortal>
      <div className="cook" role="dialog" aria-modal="true" aria-label={`Cooking ${doc.title}`}>
        <div className="ctop">
          <button className="iconbtn" onClick={p.onClose} aria-label="Close cook mode"><Ico n="x" /></button>
          <div className="cmeta">
            <div className="cr">{doc.title}</div>
            <div className="cs">{done ? "Finished" : `Step ${i + 1} of ${n}${step?.batchLabel ? " · " + step.batchLabel : ""}`}</div>
          </div>
          <div className="ring" aria-label={`${inCount} of ${used.length} ingredients in`}>
            <svg viewBox="0 0 64 64"><circle className="tr" cx="32" cy="32" r="26" /><circle className="fg" cx="32" cy="32" r="26" strokeDasharray={C.toFixed(2)} strokeDashoffset={(C * (1 - (used.length ? inCount / used.length : 0))).toFixed(2)} /></svg>
            <span>{inCount}/{used.length}<small>in</small></span>
          </div>
          <button className="iconbtn micb" onClick={toggleMic} aria-pressed={mic} aria-label="Voice commands"><Ico n="mic" /></button>
        </div>
        <div className="cprog" aria-hidden="true">{steps.map((_, k) => <i key={k} className={done || k < i ? "d" : k === i ? "n" : ""} />)}</div>

        {done ? (
          <div className="cmain" style={{ gridTemplateColumns: "1fr" }}>
            <div className="cstep cdone">
              <div className="ctitle">Done. Nice work.</div>
              <p className="ctext">Log this cook so Basil remembers what you made and how much.</p>
              <div className="row">
                <button className="btn primary big" onClick={() => void p.onLog("").then(p.onClose)}>Log this cook</button>
                <button className="btn big" onClick={p.onClose}>Close</button>
              </div>
            </div>
          </div>
        ) : step && t ? (
          <div className="cmain" ref={mainRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { sw.current = null; const el = stepEl(); if (el) el.style.transform = ""; }}>
            <div key={i} className={"cstep " + (dir === "back" ? "in-back" : dir === "next" ? "in-next" : "")}>
              <div className="ctitle">{step.title}</div>
              <p className="ctext"><Segs segs={t.segs} /></p>
              {t.notes.map((x, k) => <p key={k} className="cnote"><Segs segs={x} /></p>)}
              {mc.length > 0 && <div className="mchips big">{mc.map((c) => <span key={c.t} className={"mchip " + (c.k ? "k" : "")}>{c.t}</span>)}</div>}
              <div className="sact">
                {step.timer_sec ? <button className="btn primary big" onClick={timerForStep}><Ico n="clock" size={22} />Start {durRange(step.timer_sec, step.timer_max_sec)} timer</button> : null}
                {step.ferment_start ? <button className="btn big" onClick={() => void p.onFermentStart()}><Ico n="jar" size={22} />Start ferment</button> : null}
              </div>
            </div>
            <aside className="cside">
              <h3>{ids.length ? "In this step" : "Ingredients"}</h3>
              {ids.length ? ids.map((id) => {
                const ing = doc.ingredients.find((x) => x.id === id)!;
                const a = amountOf(ing, f);
                let nm = shortName(ing.name);
                if (ing.unit === "count" || ing.unit === "egg") nm = pluralLead(nm, a.n);
                const lead = a.none ? "" : ing.unit === "count" || ing.unit === "egg" ? a.listLead : a.str;
                const on = !!work.checked[id];
                return (
                  <button key={id} className={"ichip " + (on ? "on" : "")} aria-pressed={on} onClick={() => p.setWork({ checked: { ...work.checked, [id]: !on } })}>
                    <span className="box"><Ico n="check" /></span>
                    <span className="tx"><span className="ca nw">{lead}</span><span className="cn">{nm}</span></span>
                  </button>
                );
              }) : <p className="cnote">No ingredients to add in this step.</p>}
            </aside>
          </div>
        ) : null}

        <div className="cline" aria-live="polite">{line}</div>
        {!done && (
          <div className="cnav">
            <button className="btn" onClick={() => go(-1)} disabled={i === 0}><Ico n="back" />Back</button>
            <button className="btn primary" onClick={() => go(1)}>{last ? "Finish" : "Next"}<Ico n={last ? "check" : "next"} /></button>
          </div>
        )}
        <div className="cfoot">
          <button onClick={readAloud}><Ico n="repeat" size={18} />Read it aloud</button>
          <span className="nw" style={{ alignSelf: "center" }}>{wake ? "Screen stays on" : ""}</span>
        </div>
      </div>
    </RxPortal>
  );
}
