/** The list column: tab switch plus one row per claim / cleaning report / finished claim, needs-you first. */
import { Fragment, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Lines } from "@/components/Lines";
import { Segmented, card, label, secondary, separator, tertiary, tint } from "../laxUi";
import { cleanLabel, CLEAN_TONE, STATUS, cleanLive, cleanNeedsYou, cleanOpen, daysToEscalate, fullName, isHistory, needsList, shortDay, usd,
  type CleanData, type Data, type Row, type Tab } from "./shared";
import { Nw, YourCallPill } from "./ui";

export type Item = { id: string; title: string; line: ReactNode; right?: ReactNode; rightSub?: ReactNode; rightTone?: string; needs: boolean; group: number; key: number; section?: string };
export type Items = Record<Tab, Item[]>;

const daysShort = (d: number) => d > 1 ? `${d} days left` : d === 1 ? "1 day left" : d === 0 ? "Today" : "Overdue";
const hoursLeft = (iso: string) => Math.max(1, Math.ceil((Date.parse(iso) - Date.now()) / 3.6e6));

function needsReason(r: Row): string | null {
  const n = needsList(r);
  if (n.questions.length) return n.questions.length === 1 ? "Has a question for you" : "Has questions for you";
  if (n.drafts.length) return n.drafts[0].kind === "escalation" ? "A note to paste into Turo" : "A message needs your OK";
  if (n.bookFailed) return "Booking needs your call";
  if (n.book) return "Ready for you to book the repair";
  return null;
}

/** Turns the page data into the three sorted lists. Pure: no React state. */
export function buildItems(data: Data, clean: CleanData | null): Items {
  const open: Item[] = data.cases.filter((r) => !isHistory(r.case)).map((r) => {
    const c = r.case; const why = needsReason(r); const d = daysToEscalate(c);
    const quotes = r.estimates.filter((e) => e.status === "received").length;
    const state = c.repair_booking?.state ?? "";
    return {
      id: c.id, title: fullName(c), needs: !!why, group: why ? 0 : 1, key: c.escalate_by ? Date.parse(c.escalate_by) : Infinity,
      line: why ?? <>{STATUS[c.status] ?? c.status}{["booked", "manual"].includes(state) ? " · Repair booked" : quotes > 0 ? <> · <Nw>{quotes} {quotes === 1 ? "quote" : "quotes"} in</Nw></> : null}</>,
      right: c.estimate_amount != null ? usd(c.estimate_amount) : undefined,
      rightSub: d !== null ? daysShort(d) : undefined,
      rightTone: d !== null && d <= 4 ? tint.orange : undefined,
    };
  });
  const cl: Item[] = (clean?.rows ?? []).map((r) => {
    const needs = cleanNeedsYou(r); const isOpen = cleanOpen(r);
    const group = needs ? 0 : isOpen ? 1 : 2;
    return {
      id: `clean:${r.reservation_id}`, title: r.guest_first ?? "Guest", needs, group, key: group < 2 ? Date.parse(r.deadline) : -Date.parse(r.trip_end),
      section: group < 2 ? "Open" : "Earlier",
      line: <span className={needs ? undefined : CLEAN_TONE[r.status]}>{r.dry_run ? "Test run · " : ""}{cleanLabel(r.status)}</span>,
      right: isOpen || (needs && cleanLive(r)) ? `${hoursLeft(r.deadline)} hr left` : shortDay(r.trip_end),
    };
  });
  const hist: Item[] = data.cases.filter((r) => isHistory(r.case)).map((r) => {
    const c = r.case; const won = c.status === "paid";
    return {
      id: `hist:${c.id}`, title: fullName(c), needs: false, group: won ? 0 : 1, key: -Date.parse(c.opened_at), section: won ? "Won" : "Not followed through",
      line: <><Nw>{shortDay(c.opened_at)}</Nw> · {c.car ?? "—"}</>,
      right: won ? (c.recovered_amount != null ? usd(c.recovered_amount) : "Settled") : "Not pursued",
      rightTone: won ? tint.green : secondary,
    };
  });
  const sort = (a: Item, b: Item) => a.group - b.group || a.key - b.key;
  return { open: open.sort(sort), clean: cl.sort(sort), history: hist.sort(sort) };
}

const EMPTY: Record<Tab, string> = {
  open: "No open claims. A case opens on its own when Turo emails that a claim started.",
  clean: "No trips checked yet. The first check runs an hour after the next trip ends.",
  history: "Nothing finished yet. Claims you win, and ones you stop following, show up here.",
};

export function ClaimsList({ tab, onTab, items, counts, selectedId, onSelect, recovered }: {
  tab: Tab; onTab: (t: Tab) => void; items: Items; counts: { open: number; clean: number };
  selectedId: string | null; onSelect: (id: string) => void; recovered: { total: number; settlement: boolean };
}) {
  const list = items[tab];
  const tabs: { value: Tab; label: string }[] = [
    { value: "open", label: counts.open ? `Open (${counts.open})` : "Open" },
    { value: "clean", label: counts.clean ? `Cleaning (${counts.clean})` : "Cleaning" },
    { value: "history", label: "History" },
  ];
  return (
    <div className={cn(card, "flex min-h-0 flex-col overflow-hidden p-0 lg:max-h-[calc(100dvh-7.5rem)]")}>
      <div className="p-3 sm:[&>div]:w-full sm:[&_button]:flex-1 [&_button]:min-h-[44px] lg:[&_button]:min-h-[36px] [&_button]:px-2">
        <Segmented ariaLabel="Claims view" value={tab} options={tabs} onChange={onTab} />
      </div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto border-t", "border-[#38383A] bento:border-[#C6C6C8]")}>
        {tab === "history" && list.length > 0 && (
          <div className={cn("border-b px-4 py-3", "border-[#38383A] bento:border-[#C6C6C8]")}>
            <p className={cn("text-[13px]", secondary)}>Recovered so far</p>
            <p className={cn("whitespace-nowrap text-[22px] font-semibold leading-tight", tint.green)}>{usd(recovered.total)}</p>
            {recovered.settlement && <p className={cn("text-[13px]", secondary)}>+ total-loss settlement</p>}
          </div>
        )}
        {tab === "clean" && list.length > 0 && (
          <p className={cn("px-4 pt-3 text-[13px] leading-snug", secondary)}><Lines>After every trip, Claims Closer compares your check-in and check-out photos. Turo only takes cleaning reports for 72 hours after a trip.</Lines></p>
        )}
        {!list.length ? (
          <p className={cn("px-4 py-6 text-[15px] leading-snug", secondary)}><Lines>{EMPTY[tab]}</Lines></p>
        ) : (
          <ul className={cn("divide-y", separator)}>
            {list.map((it, i) => (
              <Fragment key={it.id}>
                {it.section && (tab === "history" || (tab === "clean" && list.some((x) => x.section !== it.section))) && it.section !== list[i - 1]?.section && (
                  <li role="heading" aria-level={3} className={cn("px-4 pb-1 pt-4 text-[13px] font-semibold uppercase tracking-[0.02em]", secondary)}>{it.section}</li>
                )}
                <li>
                  <button type="button" onClick={() => onSelect(it.id)} aria-current={it.id === selectedId ? "true" : undefined}
                    className={cn("flex min-h-[64px] w-full items-start gap-3 px-4 py-3 text-left transition-[background-color,transform] duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0A84FF]",
                      it.id === selectedId ? "bg-[#0A84FF33] bento:bg-[#007AFF1f]" : "hover:bg-[#ffffff0d] bento:hover:bg-[#0000000a]")}>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-[15px] font-semibold leading-snug", label)}>{it.title}</span>
                      <span className={cn("mt-0.5 block text-[13px] leading-snug", secondary)}>{it.line}</span>
                      {it.needs && <span className="mt-2 block"><YourCallPill /></span>}
                    </span>
                    {(it.right || it.rightSub) && (
                      <span className="shrink-0 text-right">
                        {it.right && <span className={cn("block whitespace-nowrap text-[15px] font-semibold leading-snug tabular-nums", it.rightTone && !it.rightSub ? it.rightTone : label)}>{it.right}</span>}
                        {it.rightSub && <span className={cn("mt-0.5 block whitespace-nowrap text-[13px] leading-snug", it.rightTone ?? secondary)}>{it.rightSub}</span>}
                      </span>
                    )}
                    <ChevronRight aria-hidden className={cn("mt-0.5 h-4 w-4 shrink-0 lg:hidden", tertiary)} />
                  </button>
                </li>
              </Fragment>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
