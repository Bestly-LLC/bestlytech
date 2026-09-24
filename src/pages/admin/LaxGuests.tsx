/**
 * Guests card on /admin/turo/lax-pass: every upcoming Turo trip (from turo_trips) with its private
 * LAX link (/lax/t/<token>), the guest's reminder email, and "Send reminder now".
 * LAX trips get a link automatically (lax_guest_sync); home pickups can opt in with "Make LAX link".
 * Reminders go out from support@bestly.tech (wallet-pass op remind_due, cron lax-guest-tick every 10 min).
 */
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, Mail, Plane, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CopyButton } from "@/components/CopyText";
import { cn } from "@/lib/utils";

type Row = {
  reservation_id: number; first: string | null; last: string | null; starts_at: string; ends_at: string; lax: boolean;
  token: string | null; email: string | null; email_by: "guest" | "host" | null; reminder_at: string | null;
  reminder_sent_at: string | null; reminder_error: string | null; suggested_reminder_at: string;
};
const rpc = (fn: string, args?: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;
const card = "rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 bento:border-transparent bento:bg-[#fff] bento:rounded-[1.5rem]";
const SITE = "https://bestly.tech"; // short guest links: bestly.tech/t/<7 chars>
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Los_Angeles" });

function GuestRow({ r, reload }: { r: Row; reload: () => void }) {
  const [email, setEmail] = useState(r.email ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (action: string, p_email?: string) => {
    setBusy(action);
    const { error } = await rpc("lax_guest_admin_update", { p_reservation: r.reservation_id, p_action: action, p_email });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(action === "send_now" ? "Sending now from support@bestly.tech." : action === "email" ? "Saved. The reminder is scheduled." : "Link made.");
    reload();
  };
  const link = r.token ? `${SITE}/t/${r.token}` : null;
  const msg = link ? `Hi ${r.first ?? ""}! Here's how to pick up your Turo car at LAX, plus the QR code that opens the lobby door (you can add it to Apple or Google Wallet): ${link}` : "";
  const status = r.reminder_sent_at ? `Reminder sent ${when(r.reminder_sent_at)}`
    : r.reminder_error ? `Reminder failed: ${r.reminder_error.replace(/^gave up: /, "")}`
    : r.email && r.reminder_at ? `Reminder ${when(r.reminder_at)}${r.email_by === "guest" ? " (guest signed up)" : ""}`
    : `No email yet. Guests can add one on their page, or paste it here.`;
  return (
    <li className="py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium text-white bento:text-neutral-900">
          {r.first ?? "Guest"} {r.last ? r.last.slice(0, 1) + "." : ""}
          {r.lax ? <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-violet-500/20 px-2 py-0.5 text-[11px] text-violet-200 bento:bg-violet-100 bento:text-violet-800"><Plane className="h-3 w-3" />LAX</span>
            : <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/60 bento:bg-neutral-100 bento:text-neutral-500">Home pickup</span>}
        </p>
        <p className="text-sm text-white/55 bento:text-neutral-500">{when(r.starts_at)} → {when(r.ends_at)}</p>
      </div>
      {link ? (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <CopyButton text={msg} label="Copy message for Turo" />
            <CopyButton text={link} label="Copy link" />
            <a href={`/t/${r.token}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-white/60 hover:text-white bento:text-neutral-500">Open <ExternalLink className="h-3.5 w-3.5" /></a>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Mail className="h-4 w-4 text-white/40 bento:text-neutral-400" />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="guest email (optional)" type="email"
              className="h-9 w-64 max-w-full rounded-lg border border-white/10 bg-transparent px-2.5 text-sm text-white bento:border-neutral-200 bento:text-neutral-900" />
            {email !== (r.email ?? "") && (
              <button type="button" onClick={() => act("email", email)} disabled={!!busy} className="h-9 rounded-full bg-violet-500 px-4 text-sm font-medium text-white disabled:opacity-60">
                {busy === "email" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </button>
            )}
            {r.email && email === r.email && (
              <button type="button" onClick={() => act("send_now")} disabled={!!busy} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/15 px-4 text-sm text-white bento:border-neutral-200 bento:text-neutral-800">
                {busy === "send_now" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send reminder now
              </button>
            )}
          </div>
          <p className={cn("mt-1.5 text-xs", r.reminder_error ? "text-red-300 bento:text-red-600" : "text-white/45 bento:text-neutral-500")}>{status}</p>
        </>
      ) : (
        <button type="button" onClick={() => act("link")} disabled={!!busy} className="mt-2 text-sm text-violet-300 underline underline-offset-2 bento:text-violet-700">
          {busy === "link" ? "Making…" : "Make LAX link anyway"}
        </button>
      )}
    </li>
  );
}

export function LaxGuests() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const load = useCallback(async () => {
    const { data, error } = await rpc("lax_guest_admin_list");
    if (error) { toast.error(error.message); return; }
    setRows((data as Row[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <div className={card}>
      <p className="text-sm font-medium text-white bento:text-neutral-900">Guests</p>
      <p className="mt-0.5 text-xs text-white/50 bento:text-neutral-500">Each trip gets its own page: their name, times, weather, and the car's battery and cabin temp from an hour before pickup. Reminder emails come from support@bestly.tech.</p>
      {!rows ? <Loader2 className="mt-4 h-5 w-5 animate-spin text-white/50" /> : rows.length === 0
        ? <p className="mt-4 text-sm text-white/55 bento:text-neutral-500">No upcoming trips.</p>
        : <ul className="mt-2 divide-y divide-white/[0.06] bento:divide-neutral-100">{rows.map((r) => <GuestRow key={r.reservation_id} r={r} reload={load} />)}</ul>}
    </div>
  );
}
