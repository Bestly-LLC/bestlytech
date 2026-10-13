import { useState } from "react";
import { toast } from "sonner";
import { rpcArgs } from "@/components/admin/roofguard/AvaShared";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { errText } from "./lib";
import type { LeadRow } from "./types";

const CHOICES = [
  { to: "requalify", title: "Requalify", text: "Take it off the agent's list and score it again from scratch." },
  { to: "archive", title: "Archive", text: "Take it off the list and set it aside. Nobody will call it." },
  { to: "dnc", title: "Do not call", text: "Never call this number. This stays on record.", danger: true },
] as const;

/** Pulling a lead back always asks what should happen to it. */
export function PullBackDialog({ lead, open, onClose, onDone }: { lead: Pick<LeadRow, "lead_table" | "id" | "company">; open: boolean; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const pull = async (to: string) => {
    setBusy(to);
    const { error } = await rpcArgs("pipeline_pull", { p_table: lead.lead_table, p_id: lead.id, p_to: to });
    setBusy(null);
    if (error) { toast.error(errText(error)); return; }
    toast.success("Pulled back"); onClose(); onDone();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="admin-shell max-w-md border-white/10 bg-[#0b0b0d] text-white">
        <DialogHeader>
          <DialogTitle>Pull back {lead.company}</DialogTitle>
          <DialogDescription className="text-white/60">What should happen to this lead?</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {CHOICES.map((c) => (
            <button key={c.to} type="button" disabled={busy !== null} onClick={() => void pull(c.to)}
              className={cn("block min-h-[60px] w-full rounded-xl px-4 py-3 text-left ring-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50",
                "danger" in c && c.danger ? "bg-rose-500/10 ring-rose-500/30 hover:bg-rose-500/15" : "bg-white/[0.06] ring-white/10 hover:bg-white/10")}>
              <span className="block text-[16px] font-semibold text-white">{busy === c.to ? "Working" : c.title}</span>
              <span className="block text-[13px] text-white/65">{c.text}</span>
            </button>
          ))}
          <button type="button" onClick={onClose} className="min-h-[44px] w-full rounded-xl text-[15px] text-white/75 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50">Leave it where it is</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
