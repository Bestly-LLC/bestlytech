import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Printer } from "lucide-react";

const APP_LABEL: Record<string, string> = {
  drive: "Drive",
  "video-chat": "Video & Chat",
  mail: "Mail",
  docs: "Docs",
  calendar: "Calendar",
  ai: "AI",
  shield: "DNS Shield",
  vpn: "VPN",
  backup: "Backup",
  projects: "Projects",
  forms: "Forms",
  passwords: "Passwords",
  sign: "E-sign",
};

// Per-user/year ballpark for cloud-stack replacement (used when client doesn't
// have an exact spend figure to plug in). These are conservative and based on
// the brochure's $146K/year for 50-person reference point.
const PER_USER_BAND_DEFAULT_ANNUAL: Record<string, number> = {
  "5": 146100 * (5 / 50),
  "25": 146100 * (25 / 50),
  "50": 146100,
  "100": 146100 * 2,
  "200+": 146100 * 4,
};

// Default deployment fee bands (rough — operator can override per call)
const DEPLOY_FEE_DEFAULT: Record<string, number> = {
  "5": 24500,
  "25": 38500,
  "50": 57500,
  "100": 78000,
  "200+": 110000,
};

function dollars(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function CloudDiscoveryBrief() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);

  const [lead, setLead] = useState<any>(null);
  const [brief, setBrief] = useState<any>(null);

  // Editable fields the operator fills during/after the call
  const [annualSpend, setAnnualSpend] = useState<number>(0);
  const [deployFee, setDeployFee] = useState<number>(0);
  const [supportTier, setSupportTier] = useState<string>("Self-managed");
  const [monthlyFee, setMonthlyFee] = useState<number>(0);
  const [customNotes, setCustomNotes] = useState<string>("");
  const [date, setDate] = useState<string>(
    new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
  );

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      const [lRes, bRes] = await Promise.all([
        supabase.from("cloud_leads").select("*").eq("id", id).maybeSingle(),
        supabase.from("cloud_briefs").select("*").eq("lead_id", id).maybeSingle(),
      ]);
      if (cancelled) return;
      const l = lRes.data;
      setLead(l);
      setBrief(bRes.data);
      if (l) {
        // Pre-populate spend default from brief band, else from user-count band
        const briefBand: string | null = (bRes.data as any)?.annual_saas_spend_band ?? null;
        const briefSpendDefault: Record<string, number> = {
          "<25k": 18000,
          "25-75k": 50000,
          "75-150k": 110000,
          "150-300k": 220000,
          "300k+": 400000,
          unsure: PER_USER_BAND_DEFAULT_ANNUAL[l.user_count_band] || 100000,
        };
        setAnnualSpend(briefBand ? briefSpendDefault[briefBand] : PER_USER_BAND_DEFAULT_ANNUAL[l.user_count_band] || 100000);
        setDeployFee(DEPLOY_FEE_DEFAULT[l.user_count_band] || 50000);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const threeYearCloud = annualSpend * 3;
  const threeYearInHouse = deployFee + monthlyFee * 36;
  const threeYearSavings = threeYearCloud - threeYearInHouse;
  const monthlyAvgInHouse = threeYearInHouse / 36;

  if (loading) {
    return <div className="text-white/50 p-10 text-center">Loading…</div>;
  }
  if (!lead) {
    return <div className="text-white/50 p-10 text-center">Lead not found.</div>;
  }

  return (
    <div className="space-y-6">
      {/* Operator controls (hidden in print) */}
      <div className="print:hidden space-y-4">
        <Button asChild variant="ghost" size="sm" className="text-white/50 hover:text-white">
          <Link to={`/admin/cloud/${id}`}>
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Back to deal
          </Link>
        </Button>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <h2 className="text-sm font-semibold text-white/80 mb-3">
            Discovery Brief — fill these during the call, then print to PDF
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs text-white/50">Estimated annual spend</Label>
              <Input
                type="number"
                value={annualSpend}
                onChange={(e) => setAnnualSpend(Number(e.target.value) || 0)}
                className="bg-black/30 border-white/[0.08]"
              />
            </div>
            <div>
              <Label className="text-xs text-white/50">Deployment fee</Label>
              <Input
                type="number"
                value={deployFee}
                onChange={(e) => setDeployFee(Number(e.target.value) || 0)}
                className="bg-black/30 border-white/[0.08]"
              />
            </div>
            <div>
              <Label className="text-xs text-white/50">Monthly support fee</Label>
              <Input
                type="number"
                value={monthlyFee}
                onChange={(e) => setMonthlyFee(Number(e.target.value) || 0)}
                className="bg-black/30 border-white/[0.08]"
              />
            </div>
            <div>
              <Label className="text-xs text-white/50">Support tier</Label>
              <Input
                value={supportTier}
                onChange={(e) => setSupportTier(e.target.value)}
                className="bg-black/30 border-white/[0.08]"
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs text-white/50">Date on PDF</Label>
              <Input
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-black/30 border-white/[0.08]"
              />
            </div>
            <div className="sm:col-span-3">
              <Label className="text-xs text-white/50">Custom notes (optional)</Label>
              <Textarea
                value={customNotes}
                onChange={(e) => setCustomNotes(e.target.value)}
                placeholder="A few sentences specific to their situation, surfaced on page 2."
                rows={3}
                className="bg-black/30 border-white/[0.08]"
              />
            </div>
          </div>
          <div className="mt-4">
            <Button onClick={() => window.print()} className="gap-2">
              <Printer className="h-4 w-4" />
              Print / Save as PDF
            </Button>
            <p className="text-[11px] text-white/40 mt-2">
              In the print dialog: pick "Save as PDF" as the destination, A4 or Letter, no headers/footers.
            </p>
          </div>
        </div>
      </div>

      {/* ─────────── Printable brief — light styling for paper ─────────── */}
      <div className="print-brief bg-white text-slate-900 p-12 max-w-[8.5in] mx-auto print:p-10 print:shadow-none shadow-2xl rounded-lg print:rounded-none">
        <style>{`
          @media print {
            body { background: white !important; }
            .admin-shell, .sidebar, header { display: none !important; }
            .print-brief { box-shadow: none !important; padding: 0.5in !important; }
            @page { margin: 0.5in; size: letter; }
          }
          .print-brief h1, .print-brief h2, .print-brief h3 { color: #0f172a; }
          .print-brief .accent { color: #0f766e; }
          .print-brief .muted { color: #64748b; }
        `}</style>

        {/* Page 1 — cover */}
        <div className="print-page">
          <div className="flex items-start justify-between mb-12 pb-6 border-b border-slate-200">
            <div>
              <div className="text-xs uppercase tracking-widest muted">Confidential — Discovery Brief</div>
              <div className="text-sm muted mt-1">Prepared by Jared Best · bestly.tech</div>
            </div>
            <div className="text-xs muted text-right">
              {date}
              <br />
              For: <span className="font-medium text-slate-900">{lead.company_name}</span>
            </div>
          </div>

          <div className="mb-10">
            <div className="text-xs uppercase tracking-widest accent mb-2">A Quiet Proposal for {lead.contact_name}</div>
            <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight">
              Your data. Your brand. <span className="accent italic font-light">Your cloud.</span>
            </h1>
            <p className="text-lg muted mt-6 leading-relaxed max-w-prose">
              A line-by-line read on what your team's stack costs today, against what a Bestly
              In-House Cloud deployment would cost. Numbers below are based on what you shared in
              the brief plus what we discussed on the call.
            </p>
          </div>

          {/* Headline numbers */}
          <div className="grid grid-cols-3 gap-4 mb-10">
            <div className="border border-slate-200 rounded-lg p-5">
              <div className="text-xs uppercase tracking-wider muted mb-1">3-year cloud stack</div>
              <div className="text-3xl font-semibold text-slate-700">{dollars(threeYearCloud)}</div>
              <div className="text-xs muted mt-1">{dollars(annualSpend)} / year</div>
            </div>
            <div className="border border-slate-200 rounded-lg p-5 bg-teal-50">
              <div className="text-xs uppercase tracking-wider muted mb-1">3-year In-House Cloud</div>
              <div className="text-3xl font-semibold accent">{dollars(threeYearInHouse)}</div>
              <div className="text-xs muted mt-1">≈ {dollars(monthlyAvgInHouse)} / month avg</div>
            </div>
            <div className="border-2 border-teal-600 rounded-lg p-5 bg-teal-50">
              <div className="text-xs uppercase tracking-wider accent font-semibold mb-1">You save</div>
              <div className="text-3xl font-semibold accent">{dollars(threeYearSavings)}</div>
              <div className="text-xs muted mt-1">over 36 months</div>
            </div>
          </div>

          {/* Cost breakdown table */}
          <h2 className="text-lg font-semibold mb-3">What's in the price</h2>
          <table className="w-full text-sm border-collapse mb-8">
            <thead>
              <tr className="border-b-2 border-slate-300">
                <th className="text-left py-2 muted font-medium">Line item</th>
                <th className="text-right py-2 muted font-medium">Today</th>
                <th className="text-right py-2 muted font-medium">In-House</th>
                <th className="text-right py-2 muted font-medium">Saved</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-100">
                <td className="py-2.5">Productivity, AI, video, chat, mail</td>
                <td className="py-2.5 text-right tabular-nums">{dollars(annualSpend * 0.45)}</td>
                <td className="py-2.5 text-right tabular-nums accent">$0</td>
                <td className="py-2.5 text-right tabular-nums">{dollars(annualSpend * 0.45)}</td>
              </tr>
              <tr className="border-b border-slate-100">
                <td className="py-2.5">Project mgmt, e-sign, passwords</td>
                <td className="py-2.5 text-right tabular-nums">{dollars(annualSpend * 0.15)}</td>
                <td className="py-2.5 text-right tabular-nums accent">$0</td>
                <td className="py-2.5 text-right tabular-nums">{dollars(annualSpend * 0.15)}</td>
              </tr>
              <tr className="border-b border-slate-100">
                <td className="py-2.5">DNS, VPN, backup, extra storage</td>
                <td className="py-2.5 text-right tabular-nums">{dollars(annualSpend * 0.1)}</td>
                <td className="py-2.5 text-right tabular-nums accent">$0</td>
                <td className="py-2.5 text-right tabular-nums">{dollars(annualSpend * 0.1)}</td>
              </tr>
              <tr className="border-b border-slate-100">
                <td className="py-2.5">Managed IT support / helpdesk</td>
                <td className="py-2.5 text-right tabular-nums">{dollars(annualSpend * 0.3)}</td>
                <td className="py-2.5 text-right tabular-nums">incl. ({supportTier})</td>
                <td className="py-2.5 text-right tabular-nums">—</td>
              </tr>
              <tr className="border-t-2 border-slate-300 font-semibold">
                <td className="py-3">Annual</td>
                <td className="py-3 text-right tabular-nums">{dollars(annualSpend)}</td>
                <td className="py-3 text-right tabular-nums accent">{dollars(monthlyAvgInHouse * 12)}*</td>
                <td className="py-3 text-right tabular-nums accent">{dollars(annualSpend - monthlyAvgInHouse * 12)}</td>
              </tr>
            </tbody>
          </table>
          <p className="text-xs muted">
            * In-House annual is averaged across the 3-year window: deployment fee {dollars(deployFee)} + monthly {dollars(monthlyFee)} × 36 months.
          </p>
        </div>

        {/* Page 2 — context + included */}
        <div className="print-page mt-12 pt-12 border-t border-slate-200 page-break">
          <h2 className="text-2xl font-semibold mb-2">Built for your team</h2>
          <p className="muted mb-6">
            {lead.user_count_band} users
            {brief?.office_city ? ` · based in ${brief.office_city}${brief.office_state ? `, ${brief.office_state}` : ""}` : ""}
            {brief?.compliance_frameworks?.length
              ? ` · aligned to ${brief.compliance_frameworks
                  .filter((c: string) => c !== "none" && c !== "unsure")
                  .map((c: string) => c.toUpperCase())
                  .join(", ")}`
              : ""}
            .
          </p>

          {brief?.current_apps?.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold uppercase tracking-wider muted mb-2">What you're replacing</h3>
              <div className="flex flex-wrap gap-2">
                {brief.current_apps.map((a: string) => (
                  <span
                    key={a}
                    className="inline-block border border-slate-300 rounded px-2.5 py-1 text-xs"
                  >
                    {APP_LABEL[a] ?? a}
                  </span>
                ))}
              </div>
            </div>
          )}

          {customNotes && (
            <div className="mb-6 p-4 border-l-4 border-teal-600 bg-teal-50">
              <h3 className="text-sm font-semibold accent mb-2">From our call</h3>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{customNotes}</p>
            </div>
          )}

          {brief?.biggest_unknown && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold uppercase tracking-wider muted mb-2">What you wanted answered</h3>
              <p className="text-sm leading-relaxed italic muted">"{brief.biggest_unknown}"</p>
            </div>
          )}

          <h3 className="text-sm font-semibold uppercase tracking-wider muted mt-8 mb-3">What's included</h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div>• Drive (Google Drive · Dropbox)</div>
            <div>• Video & Chat (Zoom · Slack · Teams)</div>
            <div>• Mail (Gmail · Outlook)</div>
            <div>• Docs (Google Docs · Office 365)</div>
            <div>• Calendar (Google Cal · Outlook)</div>
            <div>• Local AI (1B–8B models)</div>
            <div>• DNS Shield (filtering, security)</div>
            <div>• Corporate VPN (encrypted remote)</div>
            <div>• Backup (Backblaze · Veeam)</div>
            <div>• Projects (Asana · Trello · Monday)</div>
            <div>• Forms (Google Forms · Typeform)</div>
            <div>• Passwords (1Password · LastPass)</div>
            <div>• E-sign (DocuSign · Adobe Sign)</div>
            <div>• White-label branding throughout</div>
          </div>

          <div className="mt-12 pt-6 border-t border-slate-200 text-xs muted">
            Prepared for {lead.contact_name} at {lead.company_name} on {date}.
            Bestly LLC · jared@bestly.tech · bestly.tech
          </div>
        </div>
      </div>
    </div>
  );
}
