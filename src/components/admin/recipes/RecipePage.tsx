import { useEffect, useMemo, useRef, useState } from "react";
import { Ico, Glyph, type IconName } from "./Ico";
import { Segs, catOf, clock12, fmtDate, type FermentRow, type RecipeRow, type WorkState } from "./rx";
import { PantryChip, SrcLine, heroStyle } from "./Library";
import {
  altNote, amountOf, durRange, exampleHave, fStr, getSteps, haveFactor, haveUnits, machineChips, noteSegs, numStr, ozNote, parseQty,
  partsStr, planOf, pluralLead, resolve, shortName, snapVal, TSP, volParts, yieldAlt, yieldStr,
} from "@/lib/recipes/scale";
import { bestLabel, listWords, pantryReport } from "@/lib/recipes/pantry";
import type { LiveTimer } from "./useTimers";
import { NutritionPanel } from "./Nutrition";

export interface RecipePageProps {
  r: RecipeRow; photo?: string; work: WorkState; setWork: (patch: Partial<WorkState>) => void;
  phone: boolean; onlyOnList: boolean;
  fermenting: boolean;
  onBack: () => void; onCook: () => void; onPhoto: (f: File) => void; onNotes: (body: string) => void; onLog: (note: string) => Promise<void>;
  onFermentStart: () => Promise<void>; onAddToGroceries: (names: string[]) => Promise<void>; onSendToIpad: () => Promise<void>;
  startTimer: (key: string, label: string, sec: number, max: number | null | undefined, recipeId: number) => void;
  timers: LiveTimer[];
  onHealth: () => void;
}

export function RecipePage(p: RecipePageProps) {
  const { r, work, setWork } = p;
  const doc = r.doc;
  const pl = planOf(doc, work);
  const f = pl.eff;
  const [viewBatch, setViewBatch] = useState(1);
  const [now, setNow] = useState(() => new Date());
  const [showBar, setShowBar] = useState(false);
  const heroRef = useRef<HTMLElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [notes, setNotes] = useState(r.notes);
  const [logNote, setLogNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const notesTimer = useRef<number | null>(null);

  useEffect(() => { const iv = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(iv); }, []);
  useEffect(() => { setNotes(r.notes); }, [r.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    window.scrollTo(0, 0);
    const el = heroRef.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((es) => setShowBar(!es[0].isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [r.id]);
  useEffect(() => { setViewBatch(1); }, [pl.n]);

  const icon = catOf(doc.category).icon as IconName;
  const rep = useMemo(() => pantryReport(doc, r.pantry), [doc, r.pantry]);
  const std = [0.5, 1, 2, 3];
  const stepSize = Math.max(1, Math.round(doc.yield.amount / 8));
  const hasHave = doc.ingredients.some((i) => i.amount != null && !i.no_scale);

  const setFactor = (v: number) => setWork({ factor: v, have: null, split: false });
  const y = yieldStr(doc, work.factor).replace(/^about /, "");
  const yAlt = yieldAlt(doc, work.factor);
  const batch = pl.n > 1 ? Math.min(viewBatch, pl.n) : null;
  const steps = getSteps(doc, pl, batch || 1);
  const stringify = () => (p.onlyOnList ? "On the groceries list" : `Add ${rep.toBuy.length} to groceries`);

  const saveNotes = (v: string) => {
    setNotes(v);
    if (notesTimer.current) window.clearTimeout(notesTimer.current);
    notesTimer.current = window.setTimeout(() => p.onNotes(v), 800);
  };
  useEffect(() => () => { if (notesTimer.current) window.clearTimeout(notesTimer.current); }, []);

  const run = async (k: string, fn: () => Promise<void>) => { setBusy(k); try { await fn(); } finally { setBusy(null); } };

  return (
    <div className="page">
      <section ref={heroRef} className={"ph hero" + (p.photo ? " hasimg" : "")} style={heroStyle(r, p.photo)}>
        <Glyph n={icon} />
        <div className="hbar">
          <button className="frostbtn circle" onClick={p.onBack} aria-label="Close recipe"><Ico n="x" /></button>
          <div className="row" style={{ gap: 10 }}>
            {p.phone && <button className="frostbtn" disabled={busy === "ipad"} onClick={() => void run("ipad", p.onSendToIpad)}><Ico n="screen" size={20} />Send to iPad</button>}
            <button className="frostbtn" onClick={() => fileRef.current?.click()}><Ico n="camera" size={20} />Add photo</button>
            <span className="clock" aria-label="Time now">{clock12(now)}</span>
          </div>
        </div>
        <div className="foot">
          <div>
            <h2 className="ht">{doc.title}</h2>
            <div className="src"><SrcLine r={r} f={pl.capped ? pl.eff : work.factor} /></div>
          </div>
          <div className="pills">
            <button className="frostbtn" onClick={() => document.getElementById("rx-scale")?.scrollIntoView({ behavior: "smooth", block: "start" })}><Ico n="list" />Ingredients</button>
            <button className="frostbtn" onClick={p.onCook}><Ico n="whisk" />Start Cooking</button>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) p.onPhoto(file); }} />
      </section>

      <div className="rbody">
        <div className="col left" id="colL">
          <div className="panel" id="rx-scale">
            <h2>Scale <small>{Math.abs(work.factor - 1) > 1e-9 ? `Scaled to ${fStr(work.factor)}` : ""}</small></h2>
            <div className="scale-dyn">
              <div className="stepper">
                <button className="iconbtn" aria-label="Fewer servings" onClick={() => { const nv = doc.yield.amount * work.factor - stepSize; if (nv > 0) setFactor(nv / doc.yield.amount); }}><Ico n="minus" /></button>
                <div className="sval"><b>{y.split(" ")[0]}</b> {y.split(" ").slice(1).join(" ")}</div>
                <button className="iconbtn" aria-label="More servings" onClick={() => setFactor((doc.yield.amount * work.factor + stepSize) / doc.yield.amount)}><Ico n="plus" /></button>
              </div>
              <div className="seg" role="group" aria-label="Batch size">
                {([["½×", 0.5], ["1×", 1], ["2×", 2], ["3×", 3]] as const).map(([lbl, v]) => (
                  <button key={lbl} className="chip" aria-pressed={Math.abs(work.factor - v) < 1e-9} onClick={() => setFactor(v)}>{lbl}</button>
                ))}
              </div>
              {Math.abs(work.factor - 1) > 1e-9 && !std.includes(work.factor) && <button className="chip" style={{ alignSelf: "flex-start" }} onClick={() => setFactor(1)}>Reset to 1×</button>}
              {yAlt && <div className="inote">{yAlt}</div>}
              {doc.yield.max_note && work.factor > 1 + 1e-9 && <div className="note warn"><Ico n="info" /><div>{doc.yield.max_note}</div></div>}
            </div>
            {hasHave && <HaveBox key={r.id} r={r} work={work} setWork={setWork} />}
            {doc.omnicook && doc.omnicook !== "none" && (
              <div>
                <div className="omni">
                  <div><b>Tokit OmniCook 2.2 L</b><div className="inote">{work.omni ? "Showing machine steps" : "Switch on for machine steps"}</div></div>
                  <button className="hit" role="switch" aria-checked={work.omni} aria-label="Tokit OmniCook 2.2 L" onClick={() => setWork({ omni: !work.omni, split: false })}>
                    <span className="switch" aria-checked={work.omni} />
                  </button>
                </div>
                {work.omni && doc.omnicook === "converted" && <div className="note"><Ico n="info" /><div>Converted for the OmniCook. Check it the first time.</div></div>}
              </div>
            )}
          </div>

          <NutritionPanel n={doc.nutrition} onHealth={p.onHealth} />

          <div className="panel">
            <h2>Pantry <small>Basil's inventory</small></h2>
            <div className="row"><PantryChip r={r} /></div>
            {rep.low.length > 0 && <div className="inote warn">Running low: {listWords(rep.low)}.</div>}
            {rep.coming.length > 0 && <div className="inote">On the way: {listWords(rep.coming)}.</div>}
            {rep.alts.length > 0 && <div className="inote">{rep.alts.join(" ")}</div>}
            {rep.toBuy.length > 0 && (
              <button className={"btn " + (p.onlyOnList ? "" : "primary")} disabled={p.onlyOnList || busy === "gro"} onClick={() => void run("gro", () => p.onAddToGroceries(rep.toBuy))}>
                <Ico n={p.onlyOnList ? "check" : "cart"} size={20} />{stringify()}
              </button>
            )}
            {rep.best != null && (
              <div className="note">
                <Ico n="info" />
                <div className="grow">
                  <div>
                    <b>Biggest batch you can make:</b> <span className="nw">{bestLabel(rep.best)}</span>, limited by {rep.limit}
                    {rep.out.length ? ` (once you have ${listWords(rep.out)})` : ""}. Counted from the {rep.counted === 1 ? "one ingredient" : `${rep.counted} ingredients`} Basil has an amount for.
                  </div>
                  {rep.best <= 4 && Math.abs(work.factor - Math.min(rep.best, 4)) > 0.02 && <button className="btn soft" onClick={() => setFactor(Math.min(rep.best!, 4))}>Scale to {fStr(Math.min(rep.best, 4))}</button>}
                </div>
              </div>
            )}
          </div>

          <div className="panel">
            <h2>Ingredients <small>{pl.n > 1 ? `per batch, ${pl.n} batches` : ""}</small></h2>
            <ul className="ing">
              {doc.ingredients.map((ing) => {
                const a = amountOf(ing, f), oz = ozNote(ing, f), alt = altNote(ing, f), on = !!work.checked[ing.id];
                let name = ing.name;
                if (ing.unit === "count" || ing.unit === "egg") name = pluralLead(name, a.n);
                const pe = r.pantry?.[ing.id];
                return (
                  <li key={ing.id}>
                    <button className="irow" aria-pressed={on} onClick={() => setWork({ checked: { ...work.checked, [ing.id]: !on } })}>
                      <span className="ibox"><Ico n="check" /></span>
                      <span className="itext">
                        <span className="iline">
                          {!a.none && <span className="amt">{a.listLead}</span>}
                          <span className="iname">{name}</span>
                          {a.none && <span className="inote" style={{ fontSize: 16 }}>{ing.unit}</span>}
                          {oz && <span className="oz">({oz})</span>}
                          {alt && !oz && <span className="oz">({alt})</span>}
                          {ing.optional && <span className="opt">optional</span>}
                        </span>
                        {a.note && <span className="inote"><Segs segs={noteSegs(a.note)} /></span>}
                        {ing.no_scale && <span className="inote">Same at any size.</span>}
                        {ing.note && <span className="inote warn">{ing.note}</span>}
                        {pe?.status === "out" && <span className="inote warn">Used up in the pantry</span>}
                        {pe?.status === "low" && <span className="inote warn">Running low</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div className="col right">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {pl.omni && pl.cap && (() => {
              const dough = pl.cap.base * pl.eff, pct = Math.min(100, (dough / pl.cap.max) * 100);
              return (
                <>
                  <div className="note"><div className="grow">
                    <div><b>Bowl fill</b> <span className="nw">{Math.round(dough)} oz</span> of about <span className="nw">{pl.cap.max} oz</span> of dough (2.2 L bowl)</div>
                    <div className={"meter " + (dough > pl.cap.max * 1.02 ? "over" : "")}><i style={{ width: pct + "%" }} /></div>
                  </div></div>
                  {pl.capped && (
                    <div className="note warn"><Ico n="info" /><div className="grow">
                      <div>One OmniCook batch tops out at <span className="nw">{fStr(pl.cap.maxF)}</span>. You asked for <span className="nw">{fStr(work.factor)}</span>, so this shows a single <span className="nw">{fStr(pl.cap.maxF)}</span> batch.</div>
                      <button className="btn primary" onClick={() => { setViewBatch(1); setWork({ split: true }); }}>Split into {Math.ceil(work.factor / pl.cap.maxF - 1e-9)} batches</button>
                    </div></div>
                  )}
                  {pl.n > 1 && (
                    <div className="note"><Ico n="info" /><div className="grow">
                      <div>Making <span className="nw">{fStr(work.factor)}</span> as {pl.n} batches of <span className="nw">{fStr(pl.eff)}</span>. Steps are labeled Batch 1 of {pl.n}, and so on.</div>
                      <button className="btn" onClick={() => setWork({ split: false })}>Back to one batch</button>
                    </div></div>
                  )}
                </>
              );
            })()}
          </div>

          <div className="panel">
            {doc.ferment && (
              <div className="note" style={{ marginBottom: 6 }}>
                <Ico n="jar" />
                <div className="grow">
                  <div>
                    <b>Ferment tracker.</b> Room temperature, <span className="nw">{doc.ferment.temp_f[0]}–{doc.ferment.temp_f[1]}°F</span>, ready in <span className="nw">{doc.ferment.ready_days[0]}–{doc.ferment.ready_days[1]} days</span>.
                    After bottling, burp daily and drink within 1–2 weeks. Basil reminds you each morning.
                    {p.fermenting ? " A batch is already running (see Ferments on the library page)." : ""}
                  </div>
                  <button className="btn primary" disabled={busy === "ferm"} onClick={() => void run("ferm", p.onFermentStart)}>Start ferment</button>
                </div>
              </div>
            )}
            <h2>Steps <small>{pl.omni ? "OmniCook" : ""}</small></h2>
            {pl.n > 1 && (
              <div className="seg" role="group" aria-label="Batch">
                {Array.from({ length: pl.n }, (_, i) => <button key={i} className="chip" aria-pressed={batch === i + 1} onClick={() => setViewBatch(i + 1)}>Batch {i + 1} of {pl.n}</button>)}
              </div>
            )}
            <ol className="steps">
              {steps.map((st, i) => {
                const t = resolve(doc, st.text, f), mc = pl.omni ? machineChips(st.omni) : [];
                return (
                  <li key={i} className="step">
                    <span className="snum">{i + 1}</span>
                    <div className="sbody">
                      <div className="stitle">{st.title}{st.batchLabel && <span className="btag">{st.batchLabel}</span>}{st.added && <span className="opt">standard method, added</span>}</div>
                      <p className="stext"><Segs segs={t.segs} /></p>
                      {mc.length > 0 && <div className="mchips">{mc.map((c) => <span key={c.t} className={"mchip " + (c.k ? "k" : "")}>{c.t}</span>)}</div>}
                      {t.notes.map((n, k) => <p key={k} className="snote"><Segs segs={n} /></p>)}
                      <div className="sact">
                        {st.timer_sec ? <button className="tbtn" onClick={() => p.startTimer(`${r.id}|${i}|${viewBatch}`, st.title, st.timer_sec!, st.timer_max_sec, r.id)}><Ico n="clock" size={20} />Start {durRange(st.timer_sec, st.timer_max_sec)} timer</button> : null}
                        {st.ferment_start ? <button className="tbtn" onClick={() => void run("ferm", p.onFermentStart)}><Ico n="jar" size={20} />Start ferment</button> : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          {doc.tips && doc.tips.length > 0 && <div className="panel"><h2>Tips</h2><ul className="tips">{doc.tips.map((t) => <li key={t}>{t}</li>)}</ul></div>}
          {doc.storage && <div className="panel"><h2>Storage</h2><p>{doc.storage}</p></div>}
          {doc.equipment && doc.equipment.length > 0 && <div className="panel"><h2>You will need</h2><div className="mrow">{doc.equipment.map((e) => <span key={e} className="tag">{e}</span>)}</div></div>}

          <div className="panel">
            <h2>Notes</h2>
            <textarea className="fld" placeholder="Your own tweaks, like less sugar or a longer bake" aria-label="Notes" value={notes} onChange={(e) => saveNotes(e.target.value)} onBlur={() => { if (notesTimer.current) window.clearTimeout(notesTimer.current); p.onNotes(notes); }} />
            <h2 style={{ fontSize: 17 }}>Cook log</h2>
            <div className="log">
              {r.cooks.length ? r.cooks.map((c) => (
                <div key={c.id} className="logrow"><b>Made it {fmtDate(new Date(c.cooked_at))}</b>{c.summary ? <> · {c.summary}</> : null}{c.omni ? " · OmniCook" : ""}{c.note ? <> · {c.note}</> : null}</div>
              )) : <p className="muted">No cooks logged yet.</p>}
            </div>
            <div className="row">
              <input className="fld" placeholder="How did it turn out?" aria-label="Cook log note" style={{ flex: 1, minWidth: 180 }} autoComplete="off" value={logNote} onChange={(e) => setLogNote(e.target.value)} />
              <button className="btn soft" disabled={busy === "log"} onClick={() => void run("log", async () => { await p.onLog(logNote.trim()); setLogNote(""); })}>Log this cook</button>
            </div>
          </div>

          {doc.flags && doc.flags.length > 0 && (
            <details className="flags panel">
              <summary><Ico n="info" size={20} />Check this <span className="tag">{doc.flags.length}</span></summary>
              <ul>{doc.flags.map((x) => <li key={x}>{x}</li>)}</ul>
            </details>
          )}
        </div>
      </div>

      <div className={"actionbar" + (showBar ? " show" : "")}><button className="btn primary big" onClick={p.onCook} tabIndex={showBar ? 0 : -1}><span>Start Cooking</span></button></div>
    </div>
  );
}

/* ---- "I only have..." ---- */
function HaveBox({ r, work, setWork }: { r: RecipeRow; work: WorkState; setWork: (p: Partial<WorkState>) => void }) {
  const doc = r.doc;
  const items = doc.ingredients.filter((i) => i.amount != null && !i.no_scale);
  const [ingId, setIngId] = useState(items[0]?.id ?? "");
  const ing = items.find((i) => i.id === ingId) ?? items[0];
  const units = ing ? haveUnits(ing) : [];
  const [unit, setUnit] = useState(units[0] ?? "");
  const [amt, setAmt] = useState("");
  const [msg, setMsg] = useState<{ t: string; err: boolean } | null>(null);
  const ex = exampleHave(doc);

  const apply = (id: string, a: string, u: string) => {
    const i = items.find((x) => x.id === id);
    if (!i) return;
    if (!a.trim()) { setMsg(null); return; }
    const q = parseQty(a), fct = haveFactor(i, q, u);
    if (Number.isNaN(fct) || fct <= 0) { setMsg({ t: "Enter an amount like 2, 1/2 or 1½.", err: true }); return; }
    const hv = TSP[u] ? partsStr(volParts(q * TSP[u])) : (numStr(q) + " " + (u === "count" ? "" : u)).trim();
    setWork({ factor: fct, split: false, have: { desc: hv + " " + shortName(i.name), ing: i.id } });
    setMsg({ t: `Everything now scaled to ${fStr(fct)}, makes ${yieldStr(doc, fct)}.`, err: false });
  };
  void snapVal;

  return (
    <div className="have">
      <h3>I only have</h3>
      <div className="frow">
        <select className="fld" aria-label="Ingredient you have" value={ingId} onChange={(e) => {
          const id = e.target.value; setIngId(id);
          const i = items.find((x) => x.id === id)!; const us = haveUnits(i); const nu = us.includes(unit) ? unit : us[0]; setUnit(nu); apply(id, amt, nu);
        }}>
          {items.map((i) => <option key={i.id} value={i.id}>{shortName(i.name)}</option>)}
        </select>
        <input className="fld" inputMode="decimal" placeholder="Amount" aria-label="Amount you have" autoComplete="off" value={amt} onChange={(e) => { setAmt(e.target.value); apply(ingId, e.target.value, unit); }} />
        <select className="fld" aria-label="Unit" value={unit} onChange={(e) => { setUnit(e.target.value); apply(ingId, amt, e.target.value); }}>
          {units.map((u) => <option key={u} value={u}>{u === "count" ? "whole" : u}</option>)}
        </select>
      </div>
      <div className={"hout" + (msg?.err ? " err" : "")} role="status">{msg?.t ?? (work.have ? `Scaled to ${work.have.desc}.` : "")}</div>
      <button className="chip" style={{ alignSelf: "flex-start" }} onClick={() => { setIngId(ex.id); setUnit(ex.unit); setAmt(ex.amt); apply(ex.id, ex.amt, ex.unit); }}>Try: have {ex.label}</button>
    </div>
  );
}
