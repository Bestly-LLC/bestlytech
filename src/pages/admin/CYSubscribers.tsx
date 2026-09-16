import { useEffect, useState, useCallback, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle, ArrowRight, ChevronLeft, ChevronRight, Copy, Download, KeyRound, PanelRightOpen, RefreshCw, Search, ShieldCheck, Users, Webhook,
} from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { EmptyState } from "@/components/admin/EmptyState";
import { ActionMenu } from "@/components/admin/ActionMenu";
import { downloadCsv } from "@/components/admin/ExportButton";
import { fetchAllRows } from "@/lib/fetchAllRows";

const EXPORT_COLUMNS = [
  { key: "email", label: "Email" },
  { key: "plan", label: "Plan" },
  { key: "status", label: "Status" },
  { key: "source", label: "Source" },
  { key: "stripe_customer_id", label: "Stripe Customer ID" },
  { key: "current_period_end", label: "Period End" },
  { key: "created_at", label: "Created" },
];

const PAGE_SIZE = 20;
const MAX_SUBSCRIBERS = 20000;

/** Rows created by the granted_access trigger, not by Stripe. */
const isComp = (r: { stripe_customer_id?: string | null }) => !!r.stripe_customer_id?.startsWith("granted_");

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : "—");

async function copy(value: string, what: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Couldn't copy to clipboard");
  }
}

export default function CYSubscribers() {
  const [data, setData] = useState<any[]>([]);
  const [activationCodes, setActivationCodes] = useState<any[]>([]);
  const [webhookEvents, setWebhookEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [planFilter, setPlanFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<any>(null);
  const [truncated, setTruncated] = useState(false);
  const navigate = useNavigate();

  const loadAll = useCallback(async () => {
    const [subs, codes, hooks] = await Promise.all([
      // Paged: a plain select stops at 1,000 rows without saying so.
      fetchAllRows<any>(
        (from, to) => supabase.from("subscriptions").select("*").order("created_at", { ascending: false }).order("id").range(from, to),
        { maxRows: MAX_SUBSCRIBERS },
      ),
      supabase
        .from("activation_codes")
        .select("id, email, code, platform, active, activated_at, last_verified, expires_at, created_at")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("webhook_events")
        .select("id, event_type, email, stripe_event_id, created_at")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    const errs: string[] = [];
    if (subs.error) errs.push(`Subscriptions: ${subs.error.message}`); else { setData(subs.data); setTruncated(subs.truncated); }
    if (codes.error) errs.push(`Activation codes: ${codes.error.message}`); else setActivationCodes(codes.data || []);
    if (hooks.error) errs.push(`Webhook log: ${hooks.error.message}`); else setWebhookEvents(hooks.data || []);
    setErrors(errs);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const filtered = useMemo(() => data.filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (planFilter !== "all" && r.plan !== planFilter) return false;
    if (search) return (r.email ?? "").toLowerCase().includes(search.toLowerCase());
    return true;
  }), [data, statusFilter, planFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const compCount = data.filter(isComp).length;

  const exportCsv = () => {
    const rows = filtered.map((r) => ({ ...r, source: isComp(r) ? "comp (granted)" : "stripe" }));
    const n = downloadCsv(rows, "subscribers", EXPORT_COLUMNS);
    if (n) toast.success(`Exported ${n} subscribers`);
    else toast.info("Nothing to export");
  };

  const refresh = () => { setRefreshing(true); return loadAll(); };

  if (loading) {
    return (
      <div className="space-y-6 max-w-6xl" aria-busy="true">
        <div><Skeleton className="h-9 w-40" /><Skeleton className="h-4 w-64 mt-3" /></div>
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title="Subscribers"
        description="Cookie Yeti subscriptions, extension activations and the Stripe webhook log."
        actions={
          <>
            <Button asChild variant="outline" size="sm" className="h-9 gap-1.5 border-white/10 text-white/80 hover:text-white hover:bg-white/5">
              <Link to="/admin/cookie-yeti/granted">Granted access <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
            </Button>
            <ActionMenu
              label="More actions"
              items={[
                { group: "Export", label: "Export subscribers CSV", icon: Download, hint: `${filtered.length}`, disabled: filtered.length === 0, onSelect: exportCsv },
                { group: "View", label: "Refresh", icon: RefreshCw, disabled: refreshing, onSelect: refresh },
              ]}
            />
          </>
        }
      />

      {errors.length > 0 && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-500/25 bg-red-500/[0.06] px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-red-300 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium text-red-200">Some data didn't load</p>
            <ul className="text-red-200/75 text-xs mt-0.5 space-y-0.5">{errors.map((e) => <li key={e} className="break-words">{e}</li>)}</ul>
          </div>
          <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing} className="h-9 border-red-500/30 text-red-100 hover:bg-red-500/10">Retry</Button>
        </div>
      )}

      <Tabs defaultValue="subscriptions" className="space-y-4">
        <TabsList className="h-10 max-w-full overflow-x-auto justify-start bg-white/[0.04] border border-white/[0.06]">
          <TabsTrigger value="subscriptions" className="gap-1.5 data-[state=active]:bg-white/10 data-[state=active]:text-white text-white/60">
            <Users className="h-3.5 w-3.5" aria-hidden="true" /> Subscriptions <span className="tabular-nums text-white/55">{data.length}</span>
          </TabsTrigger>
          <TabsTrigger value="codes" className="gap-1.5 data-[state=active]:bg-white/10 data-[state=active]:text-white text-white/60">
            <KeyRound className="h-3.5 w-3.5" aria-hidden="true" /> Activations <span className="tabular-nums text-white/55">{activationCodes.length}</span>
          </TabsTrigger>
          <TabsTrigger value="webhooks" className="gap-1.5 data-[state=active]:bg-white/10 data-[state=active]:text-white text-white/60">
            <Webhook className="h-3.5 w-3.5" aria-hidden="true" /> Webhooks
          </TabsTrigger>
        </TabsList>

        {/* ── Subscriptions ── */}
        <TabsContent value="subscriptions" className="space-y-4 mt-0">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/45" aria-hidden="true" />
              <Input aria-label="Search by email" placeholder="Search by email" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="pl-9 h-9" />
            </div>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
              <SelectTrigger aria-label="Filter by status" className="h-9 w-full sm:w-[9.5rem]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[["all", "All statuses"], ["active", "Active"], ["canceled", "Canceled"], ["past_due", "Past due"], ["expired", "Expired"]].map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={planFilter} onValueChange={(v) => { setPlanFilter(v); setPage(0); }}>
              <SelectTrigger aria-label="Filter by plan" className="h-9 w-full sm:w-[9.5rem]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[["all", "All plans"], ["monthly", "Monthly"], ["yearly", "Yearly"], ["lifetime", "Lifetime"]].map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
            {compCount > 0 && (
              <p className="text-xs text-white/55 sm:ml-auto">{compCount} of {data.length} are comp rows. Revoke them from Granted Access.</p>
            )}
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-white/[0.06]">
                  <TableHead className="text-xs text-white/60">Email</TableHead>
                  <TableHead className="text-xs text-white/60">Plan</TableHead>
                  <TableHead className="text-xs text-white/60">Status</TableHead>
                  <TableHead className="text-xs text-white/60 hidden md:table-cell">Period end</TableHead>
                  <TableHead className="text-xs text-white/60 hidden sm:table-cell">Created</TableHead>
                  <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map((r) => (
                  <TableRow key={r.id} className="border-white/[0.04]">
                    <TableCell className="text-sm">
                      <button type="button" onClick={() => setSelected(r)} className="rounded text-left font-medium text-white/90 hover:text-white hover:underline underline-offset-2 break-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40">
                        {r.email}
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="outline" className="text-xs border-white/15 text-white/80 capitalize">{r.plan}</Badge>
                        {isComp(r) && <Badge variant="outline" className="text-xs border-emerald-500/30 text-emerald-300">Comp</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={r.status === "active" ? "text-xs border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "text-xs border-white/15 text-white/65"}>
                        {String(r.status ?? "").replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-white/60 hidden md:table-cell">{fmtDate(r.current_period_end)}</TableCell>
                    <TableCell className="text-sm text-white/60 hidden sm:table-cell">{fmtDate(r.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <ActionMenu
                        label={`Actions for ${r.email}`}
                        items={[
                          { label: "View details", icon: PanelRightOpen, onSelect: () => setSelected(r) },
                          { label: "Copy email", icon: Copy, onSelect: () => copy(r.email, "Email") },
                          ...(isComp(r)
                            ? [{ group: "Comp access", label: "Manage or revoke in Granted Access", icon: ShieldCheck, onSelect: () => navigate(`/admin/cookie-yeti/granted?q=${encodeURIComponent(r.email)}`) }]
                            : []),
                          ...(r.stripe_customer_id && !isComp(r)
                            ? [{ label: "Copy Stripe customer ID", icon: Copy, onSelect: () => copy(r.stripe_customer_id, "Customer ID") }]
                            : []),
                        ]}
                      />
                    </TableCell>
                  </TableRow>
                ))}
                {paged.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={6} className="p-0">
                      <EmptyState
                        compact
                        icon={Users}
                        title={data.length ? "No subscribers match" : "No subscribers yet"}
                        description={data.length ? "Try a different search or filter." : "Paid subscriptions appear here when Stripe checkout completes."}
                      />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {truncated && (
            <p className="text-xs text-amber-300" role="status">Showing the newest {MAX_SUBSCRIBERS.toLocaleString()} subscriptions only. Export and counts cover those rows.</p>
          )}

          {totalPages > 1 && (
            <nav className="flex items-center justify-center gap-3" aria-label="Pagination">
              <Button variant="outline" size="icon" className="h-9 w-9" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button>
              <span className="text-xs text-white/60 tabular-nums">Page {page + 1} of {totalPages}</span>
              <Button variant="outline" size="icon" className="h-9 w-9" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
            </nav>
          )}
        </TabsContent>

        {/* ── Activation codes ── */}
        <TabsContent value="codes" className="mt-0">
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
            <p className="px-5 pt-4 pb-2 text-xs text-white/55">Emails that redeemed an extension activation code (Chrome, Firefox, Safari). Latest 200.</p>
            {activationCodes.length === 0 ? (
              <EmptyState compact icon={KeyRound} title="No activations yet" description="Codes show up here once someone activates the extension with their email." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-white/[0.06]">
                    <TableHead className="text-xs text-white/60">Email</TableHead>
                    <TableHead className="text-xs text-white/60">Platform</TableHead>
                    <TableHead className="text-xs text-white/60">Status</TableHead>
                    <TableHead className="text-xs text-white/60 hidden sm:table-cell">Activated</TableHead>
                    <TableHead className="text-xs text-white/60 hidden md:table-cell">Last verified</TableHead>
                    <TableHead className="text-xs text-white/60 hidden md:table-cell">Expires</TableHead>
                    <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activationCodes.map((c) => (
                    <TableRow key={c.id} className="border-white/[0.04]">
                      <TableCell className="font-medium text-sm text-white/90 break-all">{c.email}</TableCell>
                      <TableCell className="text-sm text-white/70 capitalize">{c.platform || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={c.active ? "text-xs border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "text-xs border-white/15 text-white/65"}>
                          {c.active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-white/60 hidden sm:table-cell">{c.activated_at ? fmtDate(c.activated_at) : "Never"}</TableCell>
                      <TableCell className="text-sm text-white/60 hidden md:table-cell">{fmtDate(c.last_verified)}</TableCell>
                      <TableCell className="text-sm text-white/60 hidden md:table-cell">{fmtDate(c.expires_at)}</TableCell>
                      <TableCell className="text-right">
                        <ActionMenu
                          label={`Actions for ${c.email}`}
                          items={[
                            { label: "Copy code", icon: Copy, onSelect: () => copy(c.code, "Code") },
                            { label: "Copy email", icon: Copy, onSelect: () => copy(c.email, "Email") },
                          ]}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>

        {/* ── Webhook log ── */}
        <TabsContent value="webhooks" className="mt-0">
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
            <p className="px-5 pt-4 pb-2 text-xs text-white/55">Latest 50 Stripe webhook events received.</p>
            {webhookEvents.length === 0 ? (
              <div role="alert" className="m-4 flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3">
                <AlertTriangle className="h-5 w-5 text-amber-300 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-amber-200">No Stripe events have ever been received. Check the webhook endpoint in Stripe.</p>
                  <p className="text-amber-200/75 text-xs mt-0.5 break-words">
                    The stripe-webhook function logs every event it accepts here, so checkouts, renewals and cancellations are not reaching it.
                    Stripe should send to <code className="px-1 rounded bg-white/10">/functions/v1/stripe-webhook</code> on this Supabase project, signed with the same secret as <code className="px-1 rounded bg-white/10">STRIPE_WEBHOOK_SECRET</code>.
                  </p>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-white/[0.06]">
                      <TableHead className="text-xs text-white/60">Event</TableHead>
                      <TableHead className="text-xs text-white/60">Email</TableHead>
                      <TableHead className="text-xs text-white/60 hidden md:table-cell">Stripe event ID</TableHead>
                      <TableHead className="text-xs text-white/60">Received</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {webhookEvents.map((ev: any) => (
                      <TableRow key={ev.id} className="border-white/[0.04]">
                        <TableCell><Badge variant="outline" className="text-xs font-mono border-white/15 text-white/80">{ev.event_type}</Badge></TableCell>
                        <TableCell className="text-sm text-white/80 break-all">{ev.email || "—"}</TableCell>
                        <TableCell className="text-xs text-white/60 font-mono hidden md:table-cell">{ev.stripe_event_id || "—"}</TableCell>
                        <TableCell className="text-xs text-white/60 whitespace-nowrap">{ev.created_at ? new Date(ev.created_at).toLocaleString() : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Subscriber detail sheet */}
      <Sheet open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <SheetContent className="admin-shell w-full sm:max-w-md bg-[#0a0a0a] border-white/[0.06] text-white">
          <SheetHeader className="text-left">
            <SheetTitle className="text-white">Subscriber</SheetTitle>
            <SheetDescription className="text-white/60 break-all">{selected?.email}</SheetDescription>
          </SheetHeader>
          {selected && (
            <dl className="space-y-4 mt-6">
              {[
                { label: "Plan", value: selected.plan },
                { label: "Status", value: String(selected.status ?? "").replace(/_/g, " ") },
                { label: "Source", value: isComp(selected) ? "Comp, created by Granted Access" : "Stripe" },
                { label: "Stripe customer ID", value: isComp(selected) ? "—" : selected.stripe_customer_id || "—", mono: true },
                { label: "Stripe subscription ID", value: selected.stripe_subscription_id || "—", mono: true },
                { label: "Period end", value: selected.current_period_end ? new Date(selected.current_period_end).toLocaleString() : "—" },
                { label: "Created", value: selected.created_at ? new Date(selected.created_at).toLocaleString() : "—" },
                { label: "Updated", value: selected.updated_at ? new Date(selected.updated_at).toLocaleString() : "—" },
              ].map((item) => (
                <div key={item.label} className="space-y-0.5">
                  <dt className="text-[0.6875rem] font-medium text-white/55 uppercase tracking-wide">{item.label}</dt>
                  <dd className={`text-sm text-white/90 ${item.mono ? "font-mono text-xs break-all" : ""}`}>{item.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
