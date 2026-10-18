/**
 * The three small toasts of the call debrief, drawn the way the approved mockups draw them
 * (a dark pill, a green check, a blue Undo). They are sonner "custom" toasts, so they stack and
 * dismiss with the rest of the admin's toasts and appear at the top, never over Scout's button.
 */
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { glue } from "./format";

interface PillProps {
  message: ReactNode;
  action: string;
  actionLabel?: string;
  onAction: () => void;
}

/** One line: check, words, a dot, the action. */
function Pill({ message, action, actionLabel, onAction }: PillProps) {
  return (
    <div className="dbf dbf-toast">
      <Check className="dbf-tk" width={18} height={18} strokeWidth={2.6} aria-hidden />
      <span>{typeof message === "string" ? glue(message) : message}</span>
      <span className="dbf-dotsep" aria-hidden="true">&middot;</span>
      <button type="button" className="dbf-undo" aria-label={actionLabel ?? action} onClick={onAction}>{action}</button>
    </div>
  );
}

/** "Sent to Elizabeth's list · Undo". Stays long enough to find the button (15 s), and holds while the pointer is on it. */
export function showSentToast(opts: { id: string; message: string; onUndo: () => void }) {
  const { id, message, onUndo } = opts;
  toast.custom(
    (t) => <Pill message={message} action="Undo" actionLabel="Undo. Take them back off her list" onAction={() => { toast.dismiss(t); onUndo(); }} />,
    { id, duration: 15_000, className: "dbf-sonner" },
  );
}

/** "Scout will remind you in 1 hour · Undo" (Undo opens the debrief again). */
export function showLaterToast(opts: { id: string; message: string; onUndo: () => void }) {
  const { id, message, onUndo } = opts;
  toast.custom(
    (t) => <Pill message={message} action="Undo" actionLabel="Undo. Open the debrief again" onAction={() => { toast.dismiss(t); onUndo(); }} />,
    { id, duration: 8_000, className: "dbf-sonner" },
  );
}

/** While a call is being recorded: a quiet note instead of a sheet over the call. */
export function showLiveToast(opts: { id: string; onOpen: () => void }) {
  const { id, onOpen } = opts;
  toast.custom(
    (t) => (
      <div className="dbf dbf-toast dbf-toast-two">
        <div className="dbf-toast-text">
          <span className="dbf-toast-h">Call debrief ready</span>
          <span className="dbf-toast-s"><span className="dbf-ln">Scout will show it when your call ends.</span></span>
        </div>
        <button type="button" className="dbf-undo" aria-label="Open the call debrief now" onClick={() => { toast.dismiss(t); onOpen(); }}>Open</button>
      </div>
    ),
    { id, duration: 10_000, className: "dbf-sonner" },
  );
}

export function dismissToast(id: string) {
  toast.dismiss(id);
}
