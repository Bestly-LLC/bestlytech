/**
 * A call transcript read like iMessage: Jared on the right in blue, everyone
 * else on the left in grey, consecutive lines from one person stacked into one
 * run, and a centred time stamp whenever there is a pause.
 *
 * Input is the recorder's plain text:
 *   # header notes
 *   [00:16] ELIZABETH: The service agreement is fine.
 *   [1:02:03] ELI?: ...      ("?" = the name was a voice guess)
 */
import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Line { t: number; stamp: string; who: string; guess: boolean; text: string }

const LINE = /^\[(\d{1,2}:)?(\d{1,2}):(\d{2})\]\s*([^:]{1,40}?):\s?(.*)$/;

export function parseTranscript(raw: string): { lines: Line[]; notes: string[] } {
  const lines: Line[] = [];
  const notes: string[] = [];
  for (const l of raw.split("\n")) {
    const s = l.trim();
    if (!s) continue;
    if (s.startsWith("#")) { notes.push(s.replace(/^#\s*/, "")); continue; }
    const m = s.match(LINE);
    if (!m) {
      if (lines.length) lines[lines.length - 1].text += " " + s; // wrapped line
      continue;
    }
    const h = m[1] ? Number(m[1].slice(0, -1)) : 0;
    const t = h * 3600 + Number(m[2]) * 60 + Number(m[3]);
    const rawWho = m[4].trim();
    lines.push({ t, stamp: `${m[1] ?? ""}${m[2]}:${m[3]}`, who: rawWho.replace(/\?+$/, "").toUpperCase(), guess: /\?$/.test(rawWho), text: m[5].trim() });
  }
  return { lines, notes };
}

const title = (who: string) => who.charAt(0) + who.slice(1).toLowerCase();

/** Plain, readable text for pasting elsewhere: one paragraph per turn, no time stamps. */
export function cleanTranscript(lines: Line[]): string {
  const out: string[] = [];
  for (const l of lines) {
    const last = out.length ? out[out.length - 1] : "";
    const name = title(l.who) + (l.guess ? " (?)" : "");
    if (last.startsWith(name + ": ")) out[out.length - 1] = last + " " + l.text;
    else out.push(`${name}: ${l.text}`);
  }
  return out.join("\n\n");
}

// Far-end people get their own name colour so a three-way call stays readable.
const NAME_TINTS = ["text-emerald-300 bento:text-emerald-700", "text-amber-300 bento:text-amber-700", "text-sky-300 bento:text-sky-700", "text-pink-300 bento:text-pink-700", "text-violet-300 bento:text-violet-700"];

export function TranscriptBubbles({ text, me = "JARED", className }: { text: string; me?: string; className?: string }) {
  const { lines, notes } = useMemo(() => parseTranscript(text), [text]);
  const tints = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of lines) if (l.who !== me && !m.has(l.who)) m.set(l.who, NAME_TINTS[m.size % NAME_TINTS.length]);
    return m;
  }, [lines, me]);

  if (!lines.length) {
    return <pre className={cn("whitespace-pre-wrap font-mono text-xs leading-relaxed text-white/70", className)}>{text || "No words were recorded on this call."}</pre>;
  }

  // Runs: same speaker, under 45s apart.
  const runs: { who: string; guess: boolean; mine: boolean; lines: Line[]; gapBefore: boolean }[] = [];
  lines.forEach((l, i) => {
    const prev = lines[i - 1];
    const gap = !prev || l.t - prev.t > 120;
    const last = runs[runs.length - 1];
    if (last && last.who === l.who && !gap && l.t - last.lines[last.lines.length - 1].t < 45) last.lines.push(l);
    else runs.push({ who: l.who, guess: l.guess, mine: l.who === me, lines: [l], gapBefore: gap });
  });

  return (
    <div className={cn("space-y-1 px-1 py-2", className)}>
      {notes.length > 0 && (
        <p className="mx-auto mb-3 max-w-md text-center text-[11px] leading-relaxed text-white/35">
          {notes.find((n) => /always correct/i.test(n)) ? "Blue is Jared's own mic. A name with ? was matched by voice, so it may be wrong." : notes[0]}
        </p>
      )}
      {runs.map((r, i) => (
        <div key={i}>
          {r.gapBefore && (
            <p className="py-2 text-center text-[11px] font-medium tabular-nums text-white/35">{r.lines[0].stamp}</p>
          )}
          <div className={cn("flex flex-col gap-[3px]", r.mine ? "items-end" : "items-start", i > 0 && !r.gapBefore && "mt-2")}>
            {!r.mine && (
              <span className={cn("ml-3 text-[11px] font-semibold", tints.get(r.who))}>
                {title(r.who)}{r.guess && <span className="font-normal text-white/35"> (guess)</span>}
              </span>
            )}
            {r.lines.map((l, j) => {
              const first = j === 0, last = j === r.lines.length - 1;
              return (
                <p
                  key={j}
                  title={l.stamp}
                  className={cn(
                    "max-w-[82%] whitespace-pre-wrap break-words px-3.5 py-2 text-[0.9375rem] leading-snug",
                    r.mine
                      ? "bg-[#0A84FF] text-white"
                      : "bg-[#26252A] text-white/90 bento:bg-[#E9E9EB] bento:text-[#111114]",
                    // iMessage corners: the tail side tightens between stacked bubbles.
                    "rounded-[20px]",
                    r.mine ? cn(!first && "rounded-tr-[6px]", !last && "rounded-br-[6px]") : cn(!first && "rounded-tl-[6px]", !last && "rounded-bl-[6px]"),
                  )}
                >
                  {l.text}
                </p>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CopyTranscriptButton({ text, className }: { text: string; className?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    const { lines } = parseTranscript(text);
    try {
      await navigator.clipboard.writeText(lines.length ? cleanTranscript(lines) : text);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch { /* clipboard blocked */ }
  };
  return (
    <button
      onClick={copy}
      disabled={!text}
      className={cn(
        "inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition active:scale-[0.97]",
        done ? "bg-emerald-500/15 text-emerald-300 bento:text-emerald-700" : "bg-white/[0.08] text-white hover:bg-white/[0.12]",
        className,
      )}
    >
      {done ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {done ? "Copied" : "Copy"}
    </button>
  );
}
