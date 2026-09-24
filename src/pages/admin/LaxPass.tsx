/**
 * /admin/turo/lax-pass — the Park My Share (LAX) parking code for Turo guests.
 *
 * Once a month Jared drops the new QR from the Park My Share portal here (drag, click or paste).
 * The browser reads the QR (jsQR / BarcodeDetector) — the image itself is never uploaded, only its text.
 * lax_pass_set() saves it and pings wallet-pass to refresh every saved Apple Wallet pass.
 * Guests use one permanent link, bestly.tech/lax/<slug> (pages/LaxGuest.tsx), which always shows the newest code.
 * lax_pass_reminder() (cron, 9 AM PT daily) nudges Scout when this month's code isn't in yet.
 */
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import { AlertTriangle, Check, CheckCircle2, ChevronRight, ImageUp, Loader2, Settings } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/admin/PageHeader";
import { cn } from "@/lib/utils";
import { LaxGuests } from "./LaxGuests";
import { TripHealth } from "./TripHealth";
import { GuestHelperCard } from "./AskCard";
import { TripSettingsBody } from "./TripSettings";
import { Section, Segmented, btnPlain, btnPrimary, btnTinted, card, field, label, pill, secondary, separator, tertiary, tint } from "./laxUi";

type CodeRow = { id: string; payload: string; valid_month: string; note: string | null; created_at: string; is_this_month?: boolean };
type Guide = { garage?: string; level?: string; spot?: string; shuttle?: string; after_hours?: string; car?: string };
type State = {
  slug: string; guide: Guide; month_now: string; current: CodeRow | null; history: CodeRow[];
  wallet_devices: number; last_push: { at: string; detail: { devices?: number; sent?: number; failed?: number } } | null;
};

const rpc = (fn: string, args?: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;
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

const GUIDE_FIELDS: { key: keyof Guide; label: string; hint?: string }[] = [
  { key: "spot", label: "Your space (this trip)", hint: "e.g. 214. Leave blank and the page says you'll text it." },
  { key: "garage", label: "Garage address" },
  { key: "level", label: "Level" },
  { key: "shuttle", label: "Shuttle" },
  { key: "after_hours", label: "After-hours shuttle phone" },
  { key: "car", label: "Car" },
];

/** The pickup guide guests see (garage, level, space, shuttle, after-hours number). Prefilled; edit any time. */
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
    <div className={cn(card, "space-y-5")}>
      <div>
        <p className={cn("text-[17px] font-semibold", label)}>Pickup guide</p>
        <p className={cn("mt-1 text-[13px] leading-snug", secondary)}>Shows on the guest page and the back of the Wallet pass. Change the space for each trip.</p>
      </div>
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
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} {dirty ? "Save guide" : "Saved"}
        </button>
      </div>
    </div>
  );
}

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
            <div className="grid h-[132px] w-[132px] place-items-center rounded-[6px] border-2 border-dashed border-[#C6C6C8] text-[12px] text-[#3C3C4399]">Drop a code</div>
          )}
        </div>
      </div>
    </div>
  );
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


  // Settings stay folded unless a link points into them (e.g. back from Tesla sign-in: #tesla).
  const [openSettings, setOpenSettings] = useState(false);
  useEffect(() => { if (/^#(tesla|tezlab|ask|settings|helper)/.test(window.location.hash)) setOpenSettings(true); }, []);
  const link = st ? `${SITE}/lax/${st.slug}` : "";
  const cur = st?.current;
  const missing = st && (!cur || !cur.is_this_month);

  const dropProps = {
    onDragOver: (e: DragEvent) => { e.preventDefault(); setDrag(true); },
    onDragLeave: () => setDrag(false),
    onDrop: (e: DragEvent) => { e.preventDefault(); setDrag(false); take(e.dataTransfer.files?.[0]); },
  };

  return (
    <div className="w-full space-y-8">
      <PageHeader title="Guest Trips" description="Every Turo trip: its guest page, Tesla key, Turo message and health. Plus the LAX garage code."
        actions={<button type="button" onClick={() => { setOpenSettings(true); window.setTimeout(() => document.getElementById("settings")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }} className={cn(btnTinted, "px-4")}><Settings className="h-4 w-4" aria-hidden /> Settings</button>} />
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { take(e.target.files?.[0]); e.target.value = ""; }} />

      {/* Fills the width: sections flow into as many ~30rem columns as fit (1 on phones, 2-3 on wide screens). */}
      <div className="gap-8 [column-fill:balance] columns-1 md:columns-[28rem] [&>section]:mb-8 [&>section]:break-inside-avoid">

      <Section title="Trips" id="trips" className="[column-span:all]">
        <div className={cn(card, "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between")}>
          <div>
            <p className={cn("text-[15px] font-semibold", label)}>Preview the guest pages</p>
            <p className={cn("text-[13px]", secondary)}>Demo trips with a stage switcher. Nothing touches real guests, keys or the car.</p>
          </div>
          <div className="flex gap-2">
            <a href="/t/demo-home?stage=key-ready" target="_blank" rel="noreferrer" className={cn(btnTinted, "h-auto px-4")}>Home pickup</a>
            <a href="/t/demo-lax?stage=day-of" target="_blank" rel="noreferrer" className={cn(btnTinted, "h-auto px-4")}>LAX</a>
          </div>
        </div>
        <TripHealth />
        <div id="keys"><LaxGuests /></div>
      </Section>

      <Section title="LAX garage code · this month" className="[column-span:all]" footer={<>Paste a screenshot of the new QR anywhere on this page (⌘V), drop it on the card, or choose the file. Only the code is read; the picture isn't saved.</>}>
        {!draft ? (
          <div {...dropProps}
            className={cn(card, "transition-[box-shadow,background-color] duration-200", drag && "ring-2 ring-[#0A84FF] bg-[#0A84FF14] bento:ring-[#007AFF] bento:bg-[#007AFF0d]")}>
            {!st ? (
              <div className="flex h-40 items-center justify-center"><Loader2 className={cn("h-6 w-6 animate-spin", tertiary)} aria-label="Loading" /></div>
            ) : (
              <div className="flex flex-col items-center gap-6 md:flex-row md:flex-wrap md:items-center xl:flex-nowrap">
                <PassArt month={cur ? monthLabel(cur.valid_month) : null} payload={cur?.payload ?? null} />
                <div className="w-full min-w-0 flex-1 space-y-4 text-center sm:text-left">
                  <div className="space-y-2">
                    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold", missing ? pill.orange : pill.green)}>
                      {missing ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
                      {missing ? "Needs this month's code" : "Live for guests"}
                    </span>
                    <p className={cn("text-[22px] font-semibold leading-tight tracking-[-0.01em]", label)}>
                      {missing
                        ? (cur ? `Guests still see ${monthLabel(cur.valid_month)}.` : "No code yet.")
                        : `${monthLabel(cur!.valid_month)} is live.`}
                    </p>
                    <p className={cn("text-[15px] leading-snug", secondary)}>
                      {missing
                        ? `Add ${monthLabel(st.month_now)}'s code from the Park My Share portal.`
                        : <>Added {when(cur!.created_at)}. On {st.wallet_devices} phone{st.wallet_devices === 1 ? "" : "s"} in Apple Wallet; they update by themselves.</>}
                    </p>
                  </div>
                  <div className="flex flex-col items-center gap-2 sm:flex-row sm:items-center sm:gap-4">
                    <button type="button" onClick={() => fileRef.current?.click()} disabled={busy === "read"} className={cn(missing ? btnPrimary : btnTinted, "w-full sm:w-auto")}>
                      {busy === "read" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageUp className="h-4 w-4" aria-hidden />}
                      {busy === "read" ? "Reading the code…" : missing ? `Add ${monthLabel(st.month_now).split(" ")[0]}'s code` : "Replace code"}
                    </button>
                    <a href={`/lax/${st.slug}`} target="_blank" rel="noreferrer" className={btnPlain}>
                      See guest page <ChevronRight className="h-4 w-4" aria-hidden />
                    </a>
                  </div>
                </div>
                {/* At a glance: fills the wide hero on big screens */}
                <dl className={cn("w-full shrink-0 divide-y self-stretch rounded-[16px] bg-[#2C2C2E] px-4 text-left xl:max-w-[340px] bento:bg-[#F2F2F7]", separator)}>
                  {[
                    ["Next code due", monthLabel(nextMonth(st.month_now)).replace(" ", " 1, ")],
                    ["In Apple Wallet", `${st.wallet_devices} phone${st.wallet_devices === 1 ? "" : "s"}`],
                    ["Past codes", String(st.history.length)],
                  ].map(([k, v]) => (
                    <div key={k} className="flex min-h-[44px] items-center justify-between gap-3 py-2.5">
                      <dt className={cn("text-[15px]", secondary)}>{k}</dt>
                      <dd className={cn("text-[15px] font-medium tabular-nums", label)}>{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        ) : (
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
            <div className="flex items-start gap-2.5">
              <Check className={cn("mt-0.5 h-5 w-5 shrink-0", tint.green)} aria-hidden />
              <div className="min-w-0">
                <p className={cn("text-[15px] font-semibold", label)}>Code read. Both match.</p>
                <p className={cn("mt-0.5 break-all font-mono text-[12px]", tertiary)}>{draft.payload.length > 120 ? draft.payload.slice(0, 120) + "…" : draft.payload}</p>
              </div>
            </div>
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
                placeholder="e.g. Car is in row C. Keys are in the lockbox." className={cn(field, "resize-none")} />
            </label>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-4">
              <button type="button" onClick={() => setDraft(null)} className={cn(btnPlain, "justify-center")}>Cancel</button>
              <button type="button" onClick={save} disabled={busy === "save"} className={cn(btnPrimary, "w-full sm:w-auto")}>
                {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" />} Save and send to guests
              </button>
            </div>
          </div>
        )}
      </Section>

      {st && (
        <Section title="Guest page">
          <GuideCard guide={st.guide ?? {}} onSaved={load} />
        </Section>
      )}


      {st && st.history.length > 0 && (
        <Section title="Past codes">
          <ul className={cn(card, "divide-y p-0", separator)}>
            {st.history.map((h) => (
              <li key={h.id} className="flex min-h-[44px] items-center justify-between gap-3 px-5 py-3">
                <span className={cn("text-[15px]", label)}>{monthLabel(h.valid_month)}</span>
                <span className={cn("text-[13px]", secondary)}>Added {when(h.created_at)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <section id="settings" className="scroll-mt-24 [column-span:all]">
        <details open={openSettings} className={cn(card, "p-0")}>
          <summary onClick={(e) => { e.preventDefault(); setOpenSettings((o) => !o); }} aria-expanded={openSettings} className={cn("flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 [&::-webkit-details-marker]:hidden")}>
            <span className="flex items-center gap-2.5">
              <Settings className={cn("h-5 w-5", tertiary)} aria-hidden />
              <span>
                <span className={cn("block text-[17px] font-semibold", label)}>Settings</span>
                <span className={cn("block text-[13px]", secondary)}>Tesla car controls, guest questions, Apple Wallet</span>
              </span>
            </span>
            <ChevronRight className={cn("h-5 w-5 transition-transform duration-200", openSettings && "rotate-90", tertiary)} aria-hidden />
          </summary>
          {openSettings && (
            <div className="gap-8 border-t px-2 pb-2 pt-5 columns-1 md:columns-[28rem] md:px-3 [&>section]:mb-8 [&>section]:break-inside-avoid" style={{ borderColor: "rgba(127,127,127,.2)" }}>
              <Section title="Guest questions">
                <GuestHelperCard />
              </Section>
              <TripSettingsBody />
            </div>
          )}
        </details>
      </section>
      </div>
    </div>
  );
}
