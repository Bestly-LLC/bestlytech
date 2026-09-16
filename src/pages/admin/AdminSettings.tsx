import { useSearchParams } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/admin/PageHeader";
import { ChangePasswordDialog } from "@/components/admin/ChangePasswordDialog";
import AdminSetupGuide from "./AdminSetupGuide";

/** Settings: the things you configure once, not queues you work through. Tab is in the URL (?tab=). */
const TABS = [
  { value: "guide", label: "Marketplace guide" },
  { value: "security", label: "Security" },
] as const;

export default function AdminSettings() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.value === params.get("tab")) ? params.get("tab")! : "guide";

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader title="Settings" description="Set-once things for the admin and the marketplace intake." />

      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabsList>
          {TABS.map((t) => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}
        </TabsList>

        <TabsContent value="guide" className="mt-5">
          <AdminSetupGuide embedded />
        </TabsContent>

        <TabsContent value="security" className="mt-5">
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 max-w-xl">
            <div className="flex items-start gap-3">
              <KeyRound className="h-5 w-5 text-white/60 mt-0.5 flex-none" aria-hidden="true" />
              <div className="min-w-0">
                <h2 className="text-[0.9375rem] font-semibold text-white">Sign-in</h2>
                <p className="text-sm text-white/60 mt-1">Add or remove passkeys and security keys, or change your password.</p>
                <div className="mt-4"><ChangePasswordDialog inline /></div>
              </div>
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
