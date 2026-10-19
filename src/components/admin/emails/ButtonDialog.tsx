import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { btnDestructivePlain, btnPlain, btnPrimary, field } from "@/pages/admin/laxUi";
import { cn } from "@/lib/utils";
import type { Block } from "@/lib/email/render";

type Btn = Extract<Block, { type: "button" }>;

export function ButtonDialog({ block, onClose, onSave, onDelete }: { block: Btn | null; onClose: () => void; onSave: (b: Btn) => void; onDelete: (id: string) => void }) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [style, setStyle] = useState<"solid" | "outline">("solid");
  useEffect(() => { if (block) { setLabel(block.label); setUrl(block.url); setStyle(block.style ?? "solid"); } }, [block]);
  const okUrl = /^(https:\/\/|mailto:|tel:)[^\s"<>]+$/i.test(url.trim());
  return (
    <Dialog open={!!block} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100%-1.5rem)] max-w-[440px] gap-4 border-white/10 bg-[#1C1C1E] text-white">
        <DialogHeader className="text-left">
          <DialogTitle className="text-[17px]">Button</DialogTitle>
          <DialogDescription className="text-[13px] text-white/60">The label says what happens when someone taps it.</DialogDescription>
        </DialogHeader>
        <label className="block text-[13px] text-white/60">Label
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} className={`${field} mt-1`} />
        </label>
        <label className="block text-[13px] text-white/60">Link
          <input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoCapitalize="none" autoCorrect="off" className={`${field} mt-1`} placeholder="https://" />
          {!okUrl && url.length > 8 && <span className="mt-1 block text-[#FF6961]">Use a link that starts with https://</span>}
        </label>
        <div role="group" aria-label="Button look" className="flex gap-2">
          {(["solid", "outline"] as const).map((s) => (
            <button key={s} type="button" aria-pressed={style === s} onClick={() => setStyle(s)}
              className={cn("min-h-[44px] flex-1 rounded-xl border px-4 text-[15px] font-medium active:scale-[0.98]", style === s ? "border-[#0A84FF] bg-[#0A84FF]/15 text-white" : "border-white/[0.12] text-white/70")}>
              {s === "solid" ? "Filled" : "Outlined"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <button type="button" className={btnDestructivePlain} onClick={() => block && onDelete(block.id)}><Trash2 className="h-4 w-4" aria-hidden="true" />Remove</button>
          <div className="flex items-center gap-3">
            <button type="button" className={btnPlain} onClick={onClose}>Cancel</button>
            <button type="button" className={btnPrimary} disabled={!label.trim() || !okUrl} onClick={() => block && onSave({ ...block, label: label.trim(), url: url.trim(), style })}>Done</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
