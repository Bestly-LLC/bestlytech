/**
 * "Open this on your phone": the Tesla phone key only works on the phone that has the Tesla app, so when a guest opens
 * their trip page on a computer or iPad while the key is ready, a pop-up shows a QR code of the (short) trip link.
 * Once per visit ("Not now" hides it until the page is opened again). Preview anywhere with ?handoff=1.
 */
import { useEffect, useState } from "react";
import { Copy, Smartphone, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { track } from "./track";

const ACCENT = "var(--trip-accent)";
const isPhone = () => typeof navigator !== "undefined" && /iPhone|iPod|Android.*Mobile|Windows Phone/i.test(navigator.userAgent);

export function PhoneHandoff({ token, keyReady }: { token: string; keyReady: boolean }) {
  const force = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("handoff") === "1";
  const k = `handoff-dismissed:${token}`;
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!force && (!keyReady || isPhone())) { setShow(false); return; }
    let seen = false; try { seen = sessionStorage.getItem(k) === "1"; } catch { /* private mode */ }
    if (seen && !force) return;
    const t = window.setTimeout(() => { setShow(true); track(token, "handoff_shown"); }, 900);
    return () => window.clearTimeout(t);
  }, [keyReady, force, k, token]);
  useEffect(() => {
    if (!show) return;
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);
  const close = () => { setShow(false); try { sessionStorage.setItem(k, "1"); } catch { /* ignore */ } };
  if (!show) return null;
  const link = `https://bestly.tech/t/${token}`;
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ } };
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center p-4" role="dialog" aria-modal="true" aria-labelledby="handoff-title">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />
      <div className="trip-glass trip-glass-dark trip-pop-in relative w-full max-w-sm rounded-[28px] p-6 text-center text-white">
        <button type="button" onClick={close} aria-label="Not now"
          className="absolute right-0 top-0 z-[2] grid h-[60px] w-[60px] place-items-center rounded-bl-[30px] bg-white/[0.10] pb-1 pl-1 text-white/85 active:bg-white/20">
          <X className="h-[18px] w-[18px]" strokeWidth={2.5} />
        </button>
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full" style={{ background: ACCENT }}><Smartphone className="h-6 w-6 text-[#1A1140]" /></span>
        <h2 id="handoff-title" className="mt-3 text-[22px] font-bold leading-tight">Open this on your phone</h2>
        <p className="mt-1.5 text-[15px] leading-snug text-white/80">Your phone is the car key. Scan this with the phone that has the Tesla app, then tap <b className="text-white">Add the car to my Tesla app</b>.</p>
        <div className="mx-auto mt-4 w-fit rounded-2xl bg-white p-3 shadow-lg"><QRCodeSVG value={link} size={176} level="M" /></div>
        <button type="button" onClick={() => void copy()} className="mx-auto mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-full bg-white/10 px-4 text-[14px] font-semibold text-white ring-1 ring-white/15">
          <Copy className="h-4 w-4" /> {copied ? "Copied" : link.replace("https://", "")}
        </button>
        <button type="button" onClick={close} className="mt-2 block w-full text-[14px] text-white/60 underline decoration-white/25 underline-offset-2">Keep looking on this computer</button>
      </div>
    </div>
  );
}
