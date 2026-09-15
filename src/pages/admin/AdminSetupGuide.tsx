import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, BookOpen, Loader2, Plus, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { EmptyState } from "@/components/admin/EmptyState";
import { ActionMenu } from "@/components/admin/ActionMenu";

interface GuidanceEntry {
  id: string;
  platform: string;
  section: string;
  field_name: string;
  guidance_text: string;
  answer_recommendation: string | null;
  reason: string | null;
  display_order: number;
}

const PLATFORMS = ["Amazon", "Shopify", "TikTok"];
const EDITABLE: (keyof GuidanceEntry)[] = ["section", "field_name", "guidance_text", "answer_recommendation", "reason"];

export default function AdminSetupGuide() {
  /** Last saved copy from the database, keyed by id. Groups are built from this so cards don't jump while typing. */
  const [saved, setSaved] = useState<Record<string, GuidanceEntry>>({});
  const [drafts, setDrafts] = useState<Record<string, GuidanceEntry>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [platform, setPlatform] = useState("Amazon");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GuidanceEntry | null>(null);
  const { toast } = useToast();

  const loadData = useCallback(async () => {
    const { data, error } = await supabase.from("setup_guidance").select("*").order("display_order");
    if (error) {
      setLoadError(error.message);
    } else {
      const rows = (data || []) as GuidanceEntry[];
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      setLoadError(null);
      setSaved(byId);
      setOrder(rows.map((r) => r.id));
      // Keep any unsaved edits for rows that still exist.
      setDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => byId[id])));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const entryFor = (id: string) => drafts[id] ?? saved[id];
  const isDirty = (id: string) => !!drafts[id] && EDITABLE.some((k) => (drafts[id][k] ?? "") !== (saved[id]?.[k] ?? ""));

  const filteredIds = useMemo(() => order.filter((id) => saved[id]?.platform === platform), [order, saved, platform]);
  const sections = useMemo(() => [...new Set(filteredIds.map((id) => saved[id].section))], [filteredIds, saved]);
  const counts = useMemo(
    () => Object.fromEntries(PLATFORMS.map((p) => [p, order.filter((id) => saved[id]?.platform === p).length])),
    [order, saved],
  );

  const updateEntry = (id: string, field: keyof GuidanceEntry, value: string) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? saved[id]), [field]: value } }));
  };

  const discard = (id: string) => {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const saveEntry = async (id: string) => {
    const entry = entryFor(id);
    setBusy(`save:${id}`);
    const { data, error } = await supabase
      .from("setup_guidance")
      .update({
        section: entry.section.trim() || "General",
        field_name: entry.field_name,
        guidance_text: entry.guidance_text,
        answer_recommendation: entry.answer_recommendation || null,
        reason: entry.reason || null,
        display_order: entry.display_order,
      })
      .eq("id", id)
      .select("*");
    setBusy(null);
    if (error || !data?.length) {
      toast({
        title: "Entry not saved",
        description: error?.message ?? "No rows were changed. Your account may not have edit permission.",
        variant: "destructive",
      });
      return;
    }
    setSaved((prev) => ({ ...prev, [id]: data[0] as GuidanceEntry }));
    discard(id);
    toast({ title: "Entry saved", description: `${entry.field_name} · ${platform}` });
  };

  const addEntry = async () => {
    const maxOrder = Math.max(0, ...filteredIds.map((id) => saved[id].display_order ?? 0));
    setBusy("add");
    const { data, error } = await supabase
      .from("setup_guidance")
      .insert({
        platform,
        section: sections[sections.length - 1] ?? "General",
        field_name: "New field",
        guidance_text: "",
        display_order: maxOrder + 1,
      })
      .select("*");
    setBusy(null);
    if (error || !data?.length) {
      toast({ title: "Couldn't add entry", description: error?.message ?? "Nothing was created.", variant: "destructive" });
      return;
    }
    const row = data[0] as GuidanceEntry;
    setSaved((prev) => ({ ...prev, [row.id]: row }));
    setOrder((prev) => [...prev, row.id]);
    toast({ title: "Entry added", description: `Fill it in and save. It's at the end of “${row.section}”.` });
    requestAnimationFrame(() => document.getElementById(`guide-${row.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  const deleteEntry = async (entry: GuidanceEntry) => {
    setBusy(`delete:${entry.id}`);
    const { data, error } = await supabase.from("setup_guidance").delete().eq("id", entry.id).select("id");
    setBusy(null);
    setDeleteTarget(null);
    if (error || !data?.length) {
      toast({
        title: "Couldn't delete",
        description: error?.message ?? "Nothing was removed. Your account may not have delete permission.",
        variant: "destructive",
      });
      return;
    }
    setOrder((prev) => prev.filter((id) => id !== entry.id));
    setSaved((prev) => {
      const next = { ...prev };
      delete next[entry.id];
      return next;
    });
    discard(entry.id);
    toast({ title: "Entry deleted", description: entry.field_name });
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title="Setup Guide"
        description="Operator guidance shown on each submission, by marketplace."
        actions={
          <>
            <Button onClick={addEntry} size="sm" className="h-9" disabled={loading || busy === "add"}>
              {busy === "add" ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden /> : <Plus className="h-4 w-4 mr-1.5" aria-hidden />}
              Add entry
            </Button>
            <ActionMenu label="More setup guide actions" items={[{ label: "Reload", icon: RefreshCw, onSelect: () => loadData() }]} />
          </>
        }
      />

      {loadError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-500/25 bg-red-500/[0.06] px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-red-300" aria-hidden />
          <p className="text-sm text-red-200 flex-1">Couldn't load the guide: {loadError}</p>
          <Button size="sm" variant="outline" className="h-9 border-red-400/30 text-red-100" onClick={() => loadData()}>Retry</Button>
        </div>
      )}

      <Tabs value={platform} onValueChange={setPlatform}>
        <TabsList>
          {PLATFORMS.map((p) => (
            <TabsTrigger key={p} value={p}>
              {p}
              {!loading && <span className="ml-1.5 text-xs text-white/55 tabular-nums">{counts[p]}</span>}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={platform} className="space-y-4 mt-4">
          {loading ? (
            [1, 2].map((i) => (
              <div key={i} className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5 space-y-3">
                <Skeleton className="h-5 w-40 bg-white/[0.05]" />
                <Skeleton className="h-32 w-full bg-white/[0.04]" />
              </div>
            ))
          ) : sections.length === 0 ? (
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03]">
              <EmptyState
                icon={BookOpen}
                title={`No ${platform} guidance yet`}
                description="Entries here show up in the Operator guide on every submission for this marketplace."
                action={
                  <Button size="sm" className="h-9" onClick={addEntry} disabled={busy === "add"}>
                    <Plus className="h-4 w-4 mr-1.5" aria-hidden /> Add entry
                  </Button>
                }
              />
            </div>
          ) : (
            sections.map((section) => (
              <section key={section} className="rounded-2xl border border-white/[0.06] bg-white/[0.03] overflow-hidden">
                <h2 className="px-5 py-4 text-[0.9375rem] font-semibold text-white border-b border-white/[0.06]">{section}</h2>
                <div className="p-4 space-y-3">
                  {filteredIds
                    .filter((id) => saved[id].section === section)
                    .map((id) => {
                      const entry = entryFor(id);
                      const dirty = isDirty(id);
                      const saving = busy === `save:${id}`;
                      return (
                        <div key={id} id={`guide-${id}`} className="grid gap-2 p-3 rounded-xl border border-white/[0.06] bg-black/20">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <Input
                              aria-label="Section"
                              value={entry.section}
                              onChange={(e) => updateEntry(id, "section", e.target.value)}
                              placeholder="Section"
                            />
                            <Input
                              aria-label="Field name"
                              value={entry.field_name}
                              onChange={(e) => updateEntry(id, "field_name", e.target.value)}
                              placeholder="Field name"
                            />
                          </div>
                          <Textarea
                            aria-label="Guidance text"
                            value={entry.guidance_text}
                            onChange={(e) => updateEntry(id, "guidance_text", e.target.value)}
                            placeholder="What the operator should do or know"
                            rows={2}
                          />
                          <Input
                            aria-label="Recommended answer"
                            value={entry.answer_recommendation || ""}
                            onChange={(e) => updateEntry(id, "answer_recommendation", e.target.value)}
                            placeholder="Recommended answer (optional)"
                          />
                          <Input
                            aria-label="Reason"
                            value={entry.reason || ""}
                            onChange={(e) => updateEntry(id, "reason", e.target.value)}
                            placeholder="Why (optional)"
                          />
                          <div className="flex items-center justify-end gap-2">
                            {dirty && <span className="text-xs text-white/55 mr-auto">Unsaved changes</span>}
                            <ActionMenu
                              label={`Actions for ${entry.field_name}`}
                              items={[
                                ...(dirty ? [{ label: "Discard changes", icon: RotateCcw, onSelect: () => discard(id) }] : []),
                                { label: "Delete entry…", icon: Trash2, destructive: true, onSelect: () => setDeleteTarget(saved[id]) },
                              ]}
                            />
                            <Button size="sm" className="h-9" onClick={() => saveEntry(id)} disabled={!dirty || saving}>
                              {saving ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden /> Saving…</> : "Save"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </section>
            ))
          )}
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o && !busy?.startsWith("delete:")) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this guidance entry?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.field_name}” will no longer appear on {deleteTarget?.platform} submissions. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busy?.startsWith("delete:")}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!!busy?.startsWith("delete:")}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) deleteEntry(deleteTarget);
              }}
            >
              {busy?.startsWith("delete:") ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden /> Deleting…</> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
