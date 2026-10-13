import { lazyPage } from "@/lib/lazyPage";
import { SectionTabs } from "@/components/admin/SectionTabs";

const LeadsCRM = lazyPage(() => import("@/components/admin/LeadsCRM"));
const CloudDeals = lazyPage(() => import("./CloudDeals"));
const AdminSubmissions = lazyPage(() => import("./AdminSubmissions"));
const AdminHireRequests = lazyPage(() => import("./AdminHireRequests"));

/** Pipeline → Inbound: every lead in one pipeline, plus each funnel's own working view. */
export default function AdminLeads({ embedded }: { embedded?: boolean } = {}) {
  return (
    <SectionTabs
      paramName={embedded ? "sub" : "tab"}
      embedded={embedded}
      title="Leads"
      description="Every lead from every funnel. Move them along, star them, set follow-ups."
      tabs={[
        { value: "all", label: "All leads", render: () => <LeadsCRM /> },
        { value: "cloud", label: "In-House Cloud", render: () => <CloudDeals embedded /> },
        { value: "marketplace", label: "Marketplace Intake", render: () => <AdminSubmissions embedded /> },
        { value: "hire", label: "Hire Requests", render: () => <AdminHireRequests embedded /> },
      ]}
    />
  );
}
