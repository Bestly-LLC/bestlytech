import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Copy, ChevronLeft, ChevronRight, Search } from "lucide-react";

const PAGE_SIZE = 20;

export default function CYSubscribers() {
  const [data, setData] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [planFilter, setPlanFilter] = useState("All");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<any>(null);

  useEffect(() => {
    supabase.from("subscriptions").select("*").order("created_at", { ascending: false }).then(({ data }) => setData(data || []));
  }, []);

  const filtered = data.filter((r) => {
    if (statusFilter !== "All" && r.status !== statusFilter) return false;
    if (planFilter !== "All" && r.plan !== planFilter) return false;
    if (search) return r.email.toLowerCase().includes(search.toLowerCase());
    return true;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="space-y-6 max-w-6xl">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Subscribers</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage Cookie Yeti paid subscriptions.</p>
        </div>

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
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
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
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-12 text-sm">No subscribers found</TableCell></TableRow>
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
