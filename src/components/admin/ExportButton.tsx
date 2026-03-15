import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ExportButtonProps {
  data: Record<string, any>[];
  filename: string;
  columns?: { key: string; label: string }[];
}

function toCsv(data: Record<string, any>[], columns?: { key: string; label: string }[]): string {
  if (data.length === 0) return "";
  const cols = columns ?? Object.keys(data[0]).map((k) => ({ key: k, label: k }));
  const header = cols.map((c) => `"${c.label}"`).join(",");
  const rows = data.map((row) =>
    cols.map((c) => {
      const val = row[c.key];
      if (val == null) return '""';
      return `"${String(val).replace(/"/g, '""')}"`;
    }).join(",")
  );
  return [header, ...rows].join("\n");
}

export function ExportButton({ data, filename, columns }: ExportButtonProps) {
  const handleExport = () => {
    const csv = toCsv(data, columns);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Button variant="outline" size="sm" onClick={handleExport} disabled={data.length === 0}>
      <Download className="h-4 w-4 mr-1.5" />
      Export CSV
    </Button>
  );
}
