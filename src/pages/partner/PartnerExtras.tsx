/**
 * Partner portal extras:
 *   PartnerBell      Studio notifications (same feed and read state as Studio) with an unread count
 *   ConnectClaude    "Connect my Claude": a private connector link for Claude (partner-mcp)
 *   useNextMeeting   the next calendar event with Eli, from Jared's Nextcloud calendar (next-meeting)
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Check, ExternalLink, Link2, Loader2, Plug, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { CopyButton } from "@/components/CopyText";
import { cn } from "@/lib/utils";
import { playNotifySound } from "@/lib/notifySound";

const STUDIO = "https://studio.bestly.tech";

/* ───────── Studio notifications ───────── */

interface Notif { id: string; kind: string; subject: string | null; body: string | null; link: string | null; at: string; unread: boolean }

/** asRoster: the admin viewing a partner's screen sees that partner's Studio bell (read-only). */
export function usePartnerNotifs(asRoster?: string | null) {
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [linked, setLinked] = useState(true);
  // Only a rise counts: reloads and marking things read must stay silent.
  const seen = useRef<number | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase.rpc("partner_studio_notifications" as never, (asRoster ? { p_roster: asRoster } : {}) as never);
    const d = (data ?? {}) as { ok?: boolean; unread?: number; items?: Notif[] };
    setLinked(d.ok !== false);
    setItems(d.items ?? []);
    const n = d.unread ?? 0;
    if (seen.current !== null && n > seen.current && !asRoster) playNotifySound();
    seen.current = n;
    setUnread(n);
  }, [asRoster]);
  useEffect(() => {
    load();
    const t = window.setInterval(() => { if (!document.hidden) load(); }, 60_000);
    const back = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", back);
    return () => { window.clearInterval(t); document.removeEventListener("visibilitychange", back); };
  }, [load]);
  const markSeen = useCallback(async () => {
    setUnread(0);
    setItems((xs) => xs.map((x) => ({ ...x, unread: false })));
    if (!asRoster) await supabase.rpc("partner_studio_seen" as never);  // viewing as him never clears his bell
  }, [asRoster]);
  return { items, unread, linked, markSeen, reload: load };
}

const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};

export function BellButton({ notifs, onClick, className }: { notifs: ReturnType<typeof usePartnerNotifs>; onClick: () => void; className?: string }) {
  return (
    <button onClick={onClick} aria-label={notifs.unread ? `${notifs.unread} new from Studio` : "Studio notifications"}
      className={cn("relative grid h-10 w-10 place-items-center rounded-full text-white/65 hover:bg-white/[0.06]", className)}>
      <Bell className="h-[18px] w-[18px]" />
      {notifs.unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-red-500 px-1 text-center text-[10px] font-bold leading-[18px] text-[#fff]">{notifs.unread > 99 ? "99+" : notifs.unread}</span>
      )}
    </button>
  );
}

export function BellSheet({ notifs, open, onOpenChange }: { notifs: ReturnType<typeof usePartnerNotifs>; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
      <Sheet open={open} onOpenChange={(o) => { onOpenChange(o); if (!o && notifs.unread) notifs.markSeen(); }}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 border-white/10 bg-[#0b0d12] p-0 text-white sm:max-w-md bento:bg-[#F3F2EE]">
          <div className="flex items-center justify-between border-b border-white/[0.08] px-5 pb-3 pt-5">
            <div>
              <SheetTitle className="text-lg font-semibold text-white">From Studio</SheetTitle>
              <SheetDescription className="text-xs text-white/50">Same notifications as in Studio. Reading them here marks them read there too.</SheetDescription>
            </div>
          </div>
          <div className="flex gap-2 px-5 py-3">
            <a href={STUDIO} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 px-4 text-sm font-semibold text-[#fff]">
              Open Studio <ExternalLink className="h-3.5 w-3.5" />
            </a>
            {notifs.unread > 0 && (
              <button onClick={notifs.markSeen} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/[0.08] px-3.5 text-sm text-white/80"><Check className="h-4 w-4" /> Mark all read</button>
            )}
          </div>
          <ul className="min-h-0 flex-1 divide-y divide-white/[0.06] overflow-y-auto">
            {!notifs.linked ? <li className="px-5 py-8 text-sm text-white/55">Your Studio account isn't linked to this portal yet. Ask Jared.</li>
              : notifs.items.length === 0 ? <li className="px-5 py-8 text-sm text-white/55">Nothing new from Studio.</li>
              : notifs.items.map((n) => (
                <li key={n.id}>
                  <a href={n.link || STUDIO} target="_blank" rel="noreferrer" className={cn("block px-5 py-3.5 transition hover:bg-white/[0.04]", n.unread && "bg-[#0A84FF]/[0.06]")}>
                    <div className="flex items-start gap-2">
                      <p className={cn("flex-1 text-sm leading-snug", n.unread ? "font-semibold text-white" : "text-white/80")}>{n.subject || n.kind.replace(/_/g, " ")}</p>
                      <span className="shrink-0 text-[11px] text-white/40">{ago(n.at)}</span>
                      {n.unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#0A84FF]" />}
                    </div>
                    {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-white/55">{n.body}</p>}
                  </a>
                </li>
              ))}
          </ul>
        </SheetContent>
      </Sheet>
  );
}

/* ───────── Connect my Claude ───────── */

interface Conn { id: string; label: string; created_at: string; last_used_at: string | null }
const MCP = "https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/partner-mcp/";

export function ConnectClaude({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [conns, setConns] = useState<Conn[] | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase.rpc("partner_connector_list" as never);
    setConns((data ?? []) as unknown as Conn[]);
  }, []);
  useEffect(() => { if (open) { load(); setFresh(null); setErr(null); } }, [open, load]);
  const make = async () => {
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("partner_connector_create" as never, { p_label: "Claude" } as never);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setFresh(MCP + (data as { key: string }).key);
    load();
  };
  // Two taps instead of window.confirm(): the desktop app and some in-app browsers silently
  // block native dialogs, which made the delete button look dead.
  const [arming, setArming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  useEffect(() => { if (!arming) return; const t = window.setTimeout(() => setArming(null), 4000); return () => window.clearTimeout(t); }, [arming]);
  const remove = async (id: string) => {
    if (arming !== id) { setArming(id); return; }
    setArming(null); setRemoving(id); setErr(null);
    const { data, error } = await supabase.rpc("partner_connector_revoke" as never, { p_id: id } as never);
    setRemoving(null);
    if (error || data === false) { setErr(error?.message ?? "Couldn't remove that one. Refresh and try again."); load(); return; }
    setConns((cs) => (cs ?? []).filter((c) => c.id !== id));
    setFresh(null);
    load();
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto border-white/10 bg-[#0b0d12] p-6 text-white sm:max-w-md bento:bg-[#F3F2EE]">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-orange-400 to-amber-600 text-[#fff]"><Plug className="h-6 w-6" /></span>
        <SheetTitle className="mt-4 text-xl font-semibold text-white">Connect my Claude</SheetTitle>
        <SheetDescription className="mt-1 text-sm leading-relaxed text-white/60">
          Let your own Claude read this portal: your calls with Jared, to-dos, Jared's emails and files, and the pipeline. It can tick off your to-dos, nothing else.
        </SheetDescription>

        {fresh ? (
          <div className="mt-5 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4">
            <p className="text-sm font-semibold text-white">Your private link (shown once)</p>
            <code className="mt-2 block select-all break-all rounded-lg bg-black/40 p-2.5 font-mono text-[12px] text-white bento:bg-[#fff]">{fresh}</code>
            <CopyButton text={fresh} label="Copy link" className="mt-3" />
            <p className="mt-2 text-xs text-white/55">Treat it like a password: anyone with it can read your portal. Remove it below any time.</p>
          </div>
        ) : (
          <button onClick={make} disabled={busy} className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-white text-[0.975rem] font-semibold text-black disabled:opacity-50 bento:bg-[#111114] bento:text-[#fff]">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Make my link
          </button>
        )}
        {err && <p role="alert" className="mt-2 text-sm text-red-400">{err}</p>}

        <ol className="mt-6 space-y-3 text-sm text-white/75">
          {["Tap Make my link, then Copy link.", "In Claude, open Settings, then Connectors, then Add custom connector.", "Name it Bestly Partner, paste the link, and tap Add.", "Ask Claude things like \"What's on my plate from my calls with Jared?\""].map((t, i) => (
            <li key={i} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/[0.08] text-xs font-semibold">{i + 1}</span><span className="pt-0.5">{t}</span></li>
          ))}
        </ol>

        <h3 className="mt-8 text-xs font-semibold uppercase tracking-widest text-white/45">Connected</h3>
        {conns === null ? <Loader2 className="mt-3 h-5 w-5 animate-spin text-white/40" /> : conns.length === 0 ? <p className="mt-2 text-sm text-white/50">Nothing connected yet.</p> : (
          <ul className="mt-2 divide-y divide-white/[0.06] rounded-2xl bg-white/[0.04] bento:bg-[#fff]">
            {conns.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white">{c.label}</p>
                  <p className="text-xs text-white/45">Made {new Date(c.created_at).toLocaleDateString()} · {c.last_used_at ? `last used ${ago(c.last_used_at)} ago` : "not used yet"}</p>
                </div>
                <button onClick={() => remove(c.id)} disabled={removing === c.id}
                  aria-label={arming === c.id ? "Tap again to disconnect" : "Disconnect"}
                  className={cn("inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full text-sm font-medium transition disabled:opacity-50",
                    arming === c.id ? "bg-red-500 px-3.5 text-[#fff]" : "w-9 text-white/50 hover:bg-white/[0.06] hover:text-red-400")}>
                  {removing === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  {arming === c.id && "Remove"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ───────── next meeting ───────── */

export interface NextEvent { title: string; start: string; end: string | null; join_url: string | null; calendar: string }

export function useNextMeeting() {
  const [next, setNext] = useState<NextEvent | null | undefined>(undefined);
  const [events, setEvents] = useState<NextEvent[]>([]);
  useEffect(() => {
    let gone = false;
    const load = async () => {
      const { data } = await supabase.functions.invoke("next-meeting", { body: {} });
      if (gone) return;
      setNext((data?.next as NextEvent) ?? null);
      setEvents((data?.events as NextEvent[]) ?? []);
    };
    load();
    const t = window.setInterval(load, 10 * 60_000);
    return () => { gone = true; window.clearInterval(t); };
  }, []);
  return { next, events };
}

export function whenLabel(iso: string) {
  const d = new Date(iso), now = new Date();
  const mins = Math.round((d.getTime() - now.getTime()) / 60000);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
  if (mins <= 0 && mins > -90) return "Happening now";
  if (mins < 60) return `In ${mins} min`;
  const day = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/Los_Angeles" });
  const today = now.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/Los_Angeles" });
  return day === today ? `Today ${time}` : `${day} ${time}`;
}
