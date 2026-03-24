import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, Clock, AlertTriangle, CheckCircle, ArrowRight, Mail, Briefcase, Snowflake, Users, ShoppingBag, Store, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/admin/PageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { DateRangeFilter, filterByDateRange, type DateRange } from "@/components/admin/DateRangeFilter";
import { ActivityFeed } from "@/components/admin/ActivityFeed";
import { useAdminRealtime } from "@/hooks/useAdminRealtime";


const statusColor: Record<string, string> = {
  Draft: "secondary",
  Submitted: "default",
  "In Review": "outline",
  "Issues Flagged": "destructive",
  Approved: "default",
};

export default function AdminDashboard() {
  const { toast } = useToast();
  const [intakes, setIntakes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [contactCount, setContactCount] = useState(0);
  const [hireCount, setHireCount] = useState(0);
  const [waitlistCount, setWaitlistCount] = useState(0);
  const [cySubCount, setCySubCount] = useState(0);

  useAdminRealtime({
    tables: ["seller_intakes"],
    onNewRecord: (_table, record) => setIntakes((prev) => [record, ...prev]),
  });

  useEffect(() => {
    loadData();
  }, []);

  const checkPasskey = async () => {
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.user) {
      console.log("checkPasskey: no session yet");
      setHasPasskey(false);
      return;
    }
    const { count, error } = await supabase
      .from("passkey_credentials")
      .select("id", { count: "exact", head: true })
      .eq("user_id", session.session.user.id);
    if (error) {
      console.error("checkPasskey error:", error);
      setHasPasskey(false);
      return;
    }
    setHasPasskey((count ?? 0) > 0);
  };

  const handleRegisterPasskey = useCallback(async () => {
    setRegisteringPasskey(true);
    try {
      if (!window.PublicKeyCredential) {
        toast({ title: "Not Supported", description: "Your browser doesn't support passkeys.", variant: "destructive" });
        return;
      }

      const optionsRes = await supabase.functions.invoke("webauthn-register", {
        body: { action: "options", origin: window.location.origin },
      });

      if (optionsRes.error || optionsRes.data?.error) {
        toast({ title: "Error", description: optionsRes.data?.error || "Failed to get options", variant: "destructive" });
        return;
      }

      const options = optionsRes.data;

      const credential = (await navigator.credentials.create({
        publicKey: {
          rp: options.rp,
          user: {
            id: base64urlToBuffer(options.user.id),
            name: options.user.name,
            displayName: options.user.displayName,
          },
          challenge: base64urlToBuffer(options.challenge),
          pubKeyCredParams: options.pubKeyCredParams,
          timeout: options.timeout,
          authenticatorSelection: options.authenticatorSelection,
          attestation: options.attestation,
          excludeCredentials: (options.excludeCredentials || []).map((c: any) => ({
            id: base64urlToBuffer(c.id),
            type: c.type,
          })),
        },
      })) as PublicKeyCredential;

      if (!credential) {
        toast({ title: "Cancelled", description: "Passkey registration was cancelled." });
        return;
      }

      const attestationResponse = credential.response as AuthenticatorAttestationResponse;

      const verifyRes = await supabase.functions.invoke("webauthn-register", {
        body: {
          action: "verify",
          origin: window.location.origin,
          credential: {
            id: credential.id,
            rawId: bufferToBase64url(credential.rawId),
            type: credential.type,
            authenticatorAttachment: (credential as any).authenticatorAttachment,
            response: {
              clientDataJSON: bufferToBase64url(attestationResponse.clientDataJSON),
              attestationObject: bufferToBase64url(attestationResponse.attestationObject),
            },
          },
        },
      });

      if (verifyRes.error || verifyRes.data?.error) {
        toast({ title: "Error", description: verifyRes.data?.error || "Registration failed", variant: "destructive" });
        return;
      }

      setHasPasskey(true);
      toast({ title: "Passkey Registered!", description: "You can now sign in with your passkey." });
    } catch (err) {
      console.error("Passkey registration error:", err);
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        toast({ title: "Cancelled", description: "Passkey registration was cancelled." });
      } else {
        toast({ title: "Error", description: err instanceof Error ? err.message : "Registration failed", variant: "destructive" });
      }
    } finally {
      setRegisteringPasskey(false);
    }
  }, [toast]);

  const loadData = async () => {
    const [intakesRes, contactsRes, hiresRes, waitlistRes, cySubsRes] = await Promise.all([
      supabase.from("seller_intakes").select("*").order("created_at", { ascending: false }),
      supabase.from("contact_submissions").select("id", { count: "exact", head: true }).eq("status", "new"),
      supabase.from("hire_requests").select("id", { count: "exact", head: true }).eq("status", "new"),
      supabase.from("waitlist_subscribers").select("id", { count: "exact", head: true }),
      supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "active"),
    ]);
    if (intakesRes.error) toast({ title: "Failed to load", description: intakesRes.error.message, variant: "destructive" });
    setIntakes(intakesRes.data || []);
    setContactCount(contactsRes.count ?? 0);
    setHireCount(hiresRes.count ?? 0);
    setWaitlistCount(waitlistRes.count ?? 0);
    setCySubCount(cySubsRes.count ?? 0);
    setLoading(false);
  };

  const filtered = useMemo(() => filterByDateRange(intakes, dateRange), [intakes, dateRange]);

  const stats = useMemo(() => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const getPlatforms = (r: any): string[] => r.selected_platforms?.length ? r.selected_platforms : [r.platform];
    return {
      total: filtered.length,
      thisWeek: filtered.filter((r) => new Date(r.created_at!) > weekAgo).length,
      needsReview: filtered.filter((r) => r.status === "Submitted" || r.status === "In Review").length,
      approved: filtered.filter((r) => r.status === "Approved").length,
      amazon: filtered.filter((r) => getPlatforms(r).some((p: string) => p.toLowerCase().includes("amazon"))).length,
      shopify: filtered.filter((r) => getPlatforms(r).some((p: string) => p.toLowerCase().includes("shopify"))).length,
      tiktok: filtered.filter((r) => getPlatforms(r).some((p: string) => p.toLowerCase().includes("tiktok"))).length,
    };
  }, [filtered]);

  const recent = filtered.slice(0, 5);

  const statCards = [
    { label: "Intake Submissions", value: stats.total, icon: FileText, iconColor: "text-primary", iconBg: "bg-primary/10", accentColor: "border-primary/40" },
    { label: "Needs Review", value: stats.needsReview, icon: AlertTriangle, iconColor: "text-yellow-500", iconBg: "bg-yellow-500/10", accentColor: "border-yellow-500/40" },
    { label: "Amazon", value: stats.amazon, icon: ShoppingBag, iconColor: "text-amber-600", iconBg: "bg-amber-600/10", accentColor: "border-amber-600/40" },
    { label: "Shopify", value: stats.shopify, icon: Store, iconColor: "text-emerald-600", iconBg: "bg-emerald-600/10", accentColor: "border-emerald-600/40" },
    { label: "TikTok", value: stats.tiktok, icon: Video, iconColor: "text-pink-500", iconBg: "bg-pink-500/10", accentColor: "border-pink-500/40" },
    { label: "New Contacts", value: contactCount, icon: Mail, iconColor: "text-blue-500", iconBg: "bg-blue-500/10", accentColor: "border-blue-500/40" },
    { label: "Hire Requests", value: hireCount, icon: Briefcase, iconColor: "text-orange-500", iconBg: "bg-orange-500/10", accentColor: "border-orange-500/40" },
    { label: "CY Subscribers", value: cySubCount, icon: Snowflake, iconColor: "text-cyan-500", iconBg: "bg-cyan-500/10", accentColor: "border-cyan-500/40" },
    { label: "Waitlist", value: waitlistCount, icon: Users, iconColor: "text-green-500", iconBg: "bg-green-500/10", accentColor: "border-green-500/40" },
  ];

  if (loading) {
    return (
      <div className="space-y-8 max-w-6xl">
        <div><Skeleton className="h-7 w-48" /><Skeleton className="h-4 w-72 mt-2" /></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader title="Dashboard" description="Overview across all products and services." />
        <div className="flex items-center gap-2">
          {hasPasskey === false && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={handleRegisterPasskey}
              disabled={registeringPasskey}
            >
              <Fingerprint className="h-3.5 w-3.5" />
              {registeringPasskey ? "Registering..." : "Register Passkey"}
            </Button>
          )}
          <DateRangeFilter value={dateRange} onChange={setDateRange} />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {statCards.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <div>
              <CardTitle className="text-base">Recent Submissions</CardTitle>
              <CardDescription className="text-xs">Latest marketplace intake submissions.</CardDescription>
            </div>
            <Link to="/admin/submissions">
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground">
                View all <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {/* Desktop table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs">Business Name</TableHead>
                    <TableHead className="text-xs">Contact</TableHead>
                    <TableHead className="text-xs">Platform</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.map((r) => (
                    <TableRow key={r.id} className="even:bg-muted/30">
                      <TableCell>
                        <Link to={`/admin/submissions/${r.id}`} className="text-primary hover:underline font-medium text-sm">
                          {r.business_legal_name || "Unnamed"}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{r.client_name || "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(r.selected_platforms?.length ? r.selected_platforms : [r.platform]).map((p: string) => (
                            <Badge key={p} variant="outline" className="text-xs">{p}</Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusColor[r.status] as any} className="text-xs">{r.status}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {recent.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="p-0">
                        <EmptyState icon={FileText} title="No submissions yet" description="Intake submissions will appear here once clients submit their information." />
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-border">
              {recent.map((r) => (
                <Link key={r.id} to={`/admin/submissions/${r.id}`} className="block p-3 hover:bg-muted/50 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-primary truncate">{r.business_legal_name || "Unnamed"}</p>
                    <Badge variant={statusColor[r.status] as any} className="text-[10px] shrink-0">{r.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{r.client_name || "—"}</p>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    {(r.selected_platforms?.length ? r.selected_platforms : [r.platform]).map((p: string) => (
                      <Badge key={p} variant="outline" className="text-[10px] px-1.5 py-0">{p}</Badge>
                    ))}
                    <span className="text-[10px] text-muted-foreground ml-auto">{r.created_at ? new Date(r.created_at).toLocaleDateString() : ""}</span>
                  </div>
                </Link>
              ))}
              {recent.length === 0 && (
                <div className="p-4">
                  <EmptyState icon={FileText} title="No submissions yet" description="Intake submissions will appear here once clients submit their information." />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <ActivityFeed />
      </div>
    </div>
  );
}
