/** Four tappable tiles: what waits on Jared, open claims, open cleaning reports, money recovered. */
import { cn } from "@/lib/utils";
import { card, label, secondary, tint } from "../laxUi";
import { usd } from "./shared";
import type { ReactNode } from "react";
import { Nw } from "./ui";

function Tile({ name, value, sub, tone, onClick }: { name: string; value: string; sub: ReactNode; tone?: "orange" | "green"; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={`${name}: ${value}`}
      className={cn(card, "flex min-h-[92px] flex-col items-start justify-between rounded-[18px] p-4 text-left transition-transform duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A84FF]",
        tone === "orange" && "ring-[#FF9F0A66] bento:ring-[#C9340055]")}>
      <span className={cn("text-[13px] font-medium", secondary)}>{name}</span>
      <span>
        <span className={cn("block whitespace-nowrap text-[28px] tabular-nums font-semibold leading-none tracking-[-0.02em]", tone === "orange" ? tint.orange : tone === "green" ? tint.green : label)}>{value}</span>
        <span className={cn("mt-1.5 block text-[13px] leading-snug", secondary)}>{sub}</span>
      </span>
    </button>
  );
}

export function SummaryStrip({ yourCall, open, cleaning, recovered, wonCount, go }: {
  yourCall: number; open: number; cleaning: number; recovered: number; wonCount: number; go: (k: "yourCall" | "open" | "clean" | "history") => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile name="Your call" value={String(yourCall)} tone={yourCall > 0 ? "orange" : undefined} sub={yourCall > 0 ? (yourCall === 1 ? "thing waiting on you" : "things waiting on you") : "Nothing waiting on you"} onClick={() => go("yourCall")} />
      <Tile name="Open claims" value={String(open)} sub={open > 0 ? "being worked" : "None right now"} onClick={() => go("open")} />
      <Tile name="Cleaning reports" value={String(cleaning)} sub={cleaning > 0 ? "open in Turo's 72-hour window" : "None open"} onClick={() => go("clean")} />
      <Tile name="Recovered" value={usd(recovered)} tone={recovered > 0 ? "green" : undefined} sub={wonCount > 0 ? <>from <Nw>{wonCount} won {wonCount === 1 ? "claim" : "claims"}</Nw></> : "No wins yet"} onClick={() => go("history")} />
    </div>
  );
}
