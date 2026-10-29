import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Ico } from "./Ico";
import { CATEGORY_NAMES, RxPortal, call, type ParseJob } from "./rx";
import { numStr, parseQty } from "@/lib/recipes/scale";
import { SCALABLE_UNITS, normalizeDraft } from "@/lib/recipes/draft";
import type { RecipeDoc, RIngredient } from "@/lib/recipes/types";

type Stage = { s: "choose" } | { s: "parsing"; kind: "photo" | "link"; thumb?: string; label: string } | { s: "review"; kind: "photo" | "link"; thumb?: string; link?: string; draft: RecipeDoc; review: string[]; model: string | null };

const db = supabase as unknown as { from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: ParseJob | null; error: { message: string } | null }> } } } };

/** Shrinks a camera photo to a JPEG the free vision models accept (their limit is about 4 MB), and turns HEIC into JPEG on the way. */
async function toJpeg(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) {
    if (/jpe?g/i.test(file.type)) return file;
    throw new Error("This browser could not open that photo. Try a JPEG.");
  }
  const max = 1800, scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.85));
  if (!blob) throw new Error("Could not prepare the photo.");
  return blob;
}

export function AddRecipeSheet(props: {
  open: boolean; presetLink?: string | null; phone: boolean; onClose: () => void; onSaved: (name: string) => void;
  onSendLinkToIpad: (url: string) => Promise<void>;
}) {
  const [stage, setStage] = useState<Stage>({ s: "choose" });
  const [link, setLink] = useState("");
  const [err, setErr] = useState("");
  const cancelled = useRef(false);
  const camRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const started = useRef<string | null>(null);

  const reset = useCallback(() => { cancelled.current = true; setStage({ s: "choose" }); setLink(""); setErr(""); started.current = null; }, []);
  const close = useCallback(() => { reset(); props.onClose(); }, [reset, props]);

  const watch = useCallback(async (jobId: string, kind: "photo" | "link", thumb?: string, linkUrl?: string) => {
    cancelled.current = false;
    const t0 = Date.now();
    const labels = kind === "link" ? ["Fetching the page", "Keeping just the ingredients and steps", "Matching your recipe format"] : ["Reading the card", "Finding ingredients and amounts", "Writing the steps"];
    let k = 0;
    setStage({ s: "parsing", kind, thumb, label: labels[0] });
    while (!cancelled.current) {
      await new Promise((r) => setTimeout(r, 2000));
      if (cancelled.current) return;
      const { data, error } = await db.from("recipe_parse_jobs").select("id, kind, source, status, attempts, error, result, model").eq("id", jobId).maybeSingle();
      if (error) { setErr(error.message); setStage({ s: "choose" }); return; }
      if (data?.status === "done" && data.result?.draft) {
        setStage({ s: "review", kind, thumb, link: linkUrl, draft: normalizeDraft(data.result.draft), review: data.result.review ?? [], model: (data as unknown as { model?: string }).model ?? null });
        return;
      }
      if (data?.status === "failed") { setErr(data.error ?? "Basil could not read that."); setStage({ s: "choose" }); return; }
      k = Math.min(labels.length - 1, k + 1);
      setStage({ s: "parsing", kind, thumb, label: data?.status === "queued" && Date.now() - t0 > 20_000 ? "Waiting for a free model. Basil retries on his own." : labels[k] });
      if (Date.now() - t0 > 5 * 60_000) { setErr("This is taking too long. Basil keeps trying in the background; open Add again in a few minutes."); setStage({ s: "choose" }); return; }
    }
  }, []);

  const startLink = useCallback(async (raw: string) => {
    const v = raw.trim();
    if (!/^https:\/\/\S+\.\S+/i.test(v)) { setErr("Paste a full link that starts with https://, like https://example.com/recipe."); return; }
    setErr("");
    try {
      const id = await call<string>("recipe_parse_enqueue", { p_kind: "link", p_source: v });
      void supabase.functions.invoke("recipe-parse", { body: { job_id: id } });
      void watch(id, "link", undefined, v);
    } catch (e) { setErr((e as Error).message); }
  }, [watch]);

  // A link sent from the iPhone opens here already filled in, and starts reading it.
  useEffect(() => {
    if (props.open && props.presetLink && started.current !== props.presetLink) {
      started.current = props.presetLink; setLink(props.presetLink); void startLink(props.presetLink);
    }
    if (!props.open) started.current = null;
  }, [props.open, props.presetLink, startLink]);

  const onPhoto = async (file: File) => {
    setErr("");
    const thumb = URL.createObjectURL(file);
    setStage({ s: "parsing", kind: "photo", thumb, label: "Preparing the photo" });
    try {
      const blob = await toJpeg(file);
      const path = `recipes/parse/${crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from("recipe-photos").upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (up.error) throw new Error(up.error.message);
      const id = await call<string>("recipe_parse_enqueue", { p_kind: "photo", p_source: path });
      void supabase.functions.invoke("recipe-parse", { body: { job_id: id } });
      void watch(id, "photo", thumb);
    } catch (e) { setErr((e as Error).message); setStage({ s: "choose" }); }
  };

  if (!props.open) return null;
  return (
    <RxPortal>
      <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }} onKeyDown={(e) => { if (e.key === "Escape") close(); }}>
        <div className="sheet" role="dialog" aria-modal="true" aria-label="Add a recipe">
          {stage.s === "choose" && (
            <>
              <div className="shead"><h2>Add a recipe</h2><button className="iconbtn" onClick={close} aria-label="Close"><Ico n="x" /></button></div>
              <p className="muted">Snap a printed card or paste a web link. Basil reads it and shows you the result to check before saving.</p>
              <button className="opt-btn" onClick={() => camRef.current?.click()}><span className="ic"><Ico n="camera" /></span><span><b>Take photo</b><small>Use the camera on a printed card</small></span></button>
              <button className="opt-btn" onClick={() => pickRef.current?.click()}><span className="ic"><Ico n="image" /></span><span><b>Choose photo</b><small>Pick one from your library</small></span></button>
              <div className="have">
                <h3>Paste a link</h3>
                <div className="row">
                  <input className="fld" placeholder="https://" inputMode="url" autoCapitalize="none" autoCorrect="off" style={{ flex: 1, minWidth: 200 }} aria-label="Recipe link" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void startLink(link); }} />
                  <button className="btn primary" onClick={() => void startLink(link)}>Read link</button>
                  {props.phone && <button className="btn" onClick={() => void props.onSendLinkToIpad(link.trim()).then(() => { toast("Sent to the iPad", { description: "It will ask to read the link." }); close(); }).catch((e: Error) => setErr(e.message))}><Ico n="screen" size={20} />Send to iPad</button>}
                </div>
              </div>
              {err && <div className="hout err" role="alert">{err}</div>}
              <p className="muted" style={{ fontSize: 13.5 }}>Read by Basil's free AI models. Nothing is sent to a paid model.</p>
            </>
          )}
          {stage.s === "parsing" && (
            <>
              <div className="shead"><h2>Reading your {stage.kind === "link" ? "link" : "card"}</h2><button className="iconbtn" onClick={close} aria-label="Cancel"><Ico n="x" /></button></div>
              {stage.thumb && <img className="thumb" alt="Your photo" src={stage.thumb} />}
              <div className="prog"><div className="bar"><i className="ind" /></div><div style={{ fontWeight: 650 }}>{stage.label}</div>
                <div className="muted" style={{ fontSize: 13.5 }}>Free models only. This usually takes under a minute.</div></div>
            </>
          )}
          {stage.s === "review" && <Review stage={stage} onCancel={close} onSaved={(name) => { reset(); props.onSaved(name); }} />}
        </div>
      </div>
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void onPhoto(f); }} />
      <input ref={pickRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void onPhoto(f); }} />
    </RxPortal>
  );
}

function Review({ stage, onCancel, onSaved }: { stage: Extract<Stage, { s: "review" }>; onCancel: () => void; onSaved: (name: string) => void }) {
  const [d, setD] = useState<RecipeDoc>(stage.draft);
  const [amts, setAmts] = useState<string[]>(() => stage.draft.ingredients.map((i) => (i.amount == null ? "" : numStr(i.amount))));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const flags = [...stage.review, ...(stage.draft.flags ?? [])];

  const setIng = (k: number, p: Partial<RIngredient>) => setD((x) => ({ ...x, ingredients: x.ingredients.map((i, j) => (j === k ? { ...i, ...p } : i)) }));
  const setStep = (k: number, text: string) => setD((x) => ({ ...x, steps: x.steps.map((s, j) => (j === k ? { ...s, text } : s)) }));

  const save = async () => {
    setErr("");
    const ingredients = d.ingredients.map((i, k) => {
      const raw = amts[k].trim();
      if (!raw) return { ...i, amount: null, amount_max: undefined };
      const q = parseQty(raw);
      return Number.isNaN(q) ? i : { ...i, amount: q };
    }).filter((i) => i.name.trim());
    const doc: RecipeDoc = { ...d, ingredients, steps: d.steps.filter((s) => s.text.trim()), flags: [] };
    if (!doc.ingredients.length || !doc.steps.length) { setErr("A recipe needs at least one ingredient and one step."); return; }
    setBusy(true);
    try {
      await call("recipe_save", { p_doc: doc, p_source: stage.kind === "link" ? "link" : "photo", p_source_url: stage.link ?? null, p_photo_path: null });
      onSaved(doc.title);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  const U = [...SCALABLE_UNITS];
  return (
    <>
      <div className="shead"><h2>Check and save</h2><button className="iconbtn" onClick={onCancel} aria-label="Close"><Ico n="x" /></button></div>
      {stage.thumb && <img className="thumb" alt="Your photo" src={stage.thumb} />}
      {flags.length > 0 && <div className="note warn"><Ico n="info" /><div><b>Check these before you save.</b><ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{flags.map((f) => <li key={f}>{f}</li>)}</ul></div></div>}
      <label className="muted" htmlFor="rvTitle">Title</label>
      <input className="fld" id="rvTitle" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} />
      <div className="frow" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div><label className="muted" htmlFor="rvCat">Category</label>
          <select className="fld" id="rvCat" value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })}>
            {CATEGORY_NAMES.map((c) => <option key={c}>{c}</option>)}
          </select></div>
        <div><label className="muted" htmlFor="rvServ">Serves</label>
          <input className="fld" id="rvServ" inputMode="numeric" value={String(d.yield.amount)} onChange={(e) => { const q = parseQty(e.target.value); setD({ ...d, yield: { ...d.yield, amount: Number.isNaN(q) ? 0 : q } }); }} /></div>
      </div>
      <div className="muted" style={{ fontWeight: 650 }}>Ingredients</div>
      <div>
        {d.ingredients.map((i, k) => {
          const low = !amts[k].trim() && !/taste|optional|as needed|garnish/.test(i.unit);
          return (
            <div key={k} className="rv-row" style={{ gridTemplateColumns: "84px 104px minmax(0,1fr) 44px" }}>
              <input className={"fld" + (low ? " low" : "")} value={amts[k]} inputMode="decimal" placeholder="Amount" aria-label={`Amount for ${i.name}`} onChange={(e) => setAmts((a) => a.map((v, j) => (j === k ? e.target.value : v)))} />
              {amts[k].trim() ? (
                <select className="fld" aria-label={`Unit for ${i.name}`} value={U.includes(i.unit as typeof U[number]) ? i.unit : "count"} onChange={(e) => setIng(k, { unit: e.target.value })}>
                  {U.map((u) => <option key={u} value={u}>{u === "count" ? "whole" : u}</option>)}
                </select>
              ) : (
                <input className="fld" aria-label={`Note for ${i.name}`} value={i.unit} placeholder="to taste" onChange={(e) => setIng(k, { unit: e.target.value })} />
              )}
              <input className="fld" aria-label="Ingredient name" value={i.name} onChange={(e) => setIng(k, { name: e.target.value })} />
              <button className="iconbtn" aria-label={`Remove ${i.name}`} onClick={() => { setD((x) => ({ ...x, ingredients: x.ingredients.filter((_, j) => j !== k) })); setAmts((a) => a.filter((_, j) => j !== k)); }}><Ico n="x" size={18} /></button>
            </div>
          );
        })}
        <button className="chip" onClick={() => { setD((x) => ({ ...x, ingredients: [...x.ingredients, { id: `n${x.ingredients.length + 1}x`, name: "", amount: null, unit: "to taste" }] })); setAmts((a) => [...a, ""]); }}><Ico n="plus" size={18} />Add ingredient</button>
      </div>
      <div className="muted" style={{ fontWeight: 650 }}>Steps</div>
      {d.steps.map((s, k) => (
        <div key={k} className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
          <textarea className="fld" aria-label={`Step ${k + 1}`} style={{ minHeight: 70, flex: 1 }} value={s.text} onChange={(e) => setStep(k, e.target.value)} />
          <button className="iconbtn" aria-label={`Remove step ${k + 1}`} onClick={() => setD((x) => ({ ...x, steps: x.steps.filter((_, j) => j !== k) }))}><Ico n="x" size={18} /></button>
        </div>
      ))}
      <button className="chip" style={{ alignSelf: "flex-start" }} onClick={() => setD((x) => ({ ...x, steps: [...x.steps, { title: `Step ${x.steps.length + 1}`, text: "" }] }))}><Ico n="plus" size={18} />Add step</button>
      <p className="muted" style={{ fontSize: 13.5 }}>
        Source: {stage.kind === "link" ? (stage.link ? new URL(stage.link).hostname.replace(/^www\./, "") : "Web link") : "Photo of a card"}
        {stage.link ? ". The link is kept with the recipe." : ""}{stage.model ? ` Read by ${stage.model}.` : ""}
      </p>
      {err && <div className="hout err" role="alert">{err}</div>}
      <div className="row">
        <button className="btn primary big" style={{ flex: 1 }} disabled={busy} onClick={() => void save()}>Save recipe</button>
        <button className="btn big" onClick={onCancel}>Cancel</button>
      </div>
    </>
  );
}
