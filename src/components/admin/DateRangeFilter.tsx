import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type DateRange = { from: Date | undefined; to: Date | undefined };

const PRESETS: Record<string, () => DateRange> = {
  "7d": () => ({ from: new Date(Date.now() - 7 * 86400000), to: new Date() }),
  "30d": () => ({ from: new Date(Date.now() - 30 * 86400000), to: new Date() }),
  "90d": () => ({ from: new Date(Date.now() - 90 * 86400000), to: new Date() }),
  all: () => ({ from: undefined, to: undefined }),
};

interface DateRangeFilterProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

export function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  const [preset, setPreset] = useState("all");

  const handlePreset = (v: string) => {
    setPreset(v);
    if (v !== "custom") onChange(PRESETS[v]());
  };

  return (
    <div className="flex items-center gap-2">
      <Select value={preset} onValueChange={handlePreset}>
        <SelectTrigger className="w-[140px] h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Time</SelectItem>
          <SelectItem value="7d">Last 7 Days</SelectItem>
          <SelectItem value="30d">Last 30 Days</SelectItem>
          <SelectItem value="90d">Last 90 Days</SelectItem>
          <SelectItem value="custom">Custom</SelectItem>
        </SelectContent>
      </Select>
      {preset === "custom" && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className={cn("h-8 text-xs gap-1.5", !value.from && "text-muted-foreground")}>
              <CalendarIcon className="h-3.5 w-3.5" />
              {value.from ? (
                <>
                  {format(value.from, "MMM d")} – {value.to ? format(value.to, "MMM d") : "..."}
                </>
              ) : (
                "Pick dates"
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              selected={value.from ? { from: value.from, to: value.to } : undefined}
              onSelect={(range) => onChange({ from: range?.from, to: range?.to })}
              numberOfMonths={2}
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

export function filterByDateRange<T extends Record<string, any>>(
  data: T[],
  range: DateRange,
  dateKey: string = "created_at"
): T[] {
  if (!range.from) return data;
  return data.filter((item) => {
    const d = new Date(item[dateKey]);
    if (range.from && d < range.from) return false;
    if (range.to && d > new Date(range.to.getTime() + 86400000)) return false;
    return true;
  });
}
