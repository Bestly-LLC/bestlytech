/**
 * Scout's call debrief, mounted once in AdminLayout.
 *
 * After a strategy call is recorded, Scout writes it up and drafts the client's to-dos. Nothing reaches the
 * client until Jared taps Send here. This component decides when the debrief shows and in what shape:
 *
 *   desktop, on its own     a pop-up card, bottom right (it never covers the page and waits to be answered)
 *   desktop, on request     the wide review sheet (expand on the card, /admin?debrief=<id>, Needs you, the bell)
 *   phone                   a bottom sheet
 *
 * It stays completely hidden until the backend has a pending debrief to show (and until the call_debrief_*
 * functions exist at all). While a call is being recorded it never opens by itself: a quiet toast says it is
 * ready and it opens when the call ends. "Not now" and closing both snooze it for an hour, and every way out
 * of the sheet is one tap from being taken back.
 */
import "./debrief.css";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import { Drawer } from "vaul";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { DEBRIEF_OPEN_EVENT } from "../scoutBus";
import { DebriefPanel, type PanelProps, type PanelView, type Presentation } from "./DebriefPanel";
import { debriefApi } from "./api";
import { count } from "./format";
import { labelsFor } from "./people";
import { dismissToast, showLaterToast, showLiveToast, showSentToast } from "./toasts";
import { useCallDebriefs } from "./useCallDebriefs";
import { useCallLive } from "./useCallLive";
import { useReview } from "./useReview";
import { useTranscript } from "./useTranscript";

type Size = "compact" | "full";
interface Shown { id: string; size: Size }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** After the page settles, so the pop-up arrives on its own instead of during the first paint. */
const AUTO_DELAY_MS = 900;
/** Long enough for the slowest way out (the phone sheet slides for half a second) before the sheet is unmounted. */
const EXIT_PHONE_MS = 600;
const EXIT_DESKTOP_MS = 320;

export function CallDebriefHost() {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const deb = useCallDebriefs();
  const live = useCallLive(deb.due.length > 0);
  const titleId = useId();

  /** What is mounted. It outlives `visible` by the length of the exit animation. */
  const [shown, setShown] = useState<Shown | null>(null);
  const [visible, setVisible] = useState(false);
  const [view, setView] = useState<PanelView>("review");
  const [sending, setSending] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [confirmingSkip, setConfirmingSkip] = useState(false);
  /** Asked to open (deep link, Needs you, the bell). Waits for the first answer from the server. */
  const [want, setWant] = useState<{ id: string | null; at: number } | null>(null);

  const shownRef = useRef<Shown | null>(null);
  shownRef.current = shown;
  const exitTimer = useRef<number | undefined>(undefined);
  /** Debriefs Jared has just dealt with: they must not pop up again while the list catches up. */
  const quiet = useRef(new Set<string>());
  const liveToasted = useRef(new Set<string>());

  const onError = useCallback((message: string) => { toast.error(message); }, []);
  const review = useReview(shown?.id ?? null, onError);
  const row = deb.rows?.find((r) => r.id === shown?.id) ?? null;
  const { transcript, retry: retryTranscript } = useTranscript(review.detail?.header.meetingId ?? null, view === "transcript" && !!review.detail);

  const presentation: Presentation = isMobile ? "phone" : shown?.size === "full" ? "wide" : "popup";
  const defaultSize: Size = isMobile ? "compact" : "full";

  /* ───────── opening and closing ───────── */

  const openSheet = useCallback((id: string, size: Size) => {
    window.clearTimeout(exitTimer.current);
    dismissToast(`debrief-live-${id}`);
    if (shownRef.current?.id !== id) {
      setView("review");
      setConfirmingSkip(false);
      setSending(false);
      setSkipping(false);
    }
    setShown({ id, size });
    setVisible(true);
  }, []);

  const closeSheet = useCallback(() => {
    setVisible(false);
    window.clearTimeout(exitTimer.current);
    exitTimer.current = window.setTimeout(() => setShown(null), isMobile ? EXIT_PHONE_MS : EXIT_DESKTOP_MS);
  }, [isMobile]);
  useEffect(() => () => window.clearTimeout(exitTimer.current), []);

  /** The pop-up grows into the wide sheet: same debrief, same ticks, no reload. */
  const expand = useCallback(() => {
    const cur = shownRef.current;
    if (cur) setShown({ id: cur.id, size: "full" });
  }, []);

  /* ───────── asked to open ───────── */

  // /admin?debrief=<id> (the link in Scout's push): open it, then tidy the address.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const id = q.get("debrief");
    if (id === null) return;
    if (UUID.test(id)) setWant({ id, at: Date.now() });
    q.delete("debrief");
    const rest = q.toString();
    navigate(location.pathname + (rest ? `?${rest}` : "") + location.hash, { replace: true });
  }, [location.search, location.pathname, location.hash, navigate]);

  // openDebrief() from Needs you, the bell and Scout.
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<{ id: string | null }>).detail?.id ?? null;
      setWant({ id: id && UUID.test(id) ? id : null, at: Date.now() });
    };
    window.addEventListener(DEBRIEF_OPEN_EVENT, on);
    return () => window.removeEventListener(DEBRIEF_OPEN_EVENT, on);
  }, []);

  useEffect(() => {
    if (!want) return;
    // Wait for the first answer so we know the feature exists; if the server never answers, a named one opens anyway.
    if (!deb.loaded) {
      if (!want.id) return;
      const t = window.setTimeout(() => { setWant(null); openSheet(want.id!, defaultSize); }, 4000);
      return () => window.clearTimeout(t);
    }
    setWant(null);
    if (!deb.available) return; // not switched on yet: show nothing
    const id = want.id ?? deb.pending[0]?.id ?? null;
    if (id) openSheet(id, defaultSize);
  }, [want, deb.loaded, deb.available, deb.pending, defaultSize, openSheet]);

  /* ───────── opening on its own ───────── */

  // Forget "just dealt with" ids once the list agrees they are no longer waiting.
  useEffect(() => {
    const waiting = new Set(deb.pending.map((r) => r.id));
    quiet.current.forEach((id) => { if (!waiting.has(id)) quiet.current.delete(id); });
  }, [deb.pending]);

  const candidate = deb.due.find((r) => !quiet.current.has(r.id)) ?? null;

  useEffect(() => {
    if (!deb.available || shown || want || !candidate) return;
    if (live) {
      // A call is being recorded: never open over it. One quiet note, and the sheet follows when the call ends.
      if (!liveToasted.current.has(candidate.id)) {
        liveToasted.current.add(candidate.id);
        showLiveToast({ id: `debrief-live-${candidate.id}`, onOpen: () => openSheet(candidate.id, defaultSize) });
      }
      return;
    }
    const t = window.setTimeout(() => openSheet(candidate.id, "compact"), AUTO_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [deb.available, shown, want, candidate, live, defaultSize, openSheet]);

  /* ───────── what the buttons do ───────── */

  const labels = labelsFor(review.detail?.header, row);
  const status = review.detail?.header.status ?? row?.status ?? "pending";

  /** Leaving with a row still open for editing saves what was typed (it never holds the sheet open). */
  const saveEditing = () => { if (review.editingId) void review.commitEdit(); };
  const leave = () => { saveEditing(); closeSheet(); };

  /** X, Not now, Escape, a swipe down: put it off for an hour. One tap brings it back. */
  const later = () => {
    const cur = shownRef.current;
    if (!cur) return;
    if (status !== "pending") { leave(); return; }
    const { id, size } = cur;
    deb.snoozeLocal(id);
    leave();
    showLaterToast({
      id: `debrief-later-${id}`,
      message: "Scout will remind you in 1 hour",
      // Back the way it was: the small card stays a small card, the wide sheet stays wide.
      onUndo: () => { deb.unsnoozeLocal(id); openSheet(id, size); },
    });
    void debriefApi.snooze(id).then((r) => {
      if (r.ok === false && !r.missing && r.code !== "not_pending") {
        toast.error("Couldn't set the reminder", { description: "This debrief comes back here in 1 hour." });
      }
      void deb.refresh();
    });
  };

  /** Take back a send (the server allows it for 10 minutes), then open the debrief again with the same ticks. */
  const undoSend = async (id: string, sentIds: string[], allIds: string[], size: Size) => {
    setUndoing(true);
    const r = await debriefApi.undoSend(id);
    setUndoing(false);
    if (r.ok === false) {
      toast.error("Couldn't take them back", { description: r.code ? r.error : `They may already be on ${labels.list}.` });
      return;
    }
    tellTouched(r.data.touched);
    review.restoreTicks(id, sentIds, allIds);
    await deb.refresh();
    openSheet(id, size);
  };

  /** Some of what was sent had already changed on her side, so Undo leaves those where they are. */
  const tellTouched = (touched: number) => {
    if (touched < 1) return;
    toast(`${count(touched, "item")} stayed on ${labels.list}`, {
      description: `${touched === 1 ? "It was" : "They were"} already changed, so ${touched === 1 ? "it was" : "they were"} left alone.`,
    });
  };

  /** The only thing that puts anything on the client's list. */
  const send = async () => {
    const cur = shownRef.current;
    if (!cur || sending) return;
    const { id, size } = cur;
    setSending(true);
    // A row still being edited is saved first, so what goes out is what is on screen.
    if (review.editingId && !(await review.commitEdit())) { setSending(false); return; }
    const ids = review.selectedIds;
    const allIds = (review.detail?.her ?? []).map((i) => i.id);
    if (ids.length === 0) { setSending(false); return; }
    const r = await debriefApi.send(id, ids);
    setSending(false);
    if (r.ok === false || r.data.sent < 1) {
      toast.error("Couldn't send them", { description: r.ok === false && r.code ? r.error : `Nothing went to ${labels.who}. Try again.` });
      if (r.ok === false && r.code) void review.reloadQuiet(); // the server's version has moved on: show it
      return;
    }
    quiet.current.add(id);
    const partial = r.data.sent < ids.length;
    closeSheet();
    showSentToast({
      id: `debrief-sent-${id}`,
      message: partial ? `Sent ${r.data.sent} of ${ids.length} to ${labels.list}` : `Sent to ${labels.list}`,
      onUndo: () => { void undoSend(id, ids, allIds, size); },
    });
    void deb.refresh();
  };

  /** Close the debrief for good: nothing is sent and Scout stops reminding. */
  const skip = async () => {
    const cur = shownRef.current;
    if (!cur || skipping) return;
    setSkipping(true);
    const r = await debriefApi.dismiss(cur.id);
    setSkipping(false);
    if (r.ok === false && r.code !== "not_pending") { toast.error("Couldn't close that debrief", { description: "Try again." }); return; }
    quiet.current.add(cur.id);
    setConfirmingSkip(false);
    closeSheet();
    toast("Debrief closed", { description: `Nothing was sent to ${labels.who}.` });
    void deb.refresh();
  };

  /** Undo send from inside a debrief that was already sent (reopened from a link). */
  const undoSendHere = async () => {
    const cur = shownRef.current;
    if (!cur || undoing) return;
    setUndoing(true);
    const r = await debriefApi.undoSend(cur.id);
    setUndoing(false);
    if (r.ok === false) { toast.error("Couldn't take them back", { description: r.code ? r.error : `They may already be on ${labels.list}.` }); return; }
    tellTouched(r.data.touched);
    await deb.refresh();
    await review.reload();
  };

  /* ───────── drawing it ───────── */

  if (!shown) return null;

  const panel = (extra: Partial<PanelProps> & Pick<PanelProps, "titleAs" | "presentation">) => (
    <DebriefPanel
      row={row}
      review={review}
      view={view}
      onView={setView}
      transcript={transcript}
      onRetryTranscript={retryTranscript}
      sending={sending}
      confirmingSkip={confirmingSkip}
      onConfirmSkip={setConfirmingSkip}
      skipping={skipping}
      onLater={later}
      onSend={() => void send()}
      onSkip={() => void skip()}
      onUndoSend={() => void undoSendHere()}
      undoing={undoing}
      onClose={leave}
      {...extra}
    />
  );

  const announce = visible && presentation === "popup" ? (
    <div className="sr-only" role="status" aria-live="polite">
      {`Call debrief ready. ${review.selectedIds.length ? `${review.selectedIds.length} to-dos for ${labels.who} need your OK.` : "Review it when you can."}`}
    </div>
  ) : null;

  /* the wide sheet and the phone sheet are modal; the pop-up is not */
  if (presentation === "wide") {
    return (
      <Dialog.Root open={visible} onOpenChange={(o) => { if (!o) later(); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dbf dbf-scrim" />
          <Dialog.Content
            className="dbf dbf-wide"
            aria-describedby={undefined}
            onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement | null)?.focus?.(); }}
            onEscapeKeyDown={(e) => { if (review.editingId) { e.preventDefault(); review.cancelEdit(); } }}
            onInteractOutside={(e) => { if (review.editingId) e.preventDefault(); }}
            tabIndex={-1}
          >
            <div className="dbf-halo" aria-hidden="true" />
            <div className="dbf-sheet dbf-v-wide">{panel({ presentation: "wide", titleAs: Dialog.Title })}</div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  if (presentation === "phone") {
    return (
      <Drawer.Root open={visible} onOpenChange={(o) => { if (!o) later(); }} shouldScaleBackground={false}>
        <Drawer.Portal>
          <Drawer.Overlay className="dbf dbf-phone-scrim" />
          <Drawer.Content
            className="dbf dbf-phone dbf-v-phone"
            aria-describedby={undefined}
            onEscapeKeyDown={(e) => { if (review.editingId) { e.preventDefault(); review.cancelEdit(); } }}
            onInteractOutside={(e) => { if (review.editingId) e.preventDefault(); }}
          >
            <Drawer.Handle className="dbf-grab" preventCycle />
            {panel({ presentation: "phone", titleAs: Drawer.Title })}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }

  return createPortal(
    <>
      {announce}
      <div className="dbf dbf-popup" data-state={visible ? "open" : "closed"}>
        <div className="dbf-halo" aria-hidden="true" />
        <section
          className="dbf-sheet dbf-v-popup"
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            if (review.editingId) review.cancelEdit(); else later();
          }}
        >
          {panel({ presentation: "popup", titleAs: "h2", titleId, onExpand: expand })}
        </section>
      </div>
    </>,
    document.body,
  );
}
