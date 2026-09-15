import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ExportColumn = { key: string; label: string };

interface ExportButtonProps {
  data: Record<string, any>[];
  filename: string;
  columns?: ExportColumn[];
  /** Button text. Defaults to "Export CSV". */
  label?: string;
  className?: string;
}

// Spreadsheet apps execute cells that start with these characters as formulas.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function cell(val: unknown): string {
  if (val == null) return '""';
  let s = String(val);
  if (FORMULA_PREFIX.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(data: Record<string, any>[], columns?: ExportColumn[]): string {
  if (data.length === 0) return "";
  const cols = columns ?? Object.keys(data[0]).map((k) => ({ key: k, label: k }));
  const header = cols.map((c) => cell(c.label)).join(",");
  const rows = data.map((row) => cols.map((c) => cell(row[c.key])).join(","));
  return [header, ...rows].join("\n");
}

/**
 * Download rows as a CSV file. Returns the number of rows written so callers
 * (e.g. an ActionMenu item) can confirm with a toast.
 */
export function downloadCsv(data: Record<string, any>[], filename: string, columns?: ExportColumn[]): number {
  if (data.length === 0) return 0;
  const csv = toCsv(data, columns);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return data.length;
}

export function ExportButton({ data, filename, columns, label = "Export CSV", className }: ExportButtonProps) {
  const empty = data.length === 0;
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => downloadCsv(data, filename, columns)}
      disabled={empty}
      title={empty ? "Nothing to export" : `Download ${data.length} rows as CSV`}
      className={cn("h-9 border-white/10 text-white/80 hover:text-white hover:bg-white/5", className)}
    >
      <Download className="h-4 w-4 mr-1.5" aria-hidden="true" />
      {label}
    </Button>
  );
}
