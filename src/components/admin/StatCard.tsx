import { LucideIcon, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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

  if (centered) {
    return (
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl hover:bg-white/[0.05] transition-colors duration-200 p-5 text-center">
        <div className="h-9 w-9 rounded-xl bg-white/[0.05] flex items-center justify-center mx-auto mb-2">
          <Icon className="h-[18px] w-[18px] text-white/40" />
        </div>
        <p className="text-2xl font-semibold text-white tabular-nums">{value}</p>
        <p className="text-[11px] text-white/40 mt-0.5 font-medium">{labelWithTip}</p>
        {subtitle && <p className="text-[10px] text-white/25 mt-0.5">{subtitle}</p>}
      </div>
    );
  }

  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl hover:bg-white/[0.05] transition-colors duration-200 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-[11px] sm:text-xs font-medium text-white/40 uppercase tracking-wide truncate">{labelWithTip}</p>
          <p className="text-2xl sm:text-3xl font-semibold text-white mt-0.5 sm:mt-1 tabular-nums">{value}</p>
          {subtitle && <p className="text-[10px] sm:text-xs text-white/25 mt-0.5">{subtitle}</p>}
        </div>
        <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-xl bg-white/[0.05] flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4 sm:h-5 sm:w-5 text-white/40" />
        </div>
      </div>
    </div>
  );
}
