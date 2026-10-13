/**
 * Settings, inside Turo Watch (/admin/turo#settings). Jared 2026-10-13: "just inside of Turo Watch, not a tab".
 * Replaces the separate /admin/turo/settings page (old links redirect here).
 *
 *   1. LAX garage code: the live pass, and Parker (Parking Pass Clerk, Pi job lax_code_fetch) who now gets each month's
 *      active QR from Park My Share by himself. The Park My Share login is saved here, write-only (lax_fetch_connect).
 *      Adding a code by hand still works (drop, paste or choose a screenshot) for the rare day Parker can't.
 *   2. Guest pages: previews, demo key, trip health, pickup guide, the shared LAX link, guest steps, guest questions.
 *   3. The car's connections: TezLab, Tesla, Charging, Leo texting, Apple Wallet.
 *   4. History: past codes and Turo Watch's runs.
 *
 * Apple grouped sections from ./laxUi. Times are 12-hour Pacific; numbers never wrap away from their units.
 */
import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import { AlertTriangle, Check, CheckCircle2, ChevronRight, Eye, EyeOff, ImageUp, KeyRound, Loader2, Lock, RefreshCw, RotateCw } from "lucide-react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CopyButton } from "@/components/CopyText";
import { RunHistory } from "@/components/admin/turo/RunHistory";
import { cn } from "@/lib/utils";
import { TripHealth } from "./TripHealth";
import { DemoKeyCard } from "./DemoKeyCard";
import { GuestFunnel } from "./GuestFunnel";
import { GuestHelperCard, HelperSettings } from "./AskCard";
import { HostPassCard, TeslaCard } from "./TeslaCard";
import { TezLabCard } from "./TezLabCard";
import { ChargingCard } from "./ChargingCard";
import { LeoSmsCard } from "./LeoSmsCard";
import {
  Section, Segmented, btnDestructivePlain, btnPlain, btnPrimary, btnTinted, card, field, label, pill, secondary, separator, tertiary, tint,
} from "./laxUi";

const rpc = (fn: string, args?: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;
const SITE = "https://www.bestly.tech";

type CodeRow = { id: string; payload: string; valid_month: string; note: string | null; created_at: string; is_this_month?: boolean };
type Guide = { garage?: string; level?: string; spot?: string; shuttle?: string; after_hours?: string; car?: string };
type PassState = {
  slug: string; guide: Guide; month_now: string; current: CodeRow | null; history: CodeRow[];
  wallet_devices: number; last_push: { at: string; detail: { devices?: number; sent?: number; failed?: number } } | null;
};
type Parker = {
  configured: boolean; email_at: string | null; password_at: string | null; run_now_pending: boolean;
  last_try_at: string | null; last_ok_at: string | null; last_saved_at: string | null; last_kind: string | null;
  last_result: string | null; last_error: string | null; last_method: string | null; last_expires: string | null;
  facility: string | null; fails: number; job_seen_at: string | null; job_ok: boolean | null;
};

const TZ = "America/Los_Angeles";
const monthLabel = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const monthName = (iso: string) => monthLabel(iso).split(" ")[0];
const nextMonth = (iso: string) => { const [y, m] = iso.split("-").map(Number); return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`; };
// Non-breaking spaces so "Oct 13" and "12:53 PM" never split across lines (house rule: a number stays with its unit).
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ }).replace(/\s/g, "\u00a0");
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ }).replace(/\s/g, "\u00a0");
const isToday = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: TZ }) === new Date().toLocaleDateString("en-US", { timeZone: TZ });
/** "3:05 PM" today, "Oct 12, 3:05 PM" otherwise. */
const when = (iso: string) => (isToday(iso) ? time(iso) : `${day(iso)}, ${time(iso)}`);
/** A number and its unit that never split across lines. */
const N = ({ children }: { children: ReactNode }) => <span className="whitespace-nowrap">{children}</span>;
/** A text field sitting on the grouped well (#2C2C2E) needs one step more contrast in dark mode. */
const wellField = cn(field, "bg-[#3A3A3C] focus:bg-[#48484A] bento:bg-[#fff] bento:focus:bg-[#fff]");

/** Read a QR out of an image. Native BarcodeDetector first; otherwise the wallet-pass function decodes it (jsQR).
 *  The image itself is never stored anywhere. */
async function readQr(file: Blob): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const BD = (window as any).BarcodeDetector;
  if (BD) {
    try {
      const found = await new BD({ formats: ["qr_code"] }).detect(await createImageBitmap(file));
      if (found?.[0]?.rawValue) return found[0].rawValue as string;
    } catch { /* fall through to the server */ }
  }
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const ctx = c.getContext("2d")!; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const png = c.toDataURL("image/png").split(",")[1];
  const { data, error } = await supabase.functions.invoke("wallet-pass", { body: { op: "decode", png } });
  if (error) throw new Error(error.message);
  return (data as { payload?: string | null })?.payload ?? null;
}

// ------------------------------------------------------------------------------------------------ data hooks

function usePass() {
  const [st, setSt] = useState<PassState | null>(null);
  const load = useCallback(async () => {
    const { data, error } = await rpc("lax_pass_admin_state");
    if (error) { toast.error(error.message); return; }
    setSt(data as PassState);
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { st, load };
}

/** Parker's state. While a check is pending it polls every 5 s (up to 7 min), then refreshes the pass once. */
function useParker(onDone: () => void) {
  const [p, setP] = useState<Parker | null>(null);
  const timer = useRef<number | null>(null);
  const load = useCallback(async () => {
    const { data, error } = await rpc("lax_fetch_admin");
    if (!error && data) setP(data as Parker);
    return (data as Parker | null) ?? null;
  }, []);
  const watch = useCallback(() => {
    if (timer.current) window.clearInterval(timer.current);
    const until = Date.now() + 7 * 60_000;
    timer.current = window.setInterval(async () => {
      const d = await load();
      if ((d && !d.run_now_pending) || Date.now() > until) {
        if (timer.current) window.clearInterval(timer.current);
        timer.current = null;
        onDone();
      }
    }, 5000);
  }, [load, onDone]);
  useEffect(() => { void load().then((d) => { if (d?.run_now_pending) watch(); }); return () => { if (timer.current) window.clearInterval(timer.current); }; }, [load, watch]);
  return { p, load, watch };
}

/** What Parker is up to, in one plain sentence plus a tone. */
function parkerLine(p: Parker | null): { tone: "ok" | "busy" | "warn" | "bad" | "off"; text: string } {
  if (!p) return { tone: "busy", text: "Checking…" };
  if (!p.configured) return { tone: "off", text: "Connect Park My Share below and Parker gets each month's code for you." };
  if (p.run_now_pending) return { tone: "busy", text: "Parker is checking Park My Share now. This takes up to 5 minutes." };
  if (p.last_kind === "auth") return { tone: "bad", text: "Park My Share turned down the saved login. Re-enter it below." };
  if (p.fails > 0) {
    const why: Record<string, string> = {
      down: "Park My Share didn't answer", nocode: "Park My Share has no active code yet", verify: "the guest page didn't update",
      nofacility: "no garage with QR codes on the account",
    };
    return { tone: "warn", text: `Last check ${p.last_try_at ? when(p.last_try_at) : ""}: ${why[p.last_kind ?? ""] ?? "it didn't work"}. Parker keeps retrying on his own.` };
  }
  if (p.last_ok_at) return { tone: "ok", text: `Parker checked Park My Share at ${when(p.last_ok_at)}. He checks daily and on the 1st.` };
  return { tone: "busy", text: "Parker runs his first check within 5 minutes." };
}

// ------------------------------------------------------------------------------------------------ pieces

/** The live code, drawn like the Wallet pass guests get. */
function PassArt({ month, payload }: { month: string | null; payload: string | null }) {
  return (
    <div className="relative w-full max-w-[240px] shrink-0 overflow-hidden rounded-[18px] bg-[linear-gradient(165deg,#0B2545_0%,#13315C_52%,#3E5C8A_100%)] p-4 text-[#fff] shadow-[0_12px_30px_-12px_#0B254599] ring-1 ring-[#ffffff1a]"
      aria-label={month ? `Parking pass for ${month}` : "No parking pass yet"}>
      <div className="flex items-start justify-between text-[11px] font-semibold uppercase tracking-[0.08em] text-[#ffffffb3]">
        <span>Park My Share</span><span>LAX</span>
      </div>
      <p className="mt-2 text-[20px] font-semibold leading-tight tracking-[-0.01em]">{month ?? "No code yet"}</p>
      <p className="text-[12px] text-[#ffffff99]">Opens the lobby door</p>
      <div className="mt-4 flex justify-center">
        <div className="rounded-[12px] bg-[#fff] p-2.5">
          {payload ? <QRCodeSVG value={payload} size={132} /> : (
            <div className="grid h-[132px] w-[132px] place-items-center rounded-[6px] border-2 border-dashed border-[#C6C6C8] text-[12px] text-[#3C3C4399]">No code</div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Park My Share login. Write-only: the page saves it and can only ever read back when it was saved. */
function ParkMyShareLogin({ p, onSaved }: { p: Parker | null; onSaved: (d: Parker) => void }) {
  const needs = !!p && (!p.configured || p.last_kind === "auth");
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);
  const show = open || needs;
  const save = async () => {
    if (!email.trim() && !password) { toast.error("Add the email and password you use for Park My Share."); return; }
    if (!p?.configured && (!email.trim() || !password)) { toast.error("Add both the email and the password."); return; }
    setBusy(true);
    const { data, error } = await rpc("lax_fetch_connect", { p_email: email.trim() || null, p_password: password || null });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setEmail(""); setPassword(""); setOpen(false);
    toast.success("Saved. Parker signs in and checks for the code within 5 minutes.");
    onSaved(data as Parker);
  };
  const saved = p?.password_at ?? p?.email_at;
  return (
    <div className={cn("rounded-[16px] bg-[#2C2C2E] bento:bg-[#F2F2F7]", show ? "space-y-4 p-4" : "")}>
      {!show ? (
        <div className="flex min-h-[44px] items-center gap-3 px-4 py-2.5">
          <KeyRound className={cn("h-[18px] w-[18px] shrink-0", tint.blue)} aria-hidden />
          <span className={cn("flex-1 text-[15px]", label)}>Park My Share login</span>
          <span className={cn("text-[13px]", secondary)}>{saved ? `Saved ${day(saved)}` : ""}</span>
          <button type="button" onClick={() => setOpen(true)} className={btnPlain}>Change</button>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-3">
            <KeyRound className={cn("mt-0.5 h-[18px] w-[18px] shrink-0", tint.blue)} aria-hidden />
            <div className="min-w-0">
              <p className={cn("text-[15px] font-semibold", label)}>{p?.configured ? "Change the Park My Share login" : "Connect Park My Share"}</p>
              <p className={cn("mt-0.5 text-[13px] leading-snug", secondary)}>
                The same email and password you use at app.parkmycarshare.com. Parker only reads the QR page; he never changes anything there.
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={cn("mb-1.5 block text-[13px] font-medium", secondary)}>Email</span>
              <input type="email" autoComplete="off" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200}
                placeholder={p?.email_at ? "Saved. Type to replace" : "you@example.com"} className={wellField} />
            </label>
            <label className="block">
              <span className={cn("mb-1.5 block text-[13px] font-medium", secondary)}>Password</span>
              <span className="relative block">
                <input type={reveal ? "text" : "password"} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={200}
                  placeholder={p?.password_at ? "Saved. Type to replace" : "Password"} className={cn(wellField, "pr-12")}
                  onKeyDown={(e) => { if (e.key === "Enter") void save(); }} />
                <button type="button" onClick={() => setReveal((v) => !v)} aria-label={reveal ? "Hide password" : "Show password"}
                  className={cn("absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-[12px]", secondary)}>
                  {reveal ? <EyeOff className="h-[18px] w-[18px]" aria-hidden /> : <Eye className="h-[18px] w-[18px]" aria-hidden />}
                </button>
              </span>
            </label>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className={cn("flex items-center gap-1.5 text-[12px]", tertiary)}><Lock className="h-3.5 w-3.5 shrink-0" aria-hidden /> Goes straight into the vault. Nobody can read it back here.</p>
            <div className="flex items-center justify-end gap-4">
              {p?.configured && !needs && <button type="button" onClick={() => setOpen(false)} className={btnPlain}>Cancel</button>}
              <button type="button" onClick={save} disabled={busy} className={btnPrimary}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} {p?.configured ? "Save login" : "Connect"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** The garage code: live pass, Parker's status, Check now, login, and adding a code by hand. */
function GarageCode({ st, reload }: { st: PassState | null; reload: () => void }) {
  const { p, load: loadParker, watch } = useParker(reload);
  const [draft, setDraft] = useState<{ payload: string; preview: string } | null>(null);
  const [month, setMonth] = useState<"this" | "next">("this");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"read" | "save" | "check" | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setNote((n) => n || st?.current?.note || ""); }, [st]);

  const take = useCallback(async (file: Blob | null | undefined) => {
    if (!file || !file.type.startsWith("image/")) { toast.error("Drop a screenshot or photo of the QR code."); return; }
    setBusy("read");
    try {
      const payload = await readQr(file).catch((e) => { toast.error(String(e.message ?? e)); return null; });
      if (!payload) { toast.error("Couldn't find a QR code in that image. Try a tighter screenshot of just the code."); return; }
      setDraft({ payload, preview: URL.createObjectURL(file) });
      const d = Number(new Date().toLocaleString("en-US", { day: "numeric", timeZone: TZ }));
      setMonth(d >= 25 && st?.current?.is_this_month ? "next" : "this");
    } finally { setBusy(null); }
  }, [st]);

  // Paste a screenshot anywhere on the page (Cmd+V), unless typing in a field.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      if (item) { e.preventDefault(); void take(item.getAsFile()); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [take]);

  const saveDraft = async () => {
    if (!draft || !st) return;
    setBusy("save");
    const { error } = await rpc("lax_pass_set", { p_payload: draft.payload, p_month: month === "next" ? nextMonth(st.month_now) : st.month_now, p_note: note });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Saved. Guest links and saved Wallet passes show this code now.");
    setDraft(null);
    reload();
  };

  const checkNow = async () => {
    setBusy("check");
    const { data, error } = await rpc("lax_fetch_run_now");
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    void loadParker();
    if ((data as Parker | null)?.run_now_pending) watch();
  };

  const cur = st?.current;
  const missing = !!st && (!cur || !cur.is_this_month);
  const line = parkerLine(p);
  const lineTone = { ok: secondary, busy: secondary, warn: tint.orange, bad: tint.red, off: secondary }[line.tone];
  const iconTone = { ok: tint.green, busy: secondary, warn: tint.orange, bad: tint.red, off: tint.blue }[line.tone];
  const LineIcon = line.tone === "ok" ? CheckCircle2 : line.tone === "busy" ? Loader2 : line.tone === "off" ? KeyRound : AlertTriangle;
  const canCheck = !!p?.configured && !p.run_now_pending;
  const drop = {
    onDragOver: (e: DragEvent) => { e.preventDefault(); setDrag(true); },
    onDragLeave: () => setDrag(false),
    onDrop: (e: DragEvent) => { e.preventDefault(); setDrag(false); void take(e.dataTransfer.files?.[0]); },
  };

  if (draft) {
    return (
      <div className={cn(card, "space-y-6")}>
        <div className="grid grid-cols-2 gap-3 sm:gap-5">
          <figure className="space-y-2 text-center">
            <div className="grid aspect-square place-items-center overflow-hidden rounded-[14px] bg-[#fff] p-3"><img src={draft.preview} alt="Your screenshot" className="max-h-full max-w-full object-contain" /></div>
            <figcaption className={cn("text-[13px]", secondary)}>Your screenshot</figcaption>
          </figure>
          <figure className="space-y-2 text-center">
            <div className="grid aspect-square place-items-center rounded-[14px] bg-[#fff] p-3"><QRCodeSVG value={draft.payload} size={160} className="h-full max-h-[160px] w-full" /></div>
            <figcaption className={cn("text-[13px]", secondary)}>What guests get</figcaption>
          </figure>
        </div>
        <p className="flex items-center gap-2.5"><Check className={cn("h-5 w-5 shrink-0", tint.green)} aria-hidden />
          <span className={cn("text-[15px] font-semibold", label)}>Code read. Both match.</span></p>
        {st && (
          <div className="space-y-2">
            <p className={cn("text-[13px] font-medium", secondary)}>Which month is it for?</p>
            <Segmented<"this" | "next"> ariaLabel="Month" value={month} onChange={setMonth}
              options={[{ value: "this", label: monthLabel(st.month_now) }, { value: "next", label: monthLabel(nextMonth(st.month_now)) }]} />
          </div>
        )}
        <label className="block">
          <span className={cn("mb-1.5 block text-[13px] font-medium", secondary)}>Note for guests <span className={tertiary}>(optional, shows on the pass)</span></span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300}
            placeholder="e.g. Car is in row C." className={cn(field, "resize-none")} />
        </label>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-4">
          <button type="button" onClick={() => setDraft(null)} className={cn(btnPlain, "justify-center")}>Cancel</button>
          <button type="button" onClick={saveDraft} disabled={busy === "save"} className={cn(btnPrimary, "w-full sm:w-auto")}>
            {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save and send to guests
          </button>
        </div>
      </div>
    );
  }

  return (
    <div {...drop} className={cn(card, "space-y-5 transition-[box-shadow,background-color] duration-200",
      drag && "bg-[#0A84FF14] ring-2 ring-[#0A84FF] bento:bg-[#007AFF0d] bento:ring-[#007AFF]")}>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ""; }} />
      {!st ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className={cn("h-6 w-6 animate-spin", tertiary)} aria-label="Loading" /></div>
      ) : (
        <>
          <div className="flex flex-col items-center gap-6 md:flex-row md:items-start">
            <PassArt month={cur ? monthLabel(cur.valid_month) : null} payload={cur?.payload ?? null} />
            <div className="w-full min-w-0 flex-1 space-y-4 text-center md:text-left">
              <div className="space-y-2">
                <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold", missing ? pill.orange : pill.green)}>
                  {missing ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
                  {missing ? `Needs ${monthName(st.month_now)}'s code` : "Live for guests"}
                </span>
                <p className={cn("text-[22px] font-semibold leading-tight tracking-[-0.01em]", label)}>
                  {missing ? (cur ? `Guests still see ${monthLabel(cur.valid_month)}.` : "No code yet.") : `${monthLabel(cur!.valid_month)} is live.`}
                </p>
                <p className={cn("flex items-start justify-center gap-2 text-[15px] leading-snug md:justify-start", lineTone)} role="status" aria-live="polite">
                  <LineIcon className={cn("mt-[3px] h-4 w-4 shrink-0", iconTone, line.tone === "busy" && "animate-spin")} aria-hidden />
                  <span>{line.text}</span>
                </p>
              </div>
              <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                {p?.configured && p.last_kind !== "auth" && (
                  <button type="button" onClick={checkNow} disabled={!canCheck || busy === "check"} className={missing ? btnPrimary : btnTinted}>
                    {busy === "check" || p.run_now_pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCw className="h-4 w-4" aria-hidden />}
                    {p.run_now_pending ? "Checking…" : "Check now"}
                  </button>
                )}
                <button type="button" onClick={() => fileRef.current?.click()} disabled={busy === "read"} className={cn(p?.configured ? btnPlain : btnTinted, "justify-center")}>
                  {busy === "read" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ImageUp className="h-4 w-4" aria-hidden />}
                  {busy === "read" ? "Reading the code…" : "Add a code by hand"}
                </button>
                <a href="/t/demo-lax?stage=day-of" target="_blank" rel="noreferrer" className={cn(btnPlain, "justify-center")}>
                  See guest page <ChevronRight className="h-4 w-4" aria-hidden />
                </a>
              </div>
              <dl className={cn("divide-y rounded-[16px] text-left bg-[#2C2C2E] px-4 bento:bg-[#F2F2F7]", separator)}>
                {([
                  ["Gets the code", p?.configured ? "Parker, automatically" : "You, by hand"],
                  ["Good until", p?.last_expires && !missing ? <N key="u">{day(p.last_expires)}</N> : cur ? <N key="u">end of {monthName(cur.valid_month)}</N> : "–"],
                  ["In Apple Wallet", <N key="w">{st.wallet_devices} phone{st.wallet_devices === 1 ? "" : "s"}</N>],
                  ...(p?.last_saved_at ? [["Last new code", when(p.last_saved_at)]] : []),
                ] as [string, ReactNode][]).map(([k, v]) => (
                  <div key={k} className="flex min-h-[44px] items-center justify-between gap-3 py-2.5">
                    <dt className={cn("text-[15px]", secondary)}>{k}</dt>
                    <dd className={cn("text-right text-[15px] font-medium tabular-nums", label)}>{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          <ParkMyShareLogin p={p} onSaved={(d) => { setTimeout(() => void loadParker(), 0); if (d?.run_now_pending) watch(); }} />
        </>
      )}
    </div>
  );
}

const GUIDE_FIELDS: { key: keyof Guide; label: string; hint?: string }[] = [
  { key: "spot", label: "Your space (this trip)", hint: "e.g. 214. Leave blank and the page says you'll text it." },
  { key: "garage", label: "Garage address" },
  { key: "level", label: "Level" },
  { key: "shuttle", label: "Shuttle" },
  { key: "after_hours", label: "After-hours shuttle phone" },
  { key: "car", label: "Car" },
];

/** The pickup guide guests see (garage, level, space, shuttle, after-hours number). */
function GuideCard({ guide, onSaved }: { guide: Guide; onSaved: () => void }) {
  const [g, setG] = useState<Guide>(guide);
  const [saving, setSaving] = useState(false);
  useEffect(() => setG(guide), [guide]);
  const dirty = GUIDE_FIELDS.some(({ key }) => (g[key] ?? "") !== (guide[key] ?? ""));
  const save = async () => {
    setSaving(true);
    const { error } = await rpc("lax_pass_set_guide", { p_guide: g });
    setSaving(false);
    if (error) toast.error(error.message); else { toast.success("Guide updated. The guest page and saved passes show it now."); onSaved(); }
  };
  return (
    <div className={cn(card, "space-y-4")}>
      <div className="grid gap-4 sm:grid-cols-2">
        {GUIDE_FIELDS.map(({ key, label: l, hint }) => (
          <label key={key} className={cn("block", key === "spot" && "sm:col-span-2")}>
            <span className={cn("mb-1.5 block text-[13px] font-medium", secondary)}>{l}</span>
            <input value={g[key] ?? ""} onChange={(e) => setG({ ...g, [key]: e.target.value })} maxLength={120} className={field} />
            {hint && <span className={cn("mt-1.5 block text-[12px]", tertiary)}>{hint}</span>}
          </label>
        ))}
      </div>
      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={!dirty || saving} className={btnTinted}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} {dirty ? "Save guide" : "Saved"}
        </button>
      </div>
    </div>
  );
}

/** The one shared LAX link (bestly.tech/lax/<slug>); always shows the newest code. */
function GuestLink({ slug, reload }: { slug: string | null; reload: () => void }) {
  const rotate = async () => {
    if (!window.confirm("Make a new LAX link? The old link stops working, so update it anywhere you pasted it.")) return;
    const { error } = await rpc("lax_pass_rotate_slug");
    if (error) toast.error(error.message); else { toast.success("New link made. Paste it into Turo."); reload(); }
  };
  if (!slug) return <div className={cn(card, "h-28 animate-pulse")} aria-label="Loading" />;
  const link = `${SITE}/lax/${slug}`;
  return (
    <div className={cn(card, "space-y-3")}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className={cn(field, "break-all font-mono text-[14px] sm:flex-1")}>{link.replace("https://", "")}</code>
        <CopyButton text={link} label="Copy link" className={cn(btnTinted, "h-auto")} />
      </div>
      <button type="button" onClick={rotate} className={btnDestructivePlain}>
        <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Make a new link (turns the old one off)
      </button>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ the section

export function TuroSettings() {
  const { st, load } = usePass();
  const loc = useLocation();

  // Land on #settings (or a card inside it, e.g. #tesla after Tesla sign-in) once the cards have rendered.
  useEffect(() => {
    const id = loc.hash.slice(1);
    if (!id) return;
    // Cards above load their data and grow, so aim once early and once after they settle.
    const go = () => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    const t1 = window.setTimeout(go, 450), t2 = window.setTimeout(go, 1600);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [loc.hash]);

  return (
    <section id="settings" aria-labelledby="turo-settings-title" className="scroll-mt-24 space-y-8 border-t border-[#38383A] pt-8 bento:border-[#C6C6C8]">
      <div className="space-y-1 px-1">
        <h2 id="turo-settings-title" className={cn("text-[28px] font-bold leading-tight tracking-[-0.02em]", label)}>Settings</h2>
        <p className={cn("text-[15px] leading-snug", secondary)}>The LAX garage code, the guest pages, and the car&rsquo;s connections.</p>
      </div>

      <Section title="LAX garage code" id="garage-code"
        footer="Parker saves only a code Park My Share marks active, then checks guests see it. To add one yourself, drop or paste a screenshot of the QR here.">
        <GarageCode st={st} reload={load} />
      </Section>

      <div className="grid items-start gap-8 lg:grid-cols-2">
        <div className="min-w-0 space-y-8">
          <Section title="Guest pages" id="guest-pages" footer="Demo trips with a stage switcher. Nothing touches real guests or the car.">
            <div className={cn(card, "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between")}>
              <p className={cn("text-[15px] font-semibold", label)}>Preview the guest pages</p>
              <div className="flex flex-wrap gap-2">
                <a href="/t/demo-home?stage=key-ready" target="_blank" rel="noreferrer" className={btnTinted}>Home pickup</a>
                <a href="/t/demo-lax?stage=day-of" target="_blank" rel="noreferrer" className={btnTinted}>LAX</a>
                <a href="/t/demo-delivery?stage=key-ready" target="_blank" rel="noreferrer" className={btnTinted}>Delivery</a>
              </div>
            </div>
            <DemoKeyCard />
            <div id="health"><TripHealth /></div>
          </Section>

          {st && (
            <Section title="Pickup guide" id="guide" footer="Shows on the LAX guest page and the back of the Wallet pass. Change the space for each trip.">
              <GuideCard guide={st.guide ?? {}} onSaved={load} />
            </Section>
          )}

          <Section title="Shared LAX link" id="guest-link" footer="One link for every month: it always shows the newest code.">
            <GuestLink slug={st?.slug ?? null} reload={load} />
          </Section>

          <Section title="How guests use their page" id="guest-steps" footer="Green = done, orange = late for that step. Hover a step for its time.">
            <GuestFunnel />
          </Section>

          <Section title="Guest questions" id="ask" footer="All free. Keys go straight into the vault and can't be read back here.">
            <GuestHelperCard />
            <HelperSettings />
          </Section>
        </div>

        <div className="min-w-0 space-y-8">
          <Section title="TezLab" footer="First choice for guest A/C, honk and flash. If TezLab fails, the Tesla connection takes over by itself.">
            <TezLabCard />
          </Section>
          <Section title="Tesla" footer="Backup car controls and guest keys. Tesla gives $10 of free API use a month; the helper stops at the cap so it stays free.">
            <TeslaCard />
          </Section>
          <ChargingCard />
          <LeoSmsCard />
          <Section title="Apple Wallet" id="passes" footer="Guests' passes update by themselves when the code changes.">
            <HostPassCard />
          </Section>
          <Section title="History" id="runs">
            {st && st.history.length > 0 && (
              <ul className={cn(card, "divide-y p-0", separator)} aria-label="Past garage codes">
                {st.history.map((h) => (
                  <li key={h.id} className="flex min-h-[44px] items-center justify-between gap-3 px-5 py-3">
                    <span className={cn("text-[15px]", label)}>{monthLabel(h.valid_month)} code</span>
                    <span className={cn("text-[13px]", secondary)}>Added {when(h.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
            <RunHistory />
          </Section>
        </div>
      </div>
    </section>
  );
}
