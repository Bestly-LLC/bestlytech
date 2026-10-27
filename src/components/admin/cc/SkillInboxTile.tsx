/**
 * Command Center tile: "Skill Inbox: 3 picks" (Radar). Taps through to /admin/skill-inbox.
 * Loads on its own, never blanks the page: if the Skill Inbox is not set up yet (or the call fails) the tile simply is not drawn.
 * Same card + footer-freshness pattern as the four lead cards (LeadCards.tsx).
 */
import { Link } from "react-router-dom";
import { ChevronRight, Radar } from "lucide-react";
import { cn } from "@/lib/utils";
import { cardCls, focusRing } from "@/components/admin/ui";
import { useLive } from "@/lib/commandCenter";
import { rpc, shortTime } from "@/pages/admin/settlementsShared";
import type { Today } from "@/pages/admin/SkillInbox";

async function loadSkillInbox(): Promise<Today> {
  const { data, error } = await rpc<Today>("skill_inbox_today");
  if (error || !data) throw new Error(error?.message || "could not load the Skill Inbox");
  return data;
}

export function SkillInboxTile() {
  const live = useLive<Today>(loadSkillInbox, 2 * 60_000);
  const t = live.data;
  if (!t) return null;                                   // loading, or not set up yet: draw nothing

  const n = t.left;
  const big = t.picks.length === 0 ? "nothing today" : n === 0 ? "all done" : null;
  const last = t.synced.last_sync_at;
  const stale = last ? Date.now() - Date.parse(last) > 6 * 36e5 : false;
  const sub = t.picks.length === 0
    ? (t.working.waiting > 0 ? `Radar is reading ${t.working.waiting} new ${t.working.waiting === 1 ? "save" : "saves"}.` : "Radar picks the best saves from Instagram at 9:00 AM.")
    : n === 0 ? "You decided every pick. Radar sends the next ones tomorrow at 9:00 AM."
    : "Radar picked these from your Instagram saves. Ares checked each one.";

  return (
    <Link
      to="/admin/skill-inbox"
      aria-label={`Skill Inbox: ${big ?? `${n} ${n === 1 ? "pick" : "picks"}`}. Open.`}
      data-testid="skill-inbox-tile"
      className={cn(cardCls, "group flex min-h-[44px] w-full items-center gap-3 p-4 text-left transition active:scale-[0.985] hover:bg-white/[0.05] motion-reduce:transition-none motion-reduce:active:scale-100 sm:p-5", focusRing)}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-[#7C3AED26] text-[#A78BFA] bento:bg-[#6D28D91a] bento:text-[#6D28D9]"><Radar className="h-5 w-5" aria-hidden /></span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[20px] font-semibold leading-tight tracking-tight text-white">
          Skill Inbox: {big ? big : <span className="whitespace-nowrap">{n} {n === 1 ? "pick" : "picks"}</span>}
        </span>
        <span className="text-[14px] leading-snug text-white/70">{sub}</span>
        <span className={cn("text-[12px] tabular-nums", stale ? "text-[#FF9F0A] bento:text-[#C93400]" : "text-white/45")}>
          {last ? <>Last sync {shortTime(last)}{stale ? ", behind schedule" : ""}</> : "Waiting for the first sync from Muse"}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-white/35 transition-colors group-hover:text-white/70" aria-hidden />
    </Link>
  );
}
