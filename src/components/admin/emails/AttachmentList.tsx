import { useRef, useState } from "react";
import { FileText, Image as ImageIcon, Loader2, Paperclip, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { btnTinted, secondary } from "@/pages/admin/laxUi";
import { focusRing } from "@/components/admin/ui";
import { ATTACH_MAX_FILE, ATTACH_MAX_FILES, ATTACH_MAX_TOTAL, type Attachment, type EmailApi } from "@/lib/email/api";
import { fileSize } from "./emailUtils";

/**
 * Files that go out with the email. Tap "Attach files" (or drop files on the box); each one uploads to the private
 * email-attachments bucket right away and shows its name and size. They are saved with the email on Save / Send.
 */
export function AttachmentList({ api, value, onChange, savedPaths, disabled }: {
  api: EmailApi; value: Attachment[]; onChange: (next: Attachment[]) => void; savedPaths: string[]; disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [over, setOver] = useState(false);
  const can = !!api.uploadAttachment && api.dbReady && !disabled;
  const total = value.reduce((n, a) => n + a.size, 0);

  const add = async (files: File[]) => {
    if (!can || !files.length) return;
    setErr("");
    const room = ATTACH_MAX_FILES - value.length;
    const take: File[] = [];
    let sum = total;
    const problems: string[] = [];
    for (const f of files) {
      if (take.length >= room) { problems.push(`Only ${ATTACH_MAX_FILES} files per email.`); break; }
      if (f.size > ATTACH_MAX_FILE) { problems.push(`${f.name} is over ${fileSize(ATTACH_MAX_FILE)}.`); continue; }
      if (sum + f.size > ATTACH_MAX_TOTAL) { problems.push(`${f.name} would take the email over ${fileSize(ATTACH_MAX_TOTAL)}.`); continue; }
      sum += f.size; take.push(f);
    }
    setUploading(take.map((f) => f.name));
    const done: Attachment[] = [];
    for (const f of take) {
      try { done.push(await api.uploadAttachment!(f)); }
      catch (e) { problems.push(`${f.name} did not upload: ${e instanceof Error ? e.message : String(e)}`); }
      setUploading((u) => u.slice(1));
    }
    if (done.length) onChange([...value, ...done]);
    if (problems.length) setErr(problems.join(" "));
  };

  const drop = (a: Attachment) => {
    onChange(value.filter((x) => x.path !== a.path));
    // a file never saved with the email has nowhere else to live, so clean it up; saved ones stay for the version history
    if (!savedPaths.includes(a.path)) void api.removeAttachment?.(a.path).catch(() => undefined);
  };

  return (
    <section
      aria-labelledby="eb-attach"
      onDragOver={(e) => { if (can) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void add(Array.from(e.dataTransfer.files)); }}
      className={cn("space-y-2 rounded-2xl bg-white/[0.04] p-3 transition-colors", over && "bg-[#0A84FF]/10 ring-1 ring-[#0A84FF]/40")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="eb-attach" className="text-[15px] font-semibold text-white">
          Attachments{value.length > 0 && <span className="font-normal text-white/50"> · <span className="whitespace-nowrap">{value.length} of {ATTACH_MAX_FILES}</span> · <span className="whitespace-nowrap">{fileSize(total)}</span></span>}
        </h3>
        <button type="button" onClick={() => input.current?.click()} disabled={!can || uploading.length > 0 || value.length >= ATTACH_MAX_FILES} className={btnTinted}>
          {uploading.length ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Paperclip className="h-4 w-4" aria-hidden="true" />}
          {uploading.length ? "Uploading" : "Attach files"}
        </button>
        <input ref={input} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true"
          onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; void add(f); }} />
      </div>

      {value.length === 0 && uploading.length === 0 && (
        <p className={cn("text-[13px]", secondary)}>
          {can ? <>PDFs, photos or any file, up to <span className="whitespace-nowrap">{fileSize(ATTACH_MAX_FILE)}</span> each. You can also drop files here.</> : "Save is off here, so files cannot be attached."}
        </p>
      )}

      {(value.length > 0 || uploading.length > 0) && (
        <ul className="space-y-1.5">
          {value.map((a) => {
            const Icon = a.type.startsWith("image/") ? ImageIcon : FileText;
            return (
              <li key={a.path} className="flex items-center gap-2 rounded-xl bg-white/[0.05] py-1 pl-3 pr-1">
                <Icon className="h-4 w-4 shrink-0 text-white/50" aria-hidden="true" />
                <span className="min-w-0 flex-1 text-[14px] text-white/85 [overflow-wrap:anywhere]">{a.name}</span>
                <span className="shrink-0 whitespace-nowrap text-[13px] text-white/50">{fileSize(a.size)}</span>
                <button type="button" aria-label={`Remove ${a.name}`} title="Remove" onClick={() => drop(a)} disabled={disabled}
                  className={cn("inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/60 hover:bg-white/[0.08] hover:text-white active:scale-[0.94] disabled:opacity-30", focusRing)}>
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            );
          })}
          {uploading.map((n, i) => (
            <li key={`${n}-${i}`} className="flex min-h-[44px] items-center gap-2 rounded-xl bg-white/[0.03] px-3 text-[14px] text-white/50">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /><span className="min-w-0 [overflow-wrap:anywhere]">{n}</span>
            </li>
          ))}
        </ul>
      )}
      {err && <p role="alert" className="rounded-xl bg-[#FF453A]/10 px-3 py-2 text-[13px] text-[#FF6961] [overflow-wrap:anywhere]">{err}</p>}
    </section>
  );
}
