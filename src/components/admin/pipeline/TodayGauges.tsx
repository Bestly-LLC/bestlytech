import { NBSP, fit100, pct } from "./lib";
import { Ring, Panel } from "./parts";
import type { Overview } from "./types";

type G = { key: keyof Overview["today"]; label: string; tone: string };
const GAUGES: G[] = [
  { key: "found", label: "Found", tone: "text-zinc-300" },
  { key: "qualified", label: "Qualified", tone: "text-sky-400" },
  { key: "queued", label: "Queued", tone: "text-violet-400" },
  { key: "called", label: "Called", tone: "text-amber-400" },
  { key: "booked", label: "Booked", tone: "text-emerald-400" },
];

/** Today at a glance: five rings and the lead-quality gauge. */
export function TodayGauges({ data }: { data: Overview }) {
  const t = data.today;
  const goal = t.targets?.queued ?? 0;
  const base = (k: G["key"]): { of: number; cap: string } => {
    if (k === "queued" && goal > 0) return { of: goal, cap: `of${NBSP}${goal}${NBSP}goal` };
    if (k === "found") return { of: Math.max(t.found, 1), cap: "new today" };
    return { of: Math.max(t.found, 1), cap: `of${NBSP}${t.found}${NBSP}found` };
  };
  const quality = Math.round((data.quality?.avg_reach ?? 0) * ((fit100(data.quality?.avg_fit) ?? 0) / 100) * 100);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {GAUGES.map((g) => {
        const v = Number(t[g.key]) || 0, b = base(g.key);
        return (
          <Panel key={g.key} className="flex flex-col items-center gap-2 !p-4 text-center">
            <Ring value={v} of={b.of} tone={g.tone} label={`${g.label} today: ${v}, ${b.cap}`}>
              <span className="text-[24px] font-semibold tabular-nums leading-none text-white">{v}</span>
            </Ring>
            <div>
              <p className="text-[15px] font-semibold text-white">{g.label}</p>
              <p className="whitespace-nowrap text-[12px] text-white/55">{b.cap}</p>
            </div>
          </Panel>
        );
      })}
      <Panel className="col-span-2 flex flex-col items-center gap-2 !p-4 text-center sm:col-span-3 lg:col-span-1">
        <Ring value={quality} of={100} tone="text-emerald-400" label={`Lead quality ${quality} out of 100`}>
          <span className="text-[24px] font-semibold tabular-nums leading-none text-white">{data.quality?.n ? quality : "–"}</span>
        </Ring>
        <div>
          <p className="text-[15px] font-semibold text-white">Lead quality</p>
          <p className="text-[12px] leading-snug text-white/55">
            {data.quality?.n
              ? <>Reach odds <span className="whitespace-nowrap">{pct(data.quality.avg_reach)}</span>, fit <span className="whitespace-nowrap">{fit100(data.quality.avg_fit)}/100</span></>
              : "No scored leads yet"}
          </p>
        </div>
      </Panel>
    </div>
  );
}
