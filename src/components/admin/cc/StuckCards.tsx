/**
 * Stuck card + Waiting card, top of the Command Center home (design approved 2026-10-27; fix buttons added 2026-10-28).
 *
 *   Health line      "1 employee stuck · 1 waiting on someone else". Not drawn at all when there is nothing to say.
 *   Stuck card       who is stuck and why. A claim has one 44px button per block and a primary "Fix all three".
 *                    An employee whose check-in said "not OK" has ONE big button chosen by the server from the error:
 *                      "Update key"       the key stopped working: opens the page where the new key is pasted
 *                      "Retry now"        a hiccup: runs the job again now and shows the result on the card
 *                      "Have Scout fix it" anything else: hands it to Scout, with a link to the thread
 *                    plus "More": the other fix, "Prompt for Claude" (a copy-ready block; copied only when tapped), "Snooze 1 day".
 *   After a tap      the card shows working, then done or failed, with the reason, signed by the employee. Snooze has Undo.
 *   Waiting card     a claim we are waiting on someone else for: no buttons, just what was sent and what happens next.
 *                    Claims Closer's insurance cases use it too: a YOUR CALL pill and one blue button when she needs a tap (read and send,
 *                    or a bridge call, offered only while the insurer's lines are open), a paste-ready Tesla Service message, and a short timeline.
 *
 * Feed: the admin_stuck_items() RPC. If it is not deployed yet (or fails) this renders nothing, never an error.
 * House rules: 12-hour times (the RPC sends them already formatted), a number never splits from its unit,
 * nothing is cut with "...", touch targets are at least 44px, no emoji.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown, CircleAlert, Copy, KeyRound, Loader2, MessageSquare, Phone, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/copyForClaude";
import { rpcArgs } from "@/components/admin/roofguard/AvaShared";
import { errText, usePipelineRpc } from "@/components/admin/pipeline/lib";
import { Pill, cardCls, focusRing, tint } from "@/components/admin/ui";
import { openScoutThread } from "@/components/admin/scoutBus";
import { DialerSheet } from "@/components/admin/roofguard/AvaDialer";
import { requestDial } from "@/components/admin/roofguard/avaDial";
import {
  NBSP, Nums, actionLine, buttonLabel, cap, fixAllLabel, initials, moreButtons, parseStuck, primaryLabel, spanText, word,
  type FixButton, type StuckAction, type StuckCopy, type StuckItem, type StuckNeed, type StuckTimelineRow, type StuckUndo,
} from "./stuckLib";

/* ───────── shared bits ───────── */

const cardPad = "flex flex-col gap-3.5 p-4 sm:p-5";
const btn44 = "inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-xl px-3.5 text-[15px] font-semibold transition active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100";
const btnBlue = cn(btn44, "bg-[#0A84FF] text-[#fff] hover:bg-[#409CFF] bento:bg-[#007AFF] bento:hover:bg-[#0062CC]", focusRing);
const btnGrey = cn(btn44, "bg-white/[0.12] text-white hover:bg-white/[0.18]", focusRing);
const rowBg = "rounded-[14px] bg-white/[0.05]";
const SPIN = "h-4 w-4 animate-spin motion-reduce:animate-none";

function Header({ name, title, subtitle, pill }: { name: string | null; title: string; subtitle: string | null; pill: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.1] text-[15px] font-bold text-white">{initials(name)}</div>
      <div className="min-w-0 flex-1">
        <p className="text-[17px] font-semibold leading-[22px] text-white">{title}</p>
        {subtitle && <p className="text-[13px] leading-[18px] text-white/60"><Nums text={subtitle} /></p>}
      </div>
      {pill}
    </div>
  );
}

const StuckPill = () => (
  <span className="inline-flex shrink-0 items-center rounded-full bg-[#FF9F0A] px-2.5 py-1 text-[12px] font-bold leading-4 text-[#1C1C1E] bento:bg-[#FF9500]">STUCK</span>
);

/* ───────── what happened after a tap ───────── */

/** Working, done, failed or needs-your-yes, in the employee's own voice. role=status so a screen reader hears it change. */
function ActionRow({ action, name }: { action: StuckAction; name: string | null }) {
  const working = action.status === "working";
  const done = action.status === "done";
  const tone = done ? "bg-[#30D158]/[0.12] bento:bg-[#34C759]/[0.12]" : working ? "bg-white/[0.07]" : "bg-[#FF9F0A]/[0.14] bento:bg-[#FF9500]/[0.14]";
  return (
    <div className={cn("flex flex-col gap-2.5 rounded-[14px] p-3", tone)} role="status" aria-live="polite" data-testid="stuck-action" data-status={action.status}>
      <div className="flex items-start gap-3">
        {working ? <Loader2 className={cn(SPIN, "mt-0.5 shrink-0 text-white")} aria-hidden />
          : done ? <Check className={cn("mt-0.5 h-4 w-4 shrink-0", tint.green)} aria-hidden />
          : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#FF9F0A] bento:text-[#C93400]" aria-hidden />}
        <p className="min-w-0 flex-1 text-[15px] leading-[21px] text-white">
          {action.auto && <span>I tried again on my own. </span>}
          {working && <span className="font-semibold">Working on it. </span>}
          <Nums text={actionLine(action)} />
          {name && <span className="whitespace-nowrap text-white/60"> — {name}</span>}
        </p>
      </div>
      {action.kind === "scout" && action.thread_id && (
        <button type="button" onClick={() => openScoutThread(action.thread_id as string)} className={cn(btnGrey, "w-full")}>
          <MessageSquare className="h-4 w-4" aria-hidden />
          <span className="whitespace-nowrap">Open Scout&rsquo;s thread</span>
        </button>
      )}
    </div>
  );
}

/* ───────── "Prompt for Claude" ───────── */

/** The prompt, in a block he can read first. It is copied only when he taps Copy, never on its own. */
function PromptPanel({ text, onClose }: { text: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (await copyText(text)) { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }
    else toast.error("Couldn't copy that", { description: "Your browser blocked the clipboard. Select the text and copy it by hand." });
  };
  return (
    <div role="region" aria-label="Prompt for Claude" data-testid="stuck-prompt" className={cn(rowBg, "flex flex-col gap-2.5 p-3")}>
      <p className="text-[13px] leading-[18px] text-white/60">Paste this into Claude. Nothing is copied until you tap Copy.</p>
      <pre
        tabIndex={0}
        className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/40 p-3 font-mono text-[12px] leading-relaxed text-white/90 bento:bg-[#F3F2EE] bento:text-[#1C1C1E]"
      >{text}</pre>
      <div className="flex gap-2.5">
        <button type="button" onClick={() => void copy()} className={cn(btnBlue, "flex-1")} aria-label={copied ? "Copied" : "Copy the prompt"}>
          {copied ? <Check className="h-4 w-4" aria-hidden /> : null}
          <span className="whitespace-nowrap">{copied ? "Copied" : "Copy"}</span>
        </button>
        <button type="button" onClick={onClose} className={btnGrey}>Close</button>
      </div>
    </div>
  );
}

/* ───────── a fix only a person can run ───────── */

/** "Run this once on the Mac mini": the exact line, copied only when he taps Copy. Replaces the big button when it is the fix. */
function CommandBox({ command, note }: { command: string; note: string | null }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (await copyText(command)) { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }
    else toast.error("Couldn't copy that", { description: "Your browser blocked the clipboard. Select the line and copy it by hand." });
  };
  return (
    <div role="region" aria-label="The fix" data-testid="stuck-command" className={cn(rowBg, "flex flex-col gap-2.5 p-3")}>
      {note && <p className="text-[15px] leading-[21px] text-white"><Nums text={note} /></p>}
      <div className="flex items-stretch gap-2.5">
        <code tabIndex={0} className="min-w-0 flex-1 rounded-xl bg-black/40 px-3 py-3 font-mono text-[13px] leading-5 text-white/90 [overflow-wrap:anywhere] bento:bg-[#F3F2EE] bento:text-[#1C1C1E]">
          {command}
        </code>
        <button type="button" onClick={() => void copy()} className={cn(btnBlue, "shrink-0 px-5")} aria-label={copied ? "Copied" : "Copy the line"}>
          {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          <span className="whitespace-nowrap">{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
    </div>
  );
}

/* ───────── one stuck card ───────── */

type Act = (item: StuckItem, action: string) => Promise<void>;
type Run = (item: StuckItem, button: "retry" | "scout" | "snooze") => Promise<void>;
type UndoAct = (u: StuckUndo) => Promise<void>;

function StuckCard({ item, busy, onFix, onRun, onUndo }: { item: StuckItem; busy: string | null; onFix: Act; onRun: Run; onUndo: UndoAct }) {
  const fixable = item.blocks.filter((b) => b.fix_action);
  const since = spanText(item.stuck_since);
  const isClaim = item.item_id.startsWith("claim:");
  const lead = isClaim ? "I haven't moved this claim in" : "I've been reporting trouble for";
  const blocking = item.blocks.length === 1 ? "One thing is blocking me:" : `${cap(word(item.blocks.length))} things are blocking me:`;
  // The first button is the blue one (the design's primary row); the rest are grey.
  const firstFix = fixable[0]?.id;

  const fix = item.fix ?? null;
  const [more, setMore] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [promptBusy, setPromptBusy] = useState(false);
  const working = item.action?.status === "working";
  const locked = busy != null || working;
  const buttons: FixButton[] = moreButtons(fix);
  const busyOn = (b: string) => busy === `${item.item_id}|${b}`;

  const openPrompt = async () => {
    if (promptBusy) return;
    setPromptBusy(true);
    const { data, error } = await rpcArgs<string>("admin_stuck_prompt", { p_item_id: item.item_id });
    setPromptBusy(false);
    if (error || typeof data !== "string") { toast.error(errText(error, "Couldn't build the prompt. Try again in a moment.")); return; }
    setPrompt(data);
    setMore(false);
  };

  const press = (b: FixButton) => {
    if (b === "prompt") { void openPrompt(); return; }
    if (b === "retry" || b === "scout" || b === "snooze") { setMore(false); void onRun(item, b); }
  };

  return (
    <section
      aria-label={`${item.employee_name ?? "An employee"} is stuck`}
      data-testid="stuck-card"
      className={cn(
        cardCls, cardPad,
        "ring-1 ring-[#FF9F0A]/35 shadow-[0_12px_40px_-8px_rgba(255,159,10,0.18)] bento:ring-[#FF9500]/40 bento:shadow-[0_12px_40px_-8px_rgba(255,149,0,0.22)]",
      )}
    >
      <Header name={item.employee_name} title={item.employee_name ?? item.title} subtitle={isClaim ? [item.title, item.subtitle].filter(Boolean).join(" · ") : item.subtitle} pill={<StuckPill />} />

      <p className="text-[15px] leading-[21px] text-white">
        {since ? <>{lead} <span className="whitespace-nowrap">{since}</span>. </> : null}
        {item.blocks.length > 0 ? blocking : null}
      </p>

      <ul className="flex flex-col gap-2.5">
        {item.blocks.map((b) => {
          const key = `${item.item_id}|${b.fix_action}`;
          return (
            <li key={b.id} className={cn(rowBg, "flex items-center gap-3 p-3")}>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold text-white">{b.label}</p>
                {b.detail && <p className="text-[13px] leading-[18px] text-white/60"><Nums text={b.detail} /></p>}
              </div>
              {b.fix_action && (
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => void onFix(item, b.fix_action as string)}
                  aria-label={`${b.fix_label ?? "Fix"}: ${b.label}`}
                  className={b.id === firstFix ? btnBlue : btnGrey}
                >
                  {busy === key && <Loader2 className={SPIN} aria-hidden />}
                  <span className="whitespace-nowrap">{b.fix_label ?? "Fix"}</span>
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {fix?.where && !fix.command && <p className="text-[13px] leading-[18px] text-white/60">Runs on {fix.where}.</p>}

      {fixable.length >= 2 && (
        <button
          type="button"
          disabled={locked}
          onClick={() => void onFix(item, "all")}
          className={cn(btnBlue, "min-h-[50px] w-full rounded-[14px] text-[17px]")}
        >
          {busy === `${item.item_id}|all` && <Loader2 className={SPIN} aria-hidden />}
          <span className="whitespace-nowrap">{fixAllLabel(fixable.length)}</span>
        </button>
      )}

      {item.action && !(fix?.command && item.action.status === "failed") && <ActionRow action={item.action} name={item.employee_name} />}

      {fix?.command && !working && <CommandBox command={fix.command} note={fix.command_note} />}

      {/* The one big button, then More. While something is working the buttons wait. */}
      {!working && (
        <div className="flex gap-2.5">
          {fix && !fix.command && (fix.primary === "key" ? (
            <Link to={fix.link} className={cn(btnBlue, "min-h-[50px] flex-1 rounded-[14px] text-[17px]")} data-testid="stuck-primary">
              <KeyRound className="h-[18px] w-[18px]" aria-hidden />
              <span className="whitespace-nowrap">{primaryLabel(fix)}</span>
            </Link>
          ) : (
            <button
              type="button"
              disabled={locked}
              onClick={() => void onRun(item, fix.primary === "retry" ? "retry" : "scout")}
              className={cn(btnBlue, "min-h-[50px] flex-1 rounded-[14px] text-[17px]")}
              data-testid="stuck-primary"
            >
              {busyOn(fix.primary) ? <Loader2 className={SPIN} aria-hidden /> : fix.primary === "retry" ? <RotateCw className="h-[18px] w-[18px]" aria-hidden /> : <MessageSquare className="h-[18px] w-[18px]" aria-hidden />}
              <span className="whitespace-nowrap">{primaryLabel(fix)}</span>
            </button>
          ))}
          <button
            type="button"
            disabled={busy != null}
            onClick={() => setMore((v) => !v)}
            aria-expanded={more}
            aria-controls={`more-${item.item_id}`}
            className={cn(btnGrey, "min-h-[50px] rounded-[14px] px-4", (!fix || fix.command) && "flex-1")}
          >
            <span className="whitespace-nowrap">More</span>
            <ChevronDown className={cn("h-4 w-4 transition-transform motion-reduce:transition-none", more && "rotate-180")} aria-hidden />
          </button>
        </div>
      )}

      {more && !working && (
        <ul id={`more-${item.item_id}`} className="flex flex-col gap-2" data-testid="stuck-more">
          {buttons.map((b) => (
            <li key={b}>
              <button type="button" disabled={locked || (b === "prompt" && promptBusy)} onClick={() => press(b)} className={cn(btnGrey, "w-full justify-start")}>
                {b === "prompt" && promptBusy && <Loader2 className={SPIN} aria-hidden />}
                <span className="whitespace-nowrap">{buttonLabel[b]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {prompt != null && <PromptPanel text={prompt} onClose={() => setPrompt(null)} />}

      {item.undo && <UndoRow undo={item.undo} busy={busy} onUndo={onUndo} pending />}

      {item.footer && <p className="text-center text-[13px] text-white/60"><Nums text={item.footer} /></p>}
    </section>
  );
}

/** "Fixed: Trip marked complete, Hold released.   [Undo]"   or   "Snoozed for 1 day.   [Undo]" */
/**
 * On a card that is still stuck, the tap has not fixed anything yet (a sync asked for, waiting on Turo), so the row is grey
 * and says "Done:" instead of a green "Fixed:" sitting under a STUCK pill. 2026-10-30.
 */
function UndoRow({ undo, busy, onUndo, pending = false }: { undo: StuckUndo; busy: string | null; onUndo: UndoAct; pending?: boolean }) {
  const snooze = undo.kind === "snooze";
  return (
    <div className={cn("flex items-center gap-3 rounded-[14px] p-3", pending ? "bg-white/[0.06]" : "bg-[#30D158]/[0.12] bento:bg-[#34C759]/[0.12]")} role="status">
      <Check className={cn("h-4 w-4 shrink-0", pending ? "text-white/60" : tint.green)} aria-hidden />
      <p className="min-w-0 flex-1 text-[15px] text-white">
        {snooze ? <Nums text={`${undo.label}.`} /> : <><span className="font-semibold">{pending ? "Done:" : "Fixed:"}</span> <Nums text={`${undo.label}.`} /></>}
      </p>
      <button type="button" disabled={busy != null} onClick={() => void onUndo(undo)} className={cn(btn44, "px-2 text-[#409CFF] bento:text-[#007AFF]", focusRing)}>
        {busy === `undo|${undo.id}` && <Loader2 className={SPIN} aria-hidden />}
        <span>Undo</span>
      </button>
    </div>
  );
}

/** A fix whose item is no longer stuck: what worked, and the 24-hour Undo when there is one. */
function FixedRow({ item, busy, onUndo }: { item: StuckItem; busy: string | null; onUndo: UndoAct }) {
  return (
    <section aria-label="Recently fixed" data-testid="fixed-row" className={cn(cardCls, "flex flex-col gap-2 p-4")}>
      {item.action && !item.undo && <p className="text-[15px] font-semibold text-white">{item.employee_name ?? item.title}</p>}
      {item.action && <ActionRow action={item.action} name={item.employee_name} />}
      {item.undo && <UndoRow undo={item.undo} busy={busy} onUndo={onUndo} />}
      {(item.subtitle || item.footer) && (
        <p className="text-center text-[13px] text-white/60">
          {item.subtitle ? <><Nums text={item.subtitle} />. </> : null}{item.footer ? <Nums text={item.footer} /> : null}
        </p>
      )}
    </section>
  );
}

/* ───────── the waiting card ───────── */

const YourCallPill = () => (
  <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-[#0A84FF] px-2.5 py-1 text-[12px] font-bold leading-4 text-[#fff] bento:bg-[#007AFF]">YOUR CALL</span>
);

/** The one thing Claims Closer needs from Jared: a tap to read and send, a call, or a contact. Never more than one at a time. */
function NeedRow({ need }: { need: StuckNeed }) {
  const call = need.kind === "call" ? need.call : null;
  const linesOpen = need.open !== false;
  return (
    <div className="flex flex-col gap-2.5 rounded-[14px] bg-[#0A84FF]/[0.14] p-3 bento:bg-[#007AFF]/[0.1]" data-testid="waiting-need" data-kind={need.kind}>
      <p className="text-[15px] font-semibold leading-[21px] text-white"><Nums text={need.label} /></p>
      {call && linesOpen && (
        <button type="button" className={cn(btnBlue, "w-full")}
          onClick={() => requestDial({ mode: "bridge", phone: call.phone, name: "", company: call.company, purpose: call.purpose.slice(0, 600) })}>
          <Phone className="h-4 w-4" aria-hidden />
          <span className="whitespace-nowrap">Call now</span>
        </button>
      )}
      {call && !linesOpen && (
        <p className="text-[14px] leading-[20px] text-white/75"><Nums text={need.opens ? `The lines are closed right now. They open ${need.opens}.` : "The lines are closed right now."} /></p>
      )}
      {need.link && (
        <Link to={need.link} className={cn(call ? btnGrey : btnBlue, "w-full")}>{need.link_label ?? "Open"}</Link>
      )}
    </div>
  );
}

/** A message to paste somewhere else. Shut by default; nothing is copied until the Copy button is tapped. */
function CopyBlock({ c }: { c: StuckCopy }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const ok = await copyText(c.text);
    if (ok === false) { toast.error("Couldn't copy. Select the text and copy it by hand."); return; }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className={cn(rowBg, "flex flex-col")}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className={cn("flex min-h-[44px] items-center justify-between gap-3 rounded-[14px] px-3 text-left text-[15px] font-semibold text-white", focusRing)}>
        <span>{c.label}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="flex flex-col gap-2.5 px-3 pb-3">
          <pre tabIndex={0} className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/40 p-3 font-sans text-[14px] leading-[20px] text-white/90 bento:bg-[#F3F2EE] bento:text-[#1C1C1E]">{c.text}</pre>
          {c.note && <p className="text-[13px] leading-[18px] text-white/60">{c.note}</p>}
          <button type="button" onClick={() => void copy()} className={cn(btnBlue, "w-full")} aria-label={copied ? "Copied" : `Copy ${c.label}`}>
            {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
            <span className="whitespace-nowrap">{copied ? "Copied" : "Copy message"}</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** What has happened so far, newest last, in plain words. Shut by default so the card stays short. */
function Timeline({ rows }: { rows: StuckTimelineRow[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn(rowBg, "flex flex-col")}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className={cn("flex min-h-[44px] items-center justify-between gap-3 rounded-[14px] px-3 text-left text-[15px] font-semibold text-white", focusRing)}>
        <span>What has happened <span className="font-normal text-white/60">· {rows.length}</span></span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <ol className="flex flex-col gap-2.5 px-3 pb-3" data-testid="waiting-timeline">
          {rows.map((r, i) => (
            <li key={i} className="flex flex-col gap-0.5 text-[14px] leading-[20px]">
              <span className="text-[12px] font-medium leading-4 text-white/60"><Nums text={r.when} />{r.tone === "settled" ? " · settled" : ""}</span>
              <span className={r.tone === "settled" ? "text-white/70" : "text-white"}><Nums text={r.text} /></span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function WaitingCard({ item }: { item: StuckItem }) {
  const yours = item.pill === "YOUR CALL" && !!item.needs_you;
  return (
    <section aria-label={yours ? `Your call: ${item.title}` : `Waiting on someone else: ${item.title}`} data-testid="waiting-card" data-pill={yours ? "your-call" : "waiting"} className={cn(cardCls, cardPad, "gap-3")}>
      <Header name={item.employee_name} title={item.title} subtitle={item.subtitle}
        pill={yours ? <YourCallPill /> : <Pill tone="neutral" className="px-2.5 py-1 font-bold">WAITING</Pill>} />
      {yours && item.needs_you && <NeedRow need={item.needs_you} />}
      <dl className="flex flex-col gap-2 text-[15px] leading-[21px]">
        {item.blocks.map((b) => (
          <div key={b.id} className="flex items-start justify-between gap-3">
            <dt className="text-white/60">{b.label}</dt>
            <dd className="min-w-0 text-right text-white"><Nums text={b.detail ?? ""} /></dd>
          </div>
        ))}
      </dl>
      {(item.copy ?? []).map((c) => <CopyBlock key={c.id} c={c} />)}
      {(item.timeline ?? []).length > 0 && <Timeline rows={item.timeline ?? []} />}
      {item.link && (
        <Link to={item.link} className={cn(btn44, "w-full bg-white/[0.12] text-white hover:bg-white/[0.18]", focusRing)}>{item.link_label ?? "Open"}</Link>
      )}
      {item.footer && <p className="text-[13px] text-white/60"><Nums text={item.footer} /></p>}
    </section>
  );
}

/* ───────── the health line ───────── */

function HealthLine({ stuck, waiting }: { stuck: number; waiting: number }) {
  if (stuck + waiting === 0) return null;
  return (
    <div role="status" data-testid="stuck-health" className="flex items-center gap-2.5 rounded-[14px] bg-white/[0.06] px-3.5 py-3">
      <span
        aria-hidden
        className={cn("h-2.5 w-2.5 shrink-0 rounded-full", stuck > 0 ? "bg-[#FF9F0A] bento:bg-[#FF9500]" : "bg-white/35")}
        style={stuck > 0 ? { boxShadow: "0 0 10px 2px rgba(255,159,10,0.45)" } : undefined}
      />
      <p className="text-[15px] text-white">
        {stuck > 0 && <span className="font-semibold">{stuck}{NBSP}{stuck === 1 ? "employee" : "employees"} stuck</span>}
        {stuck > 0 && waiting > 0 && <span className="text-white/60"> · </span>}
        {waiting > 0 && <span className={stuck > 0 ? "text-white/60" : "font-semibold"}>{waiting} waiting on someone else</span>}
      </p>
    </div>
  );
}

/* ───────── the section ───────── */

const MAX_STUCK = 3;
const POLL_MS = 3000;

/** The Stuck / Waiting feed. The home page owns it so the AI team card counts the same employees this section shows. */
export function useStuckFeed() {
  const feed = usePipelineRpc<unknown>("admin_stuck_items", undefined, 60_000);
  const items = useMemo(() => parseStuck(feed.data), [feed.data]);
  const employeesStuck = useMemo(() => new Set(items.filter((i) => i.kind === "stuck").map((i) => i.employee_slug ?? i.item_id)).size, [items]);
  return { ...feed, items, employeesStuck };
}
export type StuckFeed = ReturnType<typeof useStuckFeed>;

export function StuckSection({ feed }: { feed: StuckFeed }) {
  const { data, missing, reload, hold, items, employeesStuck } = feed;
  const [busy, setBusy] = useState<string | null>(null);
  const [dial, setDial] = useState(false);
  const hasCall = items.some((i) => i.needs_you?.call);

  // The home page's "Refresh now" reaches this card too.
  useEffect(() => {
    const on = () => void reload();
    window.addEventListener("admin:refresh-now", on);
    return () => window.removeEventListener("admin:refresh-now", on);
  }, [reload]);

  // While a fix is working, ask for its answer every few seconds (the server settles it and tells us), then redraw the card.
  const workingIds = items.filter((i) => i.action?.status === "working").map((i) => i.action?.id).filter(Boolean).join(",");
  useEffect(() => {
    if (!workingIds) return;
    const first = workingIds.split(",")[0];
    const t = window.setInterval(() => {
      if (document.hidden) return;
      void rpcArgs("admin_stuck_action", { p_action_id: first }).then(() => reload());
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [workingIds, reload]);

  if (missing || data == null) return null;

  const stuck = items.filter((i) => i.kind === "stuck");
  const waiting = items.filter((i) => i.kind === "waiting");
  const fixed = items.filter((i) => i.kind === "fixed");
  if (stuck.length + waiting.length + fixed.length === 0) return null;

  const shown = stuck.slice(0, MAX_STUCK);
  const hidden = stuck.length - shown.length;

  const run = async (key: string, fn: string, args: Record<string, unknown>, ok: ((d: unknown) => string) | null) => {
    if (busy) return;
    setBusy(key); hold(true);
    const { data: d, error } = await rpcArgs<unknown>(fn, args);
    hold(false); setBusy(null);
    if (error) { toast.error(errText(error)); await reload(); return; }
    if (ok) toast.success(ok(d));
    await reload();
  };

  const onFix: Act = (item, action) =>
    run(`${item.item_id}|${action}`, "admin_stuck_fix", { p_item_id: item.item_id, p_action: action },
      (d) => {
        const labels = (d as { fixed?: unknown } | null)?.fixed;
        return Array.isArray(labels) && labels.length > 0 ? `Fixed: ${labels.join(", ")}` : "Fixed";
      });
  // Retry and Scout answer on the card itself (working, then done or failed); only Snooze also says so in a toast.
  const onRun: Run = (item, button) =>
    run(`${item.item_id}|${button}`, "admin_stuck_run", { p_item_id: item.item_id, p_action: button },
      button === "snooze" ? () => `Snoozed for 1${NBSP}day` : null);
  const onUndo: UndoAct = (u) =>
    run(`undo|${u.id}`, "admin_stuck_undo", { p_undo_id: u.id }, () => `Undone: ${u.label}`);

  return (
    <div className="space-y-3" data-testid="stuck-section">
      <HealthLine stuck={employeesStuck} waiting={waiting.length} />
      {shown.map((i) => <StuckCard key={i.item_id} item={i} busy={busy} onFix={onFix} onRun={onRun} onUndo={onUndo} />)}
      {hidden > 0 && (
        <Link to="/admin/overview" className={cn(btn44, "w-full bg-white/[0.06] text-[#409CFF] bento:text-[#007AFF]", focusRing)}>
          {hidden} more stuck. Open the status board
        </Link>
      )}
      {waiting.map((i) => <WaitingCard key={i.item_id} item={i} />)}
      {fixed.slice(0, 3).map((i) => <FixedRow key={i.item_id} item={i} busy={busy} onUndo={onUndo} />)}
      {hasCall && <DialerSheet kinds={["bridge"]} open={dial} onOpenChange={setDial} onCalled={() => void reload()} />}
    </div>
  );
}
