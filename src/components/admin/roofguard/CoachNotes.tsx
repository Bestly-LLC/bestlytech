/**
 * "Your notes on her lines": every line of Ava's Jared thumbed up or down, newest first.
 * The thumbs themselves live on the transcript bubbles (LiveTranscript in AvaCalls); this is where they land.
 * Each one says whether the Coach has used it yet, so a tap never disappears into nothing.
 * Data: admin_turn_vote_feed(source). Migration dated 2026-10-06 00:00.
 */
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { openCall } from "./coachBus";
import { CollapsibleSection } from "./CollapsibleSection";
import { ring, rpc, when12, type Source } from "./coachShared";

type NoteRow = { id: string; vote: "up" | "down"; said: string; note: string | null;
  call_id: string | null; created_at: string; seen_by_coach: boolean };

function NoteItem({ r, source }: { r: NoteRow; source: Source }) {
  const up = r.vote === "up";
  const Icon = up ? ThumbsUp : ThumbsDown;
  const body = (
    <>
      <span className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full",
        up ? "bg-emerald-400/15 text-emerald-300" : "bg-rose-400/15 text-rose-300")}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] leading-snug text-white">{r.said}</span>
        {r.note && <span className="mt-0.5 block text-sm text-white/70">{r.note}</span>}
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/55">
          <span>{up ? "More like this" : "Stop saying this"}</span>
          <span aria-hidden>·</span>
          <span>{when12(r.created_at)}</span>
          <span aria-hidden>·</span>
          <span className={r.seen_by_coach ? "text-emerald-300/80" : "text-amber-200/80"}>
            {r.seen_by_coach ? "The Coach has this" : "Waiting for her next review"}
          </span>
        </span>
      </span>
    </>
  );
  return (
    <li>
      {r.call_id
        ? <button type="button" onClick={() => openCall(source, r.call_id as string)}
            className={cn("flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-white/[0.04]", ring)}>{body}</button>
        : <div className="flex items-start gap-3 px-4 py-3">{body}</div>}
    </li>
  );
}

export function CoachNotes({ source }: { source: Source }) {
  const [rows, setRows] = useState<NoteRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [limit, setLimit] = useState(6);

  const load = useCallback(async () => {
    const { data, error } = await rpc<NoteRow[]>("admin_turn_vote_feed", { p_source: source, p_limit: 40 });
    if (error) setErr(error.message); else { setErr(null); setRows(data ?? []); }
  }, [source]);
  useEffect(() => { void load(); }, [load]);

  const waiting = (rows ?? []).filter((r) => !r.seen_by_coach).length;
  const downs = (rows ?? []).filter((r) => r.vote === "down").length;
  const summary = err ? "Couldn't load your notes"
    : !rows ? "Loading…"
    : rows.length === 0 ? "Thumb a line in any transcript and it lands here"
    : <><span className="tabular-nums">{rows.length}</span>&nbsp;marked · <span className="tabular-nums">{downs}</span>&nbsp;to fix</>;
  const pill = waiting > 0 ? (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-300">
      <span className="tabular-nums">{waiting}</span>&nbsp;waiting
    </span>
  ) : null;

  return (
    <CollapsibleSection id={`${source}-coach-notes`} title="Your notes on her lines" summary={summary} badge={pill}
      className="rounded-2xl" bodyClassName="pb-1">
      <p className="px-4 pb-1 pt-3 text-xs text-white/60">
        Thumbs you gave on Ava's own lines, in any transcript. She gets them with her next review, and a line you
        thumb after a call was already reviewed sends that call back for another look.
      </p>
      {err ? <p role="alert" className="px-4 py-3 text-sm text-red-200">Could not load your notes: {err}</p>
        : !rows ? <div className="mx-4 my-3 h-16 animate-pulse rounded-xl bg-white/[0.04]" aria-label="Loading your notes" />
        : rows.length === 0 ? <p className="px-4 py-6 text-center text-sm text-white/60">Nothing marked yet. Open any call and tap a thumb on one of her lines.</p>
        : <>
          <ul className="divide-y divide-white/5 border-t border-white/5">
            {rows.slice(0, limit).map((r) => <NoteItem key={r.id} r={r} source={source} />)}
          </ul>
          {rows.length > limit && (
            <div className="border-t border-white/5 p-2">
              <button type="button" onClick={() => setLimit((l) => l + 8)}
                className={cn("min-h-[44px] w-full rounded-xl text-[14px] font-medium text-white/80 hover:bg-white/[0.05]", ring)}>
                Show more ({rows.length - limit} left)
              </button>
            </div>
          )}
        </>}
    </CollapsibleSection>
  );
}
