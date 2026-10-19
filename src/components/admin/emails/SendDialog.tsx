import { useEffect, useState } from "react";
import { Loader2, Send, ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { btnPlain, btnPrimary, field } from "@/pages/admin/laxUi";
import { sha256Hex } from "@/lib/email/render";
import type { EmailApi } from "@/lib/email/api";
import { PreviewFrame } from "./PreviewFrame";

/** The confirm step. Nothing is sent until the Send button in here is tapped; it shows who, what subject, and the exact email. */
export function SendDialog({ api, open, onClose, libraryId, html, subject, defaultTo, defaultName, fromLine, onSent }: {
  api: EmailApi; open: boolean; onClose: () => void; libraryId: string; html: string; subject: string; defaultTo: string; defaultName: string; fromLine: string; onSent: (to: string, name: string) => void;
}) {
  const [to, setTo] = useState(defaultTo);
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [attempt] = useState(() => crypto.randomUUID());

  useEffect(() => { if (open) { setTo(defaultTo); setName(defaultName); setErr(""); setDone(false); } }, [open, defaultTo, defaultName]);

  const valid = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/.test(to.trim());

  const send = async () => {
    setBusy(true); setErr("");
    try {
      const html_sha = await sha256Hex(html);
      const r = await api.send({ library_id: libraryId, to: to.trim(), to_name: name.trim() || undefined, subject, html_sha, attempt });
      if (r.ok) { setDone(true); onSent(to.trim(), name.trim()); } else setErr(r.error ?? "It did not send.");
    } catch (e) { setErr(e instanceof Error ? e.message : "It did not send."); }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100%-1.5rem)] max-w-[760px] flex-col gap-0 overflow-hidden border-white/10 bg-[#1C1C1E] p-0 text-white">
        <DialogHeader className="shrink-0 border-b border-white/[0.08] px-5 py-4 pr-12 text-left">
          <DialogTitle className="text-[17px]">{done ? "Sent" : "Send this email?"}</DialogTitle>
          <DialogDescription className="text-[13px] text-white/60">
            {done ? "It is on its way. A copy went to your own inbox." : "Check who it goes to and how it looks. It sends only when you tap Send."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-[13px] text-white/60">To (name)
              <input value={name} onChange={(e) => setName(e.target.value)} disabled={busy || done} className={`${field} mt-1`} placeholder="Elizabeth" autoComplete="off" />
            </label>
            <label className="block text-[13px] text-white/60">To (email)
              <input value={to} onChange={(e) => setTo(e.target.value)} disabled={busy || done} inputMode="email" className={`${field} mt-1`} placeholder="name@example.com" autoComplete="off" />
            </label>
          </div>
          <dl className="space-y-1 rounded-2xl bg-white/[0.04] px-4 py-3 text-[13px]">
            <div className="flex flex-wrap gap-x-2"><dt className="text-white/50">Subject</dt><dd className="font-medium text-white [overflow-wrap:anywhere]">{subject}</dd></div>
            <div className="flex flex-wrap gap-x-2"><dt className="text-white/50">From</dt><dd className="text-white/80 [overflow-wrap:anywhere]">{fromLine}</dd></div>
            <div className="flex items-start gap-1.5 pt-1 text-white/50"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span>Sends exactly what you see below. You are copied by bcc.</span></div>
          </dl>
          <PreviewFrame html={html} device="desktop" dark={false} title="Email you are about to send" />
          {err && <p role="alert" className="rounded-xl bg-[#FF453A]/10 px-3 py-2 text-[13px] text-[#FF6961] [overflow-wrap:anywhere]">{err}</p>}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-white/[0.08] px-5 py-3">
          <button type="button" onClick={onClose} disabled={busy} className={btnPlain}>{done ? "Close" : "Not yet"}</button>
          {!done && (
            <button type="button" onClick={send} disabled={busy || !valid || !subject} className={btnPrimary}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
              {busy ? "Sending" : "Send"}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
