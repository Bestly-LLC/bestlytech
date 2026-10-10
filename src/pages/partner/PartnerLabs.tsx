/**
 * Bestly Labs + the call agenda (bestly.tech/partner), 2026-10-10.
 *
 *   AgendaPanel  "For our next call" on Home: what Jared (or the partner) wants to talk about.
 *                Tick = discussed (Undo in the toast), × = remove (Undo too). Anyone on the call adds.
 *   LabsSheet    New tech on the shelf (Ajax, JEV, projection mapping...): what it is, where it could
 *                go, and links. Partners read; Jared (admin) adds and edits right here.
 *
 * Tables labs_items + partner_agenda, RPCs labs_save / partner_agenda_add / partner_agenda_set
 * (supabase/migrations/20261010230000_partner_labs_agenda.sql). Open the sheet from anywhere with
 * openLabs(id?). No text is ever cut off with "...": long lines wrap.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { reportToScout } from "@/lib/reportToScout";
import { cn } from "@/lib/utils";
import { Check, ChevronDown, ExternalLink, FlaskConical, ListChecks, Loader2, Pencil, Plus, X } from "lucide-react";

/* ───────── data ───────── */

export type Stage = "idea" | "testing" | "building" | "ready";
export interface LabsItem { id: string; name: string; tagline: string; detail: string; stage: Stage; links: { label: string; href: string }[]; sort: number; active: boolean }
export interface AgendaItem { id: string; roster: string; title: string; note: string; labs_id: string | null; added_by: string; status: "open" | "discussed" | "removed"; created_at: string; discussed_at: string | null }

const STAGES: { id: Stage; label: string; dot: string }[] = [
  { id: "idea", label: "Idea", dot: "bg-white/40" },
  { id: "testing", label: "Testing", dot: "bg-amber-400" },
  { id: "building", label: "Building", dot: "bg-sky-400" },
  { id: "ready", label: "Ready to sell", dot: "bg-emerald-400" },
];
const stageOf = (s: Stage) => STAGES.find((x) => x.id === s) ?? STAGES[0];
const PT = { timeZone: "America/Los_Angeles" } as const;
const shortDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", ...PT });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Open the Labs sheet from anywhere; pass an id to open straight to that item. */
export const openLabs = (id: string | null = null) => window.dispatchEvent(new CustomEvent("partner-labs", { detail: id }));

export function useLabs() {
  const [items, setItems] = useState<LabsItem[] | null>(null);
  const load = useCallback(async () => {
    const { data, error } = await supabase.from("labs_items" as never).select("id, name, tagline, detail, stage, links, sort, active")
      .eq("active", true).order("sort").order("created_at");
    if (error) { reportToScout("partner-labs", `Labs list failed: ${error.message}`); return; }
    setItems((data ?? []) as unknown as LabsItem[]);
  }, []);
  useEffect(() => { load(); }, [load]);
  return { items, reload: load };
}

/* ───────── agenda (Home panel) ───────── */

const card = "rounded-[1.5rem] border border-white/[0.07] bg-white/[0.035] bento:border-transparent bento:bg-[#fff] bento:shadow-[0_1px_2px_rgba(17,17,20,0.04)]";

export function AgendaPanel({ roster, me, when, labs, className }: {
  roster: string; me: string; when?: string | null; labs: LabsItem[] | null; className?: string;
}) {
  const [rows, setRows] = useState<AgendaItem[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("partner_agenda" as never).select("id, roster, title, note, labs_id, added_by, status, created_at, discussed_at")
      .eq("roster" as never, roster as never).neq("status" as never, "removed" as never)
      .order("sort").order("created_at");
    if (error) { reportToScout("partner-agenda", `Agenda list failed: ${error.message}`); setRows([]); return; }
    setRows((data ?? []) as unknown as AgendaItem[]);
  }, [roster]);
  useEffect(() => { load(); }, [load]);

  const set = async (a: AgendaItem, status: AgendaItem["status"], quiet = false) => {
    const prev = a.status;
    setRows((all) => (all ?? []).map((x) => (x.id === a.id ? { ...x, status, discussed_at: status === "discussed" ? new Date().toISOString() : null } : x)));
    const { error } = await supabase.rpc("partner_agenda_set" as never, { p_id: a.id, p_status: status } as never);
    if (error) { toast.error("Couldn't save that", { description: error.message }); load(); return; }
    if (!quiet) {
      toast(status === "discussed" ? "Marked discussed" : status === "removed" ? "Removed from the agenda" : "Back on the agenda", {
        description: a.title, action: { label: "Undo", onClick: () => set({ ...a, status }, prev, true) },
      });
    }
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    const { error } = await supabase.rpc("partner_agenda_add" as never, { p_title: t, p_roster: roster } as never);
    setBusy(false);
    if (error) { toast.error("Couldn't add that", { description: error.message }); return; }
    setTitle(""); setAdding(false); load();
  };

  const open = (rows ?? []).filter((r) => r.status === "open");
  const done = (rows ?? []).filter((r) => r.status === "discussed")
    .sort((a, b) => String(b.discussed_at ?? "").localeCompare(String(a.discussed_at ?? "")));
  const labName = (id: string | null) => (id ? labs?.find((l) => l.id === id)?.name : undefined);
  const who = (by: string) => (by === me ? "You" : cap(by));

  return (
    <section className={cn(card, "p-5", className)}>
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><ListChecks className="h-4 w-4 text-white/60" />For our next call</h2>
        <button type="button" onClick={() => setAdding((v) => !v)} aria-expanded={adding}
          className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-white/60 transition hover:bg-white/[0.06] hover:text-white active:scale-95">
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>
      {when && <p className="mb-2 text-xs text-white/60">{when}</p>}

      {adding && (
        <form onSubmit={add} className="mb-2 mt-2 flex gap-2">
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Something to talk about"
            aria-label="New agenda item"
            className="h-11 min-w-0 flex-1 rounded-full border border-white/10 bg-black/30 px-4 text-[16px] text-white outline-none placeholder:text-white/60 focus:border-white/30 bento:bg-[#F3F2EE]" />
          <button aria-label="Add to agenda" disabled={!title.trim() || busy}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#0A84FF] text-[#fff] transition active:scale-95 disabled:opacity-40">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
          </button>
        </form>
      )}

      {rows === null ? <div className="h-16 animate-pulse rounded-2xl bg-white/[0.04]" /> : open.length === 0 ? (
        <p className="py-2 text-sm text-white/60">Nothing on the agenda yet. Tap Add to put something on it.</p>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {open.map((a) => {
            const lab = labName(a.labs_id);
            return (
              <li key={a.id} className="group flex items-start gap-3 py-3">
                <button aria-label="Mark discussed" onClick={() => set(a, "discussed")}
                  className="relative mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-white/25 text-transparent transition before:absolute before:-inset-2.5 before:content-[''] hover:border-emerald-400 hover:text-emerald-400 active:scale-90">
                  <Check className="h-3.5 w-3.5" />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-[0.975rem] leading-snug">{a.title}</p>
                  {a.note && <p className="mt-0.5 text-sm text-white/60">{a.note}</p>}
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-white/60">
                    <span className="whitespace-nowrap">{who(a.added_by)} · {shortDay(a.created_at)}</span>
                    {(lab || /labs/i.test(a.title)) && (
                      <button type="button" onClick={() => openLabs(a.labs_id)}
                        className="inline-flex items-center gap-1 whitespace-nowrap rounded font-medium text-[#0A84FF] underline-offset-2 hover:underline">
                        <FlaskConical className="h-3.5 w-3.5" /> {lab ? `Open ${lab} in Labs` : "Open Labs"}
                      </button>
                    )}
                  </p>
                </div>
                <button aria-label={`Remove “${a.title}”`} onClick={() => set(a, "removed")}
                  className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/40 transition hover:bg-white/[0.06] hover:text-white active:scale-90">
                  <X className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {done.length > 0 && (
        <div className="mt-2 border-t border-white/[0.06] pt-2 bento:border-white/5">
          <button onClick={() => setShowDone((o) => !o)} aria-expanded={showDone}
            className="flex min-h-[40px] w-full items-center gap-1.5 text-left text-sm font-medium text-white/60 hover:text-white">
            <ChevronDown className={cn("h-4 w-4 transition-transform", !showDone && "-rotate-90")} /> Discussed ({done.length})
          </button>
          {showDone && (
            <ul className="divide-y divide-white/[0.05]">
              {done.map((a) => (
                <li key={a.id} className="flex items-start gap-3 py-2.5">
                  <button aria-label="Not discussed yet, put it back" onClick={() => set(a, "open")}
                    className="relative mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-500 text-[#052E1F] transition before:absolute before:-inset-2.5 before:content-[''] hover:bg-white/20 active:scale-90">
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <div className="min-w-0">
                    <p className="text-[0.95rem] text-white/60 line-through decoration-white/30">{a.title}</p>
                    {a.discussed_at && <p className="mt-0.5 text-xs text-white/60">Discussed {shortDay(a.discussed_at)}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/* ───────── Labs sheet ───────── */

type Draft = { id?: string; name: string; tagline: string; detail: string; stage: Stage; links: string };
const toDraft = (l?: LabsItem): Draft => ({
  id: l?.id, name: l?.name ?? "", tagline: l?.tagline ?? "", detail: l?.detail ?? "", stage: l?.stage ?? "idea",
  links: (l?.links ?? []).map((x) => (x.label && x.label !== x.href ? `${x.label} ${x.href}` : x.href)).join("\n"),
});
/** One link per line: "Label https://…" or just the URL. */
const parseLinks = (s: string) => s.split("\n").map((line) => line.trim()).filter(Boolean).flatMap((line) => {
  const m = line.match(/^(.*?)(https?:\/\/\S+)$/);
  return m ? [{ label: m[1].trim() || m[2].replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""), href: m[2] }] : [];
});

export function LabsSheet({ items, reload, admin }: { items: LabsItem[] | null; reload: () => void; admin: boolean }) {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const on = (e: Event) => { setFocus((e as CustomEvent<string | null>).detail ?? null); setDraft(null); setOpen(true); };
    window.addEventListener("partner-labs", on);
    return () => window.removeEventListener("partner-labs", on);
  }, []);
  useEffect(() => {
    if (!open || !focus) return;
    const t = setTimeout(() => document.getElementById(`lab-${focus}`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 250);
    return () => clearTimeout(t);
  }, [open, focus]);

  const save = async () => {
    if (!draft || !draft.name.trim()) return;
    setSaving(true);
    const { error } = await supabase.rpc("labs_save" as never, { p: {
      id: draft.id ?? null, name: draft.name.trim(), tagline: draft.tagline.trim(), detail: draft.detail.trim(), stage: draft.stage, links: parseLinks(draft.links),
    } } as never);
    setSaving(false);
    if (error) { toast.error("Couldn't save", { description: error.message }); return; }
    toast(draft.id ? "Saved" : "Added to Labs", { description: draft.name.trim() });
    setDraft(null); reload();
  };

  const field = "w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[16px] text-white outline-none placeholder:text-white/50 focus:border-white/30 bento:bg-[#fff]";

  const editor = (d: Draft) => (
    <div className="space-y-2.5 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10 bento:bg-[#F3F2EE]">
      <input className={cn(field, "h-11")} placeholder="Name" maxLength={80} value={d.name} onChange={(e) => setDraft({ ...d, name: e.target.value })} aria-label="Name" />
      <input className={cn(field, "h-11")} placeholder="What it is, in one plain line" maxLength={160} value={d.tagline} onChange={(e) => setDraft({ ...d, tagline: e.target.value })} aria-label="One-line description" />
      <textarea className={cn(field, "min-h-[7rem] py-3")} placeholder="How it works, and how we could bring it to market" maxLength={4000} value={d.detail} onChange={(e) => setDraft({ ...d, detail: e.target.value })} aria-label="Details" />
      <textarea className={cn(field, "min-h-[4.5rem] py-3")} placeholder={"Links, one per line\nDemo https://…"} value={d.links} onChange={(e) => setDraft({ ...d, links: e.target.value })} aria-label="Links" />
      <div role="radiogroup" aria-label="Stage" className="flex flex-wrap gap-1.5">
        {STAGES.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={d.stage === s.id} onClick={() => setDraft({ ...d, stage: s.id })}
            className={cn("inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm transition active:scale-95",
              d.stage === s.id ? "bg-white text-black bento:bg-[#111114] bento:text-[#fff]" : "bg-white/[0.06] text-white/70 hover:bg-white/[0.1]")}>
            <span className={cn("h-2 w-2 rounded-full", s.dot)} />{s.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={save} disabled={saving || !d.name.trim()}
          className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-white font-semibold text-black transition active:scale-[0.98] disabled:opacity-50 bento:bg-[#111114] bento:text-[#fff]">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
        </button>
        <button type="button" onClick={() => setDraft(null)} className="h-11 rounded-2xl px-4 text-white/60 hover:bg-white/[0.06]">Cancel</button>
      </div>
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto border-white/10 bg-[#0b0d12] p-0 text-white sm:max-w-xl bento:bg-[#F3F2EE]">
        <div className="border-b border-white/[0.06] px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
          <SheetTitle className="flex items-center gap-2 text-lg font-semibold text-white"><FlaskConical className="h-5 w-5 text-violet-400" /> Bestly Labs</SheetTitle>
          <SheetDescription className="mt-1 text-sm text-white/60">
            New tech on the shelf: what each one is, where it could go, and how close it is to something we can sell.
          </SheetDescription>
        </div>

        <div className="space-y-3 px-5 py-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {admin && !draft && (
            <button type="button" onClick={() => setDraft(toDraft())}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 text-sm font-medium text-white/70 transition hover:bg-white/[0.04] hover:text-white active:scale-[0.99]">
              <Plus className="h-4 w-4" /> Add to Labs
            </button>
          )}
          {draft && !draft.id && editor(draft)}

          {items === null ? <div className="h-24 animate-pulse rounded-2xl bg-white/[0.04]" /> : items.length === 0 ? (
            <p className="text-sm text-white/60">Nothing in Labs yet.</p>
          ) : items.map((l) => {
            if (draft?.id === l.id) return <div key={l.id} id={`lab-${l.id}`}>{editor(draft)}</div>;
            const s = stageOf(l.stage);
            const empty = !l.tagline && !l.detail;
            return (
              <article key={l.id} id={`lab-${l.id}`}
                className={cn("scroll-mt-4 rounded-2xl bg-white/[0.04] p-4 ring-1 transition bento:bg-[#fff]",
                  focus === l.id ? "ring-[#0A84FF]/60" : "ring-white/[0.06] bento:ring-transparent")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-[1.05rem] font-semibold leading-snug">{l.name}</h3>
                    {l.tagline && <p className="mt-0.5 text-[0.95rem] text-white/75">{l.tagline}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full bg-white/[0.06] px-2.5 text-xs text-white/70">
                      <span className={cn("h-2 w-2 rounded-full", s.dot)} />{s.label}
                    </span>
                    {admin && (
                      <button type="button" aria-label={`Edit ${l.name}`} onClick={() => setDraft(toDraft(l))}
                        className="grid h-8 w-8 place-items-center rounded-full text-white/50 hover:bg-white/[0.06] hover:text-white active:scale-90">
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
                {l.detail && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-white/70">{l.detail}</p>}
                {empty && <p className="mt-2 text-sm text-white/50">{admin ? "Tap the pencil to add what it is." : "Jared is adding the details. Ask him on the next call."}</p>}
                {l.links.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {l.links.map((k) => (
                      <a key={k.href} href={k.href} target="_blank" rel="noreferrer"
                        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#0A84FF]/15 px-3 text-sm font-medium text-[#0A84FF] transition hover:bg-[#0A84FF]/25 active:scale-95">
                        {k.label} <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
