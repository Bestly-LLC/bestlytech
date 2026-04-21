import { useMemo } from "react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  Legend,
} from "recharts";
import { Activity } from "lucide-react";

interface PipelineHealthRingProps {
  data: Array<{ status: string; count: number }>;
  successRate: number;
}

const STATUS_COLORS: Record<string, string> = {
  success: "#10b981",
  success_cmp_fallback: "#34d399",
  success_cmp_fingerprint: "#6ee7b7",
  success_gemini_failsafe: "#059669",
  success_probe: "#14b8a6",
  success_consensus: "#2dd4bf",
  error: "#ef4444",
  permanently_failed: "#991b1b",
  skipped_no_html: "#6b7280",
  needs_manual_review: "#f59e0b",
  failed_not_cookie_banner: "#fb7185",
};

const DEFAULT_COLOR = "#4b5563";

function getStatusColor(status: string): string {
  return STATUS_COLORS[status] ?? DEFAULT_COLOR;
}

function formatStatusLabel(status: string): string {
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function CustomTooltipContent({
  active,
  payload,
  total,
}: {
  active?: boolean;
  payload?: Array<{ payload: { status: string; count: number } }>;
  total: number;
}) {
  if (!active || !payload?.length) return null;
  const { status, count } = payload[0].payload;
  const pct = total > 0 ? ((count / total) * 100).toFixed(1) : "0.0";

  return (
    <div className="bg-[#1a1a1a] border border-white/[0.1] rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs font-medium text-white">{formatStatusLabel(status)}</p>
      <p className="text-[11px] text-white/60 mt-0.5">
        {count.toLocaleString()} runs ({pct}%)
      </p>
    </div>
  );
}

function CustomLegendContent({
  payload,
}: {
  payload?: Array<{ value: string; color: string }>;
}) {
  if (!payload?.length) return null;
  return (
    <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-1 px-2">
      {payload.map((entry) => (
        <span key={entry.value} className="inline-flex items-center gap-1 text-[10px] text-white/50">
          <span
            className="inline-block h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          {formatStatusLabel(entry.value)}
        </span>
      ))}
    </div>
  );
}

export function PipelineHealthRing({ data, successRate }: PipelineHealthRingProps) {
  const total = useMemo(() => data.reduce((sum, d) => sum + d.count, 0), [data]);

  const rateColor =
    successRate >= 70
      ? "text-emerald-400"
      : successRate >= 50
        ? "text-amber-400"
        : "text-red-400";

  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <div className="h-8 w-8 rounded-xl bg-white/[0.05] flex items-center justify-center">
          <Activity className="h-4 w-4 text-white/40" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-white">AI Pipeline Health</h3>
          <p className="text-[10px] text-white/25">
            {total.toLocaleString()} total runs
          </p>
        </div>
      </div>

      {/* Chart */}
      <div className="relative" style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="status"
              cx="50%"
              cy="50%"
              innerRadius="58%"
              outerRadius="82%"
              paddingAngle={1.5}
              strokeWidth={0}
            >
              {data.map((entry) => (
                <Cell key={entry.status} fill={getStatusColor(entry.status)} />
              ))}
            </Pie>
            <RechartsTooltip
              content={<CustomTooltipContent total={total} />}
              cursor={false}
            />
            <Legend
              content={<CustomLegendContent />}
              verticalAlign="bottom"
            />
          </PieChart>
        </ResponsiveContainer>

        {/* Center label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none" style={{ marginBottom: 30 }}>
          <span className={`text-2xl font-bold tabular-nums ${rateColor}`}>
            {successRate.toFixed(1)}%
          </span>
          <span className="text-[10px] text-white/30 font-medium">Success</span>
        </div>
      </div>
    </div>
  );
}
