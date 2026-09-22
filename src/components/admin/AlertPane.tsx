import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Binoculars, Send } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { askScout } from "@/components/admin/scoutBus";
import { CopyText } from "@/components/CopyText";
import { formatForClaude } from "@/lib/copyForClaude";

export type PaneAlert = {
  id: string;
  created_at: string;
  kind: string;
  kindLabel: string;
  title: string;
  body: string | null;
  url: string | null;
  severity: string;
};

/**
 * What "Open" on an alert does: read the whole thing, then hand Scout the next move in one tap.
 * Suggestions are picked from the alert's kind and wording (instant, free); the box underneath
 * takes anything else. Scout gets the full alert as context either way.
 */
function suggestions(a: PaneAlert): string[] {
  const t = `${a.title} ${a.body ?? ""}`.toLowerCase();
  const out: string[] = [];
  const bad = a.severity === "warning" || /fail|error|stuck|blocked|down|timeout|401|403|404|500|crash|couldn't|can't/.test(t);

  switch (a.kind) {
    case "lead_new":
      out.push("Summarize this lead and tell me the best next step", "Draft a reply I can send with one tap", "Add a follow-up card to Deck for tomorrow");
      break;
    case "deal_deposit": case "deal_signed": case "deal_intake": case "deal_live":
      out.push("What's the next step on this deal? Do the parts you can", "Draft a short update for the customer", "Check nothing on this deal is overdue");
      break;
    case "contact_new": case "hire_new":
      out.push("Read this and draft a reply for me to approve", "Who is this? Look them up and tell me if it's worth my time", "File this and remind me Friday if I haven't answered");
      break;
    case "intake_submitted":
      out.push("Review this intake and flag anything missing", "Draft the welcome reply");
      break;
    case "waitlist_new":
      out.push("Send them the waitlist welcome (show me first)", "How many are on the waitlist now, and from where?");
      break;
    case "cy_needs_you":
      out.push("Look into this Cookie Yeti site and fix what you can", "Is this site broken for everyone or just one user?");
      break;
    case "scout": case "scout.push":
      out.push("Keep going on this", "Tell me in one line what you need from me", "Why did this happen, and how do we stop it next time?");
      break;
  }
  if (/turo/.test(t)) out.unshift("Check Turo Watch and tell me what changed");
  if (/meeting|transcript|nextcloud/.test(t)) out.unshift("Check the meetings pipeline and fix what's stuck");
  if (/release|extension|xcode|app store|web store/.test(t)) out.unshift("Where is the release stuck, and what's the one thing I need to do?");
  if (bad) out.unshift("Find out why this happened and fix it", "Is this still happening? Check right now");
  if (bad) out.push("Stop this alert from coming back (learn the fix)");
  if (!out.length) out.push("What should I do about this?", "Handle this for me and tell me when it's done");
  return [...new Set(out)].slice(0, 5);
}

export function AlertPane({ alert, onClose }: { alert: PaneAlert | null; onClose: () => void }) {
  const navigate = useNavigate();
  const [own, setOwn] = useState("");
  useEffect(() => setOwn(""), [alert?.id]);
  if (!alert) return null;

  const about = formatForClaude(alert.title, alert.body, {
    Type: `${alert.kindLabel} (${alert.severity})`,
    Sent: new Date(alert.created_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }),
    Link: alert.url,
  });
  const send = (text: string) => {
    if (!text.trim()) return;
    askScout(text.trim(), { about });
    onClose();
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto border-white/10 bg-[#0b0d12] p-0 text-white sm:max-w-md bento:bg-[#fff]">
        <div className="border-b border-white/[0.06] px-5 pb-4 pt-6">
          <p className="text-xs font-medium text-white/50">
            {alert.kindLabel} · {new Date(alert.created_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" })}
          </p>
          <SheetTitle className="mt-1 text-lg font-semibold leading-snug text-white">{alert.title}</SheetTitle>
          <SheetDescription className="sr-only">The full alert and suggested next steps for Scout.</SheetDescription>
        </div>

        <div className="px-5 py-4 text-[0.9375rem] leading-relaxed text-white/80">
          <CopyText text={alert.body || alert.title} />
          {alert.url && (
            <button type="button" onClick={() => { onClose(); navigate(alert.url!); }}
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-sky-300 hover:underline bento:text-sky-700">
              Go to the page <ArrowUpRight className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>

        <div className="border-t border-white/[0.06] px-5 py-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold"><Binoculars className="h-4 w-4" aria-hidden /> Give Scout the next move</p>
          <ul className="mt-3 space-y-2">
            {suggestions(alert).map((s) => (
              <li key={s}>
                <button type="button" onClick={() => send(s)}
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left text-[0.9375rem] text-white transition hover:bg-white/[0.08] active:scale-[0.99] bento:border-black/5 bento:bg-[#F3F2EE]">
                  {s}
                </button>
              </li>
            ))}
          </ul>
          <form onSubmit={(e) => { e.preventDefault(); send(own); }} className="mt-3 flex gap-2">
            <input value={own} onChange={(e) => setOwn(e.target.value)} placeholder="Or tell Scout something else"
              className="h-11 min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.04] px-4 text-[16px] text-white outline-none placeholder:text-white/35 focus:border-white/30 bento:border-black/10 bento:bg-[#fff]" />
            <button type="submit" disabled={!own.trim()} aria-label="Send to Scout"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-black disabled:opacity-30 bento:bg-[#111114] bento:text-[#fff]">
              <Send className="h-4 w-4" aria-hidden />
            </button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}
