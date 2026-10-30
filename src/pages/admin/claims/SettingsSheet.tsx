/** Settings sheet: the three switches that used to be full-width bars, plus read-only status. Right side on desktop, bottom on a phone. */
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Lines } from "@/components/Lines";
import { Section, Segmented, Switch, btnPlain, label, secondary, separator, tint } from "../laxUi";
import { clock, rpc, type CleanData, type Data } from "./shared";
import { Nw, useIsDesktop } from "./ui";

const group = "rounded-2xl bg-[#2C2C2E] px-4 bento:bg-[#fff] bento:shadow-[0_1px_2px_#0000000d]";
const wide = "sm:[&>div]:w-full [&>div]:w-full [&_button]:flex-1 [&_button]:min-h-[44px] sm:[&_button]:min-h-[36px]";

function StatusRow({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-x-4 gap-y-0.5 py-2.5">
      <span className={cn("text-[15px]", label)}>{name}</span>
      <span className={cn("text-right text-[15px]", secondary)}>{children}</span>
    </div>
  );
}

export function SettingsSheet({ open, onOpenChange, data, clean, reload }: { open: boolean; onOpenChange: (o: boolean) => void; data: Data; clean: CleanData | null; reload: () => void }) {
  const desktop = useIsDesktop();
  const serverOn = !!data.sender?.claims_enabled;
  const [on, setOn] = useState(serverOn);
  useEffect(() => setOn(serverOn), [serverOn]);
  const autonomy = data.settings?.autonomy === "guest_approval" ? "guest_approval" : "full";
  const auto = clean?.settings?.mode !== "ask";

  const toggleSender = async (next: boolean) => {
    setOn(next);
    const { error } = await rpc("claims_sender_set", { p_on: next });
    if (error) { setOn(!next); toast.error(error.message); } else { toast.success(next ? "Claim messages can go out" : "Claim messages paused"); reload(); }
  };
  const setAutonomy = async (next: "full" | "guest_approval") => {
    if (next === autonomy) return;
    const { error } = await rpc("claims_settings_set", { p_autonomy: next });
    if (error) toast.error(error.message); else { toast.success(next === "full" ? "Hands-off" : "Guest messages will wait for your OK"); reload(); }
  };
  const setCleaning = async (next: "auto" | "ask") => {
    if ((next === "auto") === auto) return;
    const { error } = await rpc("claims_cleaning_settings_set", { p_mode: next });
    if (error) toast.error(error.message); else { toast.success(next === "ask" ? "Cleaning reports wait for your File tap" : "Clear messes get filed on their own"); reload(); }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={desktop ? "right" : "bottom"}
        className={cn("flex flex-col gap-0 border-[#38383A] bg-[#1C1C1E] p-0 text-[#fff] bento:border-[#C6C6C8] bento:bg-[#F2F2F7] bento:text-[#000] [&>button.absolute]:hidden",
          "motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none",
          desktop ? "h-full w-full sm:max-w-[440px]" : "max-h-[92dvh] rounded-t-[22px]")}>
        <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-5">
          <div className="min-w-0">
            <SheetTitle className={cn("text-[22px] font-semibold tracking-[-0.01em]", label)}>Settings</SheetTitle>
            <SheetDescription className={cn("mt-0.5 text-[13px]", secondary)}>How much Claims Closer does on its own.</SheetDescription>
          </div>
          <SheetClose asChild><button type="button" className={cn(btnPlain, "shrink-0 font-semibold")}>Done</button></SheetClose>
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3">
          <Section title="Sending">
            <div className={group}>
              <Switch checked={on} onChange={toggleSender} label="Send claim messages"
                detail={on ? "Approved messages go out through the Link Sender. Turn this off to pause all of them." : "Claim messages are paused. Nothing goes out until you turn this back on."} />
              {data.sender?.last_error && <p className={cn("border-t pb-3 pt-2.5 text-[13px] leading-snug", tint.red, "border-[#38383A] bento:border-[#C6C6C8]")}>Sender error: {data.sender.last_error}</p>}
            </div>
          </Section>

          <Section title="Guest messages" footer={autonomy === "guest_approval" ? "Ask me first: guest messages wait for your OK." : "Hands-off: guest messages, shop requests and the Turo invoice go out on their own."}>
            <div className={wide}>
              <Segmented ariaLabel="Guest messages" value={autonomy} onChange={setAutonomy}
                options={[{ value: "full", label: "Hands-off" }, { value: "guest_approval", label: "Ask me first" }]} />
            </div>
          </Section>

          {clean && (
            <Section title="Cleaning reports" footer={`After every trip, Claims Closer compares your check-in and check-out photos. ${auto ? "A clear mess gets Turo's cleaning report filed on its own, and anything borderline waits for you." : "Anything that looks dirty waits for your File tap."} Turo only takes reports for 72 hours after a trip.`}>
              <div className={wide}>
                <Segmented ariaLabel="Cleaning reports" value={auto ? "auto" : "ask"} onChange={setCleaning}
                  options={[{ value: "auto", label: "File on its own" }, { value: "ask", label: "Ask me first" }]} />
              </div>
            </Section>
          )}

          <Section title="Status">
            <div className={cn(group, "divide-y", separator)}>
              <StatusRow name="Turo reader">
                {data.reader ? (data.reader.signed_in ? <span className={tint.green}>Signed in{data.reader.version ? <> · <Nw>v{data.reader.version}</Nw></> : null}</span> : <span className={tint.red}>Signed out</span>) : "No report yet"}
              </StatusRow>
              {data.reader?.last_error && <p className={cn("py-2.5 text-[13px] leading-snug", tint.red)}>{data.reader.last_error}</p>}
              <StatusRow name="Last check">
                {data.beat ? <span className={data.beat.ok ? undefined : tint.red}><Nw>{clock(data.beat.at)}</Nw>{data.beat.ok ? "" : " · problem"}</span> : "No check yet"}
              </StatusRow>
              {data.beat && !data.beat.ok && data.beat.summary && <p className={cn("py-2.5 text-[13px] leading-snug", secondary)}><Lines>{data.beat.summary}</Lines></p>}
            </div>
          </Section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
