/**
 * /admin/turo/lax-pass — the Park My Share (LAX) parking code for Turo guests.
 *
 * Once a month Jared drops the new QR from the Park My Share portal here (drag, click or paste).
 * The browser reads the QR (jsQR / BarcodeDetector) — the image itself is never uploaded, only its text.
 * lax_pass_set() saves it and pings wallet-pass to refresh every saved Apple Wallet pass.
 * Guests use one permanent link, bestly.tech/lax/<slug> (pages/LaxGuest.tsx), which always shows the newest code.
 * lax_pass_reminder() (cron, 9 AM PT daily) nudges Scout when this month's code isn't in yet.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { AlertTriangle, CheckCircle2, ExternalLink, ImageUp, Loader2, RefreshCw, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/admin/PageHeader";
import { CopyButton } from "@/components/CopyText";
import { cn } from "@/lib/utils";

type CodeRow = { id: string; payload: string; valid_month: string; note: string | null; created_at: string; is_this_month?: boolean };
type State = {
  slug: string; month_now: string; current: CodeRow | null; history: CodeRow[];
  wallet_devices: number; last_push: { at: string; detail: { devices?: number; sent?: number; failed?: number } } | null;
};

const rpc = (fn: string, args?: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;
const card = "rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 bento:border-transparent bento:bg-[#fff] bento:rounded-[1.5rem]";
const SITE = "https://www.bestly.tech";

const monthLabel = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Los_Angeles" });
const nextMonth = (iso: string) => { const [y, m] = iso.split("-").map(Number); return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`; };

/** Read a QR out of an image. Native BarcodeDetector (Chrome) first; otherwise the wallet-pass
 *  function decodes it (jsQR server-side). The image is not stored anywhere. */
async function readQr(file: Blob): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const BD = (window as any).BarcodeDetector;
  if (BD) {
    try {
      const found = await new BD({ formats: ["qr_code"] }).detect(await createImageBitmap(file));
      if (found?.[0]?.rawValue) return found[0].rawValue as string;
    } catch { /* fall through to the server */ }
  }
  // Normalise to PNG (handles HEIC/WebP the browser can show but the server can't decode), capped at 1600px.
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const ctx = c.getContext("2d")!; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const png = c.toDataURL("image/png").split(",")[1];
  const { data, error } = await supabase.functions.invoke("wallet-pass", { body: { op: "decode", png } });
  if (error) throw new Error(error.message);
  return (data as { payload?: string | null })?.payload ?? null;
}

export default function LaxPass() {
  const [st, setSt] = useState<State | null>(null);
  const [draft, setDraft] = useState<{ payload: string; preview: string } | null>(null);
  const [month, setMonth] = useState<"this" | "next">("this");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"read" | "save" | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data, error } = await rpc("lax_pass_admin_state");
    if (error) { toast.error(error.message); return; }
    const s = data as State;
    setSt(s);
    setNote((n) => n || s.current?.note || "");
  }, []);
  useEffect(() => { load(); }, [load]);

  const take = useCallback(async (file: Blob | null | undefined) => {
    if (!file || !file.type.startsWith("image/")) { toast.error("Drop a screenshot or photo of the QR code."); return; }
    setBusy("read");
    try {
      const payload = await readQr(file).catch((e) => { toast.error(String(e.message ?? e)); return null; });
      if (!payload) { toast.error("Couldn't find a QR code in that image. Try a tighter screenshot of just the code."); return; }
      setDraft({ payload, preview: URL.createObjectURL(file) });
      // Grabbing it in the last days of a month usually means next month's code.
      const day = Number(new Date().toLocaleString("en-US", { day: "numeric", timeZone: "America/Los_Angeles" }));
      setMonth(day >= 25 && st?.current?.is_this_month ? "next" : "this");
    } finally { setBusy(null); }
  }, [st]);

  // Paste a screenshot straight in (Cmd+V).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      if (item) { e.preventDefault(); take(item.getAsFile()); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [take]);

  const save = async () => {
    if (!draft || !st) return;
    setBusy("save");
    const { error } = await rpc("lax_pass_set", { p_payload: draft.payload, p_month: month === "next" ? nextMonth(st.month_now) : st.month_now, p_note: note });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Saved. The guest link and saved Wallet passes now show this code.");
    setDraft(null);
    load();
  };

  const rotate = async () => {
    if (!window.confirm("Make a new guest link? The old link stops working, so update it anywhere you pasted it.")) return;
    const { error } = await rpc("lax_pass_rotate_slug");
    if (error) toast.error(error.message); else { toast.success("New link made."); load(); }
  };

  const link = st ? `${SITE}/lax/${st.slug}` : "";
  const message = `Parking at LAX: open this link and add the pass to your Apple or Google Wallet. Show the QR code at the Park My Share lot. ${link}`;
  const cur = st?.current;
  const missing = st && (!cur || !cur.is_this_month);

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader title="LAX parking pass" description="Drop this month's Park My Share QR. Guests get it on one link and can add it to their phone's wallet." />

      {/* Status */}
      <div className={cn(card, "flex items-start gap-3")}>
        {!st ? <Loader2 className="h-5 w-5 animate-spin text-white/50" /> : missing
          ? <AlertTriangle className="h-5 w-5 shrink-0 text-amber-300 bento:text-amber-600" />
          : <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-300 bento:text-emerald-600" />}
        <div className="min-w-0 text-sm">
          {st && (missing ? (
            <p className="font-medium text-white bento:text-neutral-900">
              {cur ? `Guests are seeing ${monthLabel(cur.valid_month)}'s code.` : "No code yet."} Add {monthLabel(st.month_now)}'s below.
            </p>
          ) : (
            <p className="font-medium text-white bento:text-neutral-900">{monthLabel(cur!.valid_month)}'s code is live.</p>
          ))}
          {cur && <p className="mt-1 text-white/55 bento:text-neutral-500">Added {when(cur.created_at)} · {st?.wallet_devices ?? 0} phone{st?.wallet_devices === 1 ? "" : "s"} with the Apple Wallet pass</p>}
        </div>
      </div>

      {/* Drop zone / confirm */}
      {!draft ? (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); take(e.dataTransfer.files?.[0]); }}
          className={cn(card, "w-full border-dashed py-12 text-center transition-colors",
            drag ? "border-violet-400 bg-violet-500/10 bento:bg-violet-50" : "hover:border-white/20 bento:hover:bg-neutral-50")}
        >
          {busy === "read" ? <Loader2 className="mx-auto h-8 w-8 animate-spin text-white/60" /> : <ImageUp className="mx-auto h-8 w-8 text-white/60 bento:text-neutral-400" />}
          <p className="mt-3 font-medium text-white bento:text-neutral-900">Drop the QR screenshot here</p>
          <p className="mt-1 text-sm text-white/50 bento:text-neutral-500">or click to choose it, or just paste it (⌘V)</p>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { take(e.target.files?.[0]); e.target.value = ""; }} />
        </button>
      ) : (
        <div className={cn(card, "space-y-5")}>
          <div className="flex flex-wrap items-center gap-6">
            <img src={draft.preview} alt="Your screenshot" className="h-36 w-36 rounded-lg object-contain bg-white" />
            <div className="rounded-lg bg-white p-2"><QRCodeSVG value={draft.payload} size={128} /></div>
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium text-white bento:text-neutral-900">Read it. The two codes match.</p>
              <p className="mt-1 break-all font-mono text-xs text-white/50 bento:text-neutral-500">{draft.payload.length > 140 ? draft.payload.slice(0, 140) + "…" : draft.payload}</p>
            </div>
          </div>
          {st && (
            <div className="flex flex-wrap gap-2">
              {(["this", "next"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMonth(m)}
                  className={cn("rounded-full px-3 py-1.5 text-sm border",
                    month === m ? "border-violet-400 bg-violet-500/20 text-white bento:bg-violet-100 bento:text-violet-900" : "border-white/10 text-white/60 bento:border-neutral-200 bento:text-neutral-600")}>
                  Code for {monthLabel(m === "this" ? st.month_now : nextMonth(st.month_now))}
                </button>
              ))}
            </div>
          )}
          <label className="block text-sm">
            <span className="text-white/60 bento:text-neutral-600">Note for guests (optional, shows on the pass)</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300}
              placeholder="e.g. Car is in row C. Keys are in the lockbox."
              className="mt-1 w-full rounded-lg border border-white/10 bg-transparent p-2 text-white bento:border-neutral-200 bento:text-neutral-900" />
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={busy === "save"}
              className="inline-flex items-center gap-2 rounded-full bg-violet-500 px-5 py-2 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-60">
              {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" />} Save code
            </button>
            <button type="button" onClick={() => setDraft(null)} className="rounded-full px-4 py-2 text-sm text-white/60 bento:text-neutral-500">Cancel</button>
          </div>
        </div>
      )}

      {/* Guest link */}
      {st && (
        <div className={cn(card, "space-y-4")}>
          <div className="flex items-center gap-2 text-sm font-medium text-white bento:text-neutral-900"><Smartphone className="h-4 w-4" /> Guest link. It never changes, so paste it into Turo once.</div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-lg bg-white/[0.05] px-3 py-2 text-sm text-white bento:bg-neutral-100 bento:text-neutral-900">{link.replace("https://", "")}</code>
            <CopyButton text={link} label="Copy link" />
            <a href={`/lax/${st.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-white/60 hover:text-white bento:text-neutral-500">Open <ExternalLink className="h-3.5 w-3.5" /></a>
          </div>
          <div className="rounded-lg border border-white/[0.07] p-3 text-sm text-white/70 bento:border-neutral-200 bento:text-neutral-700">
            <p>{message}</p>
            <div className="mt-2"><CopyButton text={message} label="Copy message for Turo" /></div>
          </div>
          <button type="button" onClick={rotate} className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 bento:text-neutral-400">
            <RefreshCw className="h-3 w-3" /> Make a new link (turns off the old one)
          </button>
        </div>
      )}

      {/* History */}
      {st && st.history.length > 0 && (
        <div className={card}>
          <p className="mb-3 text-sm font-medium text-white bento:text-neutral-900">Past codes</p>
          <ul className="divide-y divide-white/[0.06] text-sm bento:divide-neutral-100">
            {st.history.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-white/80 bento:text-neutral-800">{monthLabel(h.valid_month)}</span>
                <span className="text-white/45 bento:text-neutral-500">added {when(h.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
