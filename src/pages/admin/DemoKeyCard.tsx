/** Turo settings > Demo key: the demo trip pages carry a REAL Tesla key for the host. Demo drivers auto-remove. */
import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CopyButton } from "@/components/CopyText";
import { cn } from "@/lib/utils";
import { Segmented, Switch, btnDestructivePlain, btnPlain, btnTinted, card, label, secondary, tertiary } from "./laxUi";

type Driver = { share_user_id: string; name: string | null; accepted_at: string; remove_at: string; removed_at: string | null; last_error: string | null };
type State = { enabled: boolean; pass: string; keep_minutes: number; status: string; invite_expires_at: string | null; last_error: string | null; drivers: Driver[]; busy: boolean };
const t12 = (s: string) => new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (a: string, v?: string) => supabase.rpc("demo_key_admin" as never, { p_action: a, p_value: v ?? null } as never) as unknown as Promise<{ data: any; error: { message: string } | null }>;

export function DemoKeyCard() {
  const [s, setS] = useState<State | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async (a = "get", v?: string) => {
    if (a !== "get") setBusy(a);
    const { data, error } = await call(a, v);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    setS(data as State);
    if (a === "remove_all") toast.success("Removing demo drivers from Blue Steel now.");
    if (a === "new_pass") toast.success("New host link. The old one stops working.");
  }, []);
  useEffect(() => { run(); const id = window.setInterval(() => run(), 20000); return () => window.clearInterval(id); }, [run]);
  if (!s) return <div className={cn(card, "h-32 animate-pulse")} />;
  const link = (k: string) => `${window.location.origin}/t/demo-${k}?stage=${k === "home" ? "key-ready" : "day-of"}&dk=${s.pass}`;
  const on = s.drivers.filter((d) => !d.removed_at);
  const status = !s.enabled ? "Off: demos use the pretend key" : s.status === "ready" ? `Ready · link good until ${t12(s.invite_expires_at!)}` : s.status === "creating" ? "Making a fresh key…" : s.status === "failed" ? `Couldn't make it: ${s.last_error ?? "unknown"}` : "Made when you open the demo";
  return (
    <div className={cn(card, "flex flex-col gap-4")} id="demo-key">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" aria-hidden />
        <div className="min-w-0">
          <p className={cn("text-[15px] font-semibold", label)}>Real key on the demo</p>
          <p className={cn("text-[13px]", secondary)}>Only you see it (signed in here, or with the host link below). Everyone else gets the pretend key. Whoever adds it is removed from Blue Steel automatically.</p>
        </div>
      </div>
      <Switch checked={s.enabled} onChange={(v) => run(v ? "on" : "off")} label="Real key on demo pages" detail={status} disabled={!!busy} />
      <div className="flex flex-wrap items-center gap-3">
        <span className={cn("text-[13px]", secondary)}>Remove drivers after</span>
        <Segmented ariaLabel="Remove after" value={String(s.keep_minutes)} onChange={(v) => run("keep", v)}
          options={[{ value: "60", label: "1 hr" }, { value: "120", label: "2 hr" }, { value: "1440", label: "24 hr" }]} />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="shrink-0 rounded-xl bg-white p-2"><QRCodeSVG value={link("home")} size={96} /></div>
        <div className="flex min-w-0 flex-col gap-2">
          <p className={cn("text-[13px]", secondary)}>Host link: scan on the phone with the Tesla app. Don't send it to guests.</p>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={link("home")} label="Copy Home link" className={cn(btnTinted, "h-auto px-3")} />
            <CopyButton text={link("lax")} label="Copy LAX link" className={cn(btnTinted, "h-auto px-3")} />
          </div>
          <button type="button" className={cn(btnPlain, "self-start text-[13px]")} onClick={() => run("new_pass")} disabled={!!busy}>New host link (old one stops working)</button>
        </div>
      </div>
      <div>
        <p className={cn("mb-1 text-[13px] font-semibold", label)}>Added from the demo</p>
        {s.drivers.length === 0 ? <p className={cn("text-[13px]", tertiary)}>No one yet.</p> : (
          <ul className="space-y-1">
            {s.drivers.slice(0, 5).map((d) => (
              <li key={d.share_user_id} className={cn("text-[13px]", d.removed_at ? tertiary : secondary)}>
                {d.name ?? "Driver"} · added {t12(d.accepted_at)} · {d.removed_at ? `removed ${t12(d.removed_at)}` : d.last_error ? <span className="text-[#FF453A]">{d.last_error}</span> : `removed at ${t12(d.remove_at)}`}
              </li>
            ))}
          </ul>
        )}
        {on.length > 0 && (
          <button type="button" className={cn(btnDestructivePlain, "mt-2")} onClick={() => run("remove_all")} disabled={!!busy}>
            {busy === "remove_all" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Remove demo drivers now
          </button>
        )}
      </div>
    </div>
  );
}
