/**
 * Turo Watch → Reviews. Stella's desk: the All-Star numbers with the math, replies waiting for Jared's tap,
 * guest ratings he owes, and the post-trip "please leave a review" drafts he pastes into Turo himself.
 * Nothing here posts on its own: Approve & post only marks a reply approved; Stella's Pi job posts it on its next pass.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Clipboard, ExternalLink, Loader2, MessageSquare, RefreshCw, Send, Star, UserCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { ActionMenu } from "@/components/admin/ActionMenu";
import { EmptyState } from "@/components/admin/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { act, agoText, card, copyText, dayOnly, fieldCls, muted, nb, pillPrimary, pillSecondary, rpc, starsLabel, useAdminRpc, well, whenLA } from "./repShared";

interface Metric {
  metric: string; label: string; rate: number | null; threshold: number; ok: boolean; at_risk: boolean;
  misses_allowed?: number; five_stars_needed?: number; cancels_allowed?: number; host_cancels?: number;
}
interface Coach { has_data: boolean; all_star?: boolean; status?: string; next_assessment?: string; window?: string; metrics?: Metric[]; at_risk?: boolean; message?: string; taken_at?: string }
interface Review {
  id: string; guest_first: string; review_date: string; stars: number | null; text: string | null; status: string; needs_reason: string | null;
  draft: string | null; draft_by: string | null; jared_notes: string | null; respond_available: boolean; has_response: boolean; response_text: string | null;
  post_error: string | null; reservation_id: number | null; trip: { lax?: boolean; nights?: number } | null; vehicle: string | null; posted_at: string | null;
}
interface Rating { reservation_id: number; guest_first: string | null; deadline: string; status: string; draft: string | null; claim_open: boolean }
interface JobRow { last_run_at: string | null; last_ok: boolean | null; last_summary: string | null }
interface Rep {
  coach: Coach;
  stats: { taken_at: string; avg_rating: number | null; ratings: number | null; trips_365: number | null; pct_5star: number | null; unrated_pct: number | null } | null;
  settings: { auto_post_5star: boolean; ask_lax: string | null; ask_home: string | null } | null;
  queue: Review[]; posted: Review[]; counts: { total: number; with_text: number; answered: number }; ratings: Rating[];
  job: { stella_reviews: JobRow | null; stella_queue: JobRow | null } | null;
  reader: { seen_at: string | null; signed_in: boolean | null; last_error: string | null } | null;
}
interface Msg { sent_at: string; role: string; author: string | null; body: string }

const pct = (n: number | null | undefined) => (n == null ? "–" : `${n}%`);

function Stars({ n }: { n: number | null }) {
  if (n == null) return null;
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={starsLabel(n)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cn("h-4 w-4", i <= n ? "fill-amber-300 text-amber-300 bento:fill-amber-500 bento:text-amber-500" : "text-white/25")} aria-hidden />
      ))}
    </span>
  );
}

function cushion(m: Metric): string {
  if (m.metric === "cancellation") return m.ok ? "Never host-cancel a trip" : "Over the line. Do not cancel any trip";
  if (m.metric === "trips") return m.ok ? "Enough trips" : "Not enough trips yet";
  if (!m.ok) return `${m.five_stars_needed ?? "?"} more 5-star trips to get back over`;
  const n = m.misses_allowed ?? 0;
  if (n <= 0) return "The next trip that is not 5-star drops it under";
  return `${n} non-5-star ${n === 1 ? "trip" : "trips"} of cushion`;
}

function AllStarCard({ data }: { data: Rep }) {
  const c = data.coach;
  if (!c.has_data) {
    return <section className={card}><EmptyState compact icon={Star} title="Stella has not read your Performance page yet" description="Her first read fills in your All-Star numbers and how much cushion each one has." /></section>;
  }
  const metrics = (c.metrics ?? []).filter((m) => m.rate != null);
  const lost = c.all_star === false;
  return (
    <section className={cn(card, "space-y-4 p-5")} aria-labelledby="allstar-h">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 id="allstar-h" className="text-xs font-semibold uppercase tracking-widest text-white/60">All-Star Host</h2>
          <p className={cn("mt-1 flex items-center gap-2 text-xl font-semibold", lost ? "text-red-300 bento:text-red-700" : "text-white")}>
            {lost ? <XCircle className="h-5 w-5" aria-hidden /> : <CheckCircle2 className="h-5 w-5 text-emerald-300 bento:text-emerald-600" aria-hidden />}
            {c.status ?? (lost ? "Not active" : "Active")}
          </p>
        </div>
        <p className={cn("text-sm", muted)}>
          Next check <span className="whitespace-nowrap font-medium text-white">{c.next_assessment ?? "–"}</span>
          {c.window && <><br />Window <span className="whitespace-nowrap">{c.window}</span></>}
        </p>
      </div>

      {c.at_risk && (
        <div role="alert" className="flex items-start gap-3 rounded-xl bg-amber-400/10 p-3 text-[0.95rem] text-white/90 ring-1 ring-amber-300/30 bento:bg-amber-50 bento:text-[#4a3000] bento:ring-amber-300">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300 bento:text-amber-600" aria-hidden />
          <div><p className="font-semibold">Stella says you are close to a line</p><p className="mt-0.5">{c.message}</p></div>
        </div>
      )}

      <ul className="divide-y divide-white/[0.06] bento:divide-black/5">
        {metrics.map((m) => {
          const lowIsGood = m.metric === "cancellation";
          const width = m.metric === "trips" ? Math.min(100, ((m.rate ?? 0) / Math.max(m.threshold, 1)) * 100) : Math.min(100, m.rate ?? 0);
          const tick = m.metric === "trips" ? 100 : m.threshold;
          return (
            <li key={m.metric} className="py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[0.95rem] text-white">{m.label}</span>
                <span className="whitespace-nowrap text-lg font-semibold tabular-nums text-white">{m.metric === "trips" ? `${m.rate} trips` : pct(m.rate)}</span>
              </div>
              <div className="relative mt-2 h-2 rounded-full bg-white/10 bento:bg-black/10" role="img"
                aria-label={`${m.label} ${m.rate}${m.metric === "trips" ? " trips" : " percent"}, line ${m.threshold}${m.metric === "trips" ? " trips" : " percent"}`}>
                <div className={cn("h-full rounded-full", m.at_risk || !m.ok ? "bg-amber-300 bento:bg-amber-500" : "bg-emerald-300 bento:bg-emerald-500")} style={{ width: `${width}%` }} />
                <div className="absolute -top-1 h-4 w-0.5 rounded bg-white/70 bento:bg-black/60" style={{ left: `${tick}%` }} aria-hidden />
              </div>
              <p className={cn("mt-1.5 flex flex-wrap items-center gap-x-2 text-sm", muted)}>
                <span className="whitespace-nowrap">{lowIsGood ? "Line: up to" : "Line:"}&nbsp;{m.metric === "trips" ? `${m.threshold} trips` : `${m.threshold}%`}</span>
                <span aria-hidden>·</span>
                <span className={cn(m.at_risk || !m.ok ? "font-medium text-amber-200 bento:text-amber-700" : "")}>{cushion(m)}</span>
              </p>
            </li>
          );
        })}
      </ul>

      {data.stats && (
        <p className={cn("text-sm", muted)}>
          Reviews page, last 365 days: <span className="whitespace-nowrap">{data.stats.avg_rating ?? "–"} average</span>, <span className="whitespace-nowrap">{pct(data.stats.pct_5star)} five-star</span> counting unrated trips, <span className="whitespace-nowrap">{data.stats.ratings ?? "–"} ratings</span> from <span className="whitespace-nowrap">{data.stats.trips_365 ?? "–"} trips</span>.
        </p>
      )}
    </section>
  );
}

function TripMessages({ reservation }: { reservation: number }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open || msgs) return;
    void rpc("rep_trip_messages", { p_reservation: reservation }).then(({ data, error }) => { if (error) setErr(error.message); else setMsgs(data as Msg[]); });
  }, [open, msgs, reservation]);
  return (
    <div className={well}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-11 w-full items-center justify-between gap-2 px-3 text-left text-sm font-medium text-white">
        <span className="inline-flex items-center gap-2"><MessageSquare className="h-4 w-4" aria-hidden /> Trip messages</span>
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-3">
          {err && <p className="text-sm text-red-300 bento:text-red-700">Could not load: {err}</p>}
          {!msgs && !err && <Skeleton className="h-16 rounded-lg" />}
          {msgs && msgs.length === 0 && <p className={cn("text-sm", muted)}>No messages saved for this trip.</p>}
          {msgs?.map((m, i) => (
            <p key={i} className="text-sm text-white/80">
              <span className="font-medium text-white">{m.role === "host" ? "You" : m.author ?? "Guest"}</span>
              <span className={muted}> · {whenLA(m.sent_at)}</span><br />{m.body}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCard({ r, reload }: { r: Review; reload: () => void }) {
  const [draft, setDraft] = useState(r.draft ?? "");
  const [notes, setNotes] = useState(r.jared_notes ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { setDraft(r.draft ?? ""); }, [r.draft]);
  const dirty = draft.trim() !== (r.draft ?? "").trim();
  const under5 = r.stars != null && r.stars < 5;
  const trip = r.trip ? [r.trip.lax ? "LAX pickup" : "Home pickup", r.trip.nights ? `${r.trip.nights} ${r.trip.nights === 1 ? "night" : "nights"}` : null].filter(Boolean).join(" · ") : null;
  const waiting = r.status === "new" || r.status === "redraft";
  const approved = r.status === "approved";
  const run = async (key: string, args: Record<string, unknown>, ok: string) => { const res = await act(setBusy, key, "review_set", { p_id: r.id, ...args }, ok); if (res) reload(); return res; };

  return (
    <article className={cn(card, "space-y-3 p-4 sm:p-5", under5 && "ring-1 ring-amber-300/40")} aria-label={`Review from ${r.guest_first}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold text-white">
            {r.guest_first} <Stars n={r.stars} />
            {under5 && <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-semibold text-amber-200 bento:bg-amber-100 bento:text-amber-800">Under 5 stars</span>}
          </p>
          <p className={cn("mt-0.5 text-sm", muted)}>{dayOnly(r.review_date)}{trip ? ` · ${trip}` : ""}</p>
        </div>
        <ActionMenu label={`More actions for ${r.guest_first}`} items={[
          { label: "I replied on Turo myself", icon: UserCheck, group: "Done", onSelect: () => run("hand", { p_action: "posted_by_hand" }, "Marked as replied") },
          { label: "Skip this review", icon: XCircle, group: "Done", destructive: true, onSelect: () => run("skip", { p_action: "skip" }, "Skipped") },
        ]} />
      </header>

      {r.text && <blockquote className="rounded-xl border-l-4 border-white/20 bg-white/[0.03] p-3 text-[0.95rem] leading-relaxed text-white/90 bento:bg-[var(--bento-well)]">{r.text}</blockquote>}
      {r.needs_reason && <p className={cn("flex items-start gap-2 text-sm", muted)}><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300 bento:text-amber-600" aria-hidden />{r.needs_reason}</p>}
      {r.reservation_id && <TripMessages reservation={r.reservation_id} />}

      {waiting ? (
        <p className={cn("flex items-center gap-2 text-sm", muted)}><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Stella is writing a draft. It lands within 10 minutes.</p>
      ) : (
        <div className="space-y-2">
          <label htmlFor={`draft-${r.id}`} className="text-xs font-semibold uppercase tracking-widest text-white/60">
            Reply draft{r.draft_by ? <span className="font-normal normal-case tracking-normal"> · {r.draft_by}</span> : null}
          </label>
          <textarea id={`draft-${r.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} className={cn(fieldCls, "leading-relaxed")} disabled={approved} />
          <p className={cn("text-sm", muted)}><span className="whitespace-nowrap">{draft.trim().length} characters</span>. No emoji. Ends with Hope to host you again soon!</p>
        </div>
      )}

      {r.status === "failed" && <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-200 bento:bg-red-50 bento:text-red-800">Posting failed: {r.post_error ?? "unknown error"}. Nothing was posted. Approve again to retry, or reply on Turo yourself.</p>}
      {approved && <p className="flex items-center gap-2 rounded-xl bg-emerald-400/10 p-3 text-sm text-emerald-200 bento:bg-emerald-50 bento:text-emerald-800"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Approved. Stella posts it on her next pass, within 10 minutes.</p>}
      {r.status === "auto_ready" && <p className={cn("text-sm", muted)}>Plain 5-star. It posts itself only when auto-post is on (below). You can approve it now.</p>}
      {!r.respond_available && !waiting && <p className="rounded-xl bg-white/[0.05] p-3 text-sm text-white/80 bento:bg-[var(--bento-well)]">Turo is not showing a reply button on this review, so Stella cannot post it. Copy the draft if you want to use the words elsewhere.</p>}

      {!waiting && (
        <>
          <div>
            <label htmlFor={`notes-${r.id}`} className="text-xs font-semibold uppercase tracking-widest text-white/60">Notes for Stella</label>
            <input id={`notes-${r.id}`} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={approved} placeholder="e.g. mention the airport pickup, keep it shorter" className={cn(fieldCls, "mt-1.5 h-11")} />
          </div>
          <div className="flex flex-wrap gap-2">
            {r.respond_available && !approved && (
              <button className={pillPrimary} disabled={!!busy || draft.trim().length < 20}
                onClick={() => run("approve", { p_action: "approve", p_text: draft }, "Approved. Stella will post it.")}>
                {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />} Approve &amp; post
              </button>
            )}
            {approved && <button className={pillSecondary} disabled={!!busy} onClick={() => run("reopen", { p_action: "reopen" }, "Pulled back")}>Pull back</button>}
            {!approved && <button className={pillSecondary} disabled={!!busy} onClick={() => run("redraft", { p_action: "redraft", p_notes: notes }, "Stella will redraft it")}>
              {busy === "redraft" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />} Redraft
            </button>}
            {dirty && !approved && <button className={pillSecondary} disabled={!!busy} onClick={() => run("draft", { p_action: "draft", p_text: draft }, "Edit saved")}>Save my edit</button>}
            <button className={pillSecondary} onClick={() => copyText(draft, "Reply")}><Clipboard className="h-4 w-4" aria-hidden /> Copy</button>
          </div>
        </>
      )}
    </article>
  );
}

function RatingRow({ g, reload }: { g: Rating; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const draftDay = useMemo(() => { const d = new Date(g.deadline + "T12:00:00"); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); }, [g.deadline]);
  const run = async (key: string, action: string, ok: string) => { const res = await act(setBusy, key, "rating_set", { p_reservation: g.reservation_id, p_action: action }, ok); if (res) reload(); };
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[0.95rem] font-medium text-white">{g.guest_first ?? "Guest"}</p>
        <p className={cn("text-sm", muted)}>Rate by <span className="whitespace-nowrap font-medium text-white">{dayOnly(g.deadline)}</span></p>
      </div>
      {g.status === "skipped_claim" && <p className={cn("text-sm", muted)}>Skipped: a claim is open on this trip.</p>}
      {g.status === "watching" && <p className={cn("text-sm", muted)}>Stella drafts it on <span className="whitespace-nowrap">{dayOnly(draftDay)}</span>.</p>}
      {g.status === "draft_ready" && (
        <>
          <p className="rounded-xl bg-white/[0.04] p-3 text-[0.95rem] text-white/90 bento:bg-[var(--bento-well)]">{g.draft}</p>
          <p className={cn("text-sm", muted)}>Drafted from trip data only. Check it matches how the trip went before you post it.</p>
          <div className="flex flex-wrap gap-2">
            <button className={pillSecondary} onClick={() => copyText(g.draft ?? "", "Rating")}><Clipboard className="h-4 w-4" aria-hidden /> Copy</button>
            <button className={pillPrimary} disabled={!!busy} onClick={() => run("rated", "rated", "Marked as rated")}>{busy === "rated" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} I rated them</button>
            <ActionMenu label="More for this rating" items={[
              { label: "Redraft", icon: RefreshCw, onSelect: () => run("redraft", "redraft", "Stella will redraft it") },
              { label: "Skip this guest", icon: XCircle, destructive: true, onSelect: () => run("skip", "skip", "Skipped") },
            ]} />
          </div>
        </>
      )}
    </li>
  );
}

function AskDrafts({ s, reload }: { s: NonNullable<Rep["settings"]>; reload: () => void }) {
  const [lax, setLax] = useState(s.ask_lax ?? "");
  const [home, setHome] = useState(s.ask_home ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const save = async (key: "ask_lax" | "ask_home", val: string) => { const r = await act(setBusy, key, "reputation_setting_set", { p_key: key, p_val: val.trim() }, "Saved"); if (r) reload(); };
  const box = (id: string, label: string, val: string, set: (v: string) => void, key: "ask_lax" | "ask_home", saved: string | null) => (
    <div className="space-y-2">
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-widest text-white/60">{label}</label>
      <textarea id={id} rows={4} value={val} onChange={(e) => set(e.target.value)} className={cn(fieldCls, "leading-relaxed")} />
      <div className="flex flex-wrap gap-2">
        <button className={pillPrimary} onClick={() => copyText(val, label)}><Clipboard className="h-4 w-4" aria-hidden /> Copy</button>
        {val.trim() !== (saved ?? "").trim() && <button className={pillSecondary} disabled={!!busy} onClick={() => save(key, val)}>{busy === key && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save my edit</button>}
      </div>
    </div>
  );
  return (
    <section className={cn(card, "space-y-4 p-5")} aria-labelledby="ask-h">
      <div>
        <h2 id="ask-h" className="text-base font-semibold text-white">Post-trip review messages</h2>
        <p className={cn("mt-1 text-sm", muted)}>You add these in Turo as scheduled messages. Stella never sends them. Plain and warm, no pressure, nothing offered in return.</p>
      </div>
      {box("ask-lax", "LAX pickup", lax, setLax, "ask_lax", s.ask_lax)}
      {box("ask-home", "Home pickup", home, setHome, "ask_home", s.ask_home)}
    </section>
  );
}

function AutoPost({ on, reload }: { on: boolean; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  const set = async (val: boolean) => { setBusy(true); const r = await act((k) => setBusy(!!k), "auto", "reputation_setting_set", { p_key: "auto_post_5star", p_val: String(val) }, val ? "Auto-post is on" : "Auto-post is off"); setBusy(false); if (r) reload(); };
  return (
    <section className={cn(card, "flex items-start justify-between gap-4 p-5")}>
      <div className="min-w-0">
        <h2 id="auto-h" className="text-base font-semibold text-white">Auto-post plain 5-star replies</h2>
        <p className={cn("mt-1 text-sm", muted)}>{on ? "On. Stella posts a reply to a plain 5-star review on her own and lists it in the evening recap." : "Off. Stella drafts them and waits for you. Turn it on once the first drafts read right to you."} Under 5 stars, or a mention of damage, smoke, FSD or a claim, always waits for your tap.</p>
      </div>
      <Switch checked={on} disabled={busy} aria-labelledby="auto-h" onCheckedChange={(v) => (v ? setAsk(true) : void set(false))} />
      <AlertDialog open={ask} onOpenChange={setAsk}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Let Stella post plain 5-star replies?</AlertDialogTitle>
            <AlertDialogDescription>She will reply in your name to written 5-star reviews without asking, in the style you approved. Anything under 5 stars still waits for you.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction onClick={() => void set(true)}>Turn on</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

export default function ReviewsTab() {
  const { data, error, load } = useAdminRpc<Rep>("reputation_admin");
  const [showPosted, setShowPosted] = useState(false);

  if (!data) {
    return error
      ? <div className={cn(card, "space-y-3 p-5")} role="alert"><p className="text-white">Could not load Reviews: {error}</p><button className={pillSecondary} onClick={() => void load()}><RefreshCw className="h-4 w-4" aria-hidden /> Retry</button></div>
      : <div className="space-y-4" aria-busy="true"><Skeleton className="h-72 rounded-2xl" /><Skeleton className="h-56 rounded-2xl" /></div>;
  }
  const queue = data.queue;
  const signedOut = data.reader && data.reader.signed_in === false;
  const lastRead = data.job?.stella_reviews?.last_run_at ?? null;

  return (
    <div className="space-y-5">
      <p className={cn("text-sm", muted)}>
        Stella read Turo {agoText(lastRead)}. {data.counts.total} reviews on file, {data.counts.with_text} with words, {data.counts.answered} answered.
        {" "}<a className="inline-flex items-center gap-1 underline" href="https://turo.com/us/en/business/reviews" target="_blank" rel="noreferrer">Turo reviews <ExternalLink className="h-3.5 w-3.5" aria-hidden /></a>
      </p>
      {signedOut && <div role="alert" className="flex items-start gap-3 rounded-xl bg-amber-400/10 p-3 text-sm text-white/90 ring-1 ring-amber-300/30 bento:bg-amber-50 bento:text-[#4a3000]"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden />Turo looks signed out in the Pi browser. Stella cannot read reviews until it is signed in again. She never types passwords.</div>}

      <AllStarCard data={data} />

      <section aria-labelledby="queue-h" className="space-y-3">
        <h2 id="queue-h" className="text-xs font-semibold uppercase tracking-widest text-white/60">Waiting for you ({queue.length})</h2>
        {queue.length === 0
          ? <div className={card}><EmptyState compact icon={CheckCircle2} title="No replies waiting" description="New written reviews show up here with a draft. Under-5-star ones push to your phone first." /></div>
          : queue.map((r) => <ReviewCard key={r.id} r={r} reload={() => void load()} />)}
      </section>

      <section className={cn(card, "p-5")} aria-labelledby="rate-h">
        <h2 id="rate-h" className="text-base font-semibold text-white">Guests to rate</h2>
        <p className={cn("mt-1 text-sm", muted)}>You rate guests on Turo. Stella tracks the window (trip end plus 10 days) and drafts it one day before. Trips with an open claim are skipped.</p>
        {data.ratings.length === 0
          ? <p className={cn("mt-3 text-sm", muted)}>No open rating windows right now.</p>
          : <ul className="mt-2 divide-y divide-white/[0.06] bento:divide-black/5">{data.ratings.map((g) => <RatingRow key={g.reservation_id} g={g} reload={() => void load()} />)}</ul>}
      </section>

      {data.settings && <AskDrafts key={`${data.settings.ask_lax}|${data.settings.ask_home}`} s={data.settings} reload={() => void load()} />}
      {data.settings && <AutoPost on={data.settings.auto_post_5star} reload={() => void load()} />}

      <section className={cn(card, "p-5")} aria-labelledby="posted-h">
        <button type="button" onClick={() => setShowPosted((o) => !o)} aria-expanded={showPosted} className="flex min-h-11 w-full items-center justify-between gap-2 text-left">
          <h2 id="posted-h" className="text-base font-semibold text-white">Replies on Turo ({data.posted.length})</h2>
          <ChevronDown className={cn("h-5 w-5 text-white/60 transition-transform", showPosted && "rotate-180")} aria-hidden />
        </button>
        {showPosted && (
          <ul className="mt-2 divide-y divide-white/[0.06] bento:divide-black/5">
            {data.posted.map((r) => (
              <li key={r.id} className="space-y-1 py-3 text-[0.95rem]">
                <p className="flex flex-wrap items-center gap-2 font-medium text-white">{r.guest_first} <Stars n={r.stars} /><span className={cn("text-sm font-normal", muted)}>{dayOnly(r.review_date)}</span></p>
                {r.text && <p className="text-white/70">{r.text}</p>}
                {r.response_text && <p className="text-white/90"><span className="font-medium">Your reply:</span> {r.response_text}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className={cn("text-sm", muted)}>{nb("Stella checks reviews at 10:03 AM and 6:03 PM, and her queue every 10 min.")}</p>
    </div>
  );
}
