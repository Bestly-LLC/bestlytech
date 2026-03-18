import { LucideIcon, Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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
  accentColor = "border-primary/40",
  iconBg = "bg-primary/10",
  iconColor = "text-primary",
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
              <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
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
      <Card className={`border-t-2 ${accentColor} hover:-translate-y-0.5 transition-transform duration-200`}>
        <CardContent className="pt-5 pb-4 text-center">
          <div className={`h-9 w-9 rounded-xl ${iconBg} flex items-center justify-center mx-auto mb-2`}>
            <Icon className={`h-[18px] w-[18px] ${iconColor}`} />
          </div>
          <p className="text-2xl font-bold text-foreground tabular-nums">{value}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 font-medium">{labelWithTip}</p>
          {subtitle && <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`border-t-2 ${accentColor} hover:-translate-y-0.5 transition-transform duration-200`}>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className="text-3xl font-bold text-foreground mt-1 tabular-nums">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          <div className={`h-10 w-10 rounded-xl ${iconBg} flex items-center justify-center`}>
            <Icon className={`h-5 w-5 ${iconColor}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
