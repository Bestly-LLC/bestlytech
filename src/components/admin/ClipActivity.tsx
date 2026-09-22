/**
 * The clip-upload live activity: a pill in the admin header, on every page, that
 * shows what's still moving and gets out of the way when it's done.
 *
 * It reads the module-level upload queue (pages/admin/clipUploads), so it keeps
 * counting while Jared is off looking at something else.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { subscribeClipUploads, dismissUpload, cancelUpload, type ClipUpload } from "@/pages/admin/clipUploads";

const mb = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(0)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

export function ClipActivity() {
  const [ups, setUps] = useState<ClipUpload[]>([]);
  useEffect(() => subscribeClipUploads(setUps), []);

  const live = ups.filter((u) => u.status !== "done");
  if (!live.length) return null;

  const moving = live.filter((u) => u.status === "uploading" || u.status === "saving");
  const failed = live.filter((u) => u.status === "error");
  const sent = moving.reduce((n, u) => n + u.sent, 0);
  const total = moving.reduce((n, u) => n + u.bytes, 0);
  const pct = total ? Math.min(99, Math.round((sent / total) * 100)) : 0;

  return (
    <div className="flex items-center gap-2">
      {!!moving.length && (
        <Link
          to="/admin/meetings?tab=clips"
          className="group relative flex items-center gap-2 overflow-hidden rounded-full border border-white/15 bg-white/[0.06] py-1.5 pl-3 pr-3.5 text-xs text-white/80 transition hover:bg-white/[0.12]"
          title={moving.map((u) => u.name).join("\n")}
        >
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 bg-[#0A84FF]/25 transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
          <Upload className="relative h-3.5 w-3.5 shrink-0" />
          <span className="relative tabular-nums">
            {moving.length > 1 ? `${moving.length} clips · ` : ""}
            {moving.some((u) => u.status === "saving") && moving.length === 1 ? "Saving" : `${pct}%`}
          </span>
          <span className="relative hidden text-white/45 sm:inline">of {mb(total)}</span>
          <button
            type="button"
            aria-label="Cancel upload"
            onClick={(e) => {
              e.preventDefault();
              for (const u of moving) cancelUpload(u.id);
            }}
            className="relative -mr-1 ml-0.5 rounded-full p-0.5 text-white/40 opacity-0 transition hover:text-white group-hover:opacity-100"
          >
            <X className="h-3 w-3" />
          </button>
        </Link>
      )}

      {failed.map((u) => (
        <span
          key={u.id}
          className={cn(
            "flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10",
            "py-1.5 pl-2.5 pr-2 text-xs text-red-200",
          )}
          title={`${u.name}: ${u.error ?? "failed"}`}
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="max-w-[9rem] truncate">{u.error ?? "Upload failed"}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismissUpload(u.id)}
            className="rounded-full p-0.5 text-red-200/60 transition hover:text-red-100"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
