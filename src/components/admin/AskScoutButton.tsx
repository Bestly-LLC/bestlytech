import { Binoculars } from "lucide-react";
import { cn } from "@/lib/utils";
import { askScout } from "./scoutBus";

/** A small "ask Scout about this" button for any row, card or error in the admin. */
export function AskScoutButton({
  question,
  about,
  label = "Ask Scout",
  className,
  compact = true,
}: {
  question: string;
  about?: string;
  label?: string;
  className?: string;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        askScout(question, { about });
      }}
      aria-label={`${label}: ${question}`}
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg text-white/45 transition-colors",
        "hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        compact ? "h-9 w-9" : "h-9 px-2.5 text-xs",
        className,
      )}
    >
      <Binoculars className="h-4 w-4" aria-hidden />
      {!compact && label}
    </button>
  );
}
