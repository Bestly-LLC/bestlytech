import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Search } from "lucide-react";

export default function CYGrantedAccess() {
  const [data, setData] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const { data } = await supabase.from("granted_access").select("*").order("created_at", { ascending: false });
    setData(data || []);
  };

  const handleGrant = async () => {
    if (!email.trim()) return;
    const { error } = await supabase.from("granted_access").insert({
      email: email.trim().toLowerCase(),
      granted_by: "admin",
      reason: reason || null,
    });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Access Granted" });
      setEmail("");
      setReason("");
      loadData();
    }
  };

  const revoke = async (id: string) => {
    await supabase.from("granted_access").delete().eq("id", id);
    toast({ title: "Access Revoked" });
    loadData();
  };

  const bulkRevoke = async () => {
    for (const id of selected) {
      await supabase.from("granted_access").delete().eq("id", id);
    }
    setSelected(new Set());
    toast({ title: `Revoked ${selected.size} entries` });
    loadData();
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const filtered = search
    ? data.filter((d) => d.email.toLowerCase().includes(search.toLowerCase()))
    : data;

  return (
    <div className="space-y-6 max-w-5xl">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Granted Access</h1>
          <p className="text-sm text-muted-foreground mt-1">Manually grant or revoke Cookie Yeti premium access.</p>
        </div>

        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Grant Premium Access</CardTitle>
            <CardDescription className="text-xs">Add an email to give immediate premium access.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs font-medium">Email</Label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" />
              </div>
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs font-medium">Reason</Label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional reason" rows={1} />
              </div>
              <div className="flex items-end">
                <Button onClick={handleGrant} size="sm">Grant</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <div className="relative max-w-xs flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by email..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          {selected.size > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">Revoke Selected ({selected.size})</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Revoke {selected.size} entries?</AlertDialogTitle>
                  <AlertDialogDescription>This will remove premium access for the selected users.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={bulkRevoke}>Revoke All</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        <Card className="border-border/50">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selected.size === filtered.length && filtered.length > 0}
                      onCheckedChange={(checked) => {
                        setSelected(checked ? new Set(filtered.map((d) => d.id)) : new Set());
                      }}
                    />
                  </TableHead>
                  <TableHead className="text-xs">Email</TableHead>
                  <TableHead className="text-xs">Reason</TableHead>
                  <TableHead className="text-xs">Granted By</TableHead>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <Checkbox checked={selected.has(d.id)} onCheckedChange={() => toggleSelect(d.id)} />
                    </TableCell>
                    <TableCell className="font-medium text-sm">{d.email}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{d.reason || "—"}</TableCell>
                    <TableCell className="text-sm">{d.granted_by || "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {d.created_at ? new Date(d.created_at).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Revoke access for {d.email}?</AlertDialogTitle>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => revoke(d.id)}>Revoke</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-12 text-sm">No granted access entries</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
    </div>
  );
}
