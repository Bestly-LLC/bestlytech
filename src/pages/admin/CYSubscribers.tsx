import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Copy, ChevronLeft, ChevronRight } from "lucide-react";

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
    <AdminLayout>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-foreground">Subscribers</h1>

        <div className="flex flex-col sm:flex-row gap-3">
          <Input placeholder="Search by email..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="max-w-xs" />
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

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Stripe ID</TableHead>
                  <TableHead>Period End</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                    <TableCell className="font-medium">{r.email}</TableCell>
                    <TableCell><Badge variant="outline">{r.plan}</Badge></TableCell>
                    <TableCell><Badge variant={r.status === "active" ? "default" : "secondary"}>{r.status}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.stripe_customer_id ? (
                        <span className="flex items-center gap-1">
                          {r.stripe_customer_id.slice(0, 12)}...
                          <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(r.stripe_customer_id); }}>
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
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No subscribers found</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="text-sm text-muted-foreground">Page {page + 1} of {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        )}

        <Sheet open={!!selected} onOpenChange={() => setSelected(null)}>
          <SheetContent>
            <SheetHeader><SheetTitle>Subscriber Details</SheetTitle></SheetHeader>
            {selected && (
              <div className="space-y-3 mt-4">
                <div><span className="text-sm text-muted-foreground">Email</span><p className="font-medium">{selected.email}</p></div>
                <div><span className="text-sm text-muted-foreground">Plan</span><p>{selected.plan}</p></div>
                <div><span className="text-sm text-muted-foreground">Status</span><p>{selected.status}</p></div>
                <div><span className="text-sm text-muted-foreground">Stripe Customer ID</span><p className="text-xs break-all">{selected.stripe_customer_id || "—"}</p></div>
                <div><span className="text-sm text-muted-foreground">Stripe Subscription ID</span><p className="text-xs break-all">{selected.stripe_subscription_id || "—"}</p></div>
                <div><span className="text-sm text-muted-foreground">Period End</span><p>{selected.current_period_end ? new Date(selected.current_period_end).toLocaleString() : "—"}</p></div>
                <div><span className="text-sm text-muted-foreground">Created</span><p>{selected.created_at ? new Date(selected.created_at).toLocaleString() : "—"}</p></div>
                <div><span className="text-sm text-muted-foreground">Updated</span><p>{selected.updated_at ? new Date(selected.updated_at).toLocaleString() : "—"}</p></div>
              </div>
            )}
          </SheetContent>
        </Sheet>
      </div>
    </AdminLayout>
  );
}
