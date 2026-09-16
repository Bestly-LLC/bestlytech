import { LucideIcon, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: number | string;
  icon: LucideIcon;
  accentColor?: string;
  iconBg?: string;
  iconColor?: string;
  subtitle?: string;
  centered?: boolean;
  tooltip?: string;
  /** Show a skeleton in place of the value (keeps the final layout while loading). */
  loading?: boolean;
}

function formatValue(value: number | string): string {
  return typeof value === "number" ? value.toLocaleString() : value;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  accentColor,
  iconBg,
  iconColor,
  subtitle,
  centered = false,
  tooltip,
  loading = false,
}: StatCardProps) {
  const labelWithTip = (
    <span className="inline-flex items-center gap-1">
      {label}
      {tooltip && (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`About ${label}: ${tooltip}`}
                className="inline-flex rounded-sm text-white/55 hover:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                <Info className="h-3 w-3" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[16.25rem] text-xs normal-case tracking-normal">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </span>
  );

  const resolvedIconBg = iconBg ?? "bg-white/[0.05]";
  const resolvedIconColor = iconColor ?? "text-white/55";
  const valueNode = loading ? (
    <Skeleton className={cn("h-7 w-16 bg-white/[0.06]", centered && "mx-auto")} />
  ) : (
    formatValue(value)
  );

  if (centered) {
    return (
      <div className={cn(
        "stat-card bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 text-center",
        accentColor && "border-l-2 bento:border-l-0",
      )} style={accentColor ? { borderLeftColor: accentColor } : undefined}>
        <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center mx-auto mb-2", resolvedIconBg)} aria-hidden="true">
          <Icon className={cn("h-[1.125rem] w-[1.125rem]", resolvedIconColor)} />
        </div>
        <div className="text-2xl font-semibold text-white tabular-nums">{valueNode}</div>
        <p className="text-xs text-white/60 mt-0.5 font-medium">{labelWithTip}</p>
        {subtitle && <p className="text-xs text-white/55 mt-0.5">{subtitle}</p>}
      </div>
    );
  }

  return (
    <div className={cn(
      "stat-card bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 sm:p-5",
      accentColor && "border-l-2 bento:border-l-0",
    )} style={accentColor ? { borderLeftColor: accentColor } : undefined}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.6875rem] font-medium text-white/60 uppercase tracking-wider truncate">{labelWithTip}</p>
          <div className="text-xl sm:text-2xl font-semibold text-white mt-1.5 tabular-nums leading-none">{valueNode}</div>
          {subtitle && <p className="text-xs text-white/55 mt-1.5 truncate">{subtitle}</p>}
        </div>
        <div className={cn("h-9 w-9 sm:h-10 sm:w-10 rounded-xl flex items-center justify-center shrink-0", resolvedIconBg)} aria-hidden="true">
          <Icon className={cn("h-4 w-4 sm:h-[1.125rem] sm:w-[1.125rem]", resolvedIconColor)} />
        </div>
      </div>
    </div>
  );
}
