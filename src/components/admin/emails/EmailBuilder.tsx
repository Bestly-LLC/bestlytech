import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Download, Loader2, Mail, Monitor, Moon, Plus, Redo2, Save, Send, Smartphone, Sparkles, Sun, Trash2, Undo2, Wand2 } from "lucide-react";
import { Lines } from "@/components/Lines";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { btnPlain, btnPrimary, btnTinted, card, field, secondary } from "@/pages/admin/laxUi";
import { focusRing } from "@/components/admin/ui";
import { renderText, type Block, type Kit } from "@/lib/email/render";
import type { EmailApi, LibraryRow } from "@/lib/email/api";
import { PreviewFrame, type EditMsg } from "./PreviewFrame";
import { ButtonDialog } from "./ButtonDialog";
import { SendDialog } from "./SendDialog";
import { BLOCK_LABEL, cleanHtml, docOf, download, emptyDraft, makeEml, newBlock, previewSource, slugify, textOf, type Draft } from "./emailUtils";

type Snap = { subject: string; preheader: string; blocks: Block[] };
const QUICK = ["Make it shorter", "Make it friendlier", "Explain it more simply", "Add a button to my website"];

const seg = (on: boolean) =>
  cn("inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-full px-4 text-[14px] font-medium transition-colors active:scale-[0.97]", on ? "bg-white/[0.16] text-white" : "text-white/60 hover:text-white", focusRing);

export function EmailBuilder({ api, initial, onSaved }: { api: EmailApi; initial: Draft; onSaved: (r: LibraryRow) => void }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(initial);
  const [pane, setPane] = useState<"write" | "preview">("write");
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const [dark, setDark] = useState(false);
  const [busy, setBusy] = useState<"" | "write" | "revise" | "save" | "eml" | "picture">("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [change, setChange] = useState("");
  const [btn, setBtn] = useState<Extract<Block, { type: "button" }> | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [saved, setSaved] = useState<LibraryRow | null>(null);
  const past = useRef<Snap[]>([]);
  const future = useRef<Snap[]>([]);
  const [, bump] = useState(0);

  useEffect(() => { setDraft(initial); past.current = []; future.current = []; setWarnings([]); setError(""); setSaved(null); }, [initial]);

  const kit: Kit = api.kits.find((k) => k.slug === draft.kit) ?? api.kits[0];
  const hasDoc = draft.blocks.length > 0 || !!draft.fixedHtml;
  const locked = !!draft.fixedHtml;
  const preview = useMemo(() => (kit && hasDoc ? previewSource(kit, draft) : ""), [kit, draft, hasDoc]);

  const snap = (): Snap => ({ subject: draft.subject, preheader: draft.preheader, blocks: draft.blocks });
  const remember = () => { past.current = [...past.current.slice(-30), snap()]; future.current = []; bump((n) => n + 1); };
  const undo = () => { const p = past.current.pop(); if (!p) return; future.current.push(snap()); setDraft((d) => ({ ...d, ...p })); bump((n) => n + 1); };
  const redo = () => { const f = future.current.pop(); if (!f) return; past.current.push(snap()); setDraft((d) => ({ ...d, ...f })); bump((n) => n + 1); };
  const setBlocks = (fn: (b: Block[]) => Block[]) => { remember(); setDraft((d) => ({ ...d, blocks: fn(d.blocks) })); };

  /* ── writing ── */
  const write = async () => {
    if (draft.brief.trim().length < 3) return;
    setBusy("write"); setError(""); setWarnings([]);
    const r = await api.generate({ kit: draft.kit, request: draft.brief, recipient_name: draft.recipient_name || undefined, recipient_email: draft.recipient_email || undefined });
    setBusy("");
    if (!r.ok || !r.doc) { setError(r.error ?? "Could not write it. Nothing was lost."); return; }
    remember();
    setDraft((d) => ({ ...d, subject: r.doc!.subject, preheader: r.doc!.preheader ?? "", blocks: r.doc!.blocks, title: d.title || r.doc!.subject, fixedHtml: undefined }));
    setWarnings(r.warnings ?? []);
    setPane("preview");
  };
  const revise = async (instruction: string) => {
    if (!instruction.trim() || !hasDoc || locked) return;
    setBusy("revise"); setError(""); setWarnings([]);
    const r = await api.revise({ kit: draft.kit, doc: docOf(draft), instruction });
    setBusy("");
    if (!r.ok || !r.doc) { setError(r.error ?? "Could not change it. Your email is untouched."); return; }
    remember();
    setDraft((d) => ({ ...d, subject: r.doc!.subject || d.subject, preheader: r.doc!.preheader ?? d.preheader, blocks: r.doc!.blocks }));
    setWarnings(r.warnings ?? []);
    setChange("");
    setPane("preview");
  };

  /* ── tap-to-edit from the preview ── */
  const onEdit = useCallback((m: EditMsg) => {
    if (m.t === "button") {
      const b = draft.blocks.find((x) => x.id === m.bid);
      if (b?.type === "button") setBtn(b);
      return;
    }
    remember();
    setDraft((d) => ({
      ...d,
      blocks: d.blocks.map((b) => {
        if (b.id !== m.bid) return b;
        if (m.field.startsWith("item:") && b.type === "list") { const n = Number(m.field.slice(5)); const items = [...b.items]; if (m.text) items[n] = m.text; else items.splice(n, 1); return { ...b, items }; }
        return { ...b, text: m.text } as Block;
      }),
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.blocks]);

  /* ── blocks ── */
  const move = (i: number, dir: -1 | 1) => setBlocks((bs) => { const j = i + dir; if (j < 0 || j >= bs.length) return bs; const c = [...bs]; [c[i], c[j]] = [c[j], c[i]]; return c; });
  const remove = (id: string) => setBlocks((bs) => bs.filter((b) => b.id !== id));
  const add = (type: Block["type"]) => setBlocks((bs) => { const at = bs.findIndex((b) => b.type === "signature"); const nb = newBlock(type); return at < 0 ? [...bs, nb] : [...bs.slice(0, at), nb, ...bs.slice(at)]; });
  const patch = (id: string, p: Partial<Block>) => setBlocks((bs) => bs.map((b) => (b.id === id ? ({ ...b, ...p } as Block) : b)));

  const makePicture = async (b: Extract<Block, { type: "image" }>) => {
    if (!b.prompt?.trim()) return;
    setBusy("picture");
    const r = await api.makeImage(draft.kit, b.prompt);
    setBusy("");
    if (r.ok && r.url) patch(b.id, { url: r.url, kind: "ai" } as Partial<Block>); else toast({ title: "Picture failed", description: r.error ?? "The free picture service did not answer.", variant: "destructive" });
  };

  /* ── saving / exporting ── */
  const html = kit && hasDoc ? cleanHtml(kit, draft) : "";
  const persist = async (): Promise<LibraryRow | null> => {
    if (!api.dbReady) { toast({ title: "Cannot save yet", description: "The email tables are not in the database yet. Download it instead.", variant: "destructive" }); return null; }
    setBusy("save");
    try {
      const row = await api.save({
        ...(draft.id ? { id: draft.id } : {}), brand_kit: draft.kit, title: draft.title.trim() || draft.subject || "Untitled email", subject: draft.subject, preheader: draft.preheader || null,
        blocks: draft.fixedHtml ? [] : draft.blocks, html, text_body: textOf(kit, draft), source: draft.source, brief: draft.brief || null,
        recipient_name: draft.recipient_name || null, recipient_email: draft.recipient_email || null,
      });
      setDraft((d) => ({ ...d, id: row.id })); setSaved(row); onSaved(row);
      return row;
    } catch (e) {
      toast({ title: "Could not save", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      return null;
    } finally { setBusy(""); }
  };
  const save = async () => { const r = await persist(); if (r) toast({ title: "Saved to your library" }); };
  const nameBase = slugify(draft.title || draft.subject);
  const dlHtml = () => download(`${nameBase}.html`, html, "text/html");
  const dlSafari = () => download(`${nameBase}-safari.html`, html, "text/html");
  const dlEml = async () => {
    setBusy("eml");
    try {
      const { eml, note } = await makeEml(api, kit, draft, html);
      download(`${nameBase}.eml`, eml, "message/rfc822");
      if (note) toast({ title: "Downloaded with a note", description: note });
    } catch (e) { toast({ title: "Could not build the .eml", description: e instanceof Error ? e.message : String(e), variant: "destructive" }); }
    setBusy("");
  };
  const openSend = async () => {
    const row = await persist();
    if (row) { setSaved(row); setSendOpen(true); }
  };

  const fromLine = `${kit?.default_sender?.from_name ?? "Jared Best"} <${kit?.default_sender?.from_email ?? "jared@bestly.tech"}>`;
  const dirtyWarn = lintWarn(kit, draft);

  return (
    <div className="space-y-4">
      {/* phone: switch between writing and looking */}
      <div role="tablist" aria-label="Builder view" className="flex rounded-full bg-white/[0.06] p-1 lg:hidden">
        {(["write", "preview"] as const).map((p) => (
          <button key={p} role="tab" aria-selected={pane === p} type="button" onClick={() => setPane(p)} className={cn(seg(pane === p), "flex-1")}>{p === "write" ? "Write" : "Preview"}</button>
        ))}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(340px,420px)_minmax(0,1fr)]">
        {/* ───────── left: prompt + changes + blocks ───────── */}
        <div className={cn("space-y-4", pane === "preview" && "max-lg:hidden")}>
          <section className={cn(card, "space-y-4")} aria-labelledby="eb-write">
            <h2 id="eb-write" className="text-[17px] font-semibold text-white">What should the email say?</h2>
            <label className="block text-[13px] text-white/60">Brand
              <select value={draft.kit} onChange={(e) => setDraft((d) => ({ ...d, kit: e.target.value }))} disabled={locked} className={`${field} mt-1 min-h-[44px]`}>
                {api.kits.map((k) => <option key={k.slug} value={k.slug}>{k.name}{k.kind === "client" ? " (client)" : ""}</option>)}
              </select>
            </label>
            <label className="block text-[13px] text-white/60">Tell me in your own words
              <textarea value={draft.brief} onChange={(e) => setDraft((d) => ({ ...d, brief: e.target.value }))} rows={5} disabled={locked}
                placeholder={"Example: Thank Elizabeth for yesterday's call. Tell her the deck page is ready and give her this link: https://..."}
                className={`${field} mt-1 resize-y leading-relaxed`} />
            </label>
            <div className="space-y-3">
              <label className="block text-[13px] text-white/60">Their name (optional)
                <input value={draft.recipient_name} onChange={(e) => setDraft((d) => ({ ...d, recipient_name: e.target.value }))} className={`${field} mt-1`} autoComplete="off" />
              </label>
              <label className="block text-[13px] text-white/60">Their email (optional)
                <input value={draft.recipient_email} onChange={(e) => setDraft((d) => ({ ...d, recipient_email: e.target.value }))} inputMode="email" className={`${field} mt-1`} autoComplete="off" />
              </label>
            </div>
            {locked ? (
              <p className={cn("text-[13px]", secondary)}><Lines>This is an imported template file, so it cannot be rewritten here. You can download it or send it as is. To write a new email in this look, pick it from the library with Start from this.</Lines></p>
            ) : (
              <button type="button" onClick={write} disabled={!!busy || draft.brief.trim().length < 3} className={cn(btnPrimary, "w-full")}>
                {busy === "write" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                {busy === "write" ? "Writing with free AI" : hasDoc ? "Write it again" : "Write it"}
              </button>
            )}
            {busy === "write" && <p className={cn("text-[13px]", secondary)}><Lines>This can take up to a minute. Free AI is slower than paid.</Lines></p>}
            {error && (
              <p role="alert" className="flex items-start gap-2 rounded-xl bg-[#FF453A]/10 px-3 py-2 text-[13px] text-[#FF6961]">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span className="[overflow-wrap:anywhere]">{error}</span>
              </p>
            )}
          </section>

          {hasDoc && !locked && (
            <section className={cn(card, "space-y-3")} aria-labelledby="eb-change">
              <h2 id="eb-change" className="text-[17px] font-semibold text-white">Ask for changes</h2>
              <div className="flex flex-wrap gap-2">
                {QUICK.map((q) => (
                  <button key={q} type="button" disabled={!!busy} onClick={() => revise(q)} className={cn("min-h-[44px] rounded-full bg-white/[0.07] px-4 text-[14px] text-white/80 hover:bg-white/[0.12] active:scale-[0.97]", focusRing)}>{q}</button>
                ))}
              </div>
              <textarea value={change} onChange={(e) => setChange(e.target.value)} rows={3} placeholder='Or say it: "add a button to the deck page: https://..."' className={`${field} resize-y`} aria-label="Ask for changes" />
              <button type="button" onClick={() => revise(change)} disabled={!!busy || !change.trim()} className={cn(btnTinted, "w-full")}>
                {busy === "revise" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Wand2 className="h-4 w-4" aria-hidden="true" />}
                {busy === "revise" ? "Changing it" : "Make the change"}
              </button>
            </section>
          )}

          {warnings.length > 0 && (
            <ul className="space-y-1.5 rounded-2xl bg-[#FF9F0A]/10 px-4 py-3 text-[13px] text-[#FFB340]" aria-label="Things to check">
              {warnings.map((w, i) => <li key={i} className="[overflow-wrap:anywhere]">{w}</li>)}
            </ul>
          )}
          {dirtyWarn.length > 0 && (
            <ul className="space-y-1.5 rounded-2xl bg-[#FF9F0A]/10 px-4 py-3 text-[13px] text-[#FFB340]" aria-label="Style checks">
              {dirtyWarn.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}

          {hasDoc && !locked && (
            <section className={cn(card, "space-y-3")} aria-labelledby="eb-parts">
              <h2 id="eb-parts" className="text-[17px] font-semibold text-white">Subject and parts</h2>
              <label className="block text-[13px] text-white/60">Subject
                <textarea rows={2} value={draft.subject} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value.replace(/[\r\n]+/g, " ") }))} className={`${field} mt-1 resize-y`} />
              </label>
              <label className="block text-[13px] text-white/60">Preview line (shows next to the subject in the inbox)
                <textarea rows={2} value={draft.preheader} onChange={(e) => setDraft((d) => ({ ...d, preheader: e.target.value }))} className={`${field} mt-1 resize-y`} />
              </label>
              <ol className="space-y-1.5">
                {draft.blocks.map((b, i) => (
                  <li key={b.id} className="rounded-xl bg-white/[0.05] px-3 py-2">
                    <div className="flex items-center gap-1">
                      <span className="min-w-0 flex-1 text-[14px] text-white/85 [overflow-wrap:anywhere]">
                        {BLOCK_LABEL[b.type]}{b.type === "button" ? `: ${b.label}` : ""}
                      </span>
                      <IconBtn label="Move up" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="h-4 w-4" /></IconBtn>
                      <IconBtn label="Move down" onClick={() => move(i, 1)} disabled={i === draft.blocks.length - 1}><ArrowDown className="h-4 w-4" /></IconBtn>
                      {b.type === "button" && <button type="button" className={cn(btnPlain, "px-2")} onClick={() => setBtn(b)}>Edit</button>}
                      <IconBtn label={`Delete ${BLOCK_LABEL[b.type]}`} onClick={() => remove(b.id)} danger><Trash2 className="h-4 w-4" /></IconBtn>
                    </div>
                    {b.type === "image" && (
                      <div className="mt-2 space-y-2">
                        <select aria-label="Brand picture" value={b.kind === "asset" ? b.asset_key ?? "" : "__ai"} className={`${field} min-h-[44px]`}
                          onChange={(e) => { const k = e.target.value; if (k === "__ai") patch(b.id, { kind: "ai" } as Partial<Block>); else { const a = kit.assets?.[k]; patch(b.id, { kind: "asset", asset_key: k, url: a?.url, alt: a?.alt ?? b.alt } as Partial<Block>); } }}>
                          <option value="">Choose a picture</option>
                          {Object.entries(kit.assets ?? {}).map(([k, a]) => <option key={k} value={k}>{a.label ?? a.alt}</option>)}
                          {kit.ai_images !== "never" && <option value="__ai">Make a new picture with free AI</option>}
                        </select>
                        {b.kind === "ai" && (
                          <>
                            <input aria-label="What to draw" value={b.prompt ?? ""} onChange={(e) => patch(b.id, { prompt: e.target.value } as Partial<Block>)} placeholder="What should the picture show?" className={field} />
                            <button type="button" className={btnTinted} disabled={busy === "picture" || !b.prompt?.trim()} onClick={() => makePicture(b)}>
                              {busy === "picture" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}{b.url ? "Make a new picture" : "Make the picture"}
                            </button>
                          </>
                        )}
                        <input aria-label="Describe the picture" value={b.alt} onChange={(e) => patch(b.id, { alt: e.target.value } as Partial<Block>)} placeholder="Describe it for screen readers" className={field} />
                      </div>
                    )}
                    {b.type === "product_ads" && (
                      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Products to mention">
                        {(kit.product_ads?.items ?? []).map((a) => {
                          const on = b.keys.includes(a.key);
                          return <button key={a.key} type="button" aria-pressed={on} onClick={() => patch(b.id, { keys: on ? b.keys.filter((k) => k !== a.key) : [...b.keys, a.key].slice(0, kit.ad_policy?.max ?? 2) } as Partial<Block>)}
                            className={cn("min-h-[44px] rounded-full border px-4 text-[14px]", on ? "border-[#0A84FF] bg-[#0A84FF]/15 text-white" : "border-white/[0.12] text-white/70")}>{a.name}</button>;
                        })}
                        <button type="button" aria-pressed={b.variant !== "soft"} onClick={() => patch(b.id, { variant: b.variant === "soft" ? "full" : "soft" } as Partial<Block>)} className={cn("min-h-[44px] rounded-full border border-white/[0.12] px-4 text-[14px] text-white/70")}>{b.variant === "soft" ? "One quiet line" : "Full box"}</button>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              <div className="flex flex-wrap gap-2 pt-1" role="group" aria-label="Add a part">
                {(["paragraph", "subheading", "button", "image", "callout", "list", "divider", "product_ads"] as const).map((t) => (
                  <button key={t} type="button" onClick={() => add(t)} className={cn("inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-white/[0.07] px-3.5 text-[14px] text-white/80 hover:bg-white/[0.12] active:scale-[0.97]", focusRing)}>
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />{BLOCK_LABEL[t]}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* ───────── right: live preview + export ───────── */}
        <div className={cn("min-w-0 space-y-4", pane === "write" && "max-lg:hidden")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div role="group" aria-label="Preview size" className="flex rounded-full bg-white/[0.06] p-1">
              <button type="button" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")} className={seg(device === "desktop")}><Monitor className="h-4 w-4" aria-hidden="true" />Desktop</button>
              <button type="button" aria-pressed={device === "phone"} onClick={() => setDevice("phone")} className={seg(device === "phone")}><Smartphone className="h-4 w-4" aria-hidden="true" />Phone</button>
            </div>
            <div role="group" aria-label="Preview colors" className="flex rounded-full bg-white/[0.06] p-1">
              <button type="button" aria-pressed={!dark} onClick={() => setDark(false)} className={seg(!dark)}><Sun className="h-4 w-4" aria-hidden="true" />Light</button>
              <button type="button" aria-pressed={dark} onClick={() => setDark(true)} className={seg(dark)}><Moon className="h-4 w-4" aria-hidden="true" />Dark</button>
            </div>
            {!locked && (
              <div className="flex">
                <IconBtn label="Undo" onClick={undo} disabled={!past.current.length}><Undo2 className="h-5 w-5" /></IconBtn>
                <IconBtn label="Redo" onClick={redo} disabled={!future.current.length}><Redo2 className="h-5 w-5" /></IconBtn>
              </div>
            )}
          </div>

          {hasDoc ? (
            <>
              {!locked && <p className={cn("text-[13px]", secondary)}><Lines>Tap any text to edit it. Tap a button to change its words or link.</Lines></p>}
              <PreviewFrame html={preview} device={device} dark={dark} editable={!locked} onEdit={onEdit} />
              <div className={cn(card, "space-y-3")}>
                <div className="flex flex-wrap gap-2">
                  {!locked && <button type="button" onClick={save} disabled={!!busy} className={btnTinted}>{busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}Save</button>}
                  <button type="button" onClick={openSend} disabled={!!busy || !draft.subject} className={btnPrimary}><Send className="h-4 w-4" aria-hidden="true" />Send</button>
                  <button type="button" onClick={dlEml} disabled={!!busy} className={btnTinted}>{busy === "eml" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mail className="h-4 w-4" aria-hidden="true" />}Download .eml</button>
                  <button type="button" onClick={dlHtml} className={btnTinted}><Download className="h-4 w-4" aria-hidden="true" />Download .html</button>
                  <button type="button" onClick={dlSafari} className={btnTinted}><Download className="h-4 w-4" aria-hidden="true" />Open for Safari share</button>
                </div>
                <p className={cn("text-[13px]", secondary)}><Lines>Opening in Mail? Use Safari → File → Share → Email This Page for the most reliable result.</Lines></p>
                {!api.dbReady && <p className="text-[13px] text-[#FFB340]"><Lines>The email database tables are not set up yet, so Save and Send are off. Downloads work.</Lines></p>}
                {saved && <p className={cn("text-[13px]", secondary)}>Saved <span className="whitespace-nowrap">to your library.</span></p>}
              </div>
            </>
          ) : (
            <div className="rounded-[22px] border border-dashed border-white/[0.12] px-6 py-20 text-center">
              <Sparkles className="mx-auto h-6 w-6 text-white/30" aria-hidden="true" />
              <p className={cn("mx-auto mt-3 max-w-sm text-[15px]", secondary)}><Lines>Your email shows up here. Tell me what it should say, then tap Write it.</Lines></p>
            </div>
          )}
        </div>
      </div>

      <ButtonDialog block={btn} onClose={() => setBtn(null)}
        onSave={(b) => { patch(b.id, b); setBtn(null); }} onDelete={(id) => { remove(id); setBtn(null); }} />
      {saved && (
        <SendDialog api={api} open={sendOpen} onClose={() => setSendOpen(false)} libraryId={saved.id} html={saved.html} subject={draft.subject}
          defaultTo={draft.recipient_email} defaultName={draft.recipient_name} fromLine={fromLine}
          onSent={(to, name) => { setDraft((d) => ({ ...d, recipient_email: to, recipient_name: name, status: "sent" })); onSaved({ ...saved, status: "sent" }); }} />
      )}
    </div>
  );
}

function lintWarn(kit: Kit | undefined, d: Draft): string[] {
  if (!kit || d.fixedHtml || !d.blocks.length) return [];
  const t = renderText(kit, docOf(d));
  const out: string[] = [];
  if (/\b(2[0-3]|1[3-9]):[0-5]\d\b(?!\s?[AaPp]\.?[Mm])/.test(t)) out.push("There is a 24-hour time. Use 3:05 PM style.");
  if (/\b\d+(\.\d+)?\s?(km|kg|cm|mm|meters?|metres?|kilometers?|°C)\b/i.test(t)) out.push("There is a metric unit. Use miles, feet, pounds and °F.");
  if (d.blocks.some((b) => b.type === "button" && !/^(https:\/\/|mailto:|tel:)[^\s]{4,}$/i.test(b.url))) out.push("A button has no real link yet.");
  return out;
}

function IconBtn({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}
      className={cn("inline-flex h-11 w-11 items-center justify-center rounded-full active:scale-[0.94] disabled:opacity-30", danger ? "text-[#FF6961] hover:bg-[#FF453A]/10" : "text-white/70 hover:bg-white/[0.08] hover:text-white", focusRing)}>
      {children}
    </button>
  );
}

