import { ReactNode, useState } from "react";
import { LucideIcon, MoreHorizontal, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * Admin action conventions (see docs/admin-ui-conventions.md):
 *   - A page shows at most ONE primary action and ONE or TWO secondary actions as buttons.
 *   - Everything else (export, maintenance, rarely-used tools) lives in the "More" ActionMenu.
 *   - Destructive items sit last, in their own group, and still open a confirm dialog.
 *   - Row-level actions use one ActionMenu per row instead of a row of icon buttons.
 */

export interface ActionItem {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void | Promise<unknown>;
  disabled?: boolean;
  destructive?: boolean;
  /** Optional group heading; items with the same group are rendered together in order of first appearance. */
  group?: string;
  hint?: string;
}

export function ActionMenu({
  items,
  label = "More actions",
  trigger,
  align = "end",
  className,
}: {
  items: ActionItem[];
  label?: string;
  trigger?: ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  const [running, setRunning] = useState<string | null>(null);
  const visible = items.filter(Boolean);
  if (visible.length === 0) return null;

  // Normal groups first (in first-seen order), destructive items always last.
  const groups: { name: string | undefined; items: ActionItem[] }[] = [];
  for (const item of visible.filter((i) => !i.destructive)) {
    const g = groups.find((x) => x.name === item.group);
    if (g) g.items.push(item);
    else groups.push({ name: item.group, items: [item] });
  }
  const destructive = visible.filter((i) => i.destructive);
  if (destructive.length) groups.push({ name: undefined, items: destructive });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <Button
            variant="outline"
            size="icon"
            aria-label={label}
            className={cn("h-9 w-9 border-white/10 text-white/70 hover:text-white hover:bg-white/5", className)}
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-[13rem]">
        {groups.map((g, gi) => (
          <div key={`${g.name ?? "g"}-${gi}`}>
            {gi > 0 && <DropdownMenuSeparator />}
            {g.name && <DropdownMenuLabel className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">{g.name}</DropdownMenuLabel>}
            {g.items.map((item) => {
              const Icon = item.icon;
              return (
                <DropdownMenuItem
                  key={item.label}
                  disabled={item.disabled || running !== null}
                  onSelect={async () => {
                    const r = item.onSelect();
                    if (r && typeof (r as Promise<unknown>).then === "function") {
                      setRunning(item.label);
                      try {
                        await r;
                      } finally {
                        setRunning(null);
                      }
                    }
                  }}
                  className={cn("gap-2 py-2", item.destructive && "text-red-400 focus:text-red-300 focus:bg-red-500/10")}
                >
                  {Icon && <Icon className="h-4 w-4 shrink-0" />}
                  <span className="flex-1">{item.label}</span>
                  {item.hint && <span className="text-xs text-muted-foreground">{item.hint}</span>}
                </DropdownMenuItem>
              );
            })}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
