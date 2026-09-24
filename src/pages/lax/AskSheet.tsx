/**
 * "Ask a question" helper for the LAX guest page. Free: Gemini free tier first, then the Mac mini's
 * local model, then the FAQ (all decided server-side in the lax-ask edge function + lax_ask_poll).
 * Opens in the same luggage bottom sheet as Pickup / Return.
 */
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Download, ExternalLink, FileText, MapPin, MessageCircleQuestion, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { TripSheet } from "./TripSheet";

const PEACH = "var(--trip-accent, #FFB878)"; // themeable: the home page sets WeHo colors
type Msg = { id: number | string; role: "user" | "assistant"; content: string; status?: string };
const rpc = (fn: string, args?: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;

// Fallback chips; the live ones come from lax_ask_suggest (trip phase, LA time of day, car state, last question).
const SUGGEST = ["Where do I catch the shuttle after I land?", "How do I get into the garage?", "How do I unlock and start the Tesla?", "How do I return the car?"];
const SUGGEST_HOME = ["How do I get the key?", "Where is the car?", "Which car is mine?", "Where do I return the car?"];

function Chips({ list, onPick, disabled }: { list: string[]; onPick: (s: string) => void; disabled?: boolean }) {
  if (!list.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2" aria-label="Suggested questions">
      {list.map((s) => (
        <button key={s} type="button" disabled={disabled} onClick={() => onPick(s)}
          className="min-h-[40px] rounded-full bg-white/[0.08] px-3.5 py-2 text-left text-[14px] font-medium text-white ring-1 ring-white/15 active:scale-95 disabled:opacity-40">{s}</button>
      ))}
    </div>
  );
}

/** Slim button in the bottom bar, above the Pickup / Return tags. */
export function AskButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen}
      className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-white/[0.08] text-[15px] font-semibold text-white ring-1 ring-white/15 active:scale-[0.98] motion-reduce:transition-none">
      <MessageCircleQuestion className="h-[18px] w-[18px]" style={{ color: PEACH }} aria-hidden /> Ask a question
    </button>
  );
}

// Phone numbers in an answer become one-tap call buttons.
const NAMES: Record<string, string> = { "4159654525": "Call Turo", "8777983752": "Call Tesla Roadside", "911": "Call 911" };
function phones(text: string) {
  const out: { digits: string; label: string; shown: string }[] = [];
  const re = /(?:\+?1[\s.-]?)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b|\b911\b/g;
  for (const m of text.matchAll(re)) {
    const digits = m[1] ? m[1] + m[2] + m[3] : "911";
    if (out.some((o) => o.digits === digits)) continue;
    const shown = digits === "911" ? "911" : `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    out.push({ digits, shown, label: NAMES[digits] ?? "Call" });
  }
  return out;
}
// Apps, places and documents the helper mentions become one-tap buttons (store links checked 2026-09-23).
const android = () => typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
const mapsTo = (q: string) => android() ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : `https://maps.apple.com/?q=${encodeURIComponent(q)}`;
type Act = { key: string; test: RegExp; label: string; icon: typeof Download; href: () => string };
const ACTS: Act[] = [
  { key: "tesla", test: /\btesla (mobile )?app\b|\btesla account\b/i, label: "Get the Tesla app", icon: Download,
    href: () => android() ? "https://play.google.com/store/apps/details?id=com.teslamotors.tesla" : "https://apps.apple.com/us/app/tesla/id582007913" },
  { key: "chargepoint", test: /\bchargepoint\b/i, label: "Get the ChargePoint app", icon: Download,
    href: () => android() ? "https://play.google.com/store/apps/details?id=com.coulombtech" : "https://apps.apple.com/us/app/chargepoint/id356866743" },
  { key: "turo", test: /\bturo app\b/i, label: "Open the Turo app", icon: ExternalLink,
    href: () => android() ? "https://play.google.com/store/apps/details?id=com.relayrides.android.relayrides" : "https://apps.apple.com/us/app/turo-better-car-rental/id555063314" },
  { key: "diner", test: /tesla diner|7001 santa monica/i, label: "Directions: Tesla Diner Supercharger", icon: MapPin, href: () => mapsTo("7001 Santa Monica Blvd, West Hollywood, CA") },
  { key: "home", test: /733 n(orth)? kings/i, label: "Directions: 733 N Kings Rd", icon: MapPin, href: () => mapsTo("733 N Kings Rd, West Hollywood, CA 90069") },
  { key: "incident", test: /incident (information )?card/i, label: "Turo incident card (PDF)", icon: FileText, href: () => "https://support-resources.turo.com/incidents/US%20Incident%20Information%20Card.pdf" },
];
function links(text: string) {
  const out: { key: string; label: string; href: string; icon: typeof Download }[] = [];
  for (const a of ACTS) if (a.test.test(text)) out.push({ key: a.key, label: a.label, href: a.href(), icon: a.icon });
  for (const m of text.matchAll(/https?:\/\/[^\s)<>"]+/g)) {
    const url = m[0].replace(/[.,;:!?]+$/, "");
    if (out.some((o) => o.href === url)) continue;
    let host = "link"; try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep "link" */ }
    out.push({ key: url, label: `Open ${host}`, href: url, icon: ExternalLink });
  }
  return out.slice(0, 4);
}

/** Every action the answer suggests: phone numbers, apps, places, documents, links. */
function CallButtons({ text, onAsk }: { text: string; onAsk?: (q: string) => void }) {
  const list = phones(text);
  const acts = links(text);
  if (!list.length && !acts.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {list.map((p) => (
        <a key={p.digits} href={p.digits === "911" ? "tel:911" : `tel:+1${p.digits}`}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 text-[15px] font-semibold text-[#1A1140] active:scale-95"
          style={{ background: p.digits === "911" ? "#FF6B6B" : "#7CE0A5" }}>
          <Phone className="h-4 w-4" aria-hidden /> {p.label}{p.digits !== "911" && <span className="font-medium opacity-70">{p.shown}</span>}
        </a>
      ))}
      {acts.map(({ key, label, href, icon: Icon }) => (
        <a key={key} href={href} target="_blank" rel="noreferrer"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 text-[15px] font-semibold text-[#1A1140] active:scale-95"
          style={{ background: PEACH }}>
          <Icon className="h-4 w-4" aria-hidden /> {label}
        </a>
      ))}
      {onAsk && acts.some((a) => a.key === "tesla") && (
        <button type="button" onClick={() => onAsk("I already have the Tesla app. What's next?")}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-white/10 px-4 text-[15px] font-semibold text-white ring-1 ring-white/20 active:scale-95">
          I already have it
        </button>
      )}
    </div>
  );
}

function Dots() {
  return (
    <span className="inline-flex gap-1 py-1" aria-label="Thinking">
      {[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-white/60 motion-reduce:animate-none" style={{ animationDelay: `${i * 140}ms` }} />)}
    </span>
  );
}

export function AskSheet({ open, onClose, token, slug, home = false }: { open: boolean; onClose: () => void; token?: string; slug?: string; home?: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const [urgent, setUrgent] = useState(false);
  const [chips, setChips] = useState<string[]>(home ? SUGGEST_HOME : SUGGEST);
  const loaded = useRef(false);
  const body = useRef<HTMLDivElement>(null);
  const who = { p_token: token || null, p_slug: token ? null : slug || null };
  const refreshChips = () =>
    rpc("lax_ask_suggest", who).then(({ data }) => { if (Array.isArray(data) && data.length) setChips(data as string[]); }).catch(() => {});

  useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
    rpc("lax_ask_history", who).then(({ data }) => { if (Array.isArray(data) && data.length) setMsgs(data as Msg[]); });
    refreshChips();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => { body.current?.scrollTo({ top: body.current.scrollHeight, behavior: "smooth" }); }, [msgs, open]);

  const patch = (id: Msg["id"], m: Partial<Msg>) => setMsgs((xs) => xs.map((x) => (x.id === id ? { ...x, ...m } : x)));

  const send = async (q: string) => {
    q = q.trim();
    if (!q || busy) return;
    setBusy(true); setText("");
    const tmp = `a${Date.now()}`;
    setMsgs((xs) => [...xs, { id: `u${Date.now()}`, role: "user", content: q }, { id: tmp, role: "assistant", content: "", status: "pending" }]);
    try {
      const { data, error } = await supabase.functions.invoke("lax-ask", { body: { token: token || undefined, slug: token ? undefined : slug, question: q } });
      const r = data as { ok: boolean; error?: string; reply_id?: number; status?: string; content?: string; left?: number; urgent?: boolean } | null;
      if (error || !r?.ok || !r.reply_id) { patch(tmp, { content: r?.error ?? "The helper hit a snag. Try again, or message your host in the Turo app.", status: "error" }); return; }
      if (r.left != null) setLeft(r.left);
      if (r.urgent || /accident|crash|hurt|injur|emergency|911/i.test(q)) setUrgent(true);
      if (r.status === "done") { patch(tmp, { id: r.reply_id, content: r.content ?? "", status: "done" }); return; }
      patch(tmp, { id: r.reply_id });
      for (let i = 0; i < 60; i++) {
        await new Promise((res) => setTimeout(res, 1200));
        const { data: p } = await rpc("lax_ask_poll", { ...who, p_reply_id: r.reply_id });
        const a = p as { status: string; content: string } | null;
        if (!a) continue;
        patch(r.reply_id, { content: a.content, status: a.status });
        if (a.status === "done" || a.status === "error") return;
      }
      patch(r.reply_id, { content: "That took too long. Try again, or message your host in the Turo app.", status: "error" });
    } finally { setBusy(false); refreshChips(); }
  };

  const footer = (
    <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="flex items-end gap-2">
      <label className="sr-only" htmlFor="ask-input">Your question</label>
      <textarea id="ask-input" rows={1} value={text} maxLength={500} placeholder={home ? "Ask about the key, car, parking…" : "Ask about the shuttle, garage, car…"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }}
        className="max-h-28 min-h-[48px] flex-1 resize-none rounded-2xl bg-white/[0.08] px-4 py-3 text-[16px] text-white placeholder:text-white/40 outline-none ring-1 ring-white/15 focus:ring-2 focus:ring-[color:var(--trip-accent,#FFB878)]" />
      <button type="submit" disabled={busy || !text.trim()} aria-label="Send"
        className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-[#1A1140] transition active:scale-95 disabled:opacity-40" style={{ background: PEACH }}>
        <ArrowUp className="h-5 w-5" strokeWidth={2.5} />
      </button>
    </form>
  );

  return (
    <TripSheet open={open} onClose={onClose} kicker="Trip helper" title="Ask a question" footer={footer} bodyRef={body}>
      {urgent && (
        <div className="mb-3 rounded-xl bg-[#E4527A]/20 p-3 text-[14px] font-semibold leading-snug text-white ring-1 ring-[#E4527A]/50">
          If anyone is hurt, call 911 first. Then use Roadside Assistance in the Turo app and message your host there.
        </div>
      )}
      {msgs.length === 0 ? (
        <div>
          <p className="text-[15px] leading-relaxed text-white/75">{home ? "Ask anything about your phone key, finding the car, driving it, or returning it." : "Ask anything about getting to the garage, the lobby door, the car, or returning it."} Answers come from your trip guide.</p>
          <Chips list={chips} onPick={send} />
        </div>
      ) : (
        <>
        <ul className="space-y-3" aria-live="polite">
          {msgs.map((m) => (
            <li key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed ${m.role === "user"
                ? "rounded-br-md text-[#1A1140]" : "rounded-bl-md bg-white/[0.08] text-white ring-1 ring-white/10"} ${m.status === "error" ? "ring-[#E4527A]/60" : ""}`}
                style={m.role === "user" ? { background: PEACH } : undefined}>
                {m.content || (m.status === "pending" || m.status === "working" ? <Dots /> : "")}
                {m.role === "assistant" && m.status !== "pending" && m.status !== "working" && m.content && <CallButtons text={m.content} onAsk={busy ? undefined : send} />}
              </div>
            </li>
          ))}
        </ul>
        {!busy && <Chips list={chips} onPick={send} />}
        </>
      )}
      <p className="mt-5 text-[12px] leading-snug text-white/45">
        Automated helper. It can make mistakes and can't change your trip. For anything else, message your host in the Turo app.
        {left != null && left <= 5 ? ` ${left} question${left === 1 ? "" : "s"} left today.` : ""}
      </p>
    </TripSheet>
  );
}
