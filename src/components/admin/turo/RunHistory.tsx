/** Turo Watch run history (moved from Turo Watch to Turo settings). Reads turo_runs. */
import { useEffect, useState } from "react";
import { Navigation } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface Run {
  id: string; ran_at: string; runner: string; mode: string; market_base: number | null; comp_n: number | null;
  days_written: number; days_verified: number; gates: { gate: string; result: string }[] | null; notes: string | null;
}
const card = "rounded-2xl border border-white/[0.07] bg-white/[0.02] bento:border-transparent bento:bg-[#fff] bento:rounded-[1.5rem]";
const money = (n: number | null | undefined) => (n == null ? "–" : `$${Math.round(Number(n))}`);
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Los_Angeles" });
const MODE: Record<string, { label: string; tone: string }> = {
  applied: { label: "Prices written", tone: "text-emerald-300 bento:text-emerald-700" },
  "propose-only": { label: "Proposed only", tone: "text-amber-300 bento:text-amber-700" },
  blocked: { label: "Blocked", tone: "text-red-300 bento:text-red-700" },
};

export function RunHistory() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  useEffect(() => {
    void supabase.from("turo_runs" as never).select("*").order("ran_at", { ascending: false }).limit(30)
      .then(({ data }) => setRuns((data ?? []) as unknown as Run[]));
  }, []);
  if (runs === null) return <div className={cn(card, "h-32 animate-pulse")} />;
  return (
    <ul className={cn(card, "divide-y divide-white/[0.06] overflow-hidden")}>
      {runs.map((r) => {
        const tripped = (r.gates ?? []).filter((g) => g.result === "TRIPPED").map((g) => g.gate);
        return (
          <li key={r.id} className="px-4 py-3 sm:px-5">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-[0.95rem] text-white bento:text-[#111]"><Navigation className="h-4 w-4 text-white/40" /> {when(r.ran_at)}</span>
              <span className={cn("text-xs font-semibold", MODE[r.mode]?.tone ?? "text-white/60")}>{MODE[r.mode]?.label ?? r.mode}</span>
            </div>
            <p className="mt-1 text-xs text-white/50 bento:text-neutral-500">
              {r.runner} · market {money(r.market_base)} · n={r.comp_n ?? 0}
              {r.mode === "applied" ? ` · ${r.days_verified}/${r.days_written} days verified` : ""}
              {tripped.length ? ` · stopped by: ${tripped.join(", ")}` : ""}
            </p>
            {r.notes && <p className="mt-1 line-clamp-2 text-xs text-white/40">{r.notes.replace(/^CRASH:.*/s, "Runner crashed (fixed Sept 22).")}</p>}
          </li>
        );
      })}
    </ul>
  );
}
