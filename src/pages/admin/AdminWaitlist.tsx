import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronLeft, ChevronRight, Search, ListChecks } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { EmptyState } from "@/components/admin/EmptyState";
import { ExportButton } from "@/components/admin/ExportButton";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

const PAGE_SIZE = 20;

const EXPORT_COLUMNS = [
  { key: "email", label: "Email" },
  { key: "products", label: "Products" },
  { key: "source", label: "Source" },
  { key: "confirmed", label: "Confirmed" },
  { key: "created_at", label: "Date" },
];

export default function AdminWaitlist() {
  const [data, setData] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    const { data: rows, error } = await supabase
      .from("waitlist_subscribers")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast({ title: "Failed to load", description: error.message, variant: "destructive" });
    setData(rows || []);
    setLoading(false);
  };

  const filtered = data.filter((r) => {
    if (!search) return true;
    return (r.email || "").toLowerCase().includes(search.toLowerCase());
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  if (loading) {
    return (
      <div className="space-y-6 max-w-6xl">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title="Waitlist Subscribers"
        description={`${data.length} total subscribers.`}
        actions={<ExportButton data={filtered} filename="waitlist" columns={EXPORT_COLUMNS} />}
      />

      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search by email..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="pl-9" />
      </div>

      <Card className="border-border/50">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-xs">Email</TableHead>
                <TableHead className="text-xs">Products</TableHead>
                <TableHead className="text-xs">Source</TableHead>
                <TableHead className="text-xs">Confirmed</TableHead>
                <TableHead className="text-xs">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map((r) => (
                <TableRow key={r.id} className="even:bg-muted/30">
                  <TableCell className="font-medium text-sm">{r.email}</TableCell>
                  <TableCell className="text-sm">
                    {(r.products || []).map((p: string) => (
                      <Badge key={p} variant="outline" className="text-xs mr-1">{p}</Badge>
                    ))}
                    {(!r.products || r.products.length === 0) && "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{r.source || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={r.confirmed ? "default" : "secondary"} className="text-xs">
                      {r.confirmed ? "Yes" : "No"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}</TableCell>
                </TableRow>
              ))}
              {paged.length === 0 && (
                <TableRow><TableCell colSpan={5} className="p-0"><EmptyState icon={ListChecks} title="No subscribers" description="Waitlist sign-ups will appear here." /></TableCell></TableRow>
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
    </div>
  );
}
