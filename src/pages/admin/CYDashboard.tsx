import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Crown, Users, ShieldCheck, Calendar, Plus } from "lucide-react";

export default function CYDashboard() {
  const [subs, setSubs] = useState<any[]>([]);
  const [grants, setGrants] = useState<any[]>([]);
  const [grantEmail, setGrantEmail] = useState("");
  const [grantReason, setGrantReason] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [{ data: s }, { data: g }] = await Promise.all([
      supabase.from("subscriptions").select("*").order("created_at", { ascending: false }),
      supabase.from("granted_access").select("*").order("created_at", { ascending: false }),
    ]);
    setSubs(s || []);
    setGrants(g || []);
  };

  const handleGrant = async () => {
    if (!grantEmail) return;
    const { error } = await supabase.from("granted_access").insert({
      email: grantEmail.trim().toLowerCase(),
      granted_by: "admin",
      reason: grantReason || null,
    });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Access Granted" });
      setGrantEmail("");
      setGrantReason("");
      setDialogOpen(false);
      loadData();
    }
  };

  const activeSubs = subs.filter((s) => s.status === "active");
  const monthly = activeSubs.filter((s) => s.plan === "monthly").length;
  const yearly = activeSubs.filter((s) => s.plan === "yearly").length;

  const stats = [
    { label: "Total Premium", value: activeSubs.length + grants.length, icon: Crown, color: "text-yellow-500" },
    { label: "Paid Subscribers", value: activeSubs.length, icon: Users, color: "text-primary" },
    { label: "Granted Access", value: grants.length, icon: ShieldCheck, color: "text-green-500" },
    { label: "Monthly Plans", value: monthly, icon: Calendar, color: "text-blue-500" },
    { label: "Yearly Plans", value: yearly, icon: Calendar, color: "text-purple-500" },
  ];

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground">Cookie Yeti Dashboard</h1>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-1" /> Grant Access</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Grant Premium Access</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Email</Label>
                  <Input value={grantEmail} onChange={(e) => setGrantEmail(e.target.value)} placeholder="user@example.com" />
                </div>
                <div>
                  <Label>Reason</Label>
                  <Textarea value={grantReason} onChange={(e) => setGrantReason(e.target.value)} placeholder="Why grant access?" rows={2} />
                </div>
                <Button onClick={handleGrant} className="w-full">Grant Access</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {stats.map((s) => (
            <Card key={s.label}>
              <CardContent className="pt-6 text-center">
                <s.icon className={`h-6 w-6 mx-auto mb-2 ${s.color}`} />
                <p className="text-2xl font-bold text-foreground">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Recent Subscribers</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subs.slice(0, 5).map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="text-sm">{s.email}</TableCell>
                      <TableCell><Badge variant="outline">{s.plan}</Badge></TableCell>
                      <TableCell><Badge variant={s.status === "active" ? "default" : "secondary"}>{s.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                  {subs.length === 0 && (
                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No subscribers</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Recently Granted</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grants.slice(0, 5).map((g) => (
                    <TableRow key={g.id}>
                      <TableCell className="text-sm">{g.email}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{g.reason || "—"}</TableCell>
                    </TableRow>
                  ))}
                  {grants.length === 0 && (
                    <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">No granted access</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
