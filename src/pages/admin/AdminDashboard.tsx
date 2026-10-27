import { useMemo } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { ActionMenu } from "@/components/admin/ActionMenu";
import { PageHeader } from "@/components/admin/PageHeader";
import { LeadCards } from "@/components/admin/cc/LeadCards";
import { SkillInboxTile } from "@/components/admin/cc/SkillInboxTile";
import { WeatherCard } from "@/components/admin/cc/WeatherCard";
import { StuckSection } from "@/components/admin/cc/StuckCards";
import { DetailPanels, useWide } from "@/components/admin/cc/Details";
import { CallNext, HealthDot, NeedsYouShort, QuickRow, loadNeeds, realNeeds } from "@/components/admin/cc/HomeParts";
import { failingSystems, fetchSystemHealth, healthHeadlineStatus, type SystemHealth } from "@/lib/systemHealth";
import { loadBundle, loadWeather, useLive, type CcBundle, type Wx } from "@/lib/commandCenter";
import { useNextMeeting } from "@/pages/partner/PartnerExtras";
import { cn } from "@/lib/utils";
import { focusRing, inset, tint } from "@/components/admin/ui";

/**
 * Admin home, Command Center v2 (Jared, 2026-10-20). Looks ahead: what is coming and what to get ahead of.
 *
 *   Stuck / Waiting cards on top (render nothing when nobody is stuck), then quick actions, then four answers (Money / Turo / AI team / My day). On a phone each taps open to its detail in a sheet;
 *   from lg up the four details sit on the page under the weather ("In detail") and a tap scrolls to its panel.
 *   The weather with your calendars and Turo drawn on it, Needs you (top three), and who to call next.
 *   One health dot replaces the old status board and lights only when something is genuinely wrong.
 *
 * What used to crowd this page now has its own page: Overview (Also waiting, Status board, This week, Recent activity),
 * Scout's day (picks, replies ready, call to-dos) and Needs you (everything, in full). All are in the sidebar.
 *
 * Every source loads on its own: a failing one shows its own "Updated 3 hours ago" and never blanks the page.
 */

const PT = { timeZone: "America/Los_Angeles" } as const;

export default function AdminDashboard() {
  const cc = useLive<CcBundle>(loadBundle, 2 * 60_000);
  const wxs = useLive<Wx>(loadWeather, 10 * 60_000);
  const needs = useLive(loadNeeds, 60_000);
  const health = useLive<SystemHealth>(fetchSystemHealth, 60_000);
  const meetings = useNextMeeting();
  const wide = useWide();

  const needsCount = needs.data ? realNeeds(needs.data).length : null;

  /** The single health dot: lit only by something genuinely wrong. */
  const reasons = useMemo(() => {
    const r: string[] = [];
    for (const i of cc.data?.issues ?? []) r.push(i.title);
    if (!cc.data && cc.error) r.push("The Command Center numbers could not load. Check your connection, then Refresh.");
    if (health.data && healthHeadlineStatus(health.data) === "down") r.push(`${failingSystems(health.data).join(", ") || "A system"} is down.`);
    return r;
  }, [cc.data, cc.error, health.data]);

  const h = Number(new Date().toLocaleString("en-US", { hour: "numeric", hourCycle: "h23", ...PT }));
  const hello = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const today = new Intl.DateTimeFormat("en-US", { ...PT, weekday: "long", month: "long", day: "numeric" }).format(new Date());

  const refreshAll = async () => {
    window.dispatchEvent(new Event("admin:refresh-now"));
    await Promise.all([cc.reload(), wxs.reload(), needs.reload(), health.reload()]);
  };

  return (
    <div className="mx-auto max-w-[102rem] space-y-6 pb-8">
      <PageHeader
        title={`${hello}, Jared`}
        description={today}
        actions={
          <div className="flex items-center gap-1">
            <HealthDot reasons={reasons} since={cc.data?.issues?.[0]?.since} />
            <ActionMenu label="More actions" className="h-11 w-11 sm:h-9 sm:w-9" items={[{ label: "Refresh now", icon: RefreshCw, onSelect: refreshAll }]} />
          </div>
        }
      />

      <StuckSection />

      <QuickRow />

      <LeadCards cc={cc} wx={wxs.data} needs={needsCount} meetings={meetings} wide={wide} />

      <SkillInboxTile />

      <div className="grid grid-cols-1 items-start gap-x-6 gap-y-8 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <WeatherCard wxs={wxs} />
        <div className="space-y-8">
          <NeedsYouShort needs={needs} />
          <CallNext cc={cc} />
        </div>
      </div>

      {wide && <DetailPanels cc={cc} wx={wxs.data} needs={needs} meetings={meetings} />}

      <nav aria-label="More pages" className={cn("flex flex-wrap gap-x-5", inset)}>
        {[["/admin/overview", "Overview"], ["/admin/scout-day", "Scout's day"], ["/admin/needs-you", "All that needs you"]].map(([to, label]) => (
          <Link key={to} to={to} className={cn("inline-flex min-h-[44px] items-center text-[15px] font-medium sm:min-h-9", tint.blue, focusRing)}>{label}</Link>
        ))}
      </nav>
    </div>
  );
}
