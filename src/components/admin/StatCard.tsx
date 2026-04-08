import { LucideIcon, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
}: StatCardProps) {
  const labelWithTip = (
    <span className="inline-flex items-center gap-1">
      {label}
      {tooltip && (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3 w-3 text-white/20 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[260px] text-xs">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </span>
  );

  const resolvedIconBg = iconBg ?? "bg-white/[0.05]";
  const resolvedIconColor = iconColor ?? "text-white/40";

  if (centered) {
    return (
      <div className={cn(
        "bg-white/[0.03] border border-white/[0.06] rounded-2xl hover:bg-white/[0.05] transition-colors duration-200 p-5 text-center",
        accentColor && "border-l-2",
      )} style={accentColor ? { borderLeftColor: accentColor } : undefined}>
        <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center mx-auto mb-2", resolvedIconBg)}>
          <Icon className={cn("h-[18px] w-[18px]", resolvedIconColor)} />
        </div>
        <p className="text-2xl font-semibold text-white tabular-nums">{value}</p>
        <p className="text-[11px] text-white/40 mt-0.5 font-medium">{labelWithTip}</p>
        {subtitle && <p className="text-[10px] text-white/25 mt-0.5">{subtitle}</p>}
      </div>
    );
  }

  return (
    <div className={cn(
      "bg-white/[0.03] border border-white/[0.06] rounded-2xl hover:bg-white/[0.05] transition-colors duration-200 p-4 sm:p-5",
      accentColor && "border-l-2",
    )} style={accentColor ? { borderLeftColor: accentColor } : undefined}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] sm:text-[11px] font-medium text-white/40 uppercase tracking-widest truncate">{labelWithTip}</p>
          <p className="text-xl sm:text-2xl font-semibold text-white mt-1 tabular-nums leading-none">{value}</p>
          {subtitle && <p className="text-[10px] sm:text-xs text-white/25 mt-1">{subtitle}</p>}
        </div>
        <div className={cn("h-9 w-9 sm:h-10 sm:w-10 rounded-xl flex items-center justify-center shrink-0", resolvedIconBg)}>
          <Icon className={cn("h-4 w-4 sm:h-[18px] sm:w-[18px]", resolvedIconColor)} />
        </div>
      </div>
    </div>
  );
}
