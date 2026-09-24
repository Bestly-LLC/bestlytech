/**
 * Files you hand to Scout.
 *
 * Attach by the paperclip, by dragging onto the panel, or by pasting a screenshot. Each file is
 * uploaded to the private scout-files bucket and read straight away by the scout-file function,
 * so a file that can't be read says so before you send rather than after. What Scout receives is
 * the TEXT: a screenshot of an error arrives as the error, a CSV arrives as the CSV.
 *
 * Text, code, CSV and JSON never touch a model and cost nothing. Images and PDFs need one that can
 * see, so they go through Haiku once, here, rather than on every later turn of the conversation.
 */
import { useCallback, useRef, useState } from "react";
import { FileText, Image as ImageIcon, Loader2, Paperclip, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export interface ScoutFile {
  id: string;
  name: string;
  size: number;
  kind: "image" | "pdf" | "text" | null;
  text: string | null;
  error: string | null;
  reading: boolean;
}

const MAX = 25 * 1024 * 1024;
const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const slug = (s: string) => s.replace(/[^\w.-]+/g, "-").slice(-80);

export function useScoutFiles() {
  const [files, setFiles] = useState<ScoutFile[]>([]);
  const patch = (id: string, p: Partial<ScoutFile>) => setFiles((xs) => xs.map((f) => (f.id === id ? { ...f, ...p } : f)));

  const add = useCallback(async (picked: File[]) => {
    for (const file of picked.slice(0, 5)) {
      if (file.size > MAX) { toast.error(`${file.name} is over 25 MB`); continue; }
      const id = crypto.randomUUID();
      setFiles((xs) => [...xs, { id, name: file.name, size: file.size, kind: null, text: null, error: null, reading: true }]);
      const path = `${new Date().toISOString().slice(0, 10)}/${id}-${slug(file.name)}`;
      const up = await supabase.storage.from("scout-files").upload(path, file, {
        contentType: file.type || "application/octet-stream", upsert: false,
      });
      if (up.error) { patch(id, { reading: false, error: up.error.message }); continue; }
      const { data, error } = await supabase.functions.invoke("scout-file", { body: { op: "read", path } });
      const r = data as { ok?: boolean; kind?: ScoutFile["kind"]; text?: string; error?: string } | null;
      if (error || !r?.ok) patch(id, { reading: false, error: r?.error ?? error?.message ?? "Couldn't read that one" });
      else patch(id, { reading: false, kind: r.kind ?? "text", text: r.text ?? "" });
    }
  }, []);

  const drop = useCallback(() => setFiles([]), []);
  const remove = useCallback((id: string) => setFiles((xs) => xs.filter((f) => f.id !== id)), []);

  /** What actually goes to Scout: the files first, then the question. */
  const compose = useCallback((question: string) => {
    const ready = files.filter((f) => f.text);
    if (!ready.length) return question;
    const blocks = ready.map((f) =>
      `[File: ${f.name}${f.kind === "image" ? " — what the image shows" : f.kind === "pdf" ? " — the document's text" : ""}]\n${f.text}`);
    return `${blocks.join("\n\n")}\n\n---\n${question || "Read this and tell me what you make of it."}`;
  }, [files]);

  const busy = files.some((f) => f.reading);
  return { files, add, drop, remove, compose, busy, count: files.length };
}

export function AttachButton({ onPick, disabled }: { onPick: (f: File[]) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input} type="file" multiple className="hidden"
        accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/*,.md,.csv,.json,.log,.ts,.tsx,.js,.jsx,.py,.sql,.yml,.yaml"
        onChange={(e) => { onPick([...(e.target.files ?? [])]); e.target.value = ""; }}
      />
      <button
        type="button" onClick={() => input.current?.click()} disabled={disabled}
        aria-label="Attach a file for Scout to read"
        className="scout-press grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white/60 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-40 sm:h-[2.375rem] sm:w-[2.375rem]"
      >
        <Paperclip className="h-4 w-4" aria-hidden />
      </button>
    </>
  );
}

export function AttachBar({ files, onRemove }: { files: ScoutFile[]; onRemove: (id: string) => void }) {
  if (!files.length) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-1.5">
      {files.map((f) => {
        const Icon = f.kind === "image" ? ImageIcon : FileText;
        return (
          <li key={f.id}
            className={cn("flex max-w-full items-center gap-1.5 rounded-lg py-1 pl-2 pr-1 text-xs",
              f.error ? "bg-red-500/15 text-red-200 bento:text-red-800" : "bg-white/[0.07] text-white/85")}>
            {f.reading ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden /> : <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            <span className="truncate">{f.name}</span>
            <span className="shrink-0 text-white/60">
              {f.error ? f.error : f.reading ? "reading…" : f.kind === "image" ? "read" : kb(f.size)}
            </span>
            <button type="button" onClick={() => onRemove(f.id)} aria-label={`Remove ${f.name}`}
              className="grid h-6 w-6 shrink-0 place-items-center rounded text-white/60 transition hover:bg-white/10 hover:text-white">
              <X className="h-3 w-3" aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
