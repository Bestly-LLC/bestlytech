import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/admin/hunter/shared";
import { HunterControls } from "@/components/admin/hunter/HunterControls";
import { JevCard } from "@/components/admin/hunter/JevCard";
import { ApolloCard } from "@/components/admin/hunter/ApolloCard";

type AgentRow = { slug: string; name: string; takes_leads: boolean | null };
type Q = { select: (c: string) => { order: (c: string) => Promise<{ data: AgentRow[] | null; error: unknown }> }; update: (p: object) => { eq: (c: string, v: string) => Promise<{ error: unknown }> } };
const table = () => supabase.from("voice_agents" as never) as unknown as Q;

/** Agents that take leads from Pipeline: one switch per agent in the registry. */
function TakerSwitches() {
  const [rows, setRows] = useState<AgentRow[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const writes = useRef(0);
  const load = useCallback(async () => {
    const { data, error } = await table().select("slug, name, takes_leads").order("name");
    if (writes.current > 0) return;
    if (error || !data) { setNote("The agent list isn't available yet. It will appear here once Pipeline is fully set up."); return; }
    setNote(null); setRows(data);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const set = async (a: AgentRow, v: boolean) => {
    writes.current += 1;
    setRows((r) => r && r.map((x) => x.slug === a.slug ? { ...x, takes_leads: v } : x));
    const { error } = await table().update({ takes_leads: v }).eq("slug", a.slug);
    writes.current -= 1;
    if (error) { toast.error("Couldn't save. Try again."); void load(); return; }
    toast.success(v ? `${a.name} now takes leads` : `${a.name} no longer takes leads`);
  };
  return (
    <Card title="Agents taking leads" hint="Turn on an agent to let Pipeline send it leads. Maya and Reese are on by default.">
      {note ? <p className="text-[14px] text-white/65">{note}</p> : !rows ? <div className="h-16 rounded-xl bg-white/[0.04] motion-safe:animate-pulse" aria-hidden /> : (
        <ul className="divide-y divide-white/10">
          {rows.map((a) => (
            <li key={a.slug} className="flex min-h-[52px] items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <span className="text-[15px] text-white">{a.name}</span>
              <Switch checked={!!a.takes_leads} onCheckedChange={(v) => void set(a, v)} aria-label={`${a.name} takes leads`} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function PipelineSettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="admin-shell flex h-[100dvh] w-full flex-col gap-0 overflow-hidden border-white/10 bg-[#0b0b0d] p-0 text-white sm:max-w-xl">
        <div className="shrink-0 space-y-1 px-5 pb-3 pr-12 pt-6 text-left">
          <SheetTitle className="text-xl font-semibold text-white">Pipeline settings</SheetTitle>
          <SheetDescription className="text-sm text-white/60">How leads are found, scored and handed to agents.</SheetDescription>
        </div>
        <div data-sheet-scroll className="min-h-0 flex-1 touch-pan-y space-y-4 overflow-y-auto overscroll-contain px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {open && (<>
            <TakerSwitches />
            <HunterControls />
            <JevCard />
            <ApolloCard />
          </>)}
        </div>
      </SheetContent>
    </Sheet>
  );
}
