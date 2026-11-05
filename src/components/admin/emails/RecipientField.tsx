import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContactHit } from "@/lib/email/api";
import { ContactField } from "./ContactField";

export interface Recipient { email: string; name?: string }

export const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;

/** "Elizabeth O'Brien <e@x.com>, b@y.com; c@z.com" -> recipients (bad pieces are returned separately). */
export function parseRecipients(text: string): { ok: Recipient[]; bad: string[] } {
  const ok: Recipient[] = [], bad: string[] = [];
  for (const raw of text.split(/[,;\n]+/)) {
    const t = raw.trim();
    if (!t) continue;
    const m = t.match(/^"?([^"<]*?)"?\s*<([^>]+)>$/);
    const email = (m ? m[2] : t).trim(), name = m ? m[1].trim() : "";
    if (EMAIL_RE.test(email)) ok.push(name ? { email, name } : { email }); else bad.push(t);
  }
  return { ok, bad };
}

/**
 * A Mail-style address field: each person is a chip, type or paste more, pick from contacts.
 * Enter, comma or leaving the field turns typed text into a chip; Backspace in an empty field removes the last one.
 */
export function RecipientField({ label, value, onChange, suggest, disabled, placeholder, onPending }: {
  label: string; value: Recipient[]; onChange: (next: Recipient[]) => void; suggest?: (q: string) => Promise<ContactHit[]>;
  disabled?: boolean; placeholder?: string;
  /** true while typed text is not a valid address (Send waits for it to be fixed or cleared). */
  onPending?: (pending: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [bad, setBad] = useState("");
  // only text that would NOT become a chip holds Send back (a good address is turned into a chip on blur)
  const pending = text.trim().length > 0 && parseRecipients(text).bad.length > 0;
  useEffect(() => { onPending?.(pending); }, [pending, onPending]);

  const addAll = (list: Recipient[]) => {
    const seen = new Set(value.map((r) => r.email.toLowerCase()));
    const fresh = list.filter((r) => { const k = r.email.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    if (fresh.length) onChange([...value, ...fresh]);
  };
  const commit = () => {
    if (!text.trim()) { setBad(""); return; }
    const { ok, bad: b } = parseRecipients(text);
    addAll(ok);
    setText(b.join(", "));
    setBad(b.length ? `Not an email address: ${b.join(", ")}` : "");
  };
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));

  return (
    <div>
      <ContactField
        label={label} value={text} disabled={disabled} inputMode="email" suggest={suggest}
        placeholder={value.length ? "" : placeholder}
        onText={(v) => {
          // a paste or typed separator commits what came before it
          if (/[,;\n]/.test(v)) { const { ok, bad: b } = parseRecipients(v.replace(/[^,;\n]*$/, "")); addAll(ok); setText(v.replace(/^.*[,;\n]/, "")); setBad(b.length ? `Not an email address: ${b.join(", ")}` : ""); }
          else { setText(v); if (bad) setBad(""); }
        }}
        onPick={(h) => { addAll([h.name ? { email: h.email, name: h.name } : { email: h.email }]); setText(""); setBad(""); }}
        onCommitKey={(e) => {
          if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) { if (!text.trim()) return false; commit(); return true; }
          if (e.key === "Backspace" && !text && value.length) { remove(value.length - 1); return true; }
          return false;
        }}
        onLeave={commit}
        before={value.map((r, i) => (
          <span key={r.email} className="inline-flex max-w-full items-center gap-0.5 rounded-full bg-[#0A84FF]/20 py-0.5 pl-2.5 pr-0.5 text-[14px] text-white bento:bg-[#007AFF]/15 bento:text-[#000]" title={r.email}>
            <span className="min-w-0 [overflow-wrap:anywhere]">{r.name || r.email}</span>
            <button type="button" disabled={disabled} aria-label={`Remove ${r.name || r.email}`} onClick={() => remove(i)}
              className={cn("relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white/70 hover:bg-white/15 hover:text-white before:absolute before:-inset-2.5 before:content-[''] bento:text-black/60")}>
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </span>
        ))}
      />
      {bad && <p role="alert" className="mt-1 text-[12px] text-[#FF6961] [overflow-wrap:anywhere]">{bad}</p>}
    </div>
  );
}
