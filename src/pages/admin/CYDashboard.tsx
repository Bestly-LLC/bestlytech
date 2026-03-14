import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Crown, Users, ShieldCheck, Calendar, Plus, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

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
    { label: "Total Premium", value: activeSubs.length + grants.length, icon: Crown, color: "text-yellow-500", bg: "bg-yellow-500/10" },
    { label: "Paid Subscribers", value: activeSubs.length, icon: Users, color: "text-primary", bg: "bg-primary/10" },
    { label: "Granted Access", value: grants.length, icon: ShieldCheck, color: "text-green-500", bg: "bg-green-500/10" },
    { label: "Monthly", value: monthly, icon: Calendar, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: "Yearly", value: yearly, icon: Calendar, color: "text-purple-500", bg: "bg-purple-500/10" },
  ];

  return (
    <AdminLayout>
      <div className="space-y-8 max-w-6xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Cookie Yeti Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage premium subscribers and access grants.</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Grant Access</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Grant Premium Access</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Email</Label>
                  <Input value={grantEmail} onChange={(e) => setGrantEmail(e.target.value)} placeholder="user@example.com" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Reason</Label>
                  <Textarea value={grantReason} onChange={(e) => setGrantReason(e.target.value)} placeholder="Why grant access?" rows={2} />
                </div>
                <Button onClick={handleGrant} className="w-full">Grant Access</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {stats.map((s) => (
            <Card key={s.label} className="border-border/50">
              <CardContent className="pt-5 pb-4 text-center">
                <div className={`h-9 w-9 rounded-xl ${s.bg} flex items-center justify-center mx-auto mb-2`}>
                  <s.icon className={`h-4 w-4 ${s.color}`} />
                </div>
                <p className="text-2xl font-bold text-foreground">{s.value}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <Card className="border-border/50">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-sm font-semibold">Recent Subscribers</CardTitle>
                <CardDescription className="text-xs">Latest paid subscriptions.</CardDescription>
              </div>
              <Link to="/admin/cookie-yeti/subscribers">
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground h-7">
                  View all <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs">Email</TableHead>
                    <TableHead className="text-xs">Plan</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subs.slice(0, 5).map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="text-sm">{s.email}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{s.plan}</Badge></TableCell>
                      <TableCell><Badge variant={s.status === "active" ? "default" : "secondary"} className="text-xs">{s.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                  {subs.length === 0 && (
                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8 text-sm">No subscribers</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-sm font-semibold">Recently Granted</CardTitle>
                <CardDescription className="text-xs">Manual premium access grants.</CardDescription>
              </div>
              <Link to="/admin/cookie-yeti/granted">
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground h-7">
                  View all <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs">Email</TableHead>
                    <TableHead className="text-xs">Reason</TableHead>
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
                    <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground py-8 text-sm">No granted access</TableCell></TableRow>
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
