import { ReactNode, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/admin/PageHeader";

export type SectionTab = {
  /** URL slug, used as ?tab=<value>. The first tab is the default. */
  value: string;
  label: string;
  /** Rendered only while this tab is active, so inactive pages don't load or query. */
  render: () => ReactNode;
};

function TabFallback() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
      </div>
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}

/**
 * A section page: one header, a tab bar, and the active tab's page.
 * The tab lives in the URL (?tab=) so links, back and refresh work; other query params are kept.
 */
export function SectionTabs({ title, description, tabs }: { title: string; description: string; tabs: SectionTab[] }) {
  const [params, setParams] = useSearchParams();
  const active = tabs.find((t) => t.value === params.get("tab")) ?? tabs[0];

  const selectTab = (value: string) => {
    const next = new URLSearchParams(params);
    if (value === tabs[0].value) next.delete("tab");
    else next.set("tab", value);
    setParams(next);
  };

  return (
    <div className="space-y-6 min-w-0">
      <PageHeader title={title} description={description} />

      <Tabs value={active.value} onValueChange={selectTab} activationMode="manual">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList className="w-max">
            {tabs.map((t) => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}
          </TabsList>
        </div>

        <TabsContent value={active.value} className="mt-5 focus-visible:ring-offset-0">
          <Suspense fallback={<TabFallback />}>
            <div key={active.value}>{active.render()}</div>
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
