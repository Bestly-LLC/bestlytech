import { useState } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { rpcArgs } from "@/components/admin/roofguard/AvaShared";
import { btnQuiet } from "./parts";
import { errText } from "./lib";
import type { LeadRow, PipelineAgent, SendResult } from "./types";

/** "Send to" buttons: any lead to any lead-taking agent. The backend refuses Do Not Call, opted-out and no-phone leads with a plain message. */
export function SendToPicker({ lead, agents, onDone }: { lead: Pick<LeadRow, "lead_table" | "id" | "owner">; agents: PipelineAgent[]; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const targets = agents.filter((a) => a.kind === "leads");
  const send = async (a: PipelineAgent) => {
    setBusy(a.slug);
    const { error } = await rpcArgs<SendResult>("pipeline_send", { p_table: lead.lead_table, p_id: lead.id, p_agent: a.slug });
    setBusy(null);
    if (error) { toast.error(errText(error)); return; }
    toast.success(`Sent to ${a.name}`);
    onDone();
  };
  if (!targets.length) return <p className="text-[14px] text-white/60">No agents are taking leads yet. Turn one on in Settings.</p>;
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Send this lead to an agent">
      {targets.map((a) => {
        const here = lead.owner === a.slug;
        return (
          <button key={a.slug} type="button" disabled={busy !== null} onClick={() => void send(a)} className={btnQuiet} aria-label={here ? `Send to ${a.name} again (already theirs)` : `Send to ${a.name}`}>
            <Send className="h-4 w-4" aria-hidden />{busy === a.slug ? "Sending" : here ? `Bump up for ${a.name}` : `Send to ${a.name}`}
          </button>
        );
      })}
    </div>
  );
}
