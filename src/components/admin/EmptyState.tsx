import { LucideIcon, Inbox } from "lucide-react";
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  /** Tighter vertical padding for use inside cards and table cells. */
  compact?: boolean;
  className?: string;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, compact = false, className }: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn("flex flex-col items-center justify-center gap-3 px-4 text-center", compact ? "py-10" : "py-16", className)}
    >
      <div className="h-12 w-12 rounded-2xl bg-white/[0.05] flex items-center justify-center" aria-hidden="true">
        <Icon className="h-6 w-6 text-white/40" />
      </div>
      <p className="text-sm font-medium text-white/90">{title}</p>
      {description && (
        <p className="text-xs leading-relaxed text-white/55 max-w-[20rem]">{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
