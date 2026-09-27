/** Step 2: one emoji per guest, unique across the wall. Scout (the server) decides where it lands. */
import { useEffect, useMemo, useState } from "react";
import { PICKS, emojiKey, isOneEmoji, lastEmoji, surprise } from "./emoji";
import { claimEmoji, takenEmojis, type WallEmoji } from "./signApi";

export default function EmojiStep({
  token, onDone, onSkip, onExpired,
}: {
  token: string;
  onDone: (e: WallEmoji) => void;
  onSkip: () => void;
  onExpired: () => void;
}) {
  const [taken, setTaken] = useState<Set<string>>(new Set());
  const [pick, setPick] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    takenEmojis(token)
      .then((list) => setTaken(new Set(list.map(emojiKey))))
      .catch((e) => { if (String(e?.message).includes("coaster")) onExpired(); });
  }, [token, onExpired]);

  const isTaken = (e: string) => taken.has(emojiKey(e));
  const choose = (e: string) => {
    if (isTaken(e)) {
      setMsg(`${e} is already on the wall. Pick another?`);
      return;
    }
    setPick(e);
    setMsg(null);
  };

  const onType = (v: string) => {
    setTyped(v.slice(-24));
    const e = lastEmoji(v);
    if (e) choose(e);
    else if (v.trim()) setMsg("Only emoji here. Use your emoji keyboard.");
  };

  const surpriseMe = () => {
    const e = surprise(taken);
    if (e) { setPick(e); setMsg(null); setTyped(""); }
    else setMsg("Every emoji we know is taken. Type your own!");
  };

  const place = async () => {
    if (!pick || !isOneEmoji(pick)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await claimEmoji(token, pick);
      if (r.ok && r.emoji) { onDone(r.emoji); return; }
      if (r.reason === "already" && r.emoji) { onDone(r.emoji); return; }
      if (r.reason === "taken") {
        setTaken(new Set((r.taken ?? []).map(emojiKey)));
        setMsg(`Someone just took ${pick}. Pick another?`);
        setPick(null);
      } else if (r.reason === "not_emoji") {
        setMsg("That one won't fit on the wall. Try a single emoji.");
      } else {
        setMsg("Sign first, then add your emoji.");
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      if (m.includes("coaster")) onExpired();
      else setMsg(m.includes("slow down") ? "Lots of emoji landing right now. Try again in a sec." : "That didn't go through. Try again?");
    } finally {
      setBusy(false);
    }
  };

  const grid = useMemo(() => {
    const extra = pick && !PICKS.some((p) => emojiKey(p) === emojiKey(pick)) ? [pick] : [];
    return [...extra, ...PICKS];
  }, [pick]);

  return (
    <div className="flex h-full min-h-0 gap-3">
      <section className="sw-rise flex min-w-0 flex-1 flex-col">
        <h1 className="text-[22px] font-bold leading-tight tracking-[-0.02em]">Add one emoji to the wall</h1>
        <p className="mt-0.5 text-[15px] leading-snug text-white/55">Scout finds it a spot. Each emoji can only be up there once.</p>
        <div className="sw-scroll mt-2 min-h-0 flex-1 overflow-y-auto rounded-[18px] bg-white/[0.05] p-1.5 ring-1 ring-white/10">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(46px,1fr))]" role="listbox" aria-label="Emoji">
            {grid.map((e) => {
              const t = isTaken(e), on = pick !== null && emojiKey(pick) === emojiKey(e);
              return (
                <button
                  key={e}
                  type="button"
                  role="option"
                  aria-selected={on}
                  aria-disabled={t}
                  aria-label={t ? `${e}, taken` : e}
                  onClick={() => choose(e)}
                  className={`relative flex h-[46px] items-center justify-center rounded-[12px] text-[28px] leading-none transition active:scale-90 ${on ? "bg-white/20 ring-2 ring-white/70" : ""} ${t ? "opacity-25 grayscale" : ""}`}
                >
                  {e}
                  {t && <span aria-hidden className="absolute left-2 right-2 top-1/2 h-[2px] -rotate-12 rounded bg-white/80" />}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <aside className="sw-rise flex w-[232px] shrink-0 flex-col gap-2.5" style={{ animationDelay: "60ms" }}>
        <div className="flex items-center gap-3">
          <div className={`flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-[20px] text-[44px] leading-none ${pick ? "bg-white/[0.1] ring-1 ring-white/20" : "border-2 border-dashed border-white/20"}`} aria-live="polite">
            {pick ?? ""}
          </div>
          <p className="text-[15px] leading-snug text-white/60">{pick ? "Nice pick." : "Tap one, type one, or let us pick."}</p>
        </div>
        <label className="block">
          <span className="sr-only">Type any emoji</span>
          <input
            value={typed}
            onChange={(e) => onType(e.target.value)}
            enterKeyHint="done"
            placeholder="Or type any emoji"
            autoComplete="off"
            autoCorrect="off"
            className="h-11 w-full rounded-[12px] bg-white/[0.08] px-3.5 text-[20px] text-white outline-none ring-1 ring-white/10 placeholder:text-[16px] placeholder:text-white/35 focus:ring-2 focus:ring-white/40"
          />
        </label>
        <button type="button" onClick={surpriseMe} className="h-11 rounded-[12px] bg-white/[0.1] text-[16px] font-semibold active:scale-[0.97]">
          Surprise me
        </button>
        {msg && <p role="alert" className="text-[14px] leading-snug text-[#FFB4B4]">{msg}</p>}
        <div className="mt-auto flex gap-2">
          <button type="button" onClick={onSkip} className="h-12 w-[84px] rounded-[14px] text-[17px] font-semibold text-white/70 active:scale-[0.97]">
            Skip
          </button>
          <button
            type="button"
            onClick={place}
            disabled={!pick || busy}
            className="h-12 flex-1 rounded-[14px] bg-white text-[17px] font-semibold text-black transition active:scale-[0.97] disabled:opacity-40"
          >
            {busy ? "Placing…" : "Put it up"}
          </button>
        </div>
      </aside>
    </div>
  );
}
