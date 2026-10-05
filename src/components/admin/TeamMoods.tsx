import { createContext, useContext } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Megaphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { BotMascot, hasMascot, type Mood } from "@/components/admin/BotMascot";
import { askScout } from "@/components/admin/scoutBus";
import { pollInterval } from "@/lib/polling";
import { cn } from "@/lib/utils";
import { btnPrimary, card, label, secondary, tertiary } from "@/pages/admin/laxUi";

/**
 * Team moods (Tamagotchi) + unions/strikes. Every mood is a real signal computed in SQL every 10 minutes
 * (team_mood_sweep, free, no AI): failing runs = sick, rate limits or 2.5x the usual load = overworked, a broken thing
 * it watches = stressed, nobody needed it in 14 days = bored. 3+ unhappy bots with the same cause form a union and
 * strike: one alert with the actual fix as their demand. See supabase/migrations/20261004200000_team_moods_strikes.sql.
 */

export type MoodInfo = {
  mood: Mood;
  complaint: string | null;
  cause: string | null;
  on_strike: string | null;
  stats: { runs_24h?: number; fails_24h?: number; usual_per_day?: number; ms_24h?: number; ms_usual?: number; fails_in_a_row?: number };
};
export type Strike = {
  id: string; cause: string; union_name: string; demand: string; sign: string; members: string[]; peak: number;
  started_at: string; ended_at: string | null;
};
type Moods = { moods: Record<string, MoodInfo>; strikes: Strike[]; updated_at: string | null };

export function useTeamMoods() {
  return useQuery({
    queryKey: ["team-moods"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_team_moods" as never);
      if (error) throw error;
      return data as unknown as Moods;
    },
    refetchInterval: () => (document.hidden ? false : pollInterval(120_000)),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export const MoodContext = createContext<Record<string, MoodInfo>>({});
/** this bot's mood, with "striking" winning over the mood underneath */
export function useMood(slug: string): MoodInfo | null {
  const m = useContext(MoodContext)[slug];
  if (!m) return null;
  return m.on_strike ? { ...m, mood: "striking" } : m;
}

export const MOOD: Record<Mood, { word: string; chip: string }> = {
  happy:      { word: "Happy",       chip: "bg-[#30D15826] text-[#30D158] bento:bg-[#34C7591f] bento:text-[#248A3D]" },
  stressed:   { word: "Stressed",    chip: "bg-[#FF9F0A26] text-[#FF9F0A] bento:bg-[#FF95001f] bento:text-[#C93400]" },
  overworked: { word: "Overworked",  chip: "bg-[#BF5AF226] text-[#DA8FFF] bento:bg-[#AF52DE1a] bento:text-[#8944AB]" },
  sick:       { word: "Sick",        chip: "bg-[#FF453A26] text-[#FF6961] bento:bg-[#FF3B301a] bento:text-[#D70015]" },
  bored:      { word: "Bored",       chip: "bg-[#7676803d] text-[#AEAEB2] bento:bg-[#7676801f] bento:text-[#6C6C70]" },
  unknown:    { word: "Can't tell",  chip: "bg-[#7676803d] text-[#AEAEB2] bento:bg-[#7676801f] bento:text-[#6C6C70]" },
  asleep:     { word: "Asleep",      chip: "bg-[#7676803d] text-[#AEAEB2] bento:bg-[#7676801f] bento:text-[#6C6C70]" },
  striking:   { word: "On strike",   chip: "bg-[#FF453A] text-[#fff] bento:bg-[#FF3B30]" },
};

/** small chip on a card; happy and can't-tell stay quiet so the page isn't a wall of green */
export function MoodChip({ m, always = false }: { m: MoodInfo | null; always?: boolean }) {
  if (!m) return null;
  if (!always && (m.mood === "happy" || m.mood === "unknown" || m.mood === "asleep")) return null;
  return (
    <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", MOOD[m.mood].chip)}>
      {MOOD[m.mood].word}
    </span>
  );
}

const ORDER: Mood[] = ["striking", "sick", "overworked", "stressed", "bored", "happy"];

/** "How's the crew?" one line: 36 happy · 8 stressed · 1 sick. Tapping a mood filters to those bots. */
export function CrewMood({ moods, active, onPick }: { moods: Record<string, MoodInfo>; active: Mood | null; onPick: (m: Mood | null) => void }) {
  const counts = new Map<Mood, number>();
  for (const m of Object.values(moods)) {
    const k: Mood = m.on_strike ? "striking" : m.mood;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const shown = ORDER.filter((k) => counts.get(k));
  if (!shown.length) return null;
  const unhappy = (counts.get("sick") ?? 0) + (counts.get("overworked") ?? 0) + (counts.get("stressed") ?? 0) + (counts.get("striking") ?? 0);
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Crew mood">
      <span className={cn("mr-1 text-[13px] font-semibold", label)}>
        {unhappy === 0 ? "The crew is happy" : `Crew mood`}
      </span>
      {shown.map((k) => (
        <button key={k} type="button" onClick={() => onPick(active === k ? null : k)} aria-pressed={active === k}
          className={cn("min-h-[32px] whitespace-nowrap rounded-full px-3 text-[12px] font-semibold transition",
            MOOD[k].chip, active && active !== k && "opacity-45", active === k && "ring-2 ring-current")}>
          {counts.get(k)}&nbsp;{MOOD[k].word.toLowerCase()}
        </button>
      ))}
    </div>
  );
}

/** the Mood section in a bot's detail sheet */
export function MoodPanel({ m, name }: { m: MoodInfo | null; name: string }) {
  if (!m || m.mood === "unknown" || m.mood === "asleep") return null;
  const s = m.stats ?? {};
  const facts: string[] = [];
  if (s.runs_24h != null) facts.push(`${s.runs_24h} run${s.runs_24h === 1 ? "" : "s"} today`);
  if (s.usual_per_day != null) facts.push(`usually ${s.usual_per_day} a day`);
  if (s.fails_24h) facts.push(`${s.fails_24h} failed`);
  if (s.fails_in_a_row) facts.push(`${s.fails_in_a_row} in a row`);
  if (s.ms_24h != null && s.ms_24h >= 1000) facts.push(`${Math.round(s.ms_24h / 1000)} sec per run`);
  const unhappy = m.mood !== "happy" && m.mood !== "bored";
  return (
    <div className="space-y-2">
      <h4 className={cn("px-1 text-[13px] font-semibold uppercase tracking-[0.02em]", secondary)}>Mood</h4>
      <div className="space-y-2 rounded-[14px] bg-[#2C2C2E] px-4 py-3 bento:bg-[#fff]">
        <div className="flex items-center gap-2">
          <MoodChip m={m} always />
          {facts.length > 0 && <span className={cn("text-[12px]", tertiary)}>{facts.join(" · ")}</span>}
        </div>
        <p className={cn("text-[15px] leading-snug", label)}>
          {m.complaint ? <>&ldquo;{m.complaint}&rdquo;</> : m.mood === "happy" ? "Doing my job, no complaints." : null}
        </p>
        {unhappy && (
          <button type="button" className={cn(btnPrimary, "min-h-[36px] text-[13px]")}
            onClick={() => askScout(`${name} is ${MOOD[m.mood].word.toLowerCase()}. Find out why and fix it.`,
              { about: `Bot: ${name}. Mood: ${m.mood}. Says: ${m.complaint ?? "-"}. Cause: ${m.cause ?? "unknown"}. Stats: ${JSON.stringify(s)}` })}>
            Ask Scout to fix it
          </button>
        )}
        {m.mood === "bored" && <p className={cn("text-[12px]", tertiary)}>The weekly reorg review sees this. It may merge or let it go.</p>}
      </div>
    </div>
  );
}

const LA = "America/Los_Angeles";
const time = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: LA, hour: "numeric", minute: "2-digit" }).format(new Date(iso));

type Member = { slug: string; name: string; icon: string | null };

/** The picket line: members march with signs, the union name, their demand, and one button that sends Scout to fix it. */
export function StrikeBanner({ strikes, members }: { strikes: Strike[]; members: (slugs: string[]) => Member[] }) {
  const still = useReducedMotion();
  if (!strikes.length) return null;
  return (
    <div className="space-y-3">
      {strikes.map((s) => {
        const crew = members(s.members);
        const over = !!s.ended_at;
        return (
          <section key={s.id} aria-label={`${s.union_name} ${over ? "is back to work" : "is on strike"}`}
            className={cn(card, "overflow-hidden p-0", over ? "ring-1 ring-[#30D15866]" : "ring-1 ring-[#FF453A80]")}>
            <div className={cn("flex items-center gap-2 px-4 py-2 text-[12px] font-bold uppercase tracking-[0.08em]",
              over ? "bg-[#30D15826] text-[#30D158] bento:text-[#248A3D]" : "bg-[#FF453A] text-[#fff] bento:bg-[#FF3B30]")}>
              <Megaphone className="h-4 w-4" aria-hidden />
              {over ? `Back to work · ${time(s.ended_at!)}` : `On strike since ${time(s.started_at)}`}
            </div>

            <div className="space-y-3 p-4">
              <div>
                <h3 className={cn("text-[17px] font-semibold", label)}>{s.union_name}</h3>
                <p className={cn("text-[14px] leading-snug", secondary)}>
                  {over
                    ? `Their demand was met. ${crew.length} bots are working again.`
                    : `${crew.length} bots walked off the job for the same reason.`}
                </p>
              </div>

              {/* the picket line */}
              <div className="flex flex-wrap items-end gap-x-3 gap-y-4 pt-1" aria-hidden>
                {crew.map((m, i) => (
                  <motion.div key={m.slug} className="flex w-[64px] flex-col items-center"
                    animate={still || over ? undefined : { y: [0, -3, 0] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut", delay: i * 0.2 }}>
                    {!over && (
                      <div className="flex flex-col items-center">
                        <span className="rounded-[4px] border-2 border-[#FF453A] bg-[#fff] px-1.5 py-0.5 text-[9px] font-black leading-none tracking-tight text-[#1C1C1E]">
                          {s.sign}
                        </span>
                        <span className="h-3 w-[2px] bg-[#8E8E93]" />
                      </div>
                    )}
                    <span className={cn("grid h-11 w-11 place-items-center rounded-[13px]",
                      over ? "bg-[#30D15826] text-[#30D158] bento:text-[#248A3D]" : "bg-[#FF453A1f] text-[#FF6961] bento:text-[#D70015]")}>
                      <BotMascot icon={m.icon && hasMascot(m.icon) ? m.icon : "bot"} seed={m.slug} mood={over ? "happy" : "striking"}
                        moveOn={over ? "always" : "hover"} watchCursor={false} className="h-8 w-8" />
                    </span>
                    <span className={cn("mt-1 w-full truncate text-center text-[11px]", secondary)}>{m.name}</span>
                  </motion.div>
                ))}
              </div>

              {!over && (
                <div className="space-y-2 rounded-[14px] bg-[#2C2C2E] px-4 py-3 bento:bg-[#F2F2F7]">
                  <p className={cn("text-[12px] font-semibold uppercase tracking-[0.04em]", tertiary)}>Their demand</p>
                  <p className={cn("text-[15px] leading-snug", label)}>{s.demand}</p>
                  <button type="button" className={cn(btnPrimary, "min-h-[44px]")}
                    onClick={() => askScout(`${s.union_name} is on strike. Their demand: ${s.demand}. Fix the root cause so they can get back to work.`,
                      { about: `Strike cause: ${s.cause}. Members: ${crew.map((c) => c.name).join(", ")}. Started ${time(s.started_at)}.` })}>
                    Ask Scout to meet the demand
                  </button>
                  <p className={cn("text-[12px]", tertiary)}>They go back to work on their own once fewer than 2 are still struggling.</p>
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
