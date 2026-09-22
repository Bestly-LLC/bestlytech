import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Apple, Chrome, Copy, Hand, Laptop, Loader2, Rocket } from "lucide-react";
import { CopyText, CopyButton } from "@/components/CopyText";
import releasePrompt from "../../../docs/cookie-yeti-extension/RELEASE-PROMPT.md?raw";

type Status = "not_started" | "building" | "uploaded" | "in_review" | "approved" | "live" | "rejected" | "blocked";
interface Release {
  channel: "mac" | "ios" | "chrome";
  version: string | null;
  status: Status;
  detail: string | null;
  needs_jared: string | null;
  store_url: string | null;
  updated_at: string;
}

// Not in the generated types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any };

const CHANNELS = [
  { key: "mac", label: "Mac App Store", icon: Laptop },
  { key: "ios", label: "iOS App Store", icon: Apple },
  { key: "chrome", label: "Chrome Web Store", icon: Chrome },
] as const;

const STATUS: Record<Status, { label: string; tone: string; step: number }> = {
  not_started: { label: "Not started", tone: "text-white/65 border-white/15", step: 0 },
  building: { label: "Building", tone: "text-sky-300 border-sky-500/30", step: 1 },
  uploaded: { label: "Uploaded", tone: "text-sky-300 border-sky-500/30", step: 2 },
  in_review: { label: "In review", tone: "text-amber-300 border-amber-500/30", step: 3 },
  approved: { label: "Approved", tone: "text-green-300 border-green-500/30", step: 4 },
  live: { label: "Live", tone: "text-green-300 border-green-500/30", step: 5 },
  rejected: { label: "Rejected", tone: "text-red-300 border-red-500/30", step: 3 },
  blocked: { label: "Blocked", tone: "text-red-300 border-red-500/30", step: 1 },
};

/** Cookie Yeti extension release: progress written by the Mac-side Claude, one row per store. */
export function CYReleaseTracker() {
  const [rows, setRows] = useState<Release[] | null>(null);
  const [clearing, setClearing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await db.from("cy_extension_releases").select("channel, version, status, detail, needs_jared, store_url, updated_at");
    if (!error) setRows((data ?? []) as Release[]);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("cy-extension-releases")
      .on("postgres_changes", { event: "*", schema: "public", table: "cy_extension_releases" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  if (!rows || rows.length === 0) return null;
  const byChannel = Object.fromEntries(rows.map((r) => [r.channel, r])) as Record<string, Release>;
  const allLive = rows.every((r) => r.status === "live");
  const notStarted = rows.every((r) => r.status === "not_started");
  const ask = rows.find((r) => r.needs_jared);
  const newest = rows.reduce((a, r) => (r.updated_at > a ? r.updated_at : a), "");
  // Once everything has been live for 3 days the card has done its job.
  if (allLive && Date.now() - new Date(newest).getTime() > 3 * 86400_000) return null;

  const done = async (r: Release) => {
    setClearing(r.channel);
    const { data, error } = await db.from("cy_extension_releases").update({ needs_jared: null }).eq("channel", r.channel).select("channel");
    setClearing(null);
    if (error || !data?.length) toast.error("Couldn't mark it done. Check admin access and try again.");
    else toast.success("Marked done. The Mac picks it up within 30 seconds.");
  };

  const copyPrompt = async () => {
    try { await navigator.clipboard.writeText(releasePrompt); toast.success("Release prompt copied"); }
    catch { toast.error("Couldn't copy. Open docs/cookie-yeti-extension/RELEASE-PROMPT.md instead."); }
  };

  return (
    <section aria-label="Extension release" className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-white">
            <Rocket className="h-4 w-4 text-white/60" aria-hidden />Extension release: click-loop fail-safe
          </h2>
          {ask ? (
            <div className="mt-1 text-sm text-white/80">
              <strong className="text-amber-200">Your turn:</strong>
              <CopyText text={ask.needs_jared ?? ""} className="mt-1" />
            </div>
          ) : (
          <p className="text-sm text-white/65 mt-1">
            {notStarted ? <><strong className="text-white/90">Next step:</strong> copy the prompt and paste it into Claude on your Mac. It does the rest.</>
              : allLive ? "Live everywhere."
              : "Claude on your Mac is working through it. Updates show here and in the bell."}
          </p>
          )}
        </div>
        {ask ? (
          <Button size="sm" onClick={() => done(ask)} disabled={clearing === ask.channel}>
            {clearing === ask.channel ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden /> : <Hand className="h-3.5 w-3.5 mr-1.5" aria-hidden />}Done
          </Button>
        ) : (
          <Button size="sm" variant={notStarted ? "default" : "outline"} onClick={copyPrompt} className={notStarted ? "" : "border-white/15 text-white/85 hover:text-white hover:bg-white/5"}>
            <Copy className="h-3.5 w-3.5 mr-1.5" aria-hidden />{notStarted ? "Copy Mac prompt" : "Copy prompt again"}
          </Button>
        )}
      </div>

      <ul className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
        {CHANNELS.map(({ key, label, icon: Icon }) => {
          const r = byChannel[key];
          if (!r) return null;
          const s = STATUS[r.status];
          return (
            <li key={key} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-sm text-white/90"><Icon className="h-4 w-4 text-white/60" aria-hidden />{label}</span>
                <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${s.tone}`}>{s.label}</span>
              </div>
              <div className="mt-2 h-1 rounded-full bg-white/[0.06] overflow-hidden" aria-hidden>
                <div className={`h-full ${r.status === "rejected" || r.status === "blocked" ? "bg-red-400" : "bg-green-400"}`} style={{ width: `${(s.step / 5) * 100}%` }} />
              </div>
              <div className="mt-2 flex items-start gap-2">
                <p className="min-w-0 flex-1 text-xs text-white/60 break-words">
                  {r.version ? `v${r.version} · ` : ""}{r.detail ?? ""}
                </p>
                {r.detail && <CopyButton text={r.detail} label="Copy" className="h-7 px-2.5 text-[11px]" />}
              </div>
              {r.store_url && <a href={r.store_url} target="_blank" rel="noreferrer" className="text-xs text-sky-300 hover:underline mt-1 inline-block">Open in store console</a>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
