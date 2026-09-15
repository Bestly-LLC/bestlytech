import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/**
 * Confirm + delete an In-House Cloud lead via the admin-only `admin_delete_cloud_lead` RPC,
 * which also removes its brief, deal, timeline and Shield requests.
 */
export function DeleteLeadDialog({
  lead,
  onOpenChange,
  onDeleted,
}: {
  lead: { id: string; company_name: string; hasDeal?: boolean } | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!lead) return;
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("admin_delete_cloud_lead", { p_lead_id: lead.id });
    setBusy(false);
    if (error || !data?.deleted) {
      toast({
        title: "Couldn't delete lead",
        description: error?.message ?? "Nothing was removed.",
        variant: "destructive",
      });
      return;
    }
    toast({ title: `Deleted ${data.company_name}` });
    onOpenChange(false);
    onDeleted();
  }

  return (
    <AlertDialog open={!!lead} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <AlertDialogContent className="admin-shell">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {lead?.company_name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the lead, its brief
            {lead?.hasDeal === false ? "" : ", the deal, its timeline and Shield requests"}. It can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete lead
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
