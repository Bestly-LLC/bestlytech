import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, Copy, Download, Loader2, Plus, Search, ShieldCheck, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { EmptyState } from "@/components/admin/EmptyState";
import { ActionMenu } from "@/components/admin/ActionMenu";
import { downloadCsv } from "@/components/admin/ExportButton";

type Grant = { id: string; email: string; reason: string | null; granted_by: string | null; created_at: string | null };

const EXPORT_COLUMNS = [
  { key: "email", label: "Email" },
  { key: "reason", label: "Reason" },
  { key: "granted_by", label: "Granted By" },
  { key: "created_at", label: "Date" },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Revoke grants AND the comp subscription row the insert trigger created for them.
 * check-entitlement treats any active subscription as premium, so deleting only
 * granted_access left the user premium forever.
 */
async function revokeGrants(rows: Grant[]): Promise<{ revoked: number; error?: string }> {
  const ids = rows.map((r) => r.id);
  const { data, error } = await supabase.from("granted_access").delete().in("id", ids).select("id");
  if (error) return { revoked: 0, error: error.message };
  const revoked = data?.length ?? 0;
  if (revoked === 0) return { revoked: 0, error: "No rows were deleted. You may not have permission." };

  const emails = rows.filter((r) => data!.some((d) => d.id === r.id)).map((r) => r.email.toLowerCase());
  const { error: subErr } = await supabase
    .from("subscriptions")
    .delete()
    .in("email", emails)
    .like("stripe_customer_id", "granted_%")
    .select("id");
  if (subErr) {
    return { revoked, error: `Grant removed, but the comp subscription row wasn't: ${subErr.message}. The user may still have premium.` };
  }
  return { revoked };
}

function friendlyInsertError(err: { code?: string; message: string; hint?: string | null }): string {
  if (err.code === "23505") return "That email already has granted access.";
  // Raised by the sync trigger when the email already pays through Stripe.
  if (err.code === "P0001") return err.hint ? `${err.message} ${err.hint}` : err.message;
  if (err.code === "42P10") {
    return "The database trigger that syncs grants to subscriptions is broken (ON CONFLICT mismatch). Nothing was saved. A migration fix is pending.";
  }
  return err.message;
}

export default function CYGrantedAccess() {
  const [data, setData] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  // Subscribers links here with ?q=<email> to revoke a comp row.
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Grant dialog
  const [grantOpen, setGrantOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [granting, setGranting] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  // Revoke confirm (single row or bulk)
  const [revokeTarget, setRevokeTarget] = useState<Grant[] | null>(null);
  const [revoking, setRevoking] = useState(false);

  const loadData = useCallback(async () => {
    const { data, error } = await supabase
      .from("granted_access")
      .select("id, email, reason, granted_by, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      setLoadError(error.message);
    } else {
      setLoadError(null);
      setData((data as Grant[]) || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = useMemo(
    () => (search ? data.filter((d) => d.email.toLowerCase().includes(search.toLowerCase())) : data),
    [data, search],
  );
  const selectedRows = filtered.filter((d) => selected.has(d.id));

  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = email.trim().toLowerCase();
    if (!EMAIL_RE.test(clean)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    setEmailError(null);
    setGranting(true);
    const { data: inserted, error } = await supabase
      .from("granted_access")
      .insert({ email: clean, granted_by: "admin", reason: reason.trim() || null })
      .select("id");
    if (error || !inserted?.length) {
      setGranting(false);
      toast.error("Couldn't grant access", { description: error ? friendlyInsertError(error) : "No row was created." });
      return;
    }
    // The grant row alone doesn't give premium; check-entitlement reads subscriptions.
    // Confirm the trigger really left an active comp subscription for this email.
    const { data: sub, error: subErr } = await supabase
      .from("subscriptions")
      .select("status, plan, stripe_customer_id")
      .eq("email", clean)
      .maybeSingle();
    setGranting(false);
    if (subErr) {
      toast.warning(`Grant saved for ${clean}, but we couldn't confirm premium`, { description: `${subErr.message}. Check Subscribers.` });
    } else if (!sub) {
      toast.error(`Grant saved for ${clean}, but no subscription was created`, { description: "They won't get premium. Revoke the grant and try again, or check the database logs." });
    } else if (sub.status !== "active") {
      toast.error(`Grant saved for ${clean}, but their subscription is ${String(sub.status).replace(/_/g, " ")}`, { description: "They won't get premium. Check Subscribers." });
    } else if (!sub.stripe_customer_id?.startsWith("granted_")) {
      toast.info(`${clean} already has an active ${sub.plan} Stripe subscription`, { description: "The grant was saved; their paid subscription is unchanged." });
    } else {
      toast.success(`Premium access granted to ${clean}`, { description: "Active lifetime comp subscription confirmed." });
    }
    setEmail("");
    setReason("");
    setGrantOpen(false);
    loadData();
  };

  const confirmRevoke = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    const { revoked, error } = await revokeGrants(revokeTarget);
    setRevoking(false);
    setRevokeTarget(null);
    if (revoked === 0) {
      toast.error("Couldn't revoke access", { description: error });
    } else if (error) {
      toast.warning(`Revoked ${revoked} of ${revokeTarget.length}`, { description: error });
    } else {
      toast.success(revoked === 1 ? `Access revoked for ${revokeTarget[0].email}` : `Access revoked for ${revoked} people`);
    }
    setSelected(new Set());
    loadData();
  };

  const copyEmail = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Email copied");
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  const exportCsv = () => {
    const n = downloadCsv(filtered, "granted-access", EXPORT_COLUMNS);
    if (n) toast.success(`Exported ${n} rows`);
    else toast.info("Nothing to export");
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  if (loading) {
    return (
      <div className="space-y-6 max-w-5xl" aria-busy="true">
        <div><Skeleton className="h-9 w-44" /><Skeleton className="h-4 w-72 mt-3" /></div>
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  const allSelected = filtered.length > 0 && filtered.every((d) => selected.has(d.id));

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader
        title="Granted Access"
        description="Comp premium access that bypasses Stripe."
        actions={
          <>
            <Button size="sm" className="h-9 gap-1.5" onClick={() => setGrantOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Grant access
            </Button>
            <ActionMenu
              label="More actions"
              items={[{ group: "Export", label: "Export CSV", icon: Download, hint: `${filtered.length} rows`, disabled: filtered.length === 0, onSelect: exportCsv }]}
            />
          </>
        }
      />

      {loadError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-500/25 bg-red-500/[0.06] px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-red-300 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm text-red-200">Couldn't load grants: <span className="text-red-200/75">{loadError}</span></p>
          <Button size="sm" variant="outline" onClick={loadData} className="h-9 border-red-500/30 text-red-100 hover:bg-red-500/10">Retry</Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/45" aria-hidden="true" />
          <Input
            aria-label="Search by email"
            placeholder="Search by email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <span className="text-xs text-white/55 tabular-nums">{filtered.length} of {data.length}</span>
      </div>

      {/* Bulk bar only when rows are selected */}
      {selectedRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5" role="region" aria-label="Bulk actions">
          <span className="text-sm text-white/80 tabular-nums">{selectedRows.length} selected</span>
          <Button variant="ghost" size="sm" className="h-9 text-white/70 hover:text-white" onClick={() => setSelected(new Set())}>
            <X className="h-4 w-4 mr-1" aria-hidden="true" /> Clear
          </Button>
          <Button variant="destructive" size="sm" className="h-9 ml-auto gap-1.5" onClick={() => setRevokeTarget(selectedRows)}>
            <Trash2 className="h-4 w-4" aria-hidden="true" /> Revoke {selectedRows.length}
          </Button>
        </div>
      )}

      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-white/[0.06]">
              <TableHead className="w-12">
                <Checkbox
                  aria-label={allSelected ? "Deselect all" : "Select all"}
                  checked={allSelected}
                  onCheckedChange={(checked) => setSelected(checked ? new Set(filtered.map((d) => d.id)) : new Set())}
                />
              </TableHead>
              <TableHead className="text-xs text-white/60">Email</TableHead>
              <TableHead className="text-xs text-white/60 hidden sm:table-cell">Reason</TableHead>
              <TableHead className="text-xs text-white/60 hidden md:table-cell">Granted by</TableHead>
              <TableHead className="text-xs text-white/60">Date</TableHead>
              <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((d) => (
              <TableRow key={d.id} className="border-white/[0.04]" data-state={selected.has(d.id) ? "selected" : undefined}>
                <TableCell>
                  <Checkbox aria-label={`Select ${d.email}`} checked={selected.has(d.id)} onCheckedChange={() => toggleSelect(d.id)} />
                </TableCell>
                <TableCell className="font-medium text-sm text-white/90 break-all">{d.email}</TableCell>
                <TableCell className="text-white/60 text-sm hidden sm:table-cell">{d.reason || "—"}</TableCell>
                <TableCell className="text-sm text-white/60 hidden md:table-cell">{d.granted_by || "—"}</TableCell>
                <TableCell className="text-sm text-white/60 whitespace-nowrap">
                  {d.created_at ? new Date(d.created_at).toLocaleDateString() : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <ActionMenu
                    label={`Actions for ${d.email}`}
                    items={[
                      { label: "Copy email", icon: Copy, onSelect: () => copyEmail(d.email) },
                      { label: "Revoke access", icon: Trash2, destructive: true, onSelect: () => setRevokeTarget([d]) },
                    ]}
                  />
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="p-0">
                  <EmptyState
                    icon={ShieldCheck}
                    title={search ? "No matches" : "No one has granted access"}
                    description={search ? "Try a different email." : "Grant comp premium access to testers, press or friends."}
                    action={!search && (
                      <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => setGrantOpen(true)}>
                        <Plus className="h-4 w-4" aria-hidden="true" /> Grant access
                      </Button>
                    )}
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Grant dialog */}
      <Dialog open={grantOpen} onOpenChange={(o) => { if (!granting) setGrantOpen(o); }}>
        <DialogContent className="admin-shell bg-[#0a0a0a] border-white/10 text-white">
          <form onSubmit={handleGrant} noValidate>
            <DialogHeader>
              <DialogTitle>Grant premium access</DialogTitle>
              <DialogDescription className="text-white/60">
                They get premium on every Cookie Yeti platform right away, without paying.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="grant-email" className="text-xs font-medium text-white/80">Email</Label>
                <Input
                  id="grant-email"
                  type="email"
                  autoComplete="off"
                  autoFocus
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setEmailError(null); }}
                  placeholder="user@example.com"
                  aria-invalid={!!emailError}
                  aria-describedby={emailError ? "grant-email-error" : undefined}
                />
                {emailError && <p id="grant-email-error" className="text-xs text-red-300">{emailError}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="grant-reason" className="text-xs font-medium text-white/80">Reason <span className="text-white/55">(optional)</span></Label>
                <Textarea id="grant-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Beta tester, press, friend…" rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setGrantOpen(false)} disabled={granting}>Cancel</Button>
              <Button type="submit" disabled={granting || !email.trim()} className="gap-1.5">
                {granting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {granting ? "Granting…" : "Grant access"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Revoke confirm */}
      <AlertDialog open={!!revokeTarget} onOpenChange={(o) => { if (!o && !revoking) setRevokeTarget(null); }}>
        <AlertDialogContent className="admin-shell bg-[#0a0a0a] border-white/10 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {revokeTarget?.length === 1 ? `Revoke access for ${revokeTarget[0].email}?` : `Revoke access for ${revokeTarget?.length ?? 0} people?`}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-white/60">
              They lose premium the next time the app checks. Paid Stripe subscriptions are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmRevoke(); }}
              disabled={revoking}
              className="bg-red-600 text-white hover:bg-red-500 gap-1.5"
            >
              {revoking && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {revoking ? "Revoking…" : "Revoke"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
