import { lazy } from "react";
import { SectionTabs } from "@/components/admin/SectionTabs";

const CYProductAnalytics = lazy(() => import("./CYProductAnalytics"));
const CYDashboard = lazy(() => import("./CYDashboard"));
const CommunityLearning = lazy(() => import("./CommunityLearning"));

/** Cookie Yeti → Analytics: Product, Operations, Community Learning. */
export default function CookieYetiAnalytics() {
  return (
    <SectionTabs
      title="Analytics"
      description="The product funnel, the pattern engine, and what the community has taught Cookie Yeti."
      tabs={[
        { value: "product", label: "Product", render: () => <CYProductAnalytics embedded /> },
        { value: "operations", label: "Operations", render: () => <CYDashboard embedded /> },
        { value: "community", label: "Community Learning", render: () => <CommunityLearning embedded /> },
      ]}
    />
  );
}
