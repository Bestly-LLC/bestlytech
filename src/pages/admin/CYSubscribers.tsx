import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Copy, ChevronLeft, ChevronRight, Search, Users, Plus, Loader2, Webhook, ShieldCheck, Trash2, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { EmptyState } from "@/components/admin/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportButton } from "@/components/admin/ExportButton";
import { toast } from "sonner";

const EXPORT_COLUMNS = [
  { key: "email", label: "Email" },
  { key: "plan", label: "Plan" },
  { key: "status", label: "Status" },
  { key: "stripe_customer_id", label: "Stripe Customer ID" },
  { key: "current_period_end", label: "Period End" },
  { key: "created_at", label: "Created" },
];

const PAGE_SIZE = 20;

export default function CYSubscribers() {
  const [data, setData] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [planFilter, setPlanFilter] = useState("All");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Granted access state
  const [grantedAccess, setGrantedAccess] = useState<any[]>([]);
  const [grantEmail, setGrantEmail] = useState("");
  const [grantReason, setGrantReason] = useState("");
  const [granting, setGranting] = useState(false);

  // Webhook log state
  const [webhookEvents, setWebhookEvents] = useState<any[]>([]);
  const [webhookLoading, setWebhookLoading] = useState(false);

  const fetchSubscriptions = useCallback(async () => {
    const { data, error } = await supabase.from("subscriptions").select("*").order("created_at", { ascending: false });
    if (error) console.error("Failed to load subscribers", error);
    setData(data || []);
    setLoading(false);
  }, []);

  const fetchGrantedAccess = useCallback(async () => {
    const { data, error } = await supabase.from("granted_access").select("*").order("created_at", { ascending: false });
    if (error) console.error("Failed to load granted access", error);
    setGrantedAccess(data || []);
  }, []);

  const fetchWebhookEvents = useCallback(async () => {
    setWebhookLoading(true);
    const { data, error } = await supabase.from("webhook_events" as any).select("*").order("created_at", { ascending: false }).limit(20);
    if (error) console.error("Failed to load webhook events", error);
    setWebhookEvents((data as any[]) || []);
    setWebhookLoading(false);
  }, []);

  useEffect(() => {
    fetchSubscriptions();
    fetchGrantedAccess();
    fetchWebhookEvents();
  }, [fetchSubscriptions, fetchGrantedAccess, fetchWebhookEvents]);

  const handleGrantAccess = async () => {
    if (!grantEmail.trim()) { toast.error("Email is required"); return; }
    setGranting(true);
    try {
      const { error } = await supabase.from("granted_access").insert({
        email: grantEmail.toLowerCase().trim(),
        reason: grantReason.trim() || "Manual grant",
        granted_by: "admin",
      });
      if (error) throw error;
      toast.success(`Access granted to ${grantEmail}`);
      setGrantEmail("");
      setGrantReason("");
      fetchGrantedAccess();
    } catch (e: any) {
      toast.error(`Failed: ${e.message}`);
    } finally {
      setGranting(false);
    }
  };

  const handleRevokeAccess = async (id: string, email: string) => {
    const { error } = await supabase.from("granted_access").delete().eq("id", id);
    if (error) { toast.error(`Failed to revoke: ${error.message}`); return; }
    toast.success(`Access revoked for ${email}`);
    fetchGrantedAccess();
  };

  const filtered = data.filter((r) => {
    if (statusFilter !== "All" && r.status !== statusFilter) return false;
    if (planFilter !== "All" && r.plan !== planFilter) return false;
    if (search) return r.email.toLowerCase().includes(search.toLowerCase());
    return true;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  if (loading) {
    return (
      <div className="space-y-6 max-w-6xl">
        <div><Skeleton className="h-7 w-40" /><Skeleton className="h-4 w-64 mt-2" /></div>
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title="Subscribers"
        description="Manage Cookie Yeti paid subscriptions and access."
        actions={<ExportButton data={filtered} filename="subscribers" columns={EXPORT_COLUMNS} />}
      />

      {/* Subscriptions Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by email..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["All", "active", "canceled", "past_due", "expired"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={planFilter} onValueChange={(v) => { setPlanFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["All", "monthly", "yearly", "lifetime"].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Subscriptions Table */}
      <Card className="border-border/50">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-xs">Email</TableHead>
                <TableHead className="text-xs">Plan</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Stripe ID</TableHead>
                <TableHead className="text-xs">Period End</TableHead>
                <TableHead className="text-xs">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map((r) => (
                <TableRow key={r.id} className="cursor-pointer even:bg-muted/30" onClick={() => setSelected(r)}>
                  <TableCell className="font-medium text-sm">{r.email}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{r.plan}</Badge></TableCell>
                  <TableCell><Badge variant={r.status === "active" ? "default" : "secondary"} className="text-xs">{r.status}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.stripe_customer_id ? (
                      <span className="flex items-center gap-1">
                        {r.stripe_customer_id.slice(0, 12)}…
                        <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(r.stripe_customer_id); }} className="hover:text-foreground transition-colors">
                          <Copy className="h-3 w-3" />
                        </button>
                      </span>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.current_period_end ? new Date(r.current_period_end).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {paged.length === 0 && (
                <TableRow><TableCell colSpan={6} className="p-0"><EmptyState icon={Users} title="No subscribers found" description="Try adjusting your search or filters." /></TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-xs text-muted-foreground tabular-nums">Page {page + 1} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      )}

      {/* Granted Access Section */}
      <Card className="border-border/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-green-500" />
            <CardTitle className="text-base">Granted Access</CardTitle>
          </div>
          <CardDescription>Manually grant premium access for comp/testing (bypasses Stripe)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input placeholder="user@example.com" value={grantEmail} onChange={(e) => setGrantEmail(e.target.value)} className="max-w-xs" />
            <Input placeholder="Reason (optional)" value={grantReason} onChange={(e) => setGrantReason(e.target.value)} className="max-w-xs" />
            <Button onClick={handleGrantAccess} disabled={granting} size="sm" className="gap-1.5">
              {granting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Grant Access
            </Button>
          </div>
          {grantedAccess.length === 0 ? (
            <p className="text-sm text-muted-foreground">No manually granted access records.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs">Email</TableHead>
                  <TableHead className="text-xs">Reason</TableHead>
                  <TableHead className="text-xs">Granted By</TableHead>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grantedAccess.map((g) => (
                  <TableRow key={g.id} className="even:bg-muted/30">
                    <TableCell className="font-medium text-sm">{g.email}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{g.reason || "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{g.granted_by || "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{g.created_at ? new Date(g.created_at).toLocaleDateString() : "—"}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => handleRevokeAccess(g.id, g.email)} className="h-7 w-7 p-0 text-red-500 hover:text-red-600">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Webhook Events Log */}
      <Card className="border-border/50">
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Webhook className="h-5 w-5 text-blue-500" />
            <div>
              <CardTitle className="text-base">Webhook Log</CardTitle>
              <CardDescription>Last 20 Stripe webhook events received</CardDescription>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={fetchWebhookEvents} disabled={webhookLoading} className="gap-1.5">
            {webhookLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {webhookEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No webhook events recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs">Event Type</TableHead>
                    <TableHead className="text-xs">Email</TableHead>
                    <TableHead className="text-xs">Stripe Event ID</TableHead>
                    <TableHead className="text-xs">Received</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {webhookEvents.map((ev: any) => (
                    <TableRow key={ev.id} className="even:bg-muted/30">
                      <TableCell>
                        <Badge variant="outline" className="text-xs font-mono">{ev.event_type}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{ev.email || "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {ev.stripe_event_id ? `${ev.stripe_event_id.slice(0, 20)}…` : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {ev.created_at ? new Date(ev.created_at).toLocaleString() : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Subscriber Detail Sheet */}
      <Sheet open={!!selected} onOpenChange={() => setSelected(null)}>
        <SheetContent>
          <SheetHeader><SheetTitle>Subscriber Details</SheetTitle></SheetHeader>
          {selected && (
            <div className="space-y-4 mt-6">
              {[
                { label: "Email", value: selected.email },
                { label: "Plan", value: selected.plan },
                { label: "Status", value: selected.status },
                { label: "Stripe Customer ID", value: selected.stripe_customer_id || "—", mono: true },
                { label: "Stripe Subscription ID", value: selected.stripe_subscription_id || "—", mono: true },
                { label: "Period End", value: selected.current_period_end ? new Date(selected.current_period_end).toLocaleString() : "—" },
                { label: "Created", value: selected.created_at ? new Date(selected.created_at).toLocaleString() : "—" },
                { label: "Updated", value: selected.updated_at ? new Date(selected.updated_at).toLocaleString() : "—" },
              ].map((item) => (
                <div key={item.label} className="space-y-0.5">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{item.label}</p>
                  <p className={`text-sm ${item.mono ? "font-mono text-xs break-all" : ""}`}>{item.value}</p>
                </div>
              ))}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
