/**
 * /admin/partners — who can use the partner portal (/partner) and their sign-in links.
 * One tap makes the login (first time) and a one-time link to text them. No email is sent.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, KeyRound, Link2, Loader2, MessageSquare, Power, Share2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/admin/PageHeader";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { PartnerMark } from "@/components/PartnerMark";

interface Row {
  id: string; name: string; email: string; roster_name: string; link_sent_at: string | null; meetings: number;
  user: { last_sign_in_at: string | null; disabled: boolean; has_password: boolean } | null;
}

const btn = "inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 text-sm font-medium transition active:scale-[0.97] disabled:opacity-50";
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
};

export default function AdminPartners() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("partner-admin", { body: { op: "list" } });
    if (error || !data?.ok) { toast.error(error?.message ?? data?.error ?? "Could not load partners"); setRows([]); return; }
    setRows(data.partners);
  }, []);
  useEffect(() => { load(); }, [load]);

  const makeLink = async (p: Row) => {
    setBusy(p.id);
    const { data, error } = await supabase.functions.invoke("partner-admin", { body: { op: "link", partner_id: p.id } });
    setBusy(null);
    if (error || !data?.ok) { toast.error(error?.message ?? data?.error ?? "Could not make a link"); return; }
    setLinks((l) => ({ ...l, [p.id]: data.url }));
    load();
  };
  const toggle = async (p: Row) => {
    setBusy(p.id);
    const op = p.user?.disabled ? "enable" : "disable";
    const { data, error } = await supabase.functions.invoke("partner-admin", { body: { op, partner_id: p.id } });
    setBusy(null);
    if (error || !data?.ok) toast.error(error?.message ?? data?.error ?? "Failed");
    else toast.success(op === "disable" ? "Access turned off" : "Access turned back on");
    load();
  };
  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); toast.success("Link copied"); } catch { toast.error("Could not copy"); }
  };
  const share = async (p: Row, url: string) => {
    const text = `Here's your Bestly partner login: ${url}\nIt's yours for 7 days and you can tap it more than once. You'll pick a password.`;
    if (navigator.share) { try { await navigator.share({ text }); return; } catch { /* cancelled */ } }
    copy(url);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-8">
      <PageHeader title="Partners" description="People who can sign in at bestly.tech/partner to see the calls they were on, their to-dos and the pipeline." />
      <a href="/partner" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-white/60 hover:text-white">
        Preview the partner portal <ExternalLink className="h-3.5 w-3.5" />
      </a>

      {rows === null ? (
        <div className="h-40 animate-pulse rounded-2xl border border-white/[0.06]" />
      ) : rows.map((p) => {
        const status = !p.user ? "No login yet" : p.user.disabled ? "Access off" : p.user.last_sign_in_at ? `Signed in ${ago(p.user.last_sign_in_at)}` : p.link_sent_at ? `Link made ${ago(p.link_sent_at)}, not used yet` : "Login made";
        const url = links[p.id];
        return (
          <section key={p.id} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 bento:border-transparent bento:bg-[#fff] bento:rounded-[1.5rem]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <PartnerMark watchCursor className="h-11 w-11 shrink-0" />
                <div>
                  <h2 className="text-lg font-semibold text-white">{p.name}</h2>
                  <p className="text-sm text-white/55">{p.email}</p>
                </div>
              </div>
              <span className={cn("rounded-full px-3 py-1 text-xs font-semibold",
                p.user?.disabled ? "bg-red-500/15 text-red-300 bento:text-red-700" : p.user?.last_sign_in_at ? "bg-emerald-500/15 text-emerald-300 bento:text-emerald-700" : "bg-white/[0.08] text-white/70")}>
                {status}
              </span>
            </div>

            <ul className="mt-4 space-y-1.5 text-sm text-white/70">
              <li className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-400" /> Calls they were on: <b className="text-white">{p.meetings}</b> (matched by the name "{p.roster_name}")</li>
              <li className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-400" /> To-dos from those calls, theirs and yours</li>
              <li className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-400" /> Cloud pipeline by name and stage, no money or contact details</li>
              <li className="flex items-center gap-2 text-white/45"><KeyRound className="h-4 w-4" /> Not the admin, Scout, mail, money or systems</li>
            </ul>

            <div className="mt-5 flex flex-wrap gap-2">
              <button className={cn(btn, "bg-white text-black bento:bg-[#111114] bento:text-[#fff]")} disabled={busy === p.id} onClick={() => makeLink(p)}>
                {busy === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                {p.user ? "New sign-in link" : "Create login and link"}
              </button>
              {p.user && (
                <button className={cn(btn, "text-white/70 hover:bg-white/[0.06]")} disabled={busy === p.id} onClick={() => toggle(p)}>
                  <Power className="h-4 w-4" /> {p.user.disabled ? "Turn access on" : "Turn access off"}
                </button>
              )}
            </div>

            {url && (
              <div className="mt-4 rounded-xl bg-white/[0.04] p-3 bento:bg-[var(--bento-well)]">
                <p className="break-all font-mono text-xs text-white/70">{url}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className={cn(btn, "min-h-[40px] bg-white/[0.08] text-white")} onClick={() => copy(url)}><Copy className="h-4 w-4" /> Copy</button>
                  <a className={cn(btn, "min-h-[40px] bg-white/[0.08] text-white")} href={`sms:&body=${encodeURIComponent(`Here's your Bestly partner login: ${url} (good for 7 days)`)}`}><MessageSquare className="h-4 w-4" /> Text it</a>
                  <button className={cn(btn, "min-h-[40px] bg-white/[0.08] text-white")} onClick={() => share(p, url)}><Share2 className="h-4 w-4" /> Share</button>
                </div>
                <p className="mt-2 text-xs text-white/45">Good for 7 days, and it can be opened more than once. On first open they choose a password. Making a new link replaces this one.</p>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
