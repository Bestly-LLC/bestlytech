/**
 * Maya's recent calls (edge function maya-admin). Tap a call for the transcript and the tickets filed on it.
 * useMayaCalls() owns the fetch (so the Messages column's badge and summary stay current while it is collapsed);
 * MayaCallsList draws the rows and the transcript sheet. Loading shows skeletons; a failure shows plain text and a Retry.
 */
import { useCallback, useState } from "react";
import { PhoneIncoming, PhoneOutgoing, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { fmtPhone } from "@/components/admin/roofguard/AvaShared";
import { invokeError } from "@/components/admin/roofguard/AvaActions";
import { LiveTranscript, type Line } from "@/components/admin/roofguard/AvaCalls";
import { ScrollSheet } from "@/components/admin/roofguard/AvaSheet";
import { callLength, whenWords } from "./mayaFormat";

type CallRow = { conversation_id: string; started_at: string | null; duration_secs: number | null; status: string | null; caller: string | null;
  direction: string | null; summary: string | null; tickets: string[] };
type CallDetail = CallRow & { data: { key: string; value: unknown }[]; transcript: Line[] };

type Ask<T> = { ok: true; data: T; error?: undefined } | { ok: false; error: string };
async function ask<T>(body: Record<string, unknown>): Promise<Ask<T>> {
  const { data, error } = await supabase.functions.invoke("maya-admin", { body });
  if (error || !data || (data as { ok?: boolean }).ok === false) {
    return { ok: false, error: await invokeError(error, data as { error?: string } | null, "Couldn't load calls. Try again in a minute.") };
  }
  return { ok: true, data: data as T };
}

const chip = "inline-flex items-center whitespace-nowrap rounded-full bg-white/10 px-2 py-0.5 font-mono text-[12px] text-white/80";
const labelOf = (k: string) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export type { CallRow };

export function useMayaCalls() {
  const [rows, setRows] = useState<CallRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    const r = await ask<{ calls: CallRow[] }>({ action: "calls", limit: 25 });
    if (r.ok) { setRows(r.data.calls); setErr(null); } else setErr(r.error);
    setBusy(false);
  }, []);
  return { rows, err, busy, load };
}

export function MayaCallsList({ rows, err, busy, load }: { rows: CallRow[] | null; err: string | null; busy: boolean; load: () => Promise<void> }) {
  const [open, setOpen] = useState<CallRow | null>(null);
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);

  const openCall = async (c: CallRow) => {
    setOpen(c); setDetail(null); setDetailErr(null);
    const r = await ask<{ call: CallDetail }>({ action: "call", conversation_id: c.conversation_id });
    if (r.ok) setDetail(r.data.call); else setDetailErr(r.error);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-[14px] text-white/60">Tap a call for the transcript.</p>
        <button type="button" onClick={() => void load()} disabled={busy}
          className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl bg-white/[0.07] px-4 text-[15px] font-medium text-white ring-1 ring-white/10 hover:bg-white/[0.12] disabled:opacity-60 motion-safe:active:scale-[0.97]">
          <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} aria-hidden />Refresh
        </button>
      </div>

      {err && (
        <div role="alert" className="rounded-2xl bg-amber-500/10 p-4 text-[15px] text-amber-100 ring-1 ring-amber-500/30">
          <p>{err}</p>
          <button type="button" onClick={() => void load()} className="mt-2 min-h-[44px] rounded-xl bg-white/10 px-4 font-medium text-white hover:bg-white/15">Retry</button>
        </div>
      )}

      {rows === null && !err && Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="h-[92px] rounded-2xl bg-white/[0.04] ring-1 ring-white/10 motion-safe:animate-pulse" aria-hidden />
      ))}

      {rows?.length === 0 && <p className="rounded-2xl bg-white/[0.04] p-5 text-[15px] text-white/70 ring-1 ring-white/10">No calls yet.</p>}

      {rows?.map((c) => {
        const Dir = c.direction === "outbound" ? PhoneOutgoing : PhoneIncoming;
        return (
          <button key={c.conversation_id} type="button" onClick={() => void openCall(c)}
            className="block w-full rounded-2xl bg-white/[0.04] p-4 text-left ring-1 ring-white/10 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 motion-safe:transition-transform motion-safe:duration-100 motion-safe:active:scale-[0.99]">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-white/65">
              <Dir className="h-4 w-4" aria-hidden />
              <span className="font-semibold text-white">{c.started_at ? whenWords(c.started_at) : "Time unknown"}</span>
              {c.duration_secs != null && <span className="whitespace-nowrap">{callLength(c.duration_secs)}</span>}
              <span className="whitespace-nowrap">{c.caller ? fmtPhone(c.caller) : "Unknown caller"}</span>
            </span>
            <span className="mt-1.5 block text-[15px] leading-snug text-white/85">{c.summary || "No summary yet. It shows up a minute after the call ends."}</span>
            {c.tickets.length > 0 && (
              <span className="mt-2 flex flex-wrap gap-1.5">{c.tickets.map((code) => <span key={code} className={chip}>{code}</span>)}</span>
            )}
          </button>
        );
      })}

      <ScrollSheet open={!!open} onClose={() => setOpen(null)}
        title={open?.started_at ? whenWords(open.started_at) : "Call"}
        description={open ? [open.caller ? fmtPhone(open.caller) : "Unknown caller", callLength(open.duration_secs)].filter(Boolean).join(" · ") : undefined}>
        {detailErr && <p role="alert" className="rounded-xl bg-amber-500/10 p-3 text-[15px] text-amber-100">{detailErr}</p>}
        {!detail && !detailErr && <div className="h-40 rounded-2xl bg-white/[0.04] motion-safe:animate-pulse" aria-hidden />}
        {detail && (
          <div className="space-y-5 pb-4">
            {detail.tickets.length > 0 && (
              <div>
                <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/55">Tickets filed</h4>
                <div className="flex flex-wrap gap-1.5">{detail.tickets.map((code) => <span key={code} className={chip}>{code}</span>)}</div>
              </div>
            )}
            {detail.summary && (
              <div>
                <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/55">Summary</h4>
                <p className="text-[15px] leading-snug text-white/90">{detail.summary}</p>
              </div>
            )}
            {detail.data.length > 0 && (
              <div>
                <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/55">Collected on the call</h4>
                <dl className="space-y-1.5 text-[14px]">
                  {detail.data.map((d) => (
                    <div key={d.key} className="flex flex-wrap gap-x-2">
                      <dt className="text-white/55">{labelOf(d.key)}</dt>
                      <dd className="break-words text-white/90">{typeof d.value === "boolean" ? (d.value ? "Yes" : "No") : String(d.value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            <div>
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/55">Transcript</h4>
              <LiveTranscript lines={detail.transcript} inline agent="Maya" them="Caller" />
            </div>
          </div>
        )}
      </ScrollSheet>
    </div>
  );
}
