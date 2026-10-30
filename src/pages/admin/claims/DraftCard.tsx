import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Copy, Loader2, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { btnDestructivePlain, btnPrimary, btnTinted, field, label, secondary } from "../laxUi";
import { KIND, rpc, type Draft } from "./shared";

/** One message (or Turo note) waiting for Jared's OK. `primary` is true only for the first "Your call" item, so one filled button shows per view. */
export function DraftCard({ d, onDone, primary }: { d: Draft; onDone: () => void; primary: boolean }) {
  const [text, setText] = useState(d.body);
  const [busy, setBusy] = useState<"" | "approve" | "reject">("");
  const isNote = d.kind === "escalation";
  const main = primary ? btnPrimary : btnTinted;
  const decide = async (action: "approve" | "reject") => {
    setBusy(action);
    const { error } = await rpc("claims_draft_decide", { p_id: d.id, p_action: action, p_body: action === "approve" ? text : null });
    setBusy("");
    if (error) { toast.error(error.message); return; }
    toast.success(action === "reject" ? "Rejected" : isNote ? "Marked done" : "Approved. It goes out on the Link Sender's next pass (within 3 minutes).");
    onDone();
  };
  return (
    <div>
      <p className={cn("text-[15px] font-semibold", label)}>{isNote ? "For you to paste into Turo (Claims tab, Escalate)" : `${KIND[d.kind] ?? "Message"} waiting for your OK`}</p>
      {d.reason && <p className={cn("mt-0.5 text-[13px]", secondary)}>{d.reason}</p>}
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(12, Math.max(4, Math.ceil(text.length / 40)))}
        className={cn(field, "mt-2.5 w-full resize-y text-[16px] leading-snug sm:text-[15px]")} aria-label="Message text" />
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        {isNote ? (
          <>
            <button type="button" className={btnTinted} onClick={() => { void navigator.clipboard.writeText(text); toast.success("Copied"); }}><Copy className="h-4 w-4" /> Copy</button>
            <button type="button" className={main} disabled={!!busy} onClick={() => decide("approve")}>{busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Done</button>
          </>
        ) : (
          <button type="button" className={main} disabled={!!busy || text.trim().length < 2} onClick={() => decide("approve")}>
            {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {text.trim() === d.body.trim() ? "Approve & send" : "Send my edit"}
          </button>
        )}
        <button type="button" className={btnDestructivePlain} disabled={!!busy} onClick={() => decide("reject")}><X className="h-4 w-4" /> Reject</button>
      </div>
    </div>
  );
}
