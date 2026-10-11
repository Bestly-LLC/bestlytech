/**
 * Knowledge: the documents a template agent can look things up in. List (name, size), open one to read, edit and save, or add a new one.
 * Saving goes through agent-hub kb_save: voice-platform text documents are not edited in place, so a new document is created and swapped
 * into the agent's list while the other documents stay attached. Changes apply from the next call.
 */
import { useCallback, useEffect, useState } from "react";
import { BookOpen, ChevronRight, FileText, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CollapsibleSection } from "@/components/admin/roofguard/CollapsibleSection";
import { ScrollSheet } from "@/components/admin/roofguard/AvaSheet";
import { announceAgentChanged, boxCls, btnPrimary, btnQuiet, fieldCls, hub, ring, type AgentInfo } from "./agentApi";

type Doc = { id: string; name: string; type: string; size_bytes: number | null };
const NB = " ";
const size = (n: number | null) => n == null ? "" : n < 1024 ? `${n}${NB}B` : n < 1048576 ? `${Math.round(n / 1024)}${NB}KB` : `${(n / 1048576).toFixed(1)}${NB}MB`;
const MAX = 200000;

function Editor({ agent, doc, onClose, onSaved }: { agent: AgentInfo; doc: Doc | "new" | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = doc && doc !== "new" ? doc.id : null;

  useEffect(() => {
    setErr(null);
    if (doc === null) return;
    if (doc === "new") { setName(""); setText(""); return; }
    let alive = true;
    setLoading(true); setName(doc.name); setText("");
    void hub<{ name: string; text: string }>({ action: "kb_get", slug: agent.slug, doc_id: doc.id }, "Couldn't read that document.").then((r) => {
      if (!alive) return;
      setLoading(false);
      if (!r.ok) setErr(r.error); else { setName(r.data.name); setText(r.data.text); }
    });
    return () => { alive = false; };
  }, [doc, agent.slug]);

  const valid = name.trim().length > 0 && text.trim().length > 0 && text.length <= MAX;
  const save = async () => {
    setBusy(true); setErr(null);
    const r = await hub({ action: "kb_save", slug: agent.slug, doc_id: id ?? undefined, name: name.trim(), text }, "Couldn't save the document. Try again.");
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    toast.success(`Saved. ${agent.name} uses it from the next call.`);
    announceAgentChanged(agent.slug);
    onSaved();
  };

  return (
    <ScrollSheet open={doc !== null} onClose={onClose} title={doc === "new" ? "New document" : name || "Document"}
      description={doc === "new" ? `Add something ${agent.name} should know.` : `Edit what ${agent.name} knows. Saving replaces this document.`}>
      <div className="space-y-4 pb-6">
        {loading && <div className="h-40 rounded-2xl bg-white/[0.04] motion-safe:animate-pulse" aria-hidden />}
        {err && <p role="alert" className="rounded-xl bg-amber-500/10 p-3 text-[15px] text-amber-100">{err}</p>}
        {!loading && (doc === "new" || !err) && (
          <>
            <div>
              <label htmlFor="kb-name" className="mb-1 block text-[13px] font-medium text-white">Name</label>
              <input id="kb-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Pricing and plans" className={cn(fieldCls, "h-11")} />
            </div>
            <div>
              <label htmlFor="kb-text" className="mb-1 block text-[13px] font-medium text-white">What {agent.name} should know</label>
              <textarea id="kb-text" value={text} onChange={(e) => setText(e.target.value)} rows={16} spellCheck
                placeholder="Plain sentences work best. Facts, steps, answers to questions callers ask."
                className={cn(fieldCls, "min-h-[280px] resize-y py-3 leading-snug")} />
              <p className={cn("mt-1 text-xs tabular-nums", text.length > MAX ? "text-amber-200" : "text-white/50")}>{text.length.toLocaleString("en-US")} of {MAX.toLocaleString("en-US")} characters</p>
            </div>
            <button type="button" onClick={() => void save()} disabled={!valid || busy} className={btnPrimary}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Save</button>
          </>
        )}
      </div>
    </ScrollSheet>
  );
}

function Body({ agent }: { agent: AgentInfo }) {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<Doc | "new" | null>(null);
  const load = useCallback(async () => {
    setErr(null);
    const r = await hub<{ docs: Doc[] }>({ action: "kb_list", slug: agent.slug }, "Couldn't load the documents. Try again.");
    if (!r.ok) setErr(r.error); else setDocs(r.data.docs);
  }, [agent.slug]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-[14px] text-white/60">What {agent.name} can look up during a call.</p>
        <button type="button" onClick={() => setEdit("new")} className={cn(btnQuiet, "shrink-0")}><Plus className="h-4 w-4" aria-hidden />Add</button>
      </div>
      {err && (
        <div role="alert" className="rounded-2xl bg-amber-500/10 p-4 text-[15px] text-amber-100 ring-1 ring-amber-500/30">
          <p>{err}</p><button type="button" onClick={() => void load()} className="mt-2 min-h-[44px] rounded-xl bg-white/10 px-4 font-medium text-white hover:bg-white/15">Retry</button>
        </div>
      )}
      {!docs && !err && Array.from({ length: 2 }, (_, i) => <div key={i} className="h-[64px] rounded-2xl bg-white/[0.04] ring-1 ring-white/10 motion-safe:animate-pulse" aria-hidden />)}
      {docs?.length === 0 && <p className={boxCls}>No documents yet. Add one and {agent.name} can answer from it.</p>}
      <ul className="space-y-2">
        {docs?.map((d) => (
          <li key={d.id}>
            <button type="button" onClick={() => setEdit(d)} className={cn("flex min-h-[56px] w-full items-center gap-3 rounded-2xl bg-white/[0.04] px-4 py-3 text-left ring-1 ring-white/10 hover:bg-white/[0.07]", ring)}>
              <FileText className="h-4 w-4 shrink-0 text-white/55" aria-hidden />
              <span className="min-w-0 flex-1 text-[15px] font-medium text-white [overflow-wrap:anywhere]">{d.name}</span>
              {d.size_bytes != null && <span className="shrink-0 whitespace-nowrap text-[13px] tabular-nums text-white/55">{size(d.size_bytes)}</span>}
              <ChevronRight className="h-4 w-4 shrink-0 text-white/35" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <Editor agent={agent} doc={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); }} />
    </div>
  );
}

export function AgentKnowledge({ agent }: { agent: AgentInfo }) {
  return (
    <CollapsibleSection id={`${agent.slug}-knowledge`} anchorId={`${agent.slug}-knowledge`} bodyClassName="p-4"
      title="Knowledge" summary={`Documents ${agent.name} can look things up in`} icon={<span className="grid h-8 w-8 place-items-center rounded-xl bg-violet-400/15 text-violet-300"><BookOpen className="h-4 w-4" aria-hidden /></span>}>
      <Body agent={agent} />
    </CollapsibleSection>
  );
}
