/** Step 3: "You're on the wall" + the take-home badge (save to Photos / download / email to yourself). */
import { useEffect, useMemo, useState } from "react";
import { badgeBlob, drawBadge, type BadgeInput } from "./badge";
import { emailBadge } from "./signApi";

export default function BadgeStep({
  token, badge, canSignAgain, onSignAgain,
}: {
  token: string;
  badge: BadgeInput;
  canSignAgain: boolean;
  onSignAgain: () => void;
}) {
  const canvas = useMemo(() => drawBadge(badge), [badge]);
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [sendState, setSendState] = useState<"idle" | "sending" | "sent">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let u: string | null = null;
    badgeBlob(canvas).then((b) => { setBlob(b); u = URL.createObjectURL(b); setUrl(u); }).catch(() => setUrl(canvas.toDataURL("image/png")));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [canvas]);

  const fileName = `kings-road-badge-${String(badge.badgeNo).padStart(4, "0")}.png`;

  const download = () => {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const save = async () => {
    if (!blob) return download();
    const file = new File([blob], fileName, { type: "image/png" });
    // iPhone: the share sheet has "Save Image", which puts it straight in Photos
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "My Kings Road wall badge" }); return; }
      catch (e) { if ((e as Error)?.name === "AbortError") return; }
    }
    download();
  };

  const sendEmail = async () => {
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email.trim())) { setMsg("That email doesn't look right."); return; }
    setSendState("sending");
    setMsg(null);
    const png = canvas.toDataURL("image/png");
    const r = await emailBadge(token, email.trim(), png, badge.name);
    if (r.ok) { setSendState("sent"); setMsg(null); }
    else { setSendState("idle"); setMsg(r.error ?? "That didn't send."); }
  };

  return (
    <div className="flex h-full min-h-0 items-center gap-5">
      <div className="sw-pop h-full shrink-0" style={{ aspectRatio: "1080 / 1350" }}>
        {url ? (
          <img src={url} alt={`Your Kings Road wall badge, number ${badge.badgeNo}`} className="h-full w-full rounded-[18px] object-contain shadow-[0_10px_40px_rgba(255,79,139,.35)]" />
        ) : (
          <div className="h-full w-full animate-pulse rounded-[18px] bg-white/10" />
        )}
      </div>

      <aside className="sw-rise flex h-full min-w-0 flex-1 flex-col justify-center gap-2.5" style={{ animationDelay: "120ms" }}>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: badge.color, boxShadow: `0 0 26px ${badge.color}` }}>
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} className="sw-check" />
            </svg>
          </div>
          <div>
            <h1 className="text-[22px] font-bold leading-tight tracking-[-0.02em]">You're on the wall</h1>
            <p className="text-[15px] text-white/60">Look up. It's writing itself right now.</p>
          </div>
        </div>
        <p className="mt-1 text-[15px] text-white/80">Here's a badge to take home.</p>

        {!emailOpen ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={save} disabled={!url} className="h-12 min-w-[150px] flex-1 rounded-[14px] bg-white px-4 text-[17px] font-semibold text-black active:scale-[0.97] disabled:opacity-40">
              Save badge
            </button>
            <button type="button" onClick={() => setEmailOpen(true)} className="h-12 min-w-[150px] flex-1 rounded-[14px] bg-white/[0.12] px-4 text-[17px] font-semibold active:scale-[0.97]">
              Email it to me
            </button>
          </div>
        ) : sendState === "sent" ? (
          <div className="rounded-[14px] bg-white/[0.08] px-4 py-3 text-[15px] leading-snug ring-1 ring-white/10" role="status">
            Sent to <span className="font-semibold">{email.trim()}</span>. Check your inbox in a minute. That's the only email you'll get.
          </div>
        ) : (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void sendEmail(); }}>
            <label className="min-w-0 flex-1">
              <span className="sr-only">Your email</span>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="off"
                enterKeyHint="send"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                className="h-12 w-full rounded-[14px] bg-white/[0.08] px-3.5 text-[17px] text-white outline-none ring-1 ring-white/10 placeholder:text-white/35 focus:ring-2 focus:ring-white/40"
              />
            </label>
            <button type="submit" disabled={sendState === "sending"} className="h-12 w-[84px] shrink-0 rounded-[14px] bg-white text-[17px] font-semibold text-black active:scale-[0.97] disabled:opacity-40">
              {sendState === "sending" ? "…" : "Send"}
            </button>
          </form>
        )}
        {msg && <p role="alert" className="text-[14px] text-[#FFB4B4]">{msg}</p>}
        {emailOpen && sendState !== "sent" && <p className="text-[13px] text-white/40">Just this one email. No list, no newsletter.</p>}

        <div className="flex flex-wrap gap-x-4">
          <button type="button" onClick={download} disabled={!url} className="h-11 text-[15px] font-medium text-white/60 underline-offset-4 active:opacity-60">
            Download file
          </button>
          {canSignAgain && (
            <button type="button" onClick={onSignAgain} className="h-11 text-[15px] font-medium text-white/60 underline-offset-4 active:opacity-60">
              Sign again
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
