import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/components/admin/homeHub/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lines } from "@/components/Lines";
import { Loader2 } from "lucide-react";

// Invite to the family cookbook (Basil owns it). Talks to the admin-only `family-admin` edge function. Nothing here ever
// holds or shows a Bestly Cloud password, and nothing is emailed until the "Send from jared@bestly.tech" tap.

type Seat = "mom" | "mariah";
interface Member {
  role: string; name: string | null; last_name: string | null; nc_uid: string | null; email: string | null; status: string | null;
  invited_at: string | null; first_sign_in_at: string | null; last_sign_in_at: string | null;
}
interface Overview {
  members: Member[]; paid: { on: boolean; cap: number; spent: number; ok: boolean; month: string } | null;
  lastPurge: { at: string; ok: boolean; recipes: number; photos: number; captures: number } | null;
  unsynced: number | null; waiting: number | null; familyRecipes: number | null;
}
interface Reply { ok?: boolean; error?: string; needsAdmin?: boolean; [k: string]: unknown }

async function admin(op: string, body: Record<string, unknown> = {}): Promise<Reply> {
  const { data, error } = await supabase.functions.invoke("family-admin", { body: { op, ...body } });
  if (error) {
    // A 409 (needs Jared's admin password) still carries a readable body.
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") { try { return (await ctx.json()) as Reply; } catch { /* fall through */ } }
    return { ok: false, error: error.message };
  }
  return (data ?? { ok: false, error: "No answer." }) as Reply;
}

const SEAT_LABEL: Record<Seat, string> = { mom: "Mom", mariah: "Mariah" };
const STATUS_WORDS: Record<string, string> = { invited: "Account linked, welcome not sent yet", active: "Signed in", pending: "Not set up yet" };
const when = (s: string | null) => (s ? new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null);

export default function FamilyInviteCard() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [seat, setSeat] = useState<Seat>("mom");
  const [name, setName] = useState(""); const [last, setLast] = useState(""); const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [needsAdmin, setNeedsAdmin] = useState<string | null>(null);
  const [subject, setSubject] = useState(""); const [text, setText] = useState("");
  const [confirmSend, setConfirmSend] = useState(false);
  const [cap, setCap] = useState("3");

  const load = useCallback(async () => {
    const r = await admin("overview");
    if (!r.ok) { setErr(String(r.error ?? "Could not load.")); return; }
    setErr(null); setOv(r as unknown as Overview);
  }, []);
  useEffect(() => { load(); }, [load]);

  const member = ov?.members?.find((m) => m.role === seat) ?? null;
  useEffect(() => {
    setName(member?.name ?? ""); setLast(member?.last_name ?? ""); setEmail(member?.email ?? "");
    setSteps([]); setNeedsAdmin(null); setSubject(""); setText(""); setConfirmSend(false);
  }, [seat, member?.name, member?.last_name, member?.email]);
  useEffect(() => { if (ov?.paid) setCap(String(ov.paid.cap)); }, [ov?.paid?.cap]);

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try { await fn(); } catch (e) { toast.error(e instanceof Error ? e.message : "Something went wrong."); } finally { setBusy(null); }
  };

  const save = () => run("save", async () => {
    const r = await admin("save_member", { role: seat, name, last_name: last, email });
    if (!r.ok) { toast.error(String(r.error)); return; }
    toast.success("Saved."); await load();
  });
  const makeAccount = () => run("account", async () => {
    setNeedsAdmin(null);
    const r = await admin("create_account", { role: seat });
    if (r.needsAdmin) { setNeedsAdmin(String(r.error ?? "")); return; }
    if (!r.ok) { toast.error(String(r.error)); return; }
    setSteps((r.steps as string[]) ?? []); toast.success("Account linked. No email was sent."); await load();
  });
  const draft = () => run("draft", async () => {
    const r = await admin("draft", { role: seat });
    if (!r.ok) { toast.error(String(r.error)); return; }
    setSubject(String(r.subject ?? "")); setText(String(r.text ?? "")); setConfirmSend(false);
  });
  const send = () => run("send", async () => {
    const r = await admin("send_welcome", { role: seat, subject, text });
    if (!r.ok) { toast.error(String(r.error)); return; }
    toast.success(`Sent to ${String(r.sentTo ?? email)}.`); setConfirmSend(false); await load();
  });
  const savePaid = (on: boolean) => run("paid", async () => {
    const r = await admin("set_paid", { on, cap: Number(cap) });
    if (!r.ok) { toast.error(String(r.error)); return; }
    toast.success(on ? "Paid reader is on." : "Paid reader is off."); await load();
  });

  const linked = !!member?.nc_uid;
  return (
    <Panel title="Invite to the family cookbook">
      <p className="text-sm text-white/60 mb-4"><Lines>{"Mom and Mariah sign in with their own Bestly Cloud accounts at bestly.tech/cookbook."}</Lines></p>
      {err && <p className="text-sm text-destructive" role="alert">{err}</p>}
      {!ov && !err && <p className="text-sm text-white/60 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Loading</p>}
      {ov && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-2 sm:w-72" role="group" aria-label="Who">
            {(["mom", "mariah"] as Seat[]).map((s) => (
              <Button key={s} type="button" variant={seat === s ? "default" : "outline"} className="h-12" aria-pressed={seat === s} onClick={() => setSeat(s)}>{SEAT_LABEL[s]}</Button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="fc-name">First name</Label><Input id="fc-name" className="h-12" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></div>
            <div className="space-y-1.5"><Label htmlFor="fc-last">Last name</Label><Input id="fc-last" className="h-12" value={last} onChange={(e) => setLast(e.target.value)} autoComplete="off" /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="fc-email">Email</Label><Input id="fc-email" className="h-12" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></div>
          </div>
          <p className="text-sm text-white/60"><Lines>{"The last name decides the home screen name. Harris shows Harris Cookbook. Best shows Best Cookbook."}</Lines></p>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" className="h-12" onClick={save} disabled={!!busy}>{busy === "save" ? "Saving" : "Save"}</Button>
            <Button type="button" variant="outline" className="h-12" onClick={makeAccount} disabled={!!busy || !member?.name}>{busy === "account" ? "Working" : linked ? "Check the account again" : "Link the Bestly Cloud account"}</Button>
          </div>

          <div className="rounded-xl bg-white/[0.04] p-4 space-y-1 text-sm">
            <div><span className="text-white/60">Status:</span> {STATUS_WORDS[member?.status ?? "pending"] ?? member?.status}</div>
            {member?.nc_uid && <div><span className="text-white/60">Username:</span> <span className="font-mono">{member.nc_uid}</span></div>}
            {when(member?.first_sign_in_at ?? null) && <div><span className="text-white/60">First sign-in:</span> {when(member!.first_sign_in_at)}</div>}
            {when(member?.last_sign_in_at ?? null) && <div><span className="text-white/60">Last sign-in:</span> {when(member!.last_sign_in_at)}</div>}
          </div>

          {steps.length > 0 && <ul className="text-sm list-disc pl-5 space-y-1">{steps.map((s) => <li key={s}>{s}</li>)}</ul>}

          {needsAdmin && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm space-y-2" role="status">
              <p className="font-medium">Bestly Cloud needs you to make this account once.</p>
              <p><Lines>{needsAdmin}</Lines></p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>Open Bestly Cloud, Users, New account. Use the username below and the display name {name} {last}.</li>
                <li>Leave the email box empty so Bestly Cloud sends nothing. Put the account in the Family group.</li>
                <li>Come back here and tap the link button again. It finds the account and shares the folders.</li>
              </ol>
              <p className="text-white/60">Suggested username: <span className="font-mono">{(name || SEAT_LABEL[seat]).toLowerCase().replace(/[^a-z0-9]/g, "")}</span></p>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" className="h-12" onClick={draft} disabled={!!busy || !linked || !member?.email}>{busy === "draft" ? "Writing" : "Write the welcome email"}</Button>
              {!linked && <span className="text-sm text-white/60">Link the account first.</span>}
            </div>
            {text && (
              <div className="space-y-3">
                <div className="space-y-1.5"><Label htmlFor="fc-sub">Subject</Label><Input id="fc-sub" className="h-12" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
                <div className="space-y-1.5">
                  <Label htmlFor="fc-body">Message to {member?.email}</Label>
                  <textarea id="fc-body" className="w-full min-h-[22rem] rounded-md border border-input bg-background p-3 text-base leading-relaxed" value={text} onChange={(e) => setText(e.target.value)} />
                </div>
                <p className="text-sm text-white/60"><Lines>{"It goes from jared@bestly.tech with your Bestly signature. Sending also puts this email on the Bestly Cloud account, so Forgot password works."}</Lines></p>
                {!confirmSend
                  ? <Button type="button" className="h-12" onClick={() => setConfirmSend(true)} disabled={!!busy}>Send from jared@bestly.tech</Button>
                  : (
                    <div className="flex flex-wrap items-center gap-3">
                      <Button type="button" className="h-12" onClick={send} disabled={!!busy}>{busy === "send" ? "Sending" : `Yes, send it to ${SEAT_LABEL[seat]} now`}</Button>
                      <Button type="button" variant="ghost" className="h-12" onClick={() => setConfirmSend(false)} disabled={!!busy}>Not yet</Button>
                    </div>
                  )}
              </div>
            )}
          </div>

          <div className="rounded-xl bg-white/[0.04] p-4 text-sm space-y-2">
            <p className="font-medium">What happens the first time they sign in</p>
            <p><Lines>{"They tap Sign in with Bestly Cloud. The account has a password nobody has seen, so on the Bestly Cloud page they tap Forgot password, type their username, and choose a password from the message Bestly Cloud sends them. A passkey can be added after that under Settings, Security. A password always comes first."}</Lines></p>
          </div>

          <div className="space-y-3">
            <p className="font-medium text-sm">Paid reader (backup for hard-to-read cards)</p>
            <p className="text-sm text-white/60"><Lines>{"The free reader goes first. When it is unsure, one cheap paid pass can try. Once this month's spend reaches the cap, cards go to Needs a look instead."}</Lines></p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5 w-28"><Label htmlFor="fc-cap">Monthly cap</Label><Input id="fc-cap" className="h-12" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} /></div>
              <Button type="button" className="h-12" variant={ov.paid?.on ? "outline" : "default"} onClick={() => savePaid(!ov.paid?.on)} disabled={!!busy}>{ov.paid?.on ? "Turn off" : "Turn on"}</Button>
              {ov.paid?.on && <Button type="button" variant="outline" className="h-12" onClick={() => savePaid(true)} disabled={!!busy}>Save cap</Button>}
            </div>
            <p className="text-sm text-white/60">
              {ov.paid ? `This month (${ov.paid.month}): $${Number(ov.paid.spent).toFixed(2)} of $${Number(ov.paid.cap).toFixed(2)}. ${ov.paid.on ? (ov.paid.ok ? "On." : "Cap reached, so it is paused.") : "Off."}` : ""}
            </p>
          </div>

          <p className="text-sm text-white/60">
            {`${ov.familyRecipes ?? 0} family recipes. ${ov.waiting ?? 0} cards waiting. ${ov.unsynced ?? 0} photos not in Bestly Cloud Files yet.`}
            {ov.lastPurge ? ` Last clean-up of deleted items: ${when(ov.lastPurge.at)}${ov.lastPurge.ok ? "" : " (it failed)"}.` : ""}
          </p>
        </div>
      )}
    </Panel>
  );
}
