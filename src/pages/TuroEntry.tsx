/**
 * /turo-key (home pickup) and /turo-lax (LAX delivery) — the one link in the Turo booking message.
 * The guest types the phone number and last name on their Turo account; the server finds their trip and sends them to
 * /t/<token>. The device remembers the trip, so a return visit is one tap ("Continue"). The key itself is still held
 * until license + host check-in are confirmed (see lax_guest_public), so signing in here never releases anything early.
 *
 * 2026-10-06 redesign (Apple HIG pass): same night scene as the trip page it opens, Blue Steel drives in, iOS grouped
 * fields, spring motion (framer-motion), Reduce Motion = crossfades only. International phones: country picker +
 * as-you-type formatting (libphonenumber-js), sent to the server as E.164. Copy follows the phone's language.
 *
 * Host test: /turo-key?test=1 prefills the US demo (555-555-0100 / Test); ?test=kr prefills the Korean demo
 * (+82 10-5555-0100 / Test).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, MotionConfig, motion, useAnimationControls, useReducedMotion } from "framer-motion";
import { Check, ChevronDown, Globe, Loader2 } from "lucide-react";
import { AsYouType, getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/min";
import { supabase } from "@/integrations/supabase/client";
import { COPY, pickLang, pickRegion, type Lang } from "./turo-entry/strings";

type Kind = "home" | "lax";
const MEM = "bestly-trip-entry";
type Mem = { token: string; first: string };
const readMem = (): Mem | null => { try { const m = JSON.parse(localStorage.getItem(MEM) || "null"); return m?.token ? m : null; } catch { return null; } };

const SCENE: Record<Kind, { hero: string; bg: string; accent: string; ink: string; pos: string }> = {
  home: { hero: "/wallet/home/hero-mcm-v5.svg", bg: "radial-gradient(120% 60% at 50% 0%, #1f4442 0%, #132726 62%)", accent: "#E8A93A", ink: "#1b1405", pos: "60% 70%" },
  lax: { hero: "/wallet/lax/hero-live3.svg", bg: "radial-gradient(120% 60% at 50% 0%, #2a1d5e 0%, #1A1140 62%)", accent: "#FFB878", ink: "#2a1405", pos: "65% center" },
};

// iOS-like spring: quick, settles without wobble.
const SPRING = { type: "spring", stiffness: 420, damping: 34, mass: 0.9 } as const;
const SOFT = { type: "spring", stiffness: 160, damping: 22, mass: 1 } as const;

const ALL_COUNTRIES = getCountries();
const countryName = (dn: Intl.DisplayNames | null, c: string) => { try { return dn?.of(c) || c; } catch { return c; } };

function initialCountry(): CountryCode {
  const r = pickRegion();
  return r && (ALL_COUNTRIES as string[]).includes(r) ? (r as CountryCode) : "US";
}

export default function TuroEntry({ kind }: { kind: Kind }) {
  const nav = useNavigate();
  const reduce = useReducedMotion();
  const scene = SCENE[kind];
  const testMode = useMemo(() => new URLSearchParams(window.location.search).get("test"), []);
  const autoLang = useMemo(() => pickLang(), []);
  const [lang, setLang] = useState<Lang>(autoLang);
  const t = COPY[lang];

  const [mem, setMem] = useState<Mem | null>(() => (testMode ? null : readMem()));
  const [country, setCountry] = useState<CountryCode>(() => (testMode === "kr" ? "KR" : testMode ? "US" : initialCountry()));
  const [phone, setPhone] = useState(testMode === "kr" ? "010-5555-0100" : testMode ? "(555) 555-0100" : "");
  const [last, setLast] = useState(testMode ? "Test" : "");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [err, setErr] = useState("");
  const phoneRef = useRef<HTMLInputElement>(null);
  const card = useAnimationControls();

  useEffect(() => { document.title = lang === "en" ? "Your Blue Steel trip" : `${t.title} · Blue Steel`; document.documentElement.lang = lang; }, [lang, t.title]);

  const dn = useMemo(() => { try { return new Intl.DisplayNames([lang === "zh-Hant" ? "zh-Hant" : lang], { type: "region" }); } catch { return null; } }, [lang]);
  const countries = useMemo(() => {
    const coll = new Intl.Collator(lang);
    return ALL_COUNTRIES.map((c) => ({ c, name: countryName(dn, c), code: getCountryCallingCode(c) }))
      .sort((a, b) => coll.compare(a.name, b.name));
  }, [dn, lang]);

  // Typing or pasting "+82 10…" switches the country to match.
  const onPhone = (raw: string) => {
    let v = raw.replace(/[^\d+()\-\s.]/g, "");
    // Backspace over a "(", ")" or "-" should delete the digit before it, not get re-added by the formatter.
    if (v.length < phone.length && v.replace(/\D/g, "") === phone.replace(/\D/g, "")) v = v.replace(/\d(?=\D*$)/, "");
    if (v.trim().startsWith("+")) {
      const f = new AsYouType();
      const out = f.input(v);
      const c = f.getCountry();
      if (c) {
        setCountry(c);
        const n = f.getNumber();
        setPhone(n && n.isPossible() ? n.formatNational() : new AsYouType(c).input(n?.nationalNumber || ""));
        return;
      }
      setPhone(out);
      return;
    }
    setPhone(new AsYouType(country).input(v));
  };
  const onCountry = (c: CountryCode) => {
    setCountry(c);
    const digits = phone.replace(/\D/g, "");
    setPhone(digits ? new AsYouType(c).input(digits) : "");
    phoneRef.current?.focus();
  };

  const shake = () => { if (!reduce) card.start({ x: [0, -11, 10, -7, 6, -3, 0], transition: { duration: 0.42, ease: "easeOut" } }); };
  const fail = (msg: string) => { setErr(msg); setState("idle"); shake(); requestAnimationFrame(() => phoneRef.current?.focus()); };

  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state !== "idle") return;
    setErr("");
    const digits = phone.replace(/\D/g, "");
    if (!digits || last.trim().length < 2) return fail(t.errMissing);
    const parsed = phone.trim().startsWith("+") ? parsePhoneNumberFromString(phone) : parsePhoneNumberFromString(phone, country);
    if (!parsed || !parsed.isPossible()) return fail(t.errPhone);
    setState("busy");
    try {
      const { data, error } = await (supabase.rpc as any)("guest_entry_lookup", { p_kind: kind, p_phone: parsed.number, p_last: last.trim() }); // eslint-disable-line @typescript-eslint/no-explicit-any
      if (error) throw error;
      if (data?.ok && data.token) {
        if (!data.demo) { try { localStorage.setItem(MEM, JSON.stringify({ token: data.token, first: data.first || "" })); } catch { /* private mode */ } }
        setState("done");
        window.setTimeout(() => nav(`/t/${data.token}`), reduce ? 150 : 650);
        return;
      }
      fail(data?.reason === "slow_down" ? t.errSlow : data?.reason === "missing" ? t.errMissing : t.errNoMatch);
    } catch { fail(t.errNet); }
  };

  const openSaved = () => {
    if (!mem || state !== "idle") return;
    setState("done");
    window.setTimeout(() => nav(`/t/${mem.token}`), reduce ? 150 : 650);
  };

  const rise = (i: number) => ({
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: reduce ? { duration: 0.2 } : { ...SOFT, delay: 0.25 + i * 0.05 },
  });

  const leaving = state === "done";
  const field = "w-full bg-transparent text-[17px] text-white outline-none placeholder:text-white/35";

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative min-h-dvh overflow-x-hidden text-white" style={{ background: scene.bg, fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Inter, system-ui, sans-serif", WebkitTapHighlightColor: "transparent" }}>
        <div className="relative">
        {/* Night scene — same art as the trip page this opens, so the hand-off feels like one place. */}
        <motion.div
          className="pointer-events-none relative overflow-hidden"
          style={{ height: "calc(11rem + env(safe-area-inset-top))" }}
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.06 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={reduce ? { duration: 0.25 } : { duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        >
          <img src={scene.hero} alt="" className="block h-full w-full object-cover" style={{ objectPosition: scene.pos }} />
          <div className="absolute inset-x-0 bottom-0 h-24" style={{ background: `linear-gradient(to bottom, transparent, ${kind === "home" ? "#132726" : "#1A1140"})` }} />
        </motion.div>

        {autoLang !== "en" ? (
          <motion.button
            type="button"
            onClick={() => setLang(lang === "en" ? autoLang : "en")}
            className="absolute right-4 flex min-h-[44px] items-center gap-1.5 rounded-full bg-black/35 px-3.5 text-[15px] font-medium text-white backdrop-blur-md ring-1 ring-white/15"
            style={{ top: "max(12px, env(safe-area-inset-top))" }}
            whileTap={{ scale: 0.95 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            aria-label={lang === "en" ? COPY[autoLang].name : "English"}
          >
            <Globe className="h-4 w-4" aria-hidden />{lang === "en" ? COPY[autoLang].name : "English"}
          </motion.button>
        ) : null}

        {/* Blue Steel pulls in, then drives off when the trip opens. */}
        <motion.img
          src="/wallet/lax/car-cutout-v2.webp"
          alt="Blue Steel, the Tesla Model 3"
          width={600}
          height={432}
          decoding="async"
          className="pointer-events-none absolute inset-x-0 z-10 mx-auto w-[min(60vw,264px)] select-none"
          style={{ bottom: "-3.1rem", filter: "drop-shadow(0 18px 22px rgba(0,0,0,.55))" }}
          initial={reduce ? { opacity: 0 } : { opacity: 0, x: "70vw" }}
          animate={leaving && !reduce ? { opacity: 0, x: "-90vw", transition: { duration: 0.55, ease: [0.55, 0, 0.75, 0.2] } } : { opacity: 1, x: 0 }}
          transition={reduce ? { duration: 0.3 } : { type: "spring", stiffness: 70, damping: 15, mass: 1.1, delay: 0.15 }}
        />
        </div>

        <main className="relative z-20 mx-auto max-w-[460px] px-5" style={{ paddingBottom: "max(28px, env(safe-area-inset-bottom))", marginTop: "3.6rem" }}>
          <motion.p {...rise(0)} className="text-[13px] font-semibold uppercase tracking-[0.14em] text-white/55">Blue Steel · Tesla Model 3</motion.p>
          <AnimatePresence mode="wait" initial={false}>
            <motion.h1 key={`${lang}-${mem ? "back" : "in"}`} {...rise(1)} exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }} className="mt-1 text-[34px] font-bold leading-[1.12] tracking-[-0.01em]">
              {mem ? t.welcome(mem.first) : t.title}
            </motion.h1>
          </AnimatePresence>
          <motion.p key={`s-${lang}-${mem ? 1 : 0}`} {...rise(2)} className="mb-5 mt-2 text-[17px] leading-snug text-white/65">
            {mem ? t.subBack : kind === "lax" ? t.subLax : t.subHome}
          </motion.p>

          {mem ? (
            <motion.div {...rise(3)} className="space-y-2">
              <motion.button
                onClick={openSaved}
                whileTap={{ scale: 0.97 }}
                className="flex min-h-[54px] w-full items-center justify-center gap-2 rounded-[16px] text-[17px] font-semibold shadow-lg shadow-black/25"
                style={{ background: scene.accent, color: scene.ink }}
              >
                <ButtonFace state={state} label={t.cont} />
              </motion.button>
              <button onClick={() => { try { localStorage.removeItem(MEM); } catch { /* ignore */ } setMem(null); }} className="min-h-[44px] w-full text-[15px] font-medium" style={{ color: scene.accent }}>{t.notYou}</button>
            </motion.div>
          ) : (
            <motion.div {...rise(3)}>
            <motion.form onSubmit={go} noValidate animate={card}>
              {/* iOS grouped inset list */}
              <div className="overflow-hidden rounded-[16px] bg-white/[0.08] ring-1 ring-white/10 backdrop-blur-xl">
                <label className="block px-4 pb-1 pt-3 text-[13px] font-medium text-white/60" htmlFor="te-phone">{t.phone}</label>
                <div className="flex items-center gap-2 px-4 pb-3">
                  <div className="relative shrink-0">
                    <span aria-hidden className="pointer-events-none flex h-[44px] items-center gap-1 rounded-[10px] bg-white/10 px-2.5 text-[17px] font-medium tabular-nums">
                      <span className="whitespace-nowrap">{country} +{getCountryCallingCode(country)}</span><ChevronDown className="h-4 w-4 opacity-60" />
                    </span>
                    <select
                      aria-label={t.country}
                      value={country}
                      onChange={(e) => onCountry(e.target.value as CountryCode)}
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    >
                      {countries.map(({ c, name, code }) => <option key={c} value={c}>{name} (+{code})</option>)}
                    </select>
                  </div>
                  <input
                    id="te-phone"
                    ref={phoneRef}
                    className={`${field} h-[44px] min-w-0 flex-1 tabular-nums`}
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    enterKeyHint="next"
                    placeholder={country === "US" || country === "CA" ? "(555) 555-5555" : ""}
                    value={phone}
                    onChange={(e) => onPhone(e.target.value)}
                    aria-invalid={!!err}
                    aria-describedby={err ? "te-err" : undefined}
                  />
                </div>
                <div className="ml-4 h-px bg-white/10" />
                <label className="block px-4 pt-3 text-[13px] font-medium text-white/60" htmlFor="te-last">{t.last}</label>
                <input
                  id="te-last"
                  className={`${field} h-[40px] px-4`}
                  type="text"
                  autoComplete="family-name"
                  autoCapitalize="words"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="go"
                  value={last}
                  onChange={(e) => setLast(e.target.value)}
                  aria-describedby="te-last-hint"
                />
                <p id="te-last-hint" className="px-4 pb-3 text-[13px] leading-snug text-white/45">{t.lastHint}</p>
              </div>

              <AnimatePresence initial={false}>
                {err && (
                  <motion.p
                    id="te-err"
                    role="alert"
                    key={err}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, transition: { duration: 0.12 } }}
                    transition={SPRING}
                    className="mt-3 rounded-[14px] bg-[#ff453a]/15 px-4 py-3 text-[15px] leading-snug text-[#ff9f97] ring-1 ring-[#ff453a]/30"
                  >
                    {err}
                  </motion.p>
                )}
              </AnimatePresence>

              <motion.button
                type="submit"
                disabled={state !== "idle"}
                whileTap={{ scale: 0.97 }}
                className="mt-4 flex min-h-[54px] w-full items-center justify-center gap-2 rounded-[16px] text-[17px] font-semibold shadow-lg shadow-black/25 disabled:cursor-default"
                style={{ background: scene.accent, color: scene.ink, touchAction: "manipulation" }}
              >
                <ButtonFace state={state} label={t.open} />
              </motion.button>
              <p className="pt-4 text-center text-[13px] leading-snug text-white/45">{t.note}</p>
            </motion.form>
            </motion.div>
          )}
          <p className="sr-only" aria-live="polite">{leaving ? t.opening : ""}</p>
        </main>
      </div>
    </MotionConfig>
  );
}

/** Label -> spinner -> checkmark, crossfading in place so the button never changes size. */
function ButtonFace({ state, label }: { state: "idle" | "busy" | "done"; label: string }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {state === "idle" && (
        <motion.span key="l" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.1 } }} transition={SPRING}>
          {label}
        </motion.span>
      )}
      {state === "busy" && (
        <motion.span key="b" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.1 } }} transition={SPRING}>
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
        </motion.span>
      )}
      {state === "done" && (
        <motion.span key="d" initial={{ opacity: 0, scale: 0.4, rotate: -20 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 520, damping: 22 }}>
          <Check className="h-7 w-7" strokeWidth={3} aria-hidden />
        </motion.span>
      )}
    </AnimatePresence>
  );
}
