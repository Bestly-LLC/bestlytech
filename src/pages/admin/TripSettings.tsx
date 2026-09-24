/**
 * /admin/turo/settings — every setting, key and switch behind the trip apps, in one place:
 * the guest helper (show/hide, AI chain, Gemini key), Tesla (connection, guest A/C switch, tests),
 * my host Wallet pass, and the guest link. The LAX Parking Pass page keeps only day-to-day work.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/admin/PageHeader";
import { CopyButton } from "@/components/CopyText";
import { cn } from "@/lib/utils";
import { HelperSettings } from "./AskCard";
import { HostPassCard, TeslaCard } from "./TeslaCard";
import { TezLabCard } from "./TezLabCard";
import { Section, btnDestructivePlain, btnPlain, btnTinted, card, field, secondary } from "./laxUi";

const rpc = (fn: string, args?: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;
const SITE = "https://www.bestly.tech";

function GuestLinkSettings() {
  const [slug, setSlug] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data } = await rpc("lax_pass_admin_state");
    setSlug((data as { slug?: string } | null)?.slug ?? null);
  }, []);
  useEffect(() => { load(); }, [load]);
  const rotate = async () => {
    if (!window.confirm("Make a new guest link? The old link stops working, so update it anywhere you pasted it.")) return;
    const { error } = await rpc("lax_pass_rotate_slug");
    if (error) toast.error(error.message); else { toast.success("New link made. Paste it into Turo."); load(); }
  };
  if (!slug) return <div className={cn(card, "h-28 animate-pulse")} aria-label="Loading" />;
  const link = `${SITE}/lax/${slug}`;
  return (
    <div className={cn(card, "space-y-3")}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className={cn(field, "truncate font-mono text-[14px] sm:flex-1")}>{link.replace("https://", "")}</code>
        <CopyButton text={link} label="Copy link" className={cn(btnTinted, "h-auto")} />
      </div>
      <button type="button" onClick={rotate} className={btnDestructivePlain}>
        <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Make a new link (turns the old one off)
      </button>
    </div>
  );
}

/** The settings sections, shared with the folded Settings on the Guest Trips page. */
export function TripSettingsBody() {
  return (
    <>
      <Section title="TezLab (first choice for car buttons)" footer="Guest A/C, honk and flash use your TezLab allowance. If TezLab fails, the Tesla API below takes over by itself.">
        <TezLabCard />
      </Section>
      <Section title="Tesla car controls (backup + keys)" footer="Tesla gives $10 of free API use a month; the helper stops at the cap so it stays free.">
        <TeslaCard />
      </Section>
      <Section title="Guest questions (trip helper)" footer="All free. Keys go straight into Vault and can't be read back here.">
        <HelperSettings />
      </Section>
      <Section title="Apple Wallet">
        <HostPassCard />
        <p className={cn("px-4 text-[13px]", secondary)}>Guests' passes update by themselves when you save a new code.</p>
      </Section>
    </>
  );
}

export default function TripSettings() {
  return (
    <div className="w-full space-y-8">
      <div className="space-y-2">
        <Link to="/admin/turo/lax-pass" className={cn(btnPlain, "-ml-1")}><ChevronLeft className="h-5 w-5" aria-hidden /> Guest Trips</Link>
        <PageHeader title="Trip settings" description="Keys, connections and switches for the guest trip pages." />
      </div>
      <div className="gap-8 columns-1 md:columns-[28rem] [&>section]:mb-8 [&>section]:break-inside-avoid">
        <TripSettingsBody />
        <Section title="Guest link" footer="The same link always shows the newest code.">
          <GuestLinkSettings />
        </Section>
      </div>
    </div>
  );
}
