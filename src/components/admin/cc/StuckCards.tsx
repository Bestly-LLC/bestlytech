/**
 * Stuck card + Waiting card, top of the Command Center home (design approved 2026-10-27).
 *
 *   Health line      "1 employee stuck · 1 waiting on someone else". Not drawn at all when there is nothing to say.
 *   Stuck card       who is stuck, what blocks them, one 44px button per block, and a primary "Fix all three".
 *                    Every fix is Jared's tap. After a fix the card shows what changed and an Undo (24 hours).
 *   Waiting card     a claim we are waiting on someone else for: no buttons, just what was sent and what happens next.
 *
 * Feed: the admin_stuck_items() RPC. If it is not deployed yet (or fails) this renders nothing, never an error.
 * House rules: 12-hour times (the RPC sends them already formatted), a number never splits from its unit,
 * nothing is cut with "...", touch targets are at least 44px, no emoji.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { rpcArgs } from "@/components/admin/roofguard/AvaShared";
import { errText, usePipelineRpc } from "@/components/admin/pipeline/lib";
import { Pill, cardCls, focusRing, tint } from "@/components/admin/ui";
import { NBSP, Nums, cap, fixAllLabel, initials, parseStuck, spanText, word, type StuckItem, type StuckUndo } from "./stuckLib";

/* ───────── shared bits ───────── */

const cardPad = "flex flex-col gap-3.5 p-4 sm:p-5";
const btn44 = "inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-xl px-3.5 text-[15px] font-semibold transition active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100";
const btnBlue = cn(btn44, "bg-[#0A84FF] text-[#fff] hover:bg-[#409CFF] bento:bg-[#007AFF] bento:hover:bg-[#0062CC]", focusRing);
const btnGrey = cn(btn44, "bg-white/[0.12] text-white hover:bg-white/[0.18]", focusRing);
const rowBg = "rounded-[14px] bg-white/[0.05]";

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

/* ───────── one stuck card ───────── */

type Act = (item: StuckItem, action: string) => Promise<void>;

function StuckCard({ item, busy, onFix, onUndo }: { item: StuckItem; busy: string | null; onFix: Act; onUndo: (u: StuckUndo) => Promise<void> }) {
  const fixable = item.blocks.filter((b) => b.fix_action);
  const since = spanText(item.stuck_since);
  const isClaim = item.item_id.startsWith("claim:");
  const lead = isClaim ? "I haven't moved this claim in" : "I've been reporting trouble for";
  const blocking = item.blocks.length === 1 ? "One thing is blocking me:" : `${cap(word(item.blocks.length))} things are blocking me:`;
  // The first button is the blue one (the design's primary row); the rest are grey.
  const firstFix = fixable[0]?.id;

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
                  disabled={busy != null}
                  onClick={() => void onFix(item, b.fix_action as string)}
                  aria-label={`${b.fix_label ?? "Fix"}: ${b.label}`}
                  className={b.id === firstFix ? btnBlue : btnGrey}
                >
                  {busy === key && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  <span className="whitespace-nowrap">{b.fix_label ?? "Fix"}</span>
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {fixable.length >= 2 && (
        <button
          type="button"
          disabled={busy != null}
          onClick={() => void onFix(item, "all")}
          className={cn(btnBlue, "min-h-[50px] w-full rounded-[14px] text-[17px]")}
        >
          {busy === `${item.item_id}|all` && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          <span className="whitespace-nowrap">{fixAllLabel(fixable.length)}</span>
        </button>
      )}

      {item.undo && <UndoRow undo={item.undo} busy={busy} onUndo={onUndo} />}

      {item.footer && <p className="text-center text-[13px] text-white/60"><Nums text={item.footer} /></p>}
    </section>
  );
}

/** "Fixed: Trip marked complete, Hold released.   [Undo]" */
function UndoRow({ undo, busy, onUndo }: { undo: StuckUndo; busy: string | null; onUndo: (u: StuckUndo) => Promise<void> }) {
  return (
    <div className="flex items-center gap-3 rounded-[14px] bg-[#30D158]/[0.12] p-3 bento:bg-[#34C759]/[0.12]" role="status">
      <Check className={cn("h-4 w-4 shrink-0", tint.green)} aria-hidden />
      <p className="min-w-0 flex-1 text-[15px] text-white"><span className="font-semibold">Fixed:</span> {undo.label}.</p>
      <button type="button" disabled={busy != null} onClick={() => void onUndo(undo)} className={cn(btn44, "px-2 text-[#409CFF] bento:text-[#007AFF]", focusRing)}>
        {busy === `undo|${undo.id}` && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        <span>Undo</span>
      </button>
    </div>
  );
}

/** A fix whose item is no longer stuck: one quiet row so the 24-hour Undo stays reachable. */
function FixedRow({ item, busy, onUndo }: { item: StuckItem; busy: string | null; onUndo: (u: StuckUndo) => Promise<void> }) {
  return (
    <section aria-label="Recently fixed" data-testid="fixed-row" className={cn(cardCls, "flex flex-col gap-2 p-4")}>
      {item.undo && <UndoRow undo={item.undo} busy={busy} onUndo={onUndo} />}
      <p className="text-center text-[13px] text-white/60">
        {item.subtitle ? <><Nums text={item.subtitle} />. </> : null}{item.footer ? <Nums text={item.footer} /> : null}
      </p>
    </section>
  );
}

/* ───────── the waiting card ───────── */

function WaitingCard({ item }: { item: StuckItem }) {
  return (
    <section aria-label={`Waiting on someone else: ${item.title}`} data-testid="waiting-card" className={cn(cardCls, cardPad, "gap-3")}>
      <Header name={item.employee_name} title={item.title} subtitle={item.subtitle} pill={<Pill tone="neutral" className="px-2.5 py-1 font-bold">WAITING</Pill>} />
      <dl className="flex flex-col gap-2 text-[15px] leading-[21px]">
        {item.blocks.map((b) => (
          <div key={b.id} className="flex items-start justify-between gap-3">
            <dt className="text-white/60">{b.label}</dt>
            <dd className="min-w-0 text-right text-white"><Nums text={b.detail ?? ""} /></dd>
          </div>
        ))}
      </dl>
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

export function StuckSection() {
  const { data, missing, reload, hold } = usePipelineRpc<unknown>("admin_stuck_items", undefined, 60_000);
  const [busy, setBusy] = useState<string | null>(null);
  const items = useMemo(() => parseStuck(data), [data]);

  // The home page's "Refresh now" reaches this card too.
  useEffect(() => {
    const on = () => void reload();
    window.addEventListener("admin:refresh-now", on);
    return () => window.removeEventListener("admin:refresh-now", on);
  }, [reload]);

  if (missing || data == null) return null;

  const stuck = items.filter((i) => i.kind === "stuck");
  const waiting = items.filter((i) => i.kind === "waiting");
  const fixed = items.filter((i) => i.kind === "fixed");
  if (stuck.length + waiting.length + fixed.length === 0) return null;

  const employeesStuck = new Set(stuck.map((i) => i.employee_slug ?? i.item_id)).size;
  const shown = stuck.slice(0, MAX_STUCK);
  const hidden = stuck.length - shown.length;

  const run = async (key: string, fn: string, args: Record<string, unknown>, ok: (d: unknown) => string) => {
    if (busy) return;
    setBusy(key); hold(true);
    const { data: d, error } = await rpcArgs<unknown>(fn, args);
    hold(false); setBusy(null);
    if (error) { toast.error(errText(error)); return; }
    toast.success(ok(d));
    await reload();
  };

  const onFix: Act = (item, action) =>
    run(`${item.item_id}|${action}`, "admin_stuck_fix", { p_item_id: item.item_id, p_action: action },
      (d) => {
        const labels = (d as { fixed?: unknown } | null)?.fixed;
        return Array.isArray(labels) && labels.length > 0 ? `Fixed: ${labels.join(", ")}` : "Fixed";
      });
  const onUndo = (u: StuckUndo) =>
    run(`undo|${u.id}`, "admin_stuck_undo", { p_undo_id: u.id }, () => `Undone: ${u.label}`);

  return (
    <div className="space-y-3" data-testid="stuck-section">
      <HealthLine stuck={employeesStuck} waiting={waiting.length} />
      {shown.map((i) => <StuckCard key={i.item_id} item={i} busy={busy} onFix={onFix} onUndo={onUndo} />)}
      {hidden > 0 && (
        <Link to="/admin/overview" className={cn(btn44, "w-full bg-white/[0.06] text-[#409CFF] bento:text-[#007AFF]", focusRing)}>
          {hidden} more stuck. Open the status board
        </Link>
      )}
      {waiting.map((i) => <WaitingCard key={i.item_id} item={i} />)}
      {fixed.slice(0, 3).map((i) => <FixedRow key={i.item_id} item={i} busy={busy} onUndo={onUndo} />)}
    </div>
  );
}
