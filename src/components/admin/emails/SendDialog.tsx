import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Loader2, RotateCcw, Send, ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { btnPlain, btnPrimary, btnTinted } from "@/pages/admin/laxUi";
import { cn } from "@/lib/utils";
import { sha256Hex } from "@/lib/email/render";
import type { EmailApi } from "@/lib/email/api";
import { PreviewFrame } from "./PreviewFrame";
import { ContactField } from "./ContactField";
import "./sendFlow.css";

const COUNTDOWN_MS = 2800;
const MORPH_MS = 320;
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * The send flow in one dialog: confirm -> sending -> success (cross-fades, closes itself) -> back to the library.
 * Nothing is sent until the Send button in here is tapped; it shows who, what subject, and the exact email.
 * `onSent` fires the moment the mail service says yes; `onFinished` fires when the success view closes (any way).
 */
export function SendDialog({ api, open, onClose, libraryId, html, subject, defaultTo, defaultName, fromLine, onSent, onFinished }: {
  api: EmailApi; open: boolean; onClose: () => void; libraryId: string; html: string; subject: string; defaultTo: string; defaultName: string; fromLine: string;
  onSent: (to: string, name: string) => void; onFinished?: (to: string, name: string) => void;
}) {
  const [to, setTo] = useState(defaultTo);
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [phase, setPhase] = useState<"confirm" | "success">("confirm");
  const [leaving, setLeaving] = useState(false);
  const [flags, setFlags] = useState({ hover: false, focus: false, key: false });
  const paused = flags.hover || flags.focus || flags.key;

  const boxRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const from = useRef<{ h: number; w: number } | null>(null);
  const sentRef = useRef({ to: "", name: "" });
  const pausedRef = useRef(false);
  const closedRef = useRef(false);
  const cb = useRef({ onClose, onFinished });
  cb.current = { onClose, onFinished };
  pausedRef.current = paused;

  /* One id per distinct request: a retry of the same thing reuses it (never a double send); changing who/what gets a new one. */
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const attemptFor = () => {
    const key = [to.trim(), name.trim(), subject, html].join("\u0001");
    if (!attempt.current || attempt.current.key !== key) attempt.current = { key, id: crypto.randomUUID() };
    return attempt.current.id;
  };

  // Reset only when the dialog opens (defaults change while it is open when onSent updates the draft; that must not reset it).
  useEffect(() => {
    if (!open) return;
    setTo(defaultTo); setName(defaultName); setErr(""); setBusy(false); setPhase("confirm"); setLeaving(false); setFlags({ hover: false, focus: false, key: false });
    closedRef.current = false;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const valid = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/.test(to.trim());
  const [typingName, setTypingName] = useState(false);
  const first = typingName ? "" : (name.trim().split(/\s+/)[0] ?? "");
  const who = name.trim() || to.trim();

  const send = async () => {
    if (busy || !valid || !subject) return;
    setBusy(true); setErr("");
    try {
      const html_sha = await sha256Hex(html);
      const r = await api.send({ library_id: libraryId, to: to.trim(), to_name: name.trim() || undefined, subject, html_sha, attempt: attemptFor() });
      if (r.ok) {
        const t = to.trim(), n = name.trim();
        sentRef.current = { to: t, name: n };
        const el = boxRef.current;
        if (el) { const b = el.getBoundingClientRect(); from.current = { h: b.height, w: b.width }; }
        setPhase("success"); setLeaving(true);
        window.setTimeout(() => setLeaving(false), 300);
        onSent(t, n);
      } else setErr(r.error ?? "It did not send.");
    } catch (e) { setErr(e instanceof Error ? e.message : "It did not send."); }
    setBusy(false);
  };

  const finish = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    cb.current.onClose();
    cb.current.onFinished?.(sentRef.current.to, sentRef.current.name);
  }, []);

  /* The box glides from the tall preview size to the size of the success view (skipped with reduced motion). */
  useLayoutEffect(() => {
    if (phase !== "success") return;
    const el = boxRef.current, f = from.current;
    if (!el || !f || reducedMotion()) return;
    el.style.transition = "none"; el.style.maxWidth = ""; el.style.height = "auto";
    const target = el.getBoundingClientRect().height;
    el.style.height = `${f.h}px`; el.style.maxWidth = `${f.w}px`;
    void el.offsetHeight;
    el.style.transition = `height ${MORPH_MS}ms ${EASE}, max-width ${MORPH_MS}ms ${EASE}`;
    el.style.height = `${target}px`; el.style.maxWidth = "";
    const t = window.setTimeout(() => { el.style.transition = ""; el.style.height = ""; el.style.maxWidth = ""; }, MORPH_MS + 40);
    return () => window.clearTimeout(t);
  }, [phase]);

  useEffect(() => { if (phase === "success") boxRef.current?.focus({ preventScroll: true }); }, [phase]);

  /* Countdown: runs on the display clock, pauses while hovered / focused / a key was pressed. Drives the bar directly (no re-render per frame). */
  useEffect(() => {
    if (phase !== "success") return;
    let raf = 0, last = performance.now(), left = COUNTDOWN_MS;
    const tick = (now: number) => {
      const dt = now - last; last = now;
      if (!pausedRef.current) left -= dt;
      if (barRef.current) barRef.current.style.width = `${Math.max(0, left / COUNTDOWN_MS) * 100}%`;
      if (left <= 0) { finish(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, finish]);

  const showConfirm = phase === "confirm" || leaving;
  const set = (k: "hover" | "focus" | "key", v: boolean) => setFlags((f) => (f[k] === v ? f : { ...f, [k]: v }));
  const Title = phase === "confirm" ? DialogTitle : "h2";
  const sendLabel = err ? "Try again" : first ? `Send to ${first}` : "Send";

  const live = phase === "success" ? `Sent to ${who}. A copy is in your inbox. This closes in a few seconds.` : busy ? `Sending to ${first || to.trim()}` : "";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (o || busy) return; if (phase === "success") finish(); else onClose(); }}>
      <DialogContent
        ref={boxRef}
        // an open suggestion list takes the first Escape
        onEscapeKeyDown={(e) => { if ((document.activeElement as HTMLElement | null)?.getAttribute("aria-expanded") === "true") e.preventDefault(); }}
        onKeyDown={(e) => {
          if (phase === "confirm" && (e.metaKey || e.ctrlKey) && e.key === "Enter" && valid && !!subject && !busy) { e.preventDefault(); void send(); }
          else if (phase === "success" && !["Escape", "Meta", "Control", "Shift", "Alt"].includes(e.key)) set("key", true);
        }}
        onPointerEnter={() => set("hover", true)} onPointerLeave={() => { set("hover", false); set("key", false); }}
        onFocusCapture={(e) => { if (phase === "success" && e.target !== boxRef.current && (e.target as HTMLElement).matches?.(":focus-visible")) set("focus", true); }}
        onBlurCapture={(e) => { if (!boxRef.current?.contains(e.relatedTarget as Node | null)) { set("focus", false); set("key", false); } }}
        className={cn(
          "grid max-h-[92vh] w-[calc(100%-1.5rem)] gap-0 overflow-hidden border-white/10 bg-[#1C1C1E] p-0 text-white outline-none sm:rounded-[22px]",
          phase === "success" ? "max-w-[440px]" : "max-w-[760px]",
          busy && "[&>button:last-child]:hidden",
        )}
      >
        <p className="sr-only" role="status" aria-live="polite">{live}</p>

        {showConfirm && (
          <div
            className={cn("flex min-h-0 flex-col", phase === "success" ? "sf-view-out pointer-events-none absolute inset-0" : "max-h-[92vh]")}
            aria-hidden={phase === "success" || undefined}
            ref={(n) => { if (n) { if (phase === "success") n.setAttribute("inert", ""); else n.removeAttribute("inert"); } }}
          >
            <DialogHeader className="shrink-0 border-b border-white/[0.08] px-5 py-4 pr-12 text-left">
              <Title className="text-[17px] font-semibold leading-none tracking-tight">Send this email?</Title>
              {phase === "confirm"
                ? <DialogDescription className="text-[13px] text-white/60">Check who it goes to and how it looks. It sends only when you tap Send.</DialogDescription>
                : <p className="text-[13px] text-white/60">Check who it goes to and how it looks. It sends only when you tap Send.</p>}
            </DialogHeader>

            <div className="relative z-20 grid shrink-0 gap-3 px-5 pt-4 sm:grid-cols-2">
              <div onFocusCapture={() => setTypingName(true)} onBlurCapture={() => setTypingName(false)}>
              <ContactField label="To (name)" value={name} onText={setName} disabled={busy} placeholder="Elizabeth" suggest={api.suggestContacts}
                onPick={(h) => { if (h.name) setName(h.name); setTo(h.email); setTypingName(false); }} />
              </div>
              <ContactField label="To (email)" value={to} onText={setTo} disabled={busy} inputMode="email" placeholder="name@example.com" suggest={api.suggestContacts}
                onPick={(h) => { if (h.name) setName(h.name); setTo(h.email); }} />
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <dl className="space-y-1 rounded-2xl bg-white/[0.04] px-4 py-3 text-[13px]">
                <div className="flex flex-wrap gap-x-2"><dt className="text-white/50">Subject</dt><dd className="font-medium text-white [overflow-wrap:anywhere]">{subject}</dd></div>
                <div className="flex flex-wrap gap-x-2"><dt className="text-white/50">From</dt><dd className="text-white/80 [overflow-wrap:anywhere]">{fromLine}</dd></div>
                <div className="flex items-start gap-1.5 pt-1 text-white/50"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span>Sends exactly what you see below. You are copied by bcc.</span></div>
              </dl>
              <div className={cn("transition-opacity duration-300", busy && "opacity-60")}>
                <PreviewFrame html={html} device="desktop" dark={false} title="Email you are about to send" />
              </div>
            </div>

            {err && <p role="alert" className="mx-5 mb-3 shrink-0 rounded-xl bg-[#FF453A]/10 px-3 py-2 text-[13px] text-[#FF6961] [overflow-wrap:anywhere]">{err}</p>}

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-white/[0.08] px-5 py-3">
              <button type="button" onClick={onClose} disabled={busy} className={btnPlain}>Not yet</button>
              <button type="button" onClick={() => void send()} disabled={busy || !valid || !subject} className={cn(btnPrimary, "h-auto max-w-full py-2.5 text-center [overflow-wrap:anywhere]")}>
                {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : err ? <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" /> : <Send className="h-4 w-4 shrink-0" aria-hidden="true" />}
                <span>{busy ? `Sending to ${first || to.trim()}` : sendLabel}</span>
              </button>
            </div>
          </div>
        )}

        {phase === "success" && (
          <div className="sf-view-in relative flex flex-col items-center px-6 pb-14 pt-12 text-center" data-testid="send-success">
            <div className="relative h-24 w-24">
              <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 -ml-[120px] -mt-[120px] h-60 w-60">
                <div className="sf-glow h-full w-full" style={{ background: "radial-gradient(closest-side, rgba(48,209,88,0.42), rgba(48,209,88,0.16) 52%, rgba(48,209,88,0) 100%)" }} />
              </div>
              <div className="sf-badge relative h-24 w-24 drop-shadow-[0_6px_24px_rgba(48,209,88,0.35)]">
                <svg viewBox="0 0 96 96" className="h-24 w-24" aria-hidden="true">
                  <circle cx="48" cy="48" r="46" fill="#30D158" />
                  <path className="sf-check" pathLength={1} d="M29 49.5 L42.5 63 L68 35" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
            <Title className="mt-7 max-w-full text-[26px] font-semibold leading-tight tracking-[-0.02em] text-white [overflow-wrap:anywhere]">Sent to {who}</Title>
            <div className="mt-2 max-w-full space-y-0.5 text-[15px] leading-snug text-[#EBEBF599]">
              {name.trim() && <p className="[overflow-wrap:anywhere]">{sentRef.current.to}</p>}
              <p className="[overflow-wrap:anywhere]">{subject}</p>
            </div>
            <p className="mt-4 text-[13px] text-[#EBEBF54d]">A copy is in your inbox.</p>
            <button type="button" onClick={finish} className={cn(btnTinted, "mt-6 min-w-[120px]")}>Done</button>

            <div aria-hidden="true" className="pointer-events-none absolute inset-x-6 bottom-3.5 h-[3px]" style={{ WebkitMaskImage: "linear-gradient(90deg, transparent, #000 14%, #000 86%, transparent)", maskImage: "linear-gradient(90deg, transparent, #000 14%, #000 86%, transparent)" }}>
              <div className="absolute inset-0 rounded-full bg-white/[0.07]" />
              <div ref={barRef} data-testid="send-bar" className={cn("relative h-full rounded-full transition-opacity duration-200", paused && "opacity-50")} style={{ width: "100%", background: "linear-gradient(90deg, rgba(48,209,88,0), #30D158 22px, #30D158 calc(100% - 22px), rgba(48,209,88,0))" }} />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
