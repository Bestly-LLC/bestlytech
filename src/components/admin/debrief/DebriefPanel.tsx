/**
 * What is inside the call debrief, the same in all three presentations (Scout's pop-up, the wide review
 * sheet, the phone sheet): header, the call in one line, the summary, the to-dos for the client (tick, edit,
 * move, remove), the ones for Jared and Eli, and the three buttons. The shells in CallDebriefHost only decide
 * where it sits. Layout and colour come from debrief.css, taken from the approved mockups.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, type ElementType, type KeyboardEventHandler } from "react";
import {
  ArrowRightLeft, ArrowUpRight, Calendar, Check, ChevronLeft, CirclePlay, FileText, Loader2, Maximize2, Pencil, RefreshCw,
  Send, Undo2, X,
} from "lucide-react";
import { Lines } from "@/components/Lines";
import { TranscriptBubbles, CopyTranscriptButton } from "@/components/admin/TranscriptBubbles";
import { ScoutMark } from "./ScoutMark";
import type { Review } from "./useReview";
import type { DebriefRow, HerItem, MoveTarget, TeamItem } from "./types";
import { clock12, count, dueLabel, durationLabel, glue, joinNames, minutesBetween, nice, stamp } from "./format";
import { herList, labelsFor, TEAM_OWNERS } from "./people";
import { recordingsFolderUrl, STUDIO_HER_LIST_URL } from "./link";

export type Presentation = "popup" | "wide" | "phone";
export type PanelView = "review" | "transcript";

export interface TranscriptState {
  /** external = the transcript can only be opened in Nextcloud from here. */
  status: "idle" | "loading" | "ready" | "error" | "external";
  text: string | null;
  error: string | null;
}

export interface PanelProps {
  presentation: Presentation;
  /** The list row for this debrief: draws the header before the full debrief has arrived. */
  row: DebriefRow | null;
  review: Review;
  /** The element that carries the dialog's name: Dialog.Title, Drawer.Title, or a plain "h2". */
  titleAs: ElementType;
  /** Only for the plain "h2": the id the pop-up's aria-labelledby points at (Radix and vaul wire their own). */
  titleId?: string;
  view: PanelView;
  onView: (v: PanelView) => void;
  transcript: TranscriptState;
  onRetryTranscript: () => void;
  sending: boolean;
  confirmingSkip: boolean;
  onConfirmSkip: (v: boolean) => void;
  skipping: boolean;
  /** X, Not now, Escape: put it off for an hour. */
  onLater: () => void;
  onSend: () => void;
  onSkip: () => void;
  onUndoSend: () => void;
  undoing: boolean;
  /** Close without snoozing (a debrief that is already sent or skipped). */
  onClose: () => void;
  onExpand?: () => void;
}

/* ───────────────────────── small pieces ───────────────────────── */

function Skeleton({ lines = 3, tall = false }: { lines?: number; tall?: boolean }) {
  return (
    <div className={`dbf-skel${tall ? " dbf-skel-tall" : ""}`} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => <span key={i} style={{ width: `${tall ? [92, 80, 88, 56][i % 4] : 88 - i * 14}%` }} />)}
    </div>
  );
}

/**
 * The to-do lists while they load: the same rows in grey, as many as the list already said there would be, so the
 * sheet keeps its height when the words arrive instead of jumping.
 */
function HerSkeleton({ rows }: { rows: number }) {
  return (
    <div className="dbf-card dbf-rows" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="dbf-row" key={i}>
          <span className="dbf-sk-cell"><span className="dbf-sk dbf-sk-box" /></span>
          <div className="dbf-rbody">
            <div className="dbf-sk-line dbf-sk-l1"><span className="dbf-sk" style={{ width: `${74 - (i % 3) * 9}%` }} /></div>
            <div className="dbf-sk-line dbf-sk-l2"><span className="dbf-sk" style={{ width: `${54 - (i % 2) * 12}%` }} /></div>
            <div className="dbf-sk-line dbf-sk-l3"><span className="dbf-sk dbf-sk-chip" /></div>
          </div>
        </div>
      ))}
    </div>
  );
}

function TeamSkeleton({ rows, two }: { rows: number; two: boolean }) {
  return (
    <div className={`dbf-card dbf-srows${two ? " dbf-two" : ""}`} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="dbf-srow" key={i}>
          <span className="dbf-sk dbf-sk-av" />
          <span className="dbf-sk dbf-sk-bar" style={{ width: `${78 - (i % 2) * 14}%` }} />
          <span className="dbf-sk dbf-sk-due" />
        </div>
      ))}
    </div>
  );
}

function OwnerChip({ owner }: { owner: string }) {
  const name = nice(owner) || "Someone";
  const tone = owner === "jared" ? "j" : owner === "eli" ? "e" : "n";
  return <span className={`dbf-av dbf-av-${tone}`} role="img" aria-label={name}>{name.charAt(0).toUpperCase()}</span>;
}

/**
 * "Move": a native menu laid invisibly over a text button. The system draws the list, so it works with a
 * keyboard, a screen reader and an iPhone's own picker, and it never fights the sheet it sits in.
 */
function MovePicker({ label, options, onPick, disabled }: {
  label: string;
  options: { value: MoveTarget; label: string }[];
  onPick: (to: MoveTarget) => void;
  disabled?: boolean;
}) {
  return (
    <span className="dbf-mini dbf-mv" data-disabled={disabled || undefined}>
      <ArrowRightLeft width={14} height={14} strokeWidth={2} aria-hidden />
      Move
      <select
        aria-label={label}
        data-vaul-no-drag=""
        value=""
        disabled={disabled}
        onChange={(e) => {
          const to = e.target.value as MoveTarget | "";
          e.target.value = "";
          if (to) onPick(to);
        }}
      >
        <option value="" disabled>Move to</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </span>
  );
}

/**
 * A text field that grows with what is typed, so a long title is never half hidden behind a sideways scroll.
 * Enter is left to the caller (it saves the title; in the details it starts a new line).
 */
function GrowField({ className, value, onChange, onKeyDown, label, autoFocus, invalid, describedBy }: {
  className: string;
  value: string;
  onChange: (v: string) => void;
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  label: string;
  autoFocus?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  useLayoutEffect(fit, [value, fit]);
  useEffect(() => {
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fit]);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={className}
      value={value}
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      data-vaul-no-drag=""
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}

/* ───────────────────────── her list ───────────────────────── */

/** How a to-do that is no longer waiting on Jared reads. */
const SENT_TAG: Record<string, string> = { ours: "Handed back to you", done: "Done" };

function HerRow({ item, review, who, list, canAct }: { item: HerItem; review: Review; who: string; list: string; canAct: boolean }) {
  const errId = useId();
  const checked = review.isChecked(item.id);
  const editing = review.editingId === item.id && review.draft;
  const busy = review.moving.has(item.id);
  const moveOptions = TEAM_OWNERS.map((o) => ({ value: o as MoveTarget, label: nice(o) }));

  if (item.status === "dropped") {
    return (
      <div className="dbf-gone" role="listitem">
        <span>Removed from the list</span>
        {canAct && (
          <button type="button" className="dbf-mini" aria-label={`Undo remove: ${item.title}`} onClick={() => void review.restore(item)}>
            <Undo2 width={14} height={14} strokeWidth={2} aria-hidden />Undo
          </button>
        )}
      </div>
    );
  }

  // Already on her list (a debrief that was sent), or a debrief that was skipped: read only.
  const onHerList = item.status === "open" || item.status === "ours" || item.status === "done";
  if (onHerList || !canAct) {
    return (
      <div className={`dbf-row dbf-row-done${onHerList ? "" : " dbf-row-off"}`} role="listitem">
        <span className="dbf-chk dbf-chk-static" aria-hidden="true">
          <span className={`dbf-box${onHerList ? " dbf-box-on" : ""}`}><Check width={14} height={14} strokeWidth={3} /></span>
        </span>
        <div className="dbf-rbody">
          <div className="dbf-rtext">{glue(item.title)}</div>
          <div className="dbf-rmeta">
            {item.due && <span className="dbf-due"><Calendar width={12} height={12} strokeWidth={2.2} aria-hidden />{dueLabel(item.due)}</span>}
            {onHerList
              ? <span className="dbf-tag">{SENT_TAG[item.status] ?? `On ${list}`}</span>
              : <span className="dbf-tag dbf-tag-mute">Not sent</span>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dbf-row" data-on={checked || undefined} data-busy={busy || undefined} role="listitem" aria-busy={busy || undefined}>
      <button
        type="button"
        className="dbf-chk"
        data-on={checked || undefined}
        role="checkbox"
        aria-checked={checked}
        aria-label={`Send to ${who}: ${item.title}`}
        onClick={() => review.toggle(item.id)}
      >
        <span className="dbf-box"><Check width={14} height={14} strokeWidth={3} aria-hidden /></span>
      </button>
      <div className="dbf-rbody">
        {editing ? (
          <>
            <GrowField
              className="dbf-edit dbf-edit-title"
              value={review.draft!.title}
              label="Edit the item text"
              autoFocus
              invalid={!!review.editError}
              describedBy={review.editError ? errId : undefined}
              onChange={(v) => review.changeDraft({ title: v })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void review.commitEdit(); }
                else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); review.cancelEdit(); }
              }}
            />
            {review.editError && <p className="dbf-field-err" id={errId} role="alert">{review.editError}</p>}
            {(item.detail || review.draft!.detail) && (
              <GrowField
                className="dbf-edit dbf-edit-ta"
                value={review.draft!.detail}
                label="Edit the details"
                onChange={(v) => review.changeDraft({ detail: v })}
                onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); review.cancelEdit(); } }}
              />
            )}
            {item.quote && (
              <p className="dbf-quote">
                <Lines>{`From the call${item.at ? ` at ${item.at}` : ""}: “${glue(item.quote)}”`}</Lines>
              </p>
            )}
          </>
        ) : (
          <>
            <div className="dbf-rtext">{glue(item.title)}</div>
            {item.detail && <p className="dbf-rdetail"><Lines>{glue(item.detail)}</Lines></p>}
          </>
        )}
        <div className="dbf-rmeta">
          {editing ? (
            <label className="dbf-due dbf-due-edit">
              <Calendar width={12} height={12} strokeWidth={2.2} aria-hidden />
              <input type="date" data-vaul-no-drag="" value={review.draft!.due} aria-label="Due date" onChange={(e) => review.changeDraft({ due: e.target.value })} />
            </label>
          ) : (
            <span
              className="dbf-due"
              title={item.due && item.dueSaid === false ? "The call didn’t give a date, so Scout picked one about a week out." : undefined}
            >
              <Calendar width={12} height={12} strokeWidth={2.2} aria-hidden />
              {item.due ? dueLabel(item.due) : "No date"}
              {item.due && item.dueSaid === false && <span className="dbf-guess">Scout’s pick</span>}
            </span>
          )}
          <button
            type="button"
            className="dbf-mini"
            aria-label={`${editing ? "Done editing" : "Edit"}: ${item.title}`}
            onClick={() => (editing ? void review.commitEdit() : review.startEdit(item))}
          >
            {editing ? <Check width={14} height={14} strokeWidth={2.6} aria-hidden /> : <Pencil width={14} height={14} strokeWidth={2} aria-hidden />}
            {editing ? "Done" : "Edit"}
          </button>
          {editing && (
            <MovePicker
              label={`Hand this to someone else: ${item.title}`}
              options={moveOptions}
              disabled={busy}
              onPick={(to) => void review.move(item.id, to)}
            />
          )}
          <button type="button" className="dbf-mini dbf-rm" aria-label={`Remove: ${item.title}`} onClick={() => void review.remove(item)}>Remove</button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── for you and Eli ───────────────────────── */

function TeamRow({ item, review, person, readOnly }: { item: TeamItem; review: Review; person: string; readOnly: boolean }) {
  const busy = review.moving.has(item.id);
  const others = TEAM_OWNERS.filter((o) => o !== item.owner);
  const options: { value: MoveTarget; label: string }[] = [
    { value: "her", label: nice(herList(person)) },
    ...others.map((o) => ({ value: o as MoveTarget, label: nice(o) })),
  ];
  return (
    <div className="dbf-srow" role="listitem" data-busy={busy || undefined} aria-busy={busy || undefined}>
      <OwnerChip owner={item.owner} />
      <span className="dbf-stext">{glue(item.title)}</span>
      {item.due && <span className="dbf-sdue">{dueLabel(item.due)}</span>}
      {!readOnly && (
        <MovePicker label={`Move to someone else: ${item.title}`} options={options} disabled={busy} onPick={(to) => void review.move(item.id, to)} />
      )}
    </div>
  );
}

/* ───────────────────────── transcript ───────────────────────── */

function TranscriptBody({ transcript, onRetry, fileUrl }: { transcript: TranscriptState; onRetry: () => void; fileUrl: string | null }) {
  if (transcript.status === "idle" || transcript.status === "loading") return <Skeleton lines={6} />;
  if (transcript.status === "external") {
    return (
      <p className="dbf-empty">
        <Lines>Scout keeps this transcript in Nextcloud.</Lines>
        {fileUrl && <> <a className="dbf-tl dbf-tl-inline" href={fileUrl} target="_blank" rel="noopener noreferrer">Open in Nextcloud<ArrowUpRight width={14} height={14} aria-hidden /></a></>}
      </p>
    );
  }
  if (transcript.status === "error") {
    return (
      <div className="dbf-err" role="alert">
        <span>{transcript.error ?? "Couldn't load the transcript."}</span>
        <button type="button" className="dbf-mini" onClick={onRetry}><RefreshCw width={14} height={14} aria-hidden />Retry</button>
      </div>
    );
  }
  if (!transcript.text) {
    return (
      <p className="dbf-empty">
        <Lines>The transcript isn&rsquo;t ready yet. Scout is still putting it together.</Lines>
        {fileUrl && <> <a className="dbf-tl dbf-tl-inline" href={fileUrl} target="_blank" rel="noopener noreferrer">Look in Nextcloud<ArrowUpRight width={14} height={14} aria-hidden /></a></>}
      </p>
    );
  }
  return (
    <>
      <div className="dbf-tx-bar">
        <CopyTranscriptButton text={transcript.text} className="min-h-[44px]" />
        {fileUrl && (
          <a className="dbf-tl" href={fileUrl} target="_blank" rel="noopener noreferrer" aria-label="Open the files in Nextcloud, opens in a new tab">
            Open in Nextcloud<ArrowUpRight width={14} height={14} aria-hidden />
          </a>
        )}
      </div>
      <TranscriptBubbles text={transcript.text} me="JARED" />
    </>
  );
}

/* ───────────────────────── the panel ───────────────────────── */

export function DebriefPanel(p: PanelProps) {
  const { presentation, row, review, view, onView } = p;
  const uid = useId();
  const Title = p.titleAs;
  const d = review.detail;
  const h = d?.header;

  const status = h?.status ?? row?.status ?? "pending";
  const pending = status === "pending";
  const sent = status === "sent";
  const { person, who, list } = labelsFor(h, row);

  const meetingName = h?.meetingName ?? row?.meetingName ?? "Strategy call";
  const startedAt = h?.startedAt ?? row?.startedAt ?? null;
  const stoppedAt = h?.stoppedAt ?? row?.stoppedAt ?? null;
  const readyAt = h?.createdAt ?? row?.createdAt ?? stoppedAt ?? startedAt;
  const duration = durationLabel(h?.durationMin ?? row?.durationMin ?? minutesBetween(startedAt, stoppedAt));
  const people = joinNames(h?.people ?? []);
  const sandbox = h?.sandbox ?? row?.sandbox ?? false;
  // How much of the call Scout could hear. Only worth a word when a real part of it is missing.
  const coverage = h?.coverage ?? row?.coverage ?? null;
  const partial = coverage != null && coverage > 0 && coverage < 80 ? Math.round(coverage) : null;

  const recordingUrl = h?.recordingUrl ?? recordingsFolderUrl(startedAt ?? stoppedAt);
  const transcriptUrl = h?.transcriptUrl ?? recordingsFolderUrl(startedAt ?? stoppedAt);
  const canTranscript = !!d?.transcriptAvailable;

  const her = d?.her ?? [];
  const team = d?.team ?? [];
  const drafts = her.filter((i) => i.status === "draft");
  // Waiting on Jared: a new debrief, or one he already sent from while some items were left unticked.
  const canAct = pending || (sent && drafts.length > 0);
  const picked = review.selectedIds.length;
  const noHer = pending && !!d && drafts.length === 0;
  const canSend = canAct && picked > 0 && !p.sending;

  const bullets = d?.bullets ?? [];
  const wide = presentation === "wide";
  const phone = presentation === "phone";

  /* ── header ── */
  const header = (
    <div className="dbf-hd">
      <span className="dbf-mark"><ScoutMark /></span>
      <div className="dbf-hd-t">
        <div className="dbf-hd-k">
          <b>Scout</b><span aria-hidden="true">&middot;</span><span className="dbf-nw">{stamp(readyAt) || "Today"}</span>
        </div>
        <Title className="dbf-hd-h" {...(p.titleId ? { id: p.titleId } : {})}>{pending ? "Call debrief ready" : "Call debrief"}</Title>
      </div>
      {presentation === "popup" && p.onExpand && (
        <button type="button" className="dbf-xbtn" aria-label="Open the full review" title="Open the full review" onClick={p.onExpand}>
          <Maximize2 width={18} height={18} strokeWidth={2} aria-hidden />
        </button>
      )}
      <button
        type="button"
        className="dbf-xbtn"
        aria-label={pending ? "Close. Scout will remind you in 1 hour" : "Close"}
        title={pending ? "Close. Scout will remind you in 1 hour" : "Close"}
        onClick={pending ? p.onLater : p.onClose}
      >
        <X width={20} height={20} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );

  /* ── the call in one line, and its two links ── */
  const callLine = (
    <div className="dbf-call">
      <div className="dbf-call-l">
        <span className="dbf-ln dbf-cname">
          {sandbox && <span className="dbf-test" title="A rehearsal with the test client. Nothing here is a real client’s.">Test call</span>}
          {meetingName}
        </span>
        {(duration || people) && <span className="dbf-cdot"> &middot; </span>}
        {duration && <span className="dbf-ln dbf-nw">{duration}</span>}
        {duration && people && <> &middot; </>}
        {people && <span className="dbf-ln">{people}</span>}
      </div>
      {(recordingUrl || canTranscript) && (
        <div className="dbf-links">
          {recordingUrl && (
            <a className="dbf-lk" href={recordingUrl} target="_blank" rel="noopener noreferrer" aria-label="Recording, opens in Nextcloud Files">
              <CirclePlay width={15} height={15} strokeWidth={2} aria-hidden />Recording
            </a>
          )}
          {canTranscript && (
            <button
              type="button"
              className="dbf-lk"
              aria-pressed={view === "transcript"}
              aria-label={view === "transcript" ? "Transcript, showing. Go back to the review" : "Transcript, read the call"}
              onClick={() => onView(view === "transcript" ? "review" : "transcript")}
            >
              <FileText width={15} height={15} strokeWidth={2} aria-hidden />Transcript
            </button>
          )}
        </div>
      )}
    </div>
  );

  /* ── sections ── */
  const summarySection = (
    <section className="dbf-sec" aria-labelledby={`${uid}-sum`}>
      <h3 className="dbf-sh" id={`${uid}-sum`}>Summary</h3>
      {bullets.length > 0 ? (
        <div className="dbf-sum">{bullets.map((b, i) => <div key={i}><Lines>{glue(b)}</Lines></div>)}</div>
      ) : !d ? (
        <Skeleton lines={4} tall />
      ) : (
        <p className="dbf-empty"><Lines>Scout is still writing this one up.</Lines></p>
      )}
      {d && partial != null && (
        <p className="dbf-cov"><Lines>{`Scout only caught about ${partial}% of this call, so check the list for anything missing.`}</Lines></p>
      )}
    </section>
  );

  const transcriptSection = (
    <section className="dbf-sec" aria-labelledby={`${uid}-tx`}>
      <h3 className="dbf-sh" id={`${uid}-tx`}>
        <span>Transcript</span>
        {wide && <button type="button" className="dbf-mini" onClick={() => onView("review")}><ChevronLeft width={14} height={14} strokeWidth={2.2} aria-hidden />Summary</button>}
      </h3>
      <div className="dbf-tx">
        <TranscriptBody transcript={p.transcript} onRetry={p.onRetryTranscript} fileUrl={transcriptUrl} />
      </div>
    </section>
  );

  const herSection = (
    <section className="dbf-sec" aria-labelledby={`${uid}-her`}>
      <h3 className="dbf-sh" id={`${uid}-her`}>
        {canAct && her.length > 0 ? `For ${list} — needs your OK` : `For ${list}`}
      </h3>
      {!d ? (
        row?.herCount === 0
          ? <Skeleton lines={1} />
          : <HerSkeleton rows={Math.max(1, Math.min(6, row?.herCount ?? 3))} />
      ) : her.length === 0 ? (
        <p className="dbf-empty"><Lines>{`Nothing for ${who} came out of this call.`}</Lines></p>
      ) : (
        <div className="dbf-card dbf-rows" role="list" aria-label={`Items for ${list}`}>
          {her.map((item) => <HerRow key={item.id} item={item} review={review} who={who} list={list} canAct={canAct} />)}
        </div>
      )}
    </section>
  );

  // While the debrief loads, the list row already says how many team items there will be: hold their place.
  const teamComing = !d ? Math.min(6, row?.teamCount ?? 0) : 0;
  const teamSection = (team.length > 0 || teamComing > 0) && (
    <section className="dbf-sec" aria-labelledby={`${uid}-team`}>
      <h3 className="dbf-sh" id={`${uid}-team`}>
        <span>For you and Eli</span>
        <span className="dbf-sh-aside">no OK needed</span>
      </h3>
      {d ? (
        <div className={`dbf-card dbf-srows${wide ? " dbf-two" : ""}`} role="list" aria-label="Items for you and Eli">
          {team.map((item) => <TeamRow key={item.id} item={item} review={review} person={person} readOnly={!canAct} />)}
        </div>
      ) : (
        <TeamSkeleton rows={teamComing} two={wide} />
      )}
    </section>
  );

  // Not there until the debrief has loaded, but its space is kept so the buttons below do not jump.
  const skipPlaceholder = (
    <div className="dbf-skip dbf-skip-ph" aria-hidden="true"><span className="dbf-mini">Skip this debrief</span></div>
  );
  const skipBlock = pending && (!d ? skipPlaceholder : (
    <div className="dbf-skip">
      {p.confirmingSkip ? (
        <>
          <p className="dbf-skip-q"><Lines>{`Skip this debrief? Nothing goes to ${who}, and Scout stops reminding you.`}</Lines></p>
          <div className="dbf-skip-a">
            <button type="button" className="dbf-mini dbf-skip-yes" disabled={p.skipping} onClick={p.onSkip}>
              {p.skipping && <Loader2 width={14} height={14} className="dbf-spin" aria-hidden />}Yes, skip it
            </button>
            <button type="button" className="dbf-mini" onClick={() => p.onConfirmSkip(false)}>Keep it</button>
          </div>
        </>
      ) : (
        <button type="button" className="dbf-mini dbf-rm" onClick={() => p.onConfirmSkip(true)}>Skip this debrief</button>
      )}
    </div>
  ));

  /* ── a debrief that is not waiting on Jared any more ── */
  const stillWaiting = drafts.length === 0 ? "" : drafts.length === 1 ? " 1 more is still waiting for your OK." : ` ${drafts.length} more are still waiting for your OK.`;
  const doneBanner = d && !pending && (
    <div className="dbf-banner" role="status">
      <span className="dbf-banner-i" aria-hidden="true"><Check width={16} height={16} strokeWidth={2.6} /></span>
      <span className="dbf-banner-t">
        <Lines>
          {sent
            ? glue(`Sent ${h?.sentCount ? `${count(h.sentCount, "item")} ` : ""}to ${list}${h?.sentAt ? ` at ${clock12(h.sentAt)}` : ""}.${stillWaiting}`)
            : "Skipped. Nothing was sent."}
        </Lines>
      </span>
      {sent && h?.canUndo !== false && (
        <button type="button" className="dbf-mini" disabled={p.undoing} onClick={p.onUndoSend}>
          {p.undoing ? <Loader2 width={14} height={14} className="dbf-spin" aria-hidden /> : <Undo2 width={14} height={14} strokeWidth={2} aria-hidden />}
          Undo send
        </button>
      )}
    </div>
  );

  /* ── the body ── */
  let body: React.ReactNode;
  if (review.error && !d) {
    body = (
      <div className="dbf-err" role="alert">
        <span><Lines>Couldn&rsquo;t open this debrief.</Lines></span>
        <button type="button" className="dbf-mini" onClick={() => void review.reload()}><RefreshCw width={14} height={14} aria-hidden />Retry</button>
      </div>
    );
  } else if (view === "transcript" && !wide) {
    body = (
      <>
        <div className="dbf-tback">
          <button type="button" className="dbf-tl" onClick={() => onView("review")}><ChevronLeft width={16} height={16} strokeWidth={2.2} aria-hidden />Back to the review</button>
        </div>
        {transcriptSection}
      </>
    );
  } else if (wide) {
    body = (
      <>
        {doneBanner}
        <div className="dbf-cols" data-view={view}>
          {view === "transcript" ? transcriptSection : summarySection}
          {herSection}
        </div>
        {teamSection}
        {skipBlock}
      </>
    );
  } else {
    body = (
      <>
        {doneBanner}
        {summarySection}
        {herSection}
        {teamSection}
        {skipBlock}
      </>
    );
  }

  /* ── the three buttons ── */
  const sendLabel = p.sending ? "Sending" : picked === 0 ? "Pick an item to send" : `Send ${picked} to her list`;
  const studio = (
    <a className="dbf-tl" href={STUDIO_HER_LIST_URL} target="_blank" rel="noopener noreferrer" aria-label="Open in Studio, opens in a new tab">
      Open in Studio<ArrowUpRight width={16} height={16} strokeWidth={2} aria-hidden />
    </a>
  );
  const notNow = pending ? (
    <button type="button" className="dbf-p2" aria-label="Not now. Scout will remind you in 1 hour" onClick={p.onLater}>Not now</button>
  ) : (
    <button type="button" className="dbf-p2" onClick={p.onClose}>Close</button>
  );

  let footer: React.ReactNode;
  if (!canAct) {
    footer = (
      <div className="dbf-ft">
        <div className="dbf-acts">
          {studio}
          <button type="button" className="dbf-p1" onClick={p.onClose}>Done</button>
        </div>
      </div>
    );
  } else if (noHer) {
    footer = (
      <div className="dbf-ft">
        <p className="dbf-note"><Lines>{`Nothing to send. Close this when you have read it.`}</Lines></p>
        <div className="dbf-acts">
          {studio}
          {notNow}
          <button type="button" className="dbf-p1" disabled={p.skipping} onClick={p.onSkip}>
            {p.skipping ? <Loader2 width={17} height={17} className="dbf-spin" aria-hidden /> : <Check width={17} height={17} strokeWidth={2.4} aria-hidden />}
            Done
          </button>
        </div>
      </div>
    );
  } else {
    const sendBtn = (
      <button
        type="button"
        className={`dbf-p1${canSend ? "" : " dbf-off"}`}
        aria-disabled={!canSend}
        aria-busy={p.sending || undefined}
        onClick={() => { if (canSend) p.onSend(); }}
      >
        {p.sending ? <Loader2 width={17} height={17} className="dbf-spin" aria-hidden /> : <Send width={17} height={17} strokeWidth={2} aria-hidden />}
        {sendLabel}
      </button>
    );
    footer = phone ? (
      <div className="dbf-ft">
        <p className="dbf-note"><Lines>{`Nothing reaches ${who} until you tap Send.`}</Lines></p>
        {sendBtn}
        <div className="dbf-row2">{notNow}{studio}</div>
      </div>
    ) : (
      <div className="dbf-ft">
        <p className="dbf-note"><Lines>{`Nothing reaches ${who} until you tap Send.`}</Lines></p>
        <div className="dbf-acts">{studio}{notNow}{sendBtn}</div>
      </div>
    );
  }

  return (
    <>
      {header}
      {callLine}
      <div className="dbf-pbody" data-view={view}>{body}</div>
      {footer}
    </>
  );
}
