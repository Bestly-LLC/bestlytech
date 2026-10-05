/**
 * Archive calls, the same on both Ava pages (Jared 2026-10-05). Archive = out of the call lists and the message inbox,
 * but kept: it still counts in the scorecard, spend and coach reviews, and "Put back" restores it. Delete is the
 * stronger option (out of the scorecard too). Database: rg_archive_call / ava_archive_call, admin_archived_calls,
 * migration 20261005170000_archive_calls.sql.
 *
 *   ArchiveCallButton   in a call sheet, next to Delete. Reads its own state, so it shows "Put Back" on an archived call.
 *   ArchivedCalls       a collapsed "Archived" section at the bottom of each page's call area.
 *   ARCHIVE_EVENT       fired on every archive / put back, so lists on the page reload (detail = source).
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Loader2 } from "lucide-react";
import { CollapsibleSection } from "./CollapsibleSection";

type Source = "roofguard" | "ava";
export const ARCHIVE_EVENT = "bestly:ava-archive";

// bound: supabase.rpc reads this.rest
const rpc = supabase.rpc.bind(supabase) as unknown as <T>(f: string, a: object) => Promise<{ data: T | null; error: { message: string } | null }>;
const table = (t: string) => (supabase.from(t as never) as unknown as {
  select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { archived_at: string | null } | null }> } } });

async function setArchived(source: Source, id: string, archive: boolean): Promise<string | null> {
  const { error } = await rpc(source === "ava" ? "ava_archive_call" : "rg_archive_call", { p_id: id, p_archive: archive });
  if (error) return error.message;
  window.dispatchEvent(new CustomEvent<Source>(ARCHIVE_EVENT, { detail: source }));
  return null;
}

/** Reload a page's lists whenever a call on that page is archived or put back. */
export function useArchiveReload(source: Source, reload: () => void) {
  useEffect(() => {
    const h = (e: Event) => { if ((e as CustomEvent<Source>).detail === source) reload(); };
    window.addEventListener(ARCHIVE_EVENT, h);
    return () => window.removeEventListener(ARCHIVE_EVENT, h);
  }, [source, reload]);
}

export function ArchiveCallButton({ source, callId, onChanged }: { source: Source; callId: string; onChanged?: () => void }) {
  const [archived, setA] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let off = false;
    setA(null);
    void table(source === "ava" ? "ava_calls" : "rg_calls").select("archived_at").eq("id", callId).maybeSingle()
      .then(({ data }) => { if (!off) setA(!!data?.archived_at); });
    return () => { off = true; };
  }, [source, callId]);

  const go = async () => {
    const to = !archived;
    setBusy(true);
    const err = await setArchived(source, callId, to);
    setBusy(false);
    if (err) { toast.error(err); return; }
    setA(to);
    if (to) {
      toast.success("Call archived", {
        description: "It's under Archived at the bottom of the page.",
        action: { label: "Undo", onClick: () => void setArchived(source, callId, false) },
      });
    } else {
      toast.success("Call put back");
    }
    onChanged?.();
  };

  if (archived === null) return null;
  const Icon = archived ? ArchiveRestore : Archive;
  return (
    <button type="button" onClick={() => void go()} disabled={busy}
      className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl bg-white/[0.03] text-[15px] font-medium text-white/85 ring-1 ring-white/10 transition hover:bg-white/[0.07] disabled:opacity-60 motion-safe:active:scale-[0.98]">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Icon className="h-4 w-4" aria-hidden />}
      {archived ? "Put Back" : "Archive Call"}
    </button>
  );
}

type Row = { id: string; call_no: number | null; direction: string | null; name: string | null; summary: string | null; message?: string | null;
  duration_sec: number | null; at: string; archived_at: string };

const whenShort = (iso: string) => {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
};

export function ArchivedCalls({ source, onOpen }: { source: Source; onOpen?: (id: string) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data } = await rpc<Row[]>("admin_archived_calls", { p_source: source, p_limit: 100 });
    setRows(data ?? []);
  }, [source]);
  useEffect(() => { void load(); }, [load]);
  useArchiveReload(source, load);

  const putBack = async (id: string) => {
    setBusy(id);
    const err = await setArchived(source, id, false);
    setBusy(null);
    if (err) toast.error(err); else toast.success("Call put back");
  };

  const n = rows?.length ?? 0;
  return (
    <CollapsibleSection id={`${source}-archived`} title="Archived" icon={<Archive className="h-4 w-4 text-white/60" />}
      summary={rows === null ? "Loading…" : n ? <><span className="tabular-nums">{n}</span>&nbsp;{n === 1 ? "call" : "calls"}</> : "Nothing archived"}>
      {n === 0 ? <p className="px-4 py-6 text-center text-sm text-white/50">Archived calls land here. They still count in her scorecard.</p> : (
        <ul className="divide-y divide-white/5">
          {rows!.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
              <button type="button" disabled={!onOpen} onClick={() => onOpen?.(r.id)}
                className="min-h-[44px] min-w-0 flex-1 text-left disabled:cursor-default">
                <span className="flex items-baseline gap-2">
                  {r.call_no != null && <span className="whitespace-nowrap text-xs tabular-nums text-white/50">#{r.call_no}</span>}
                  <span className="truncate text-[15px] text-white">{r.name ?? "Unknown"}</span>
                  <span className="ml-auto shrink-0 whitespace-nowrap text-xs text-white/45">{whenShort(r.at)}</span>
                </span>
                {(r.message || r.summary) && <span className="mt-0.5 line-clamp-1 block text-xs text-white/55">{r.message || r.summary}</span>}
              </button>
              <button type="button" onClick={() => void putBack(r.id)} disabled={busy === r.id}
                className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 text-[13px] font-medium text-white/85 transition hover:bg-white/15 disabled:opacity-60">
                {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />}Put back
              </button>
            </li>
          ))}
        </ul>
      )}
    </CollapsibleSection>
  );
}
