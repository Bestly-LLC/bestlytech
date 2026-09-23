import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyText } from "@/lib/copyForClaude";
import { cn } from "@/lib/utils";

/**
 * Text Jared may need to paste somewhere, with ONE copy button.
 *
 * If the text holds a command or value to paste (in `backticks`, or after "run:" / "paste:"),
 * that part shows in a monospace box and the button copies exactly it. Otherwise the button
 * copies the whole text. Writers (Scout, the Mac-side Claude) should wrap anything to paste in
 * backticks so this picks it up.
 */
export function pasteable(text: string): string | null {
  const ticks = [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter(Boolean);
  if (ticks.length) return ticks.join("\n");
  const m = text.match(/\b(?:run|paste|type|enter)\s*:\s*(.+?)(?:\s{2,}|\s\(|,\s*then\b|\.\s|$)/i);
  return m ? m[1].trim() : null;
}

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        if (await copyText(text)) {
          setDone(true);
          window.setTimeout(() => setDone(false), 1600);
        }
      }}
      aria-label={done ? "Copied" : label}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white/[0.08] px-3.5 text-[13px] font-medium text-white transition hover:bg-white/[0.14] active:scale-[0.97] bento:bg-[#111114] bento:text-[#fff]",
        className,
      )}
    >
      {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      {done ? "Copied" : label}
    </button>
  );
}

/**
 * A multi-line block (prompt, script, config) with a one-tap "Copy all" button.
 * Use this for anything Jared needs to paste somewhere else.
 */
export function CopyBlock({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("my-2 rounded-xl overflow-hidden border border-white/[0.1] bg-black/40", className)}>
      <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[12px] text-white/90 leading-relaxed select-all">{text}</pre>
      <div className="flex justify-end border-t border-white/[0.07] px-3 py-1.5">
        <CopyButton text={text} label="Copy all" />
      </div>
    </div>
  );
}

export function CopyText({ text, className }: { text: string; className?: string }) {
  const cmd = pasteable(text);
  const prose = cmd ? text.replace(/`([^`]+)`/g, "$1") : text;
  return (
    <div className={cn("space-y-2", className)}>
      <p className="whitespace-pre-wrap break-words">{prose}</p>
      <div className="flex items-center gap-2">
        {cmd && (
          <code className="min-w-0 flex-1 select-all overflow-x-auto whitespace-pre rounded-lg bg-black/40 px-3 py-2 font-mono text-[13px] text-white bento:bg-[#F3F2EE]">
            {cmd}
          </code>
        )}
        <CopyButton text={cmd ?? text} label={cmd ? "Copy command" : "Copy"} />
      </div>
    </div>
  );
}
