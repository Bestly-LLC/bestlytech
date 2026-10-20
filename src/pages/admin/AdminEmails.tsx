import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Inbox, Plus, RefreshCw, UserPlus } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { Lines } from "@/components/Lines";
import { cardCls, focusRing } from "@/components/admin/ui";
import { btnPlain, btnPrimary, btnTinted, secondary } from "@/pages/admin/laxUi";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { createEmailApi, loadEmailData, type EmailApi, type LibraryRow } from "@/lib/email/api";
import { EmailBuilder } from "@/components/admin/emails/EmailBuilder";
import { EmailLibrary, applyJustSent, type JustSent } from "@/components/admin/emails/EmailLibrary";
import { draftFromRow, emptyDraft, type Draft } from "@/components/admin/emails/emailUtils";

/**
 * Emails: the library of saved emails plus the AI builder.
 * The writer is the free model ladder only (no paid models). Nothing is ever sent without the confirm step.
 */
export default function AdminEmails() {
  const { toast } = useToast();
  const [data, setData] = useState<Awaited<ReturnType<typeof loadEmailData>> | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [filter, setFilter] = useState("all");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [clientOpen, setClientOpen] = useState(false);
  const [justSent, setJustSent] = useState<JustSent | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try { setLoadErr(""); setData(await loadEmailData()); }
    catch (e) { setLoadErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const api: EmailApi | null = useMemo(() => (data ? createEmailApi(data, reload) : null), [data, reload]);
  const kitName = useMemo(() => Object.fromEntries((data?.kits ?? []).map((k) => [k.slug, k.name])), [data]);
  const shown = useMemo(() => applyJustSent(data?.library ?? [], justSent).filter((r) => filter === "all" || r.brand_kit === filter), [data, filter, justSent]);
  useEffect(() => { if (draft) setJustSent(null); }, [draft]);
  useEffect(() => {
    if (!flashId) return;
    const t = window.setTimeout(() => setFlashId(null), 2800);
    return () => window.clearTimeout(t);
  }, [flashId]);
  const usedKits = useMemo(() => (data?.kits ?? []).filter((k) => (data?.library ?? []).some((r) => r.brand_kit === k.slug)), [data]);

  const remove = async (r: LibraryRow) => {
    if (!api || !window.confirm(`Delete "${r.title}"? This cannot be undone.`)) return;
    try { await api.remove(r.id); await reload(); toast({ title: "Deleted" }); }
    catch (e) { toast({ title: "Could not delete", description: e instanceof Error ? e.message : String(e), variant: "destructive" }); }
  };

  /* ───────── builder view ───────── */
  if (draft && api) {
    return (
      <div className="space-y-6">
        <PageHeader title={draft.id ? "Edit email" : "New email"} description="Say what you want in plain words. Free AI writes it, you check it, then send or download."
          actions={<button type="button" onClick={() => { setDraft(null); void reload(); }} className={btnPlain}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to the library</button>} />
        <EmailBuilder api={api} initial={draft} onSaved={() => { void reload(); }}
          onSentDone={(row, to, name) => {
            // Back to the library, newest first, the sent card lit for a moment.
            setJustSent({ id: row.id, to, name, at: new Date().toISOString() }); setFlashId(row.id); setFilter("all"); setDraft(null); void reload();
          }} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Emails" description="Write a branded email with free AI, check it, then send it or download it."
        actions={
          <>
            <button type="button" onClick={() => api && setClientOpen(true)} disabled={!api || !api.dbReady} className={btnTinted}><UserPlus className="h-4 w-4" aria-hidden="true" />Add a client brand</button>
            <button type="button" onClick={() => api && setDraft(emptyDraft(api.kits[0]?.slug ?? "bestly"))} disabled={!api} className={btnPrimary}><Plus className="h-4 w-4" aria-hidden="true" />New email</button>
          </>
        } />

      <p className={cn("text-[13px]", secondary)}>
        <Lines>Looking for the original template files? </Lines>{" "}
        <Link to="/admin/templates" className={cn("text-[#409CFF] underline-offset-2 hover:underline", focusRing)}>Open the template files</Link>.
      </p>

      {loadErr && (
        <div role="alert" className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-4 text-sm text-white/70">
          <p className="[overflow-wrap:anywhere]">Could not load the library: {loadErr}</p>
          <button type="button" onClick={() => void reload()} className={cn(btnTinted, "mt-3")}><RefreshCw className="h-4 w-4" aria-hidden="true" />Try again</button>
        </div>
      )}
      {api && !api.dbReady && (
        <div role="status" className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-4 text-sm text-amber-200">
          <Lines>The email tables are not in the database yet, so the library is empty and Save and Send are off. Writing, previews and downloads still work.</Lines>
        </div>
      )}

      {api && usedKits.length > 0 && (
        <div role="group" aria-label="Filter by brand" className="flex flex-wrap gap-2">
          {[{ slug: "all", name: "All" }, ...usedKits].map((k) => {
            const on = filter === k.slug;
            return (
              <button key={k.slug} type="button" aria-pressed={on} onClick={() => setFilter(k.slug)}
                className={cn("inline-flex min-h-[44px] items-center rounded-full border px-4 text-sm font-medium", on ? "border-white/25 bg-white/[0.12] text-white" : "border-white/[0.08] bg-white/[0.03] text-white/60 hover:bg-white/[0.07] hover:text-white", focusRing)}>
                {k.name}
              </button>
            );
          })}
        </div>
      )}

      {!data && !loadErr && (
        <div className="grid gap-5 lg:grid-cols-2" aria-busy="true" aria-label="Loading emails">
          {[0, 1].map((i) => <div key={i} className={cn(cardCls, "p-4 sm:p-5")}><div className="aspect-[4/3] rounded-xl bg-white/[0.05] motion-safe:animate-pulse" /></div>)}
        </div>
      )}

      {data && shown.length === 0 && (
        <div className="rounded-2xl border border-dashed border-white/[0.1] px-6 py-16 text-center">
          <Inbox className="mx-auto h-5 w-5 text-white/25" aria-hidden="true" />
          <p className={cn("mx-auto mt-3 max-w-sm text-sm", secondary)}><Lines>Nothing saved yet. Tap New email to write the first one.</Lines></p>
        </div>
      )}

      {shown.length > 0 && api && (
        <EmailLibrary rows={shown} kitName={kitName} highlightId={flashId}
          onOpen={(r) => setDraft(draftFromRow(r))}
          onStartFrom={(r) => setDraft({ ...emptyDraft(r.brand_kit), brief: r.brief ?? "" })}
          onDelete={(r) => void remove(r)} />
      )}

      {api && <ClientDialog open={clientOpen} onClose={() => setClientOpen(false)} api={api} onMade={async (slug) => { await reload(); setClientOpen(false); setDraft(emptyDraft(slug)); }} />}
    </div>
  );
}

function ClientDialog({ open, onClose, api, onMade }: { open: boolean; onClose: () => void; api: EmailApi; onMade: (slug: string) => void }) {
  const { toast } = useToast();
  const [clients, setClients] = useState<{ slug: string; name: string }[] | null>(null);
  const [busy, setBusy] = useState("");
  useEffect(() => {
    if (!open || clients) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void (supabase as any).from("approval_clients").select("slug,name").order("name").then(({ data }: { data: { slug: string; name: string }[] | null }) => setClients(data ?? []));
  }, [open, clients]);
  const make = async (slug: string) => {
    setBusy(slug);
    try { const k = await api.kitFromClient?.(slug); if (k) onMade(k); }
    catch (e) { toast({ title: "Could not make the brand", description: e instanceof Error ? e.message : String(e), variant: "destructive" }); }
    setBusy("");
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-[480px] border-white/10 bg-neutral-950 text-white">
        <DialogHeader>
          <DialogTitle>Add a client brand</DialogTitle>
          <DialogDescription className="text-white/60">Pulls the client's colors, fonts and logo into an email look.</DialogDescription>
        </DialogHeader>
        <ul className="max-h-[50vh] space-y-2 overflow-auto">
          {clients === null && <li className="text-sm text-white/50">Loading</li>}
          {clients?.length === 0 && <li className="text-sm text-white/50">No clients found.</li>}
          {clients?.map((c) => (
            <li key={c.slug}>
              <button type="button" disabled={!!busy} onClick={() => void make(c.slug)} className={cn("flex min-h-[44px] w-full items-center justify-between rounded-xl bg-white/[0.06] px-4 text-left text-[15px] hover:bg-white/[0.1]", focusRing)}>
                <span className="[overflow-wrap:anywhere]">{c.name}</span>
                <span className="text-xs text-white/50">{busy === c.slug ? "Working" : "Use"}</span>
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
