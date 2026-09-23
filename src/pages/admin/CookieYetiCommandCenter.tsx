import { lazyPage } from "@/lib/lazyPage";
import { SectionTabs } from "@/components/admin/SectionTabs";

const CYCommandCenter = lazyPage(() => import("./CYCommandCenter"));
const CYAutoFixMonitor = lazyPage(() => import("./CYAutoFixMonitor"));
const CYDomains = lazyPage(() => import("./CYDomains"));

/** Cookie Yeti → Command Center: Overview, Auto-Fix, Domains. */
export default function CookieYetiCommandCenter() {
  return (
    <SectionTabs
      title="Command Center"
      description="Cookie Yeti at a glance: what users reported, what fixes itself, and every domain."
      tabs={[
        { value: "overview", label: "Overview", render: () => <CYCommandCenter embedded /> },
        { value: "autofix", label: "Auto-Fix", render: () => <CYAutoFixMonitor embedded /> },
        { value: "domains", label: "Domains", render: () => <CYDomains embedded /> },
      ]}
    />
  );
}
