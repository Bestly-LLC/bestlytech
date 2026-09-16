import { lazy } from "react";
import { SectionTabs } from "@/components/admin/SectionTabs";

const CYCommandCenter = lazy(() => import("./CYCommandCenter"));
const CYAutoFixMonitor = lazy(() => import("./CYAutoFixMonitor"));
const CYDomains = lazy(() => import("./CYDomains"));

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
