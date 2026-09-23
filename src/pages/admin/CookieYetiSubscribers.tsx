import { lazyPage } from "@/lib/lazyPage";
import { SectionTabs } from "@/components/admin/SectionTabs";

const CYSubscribers = lazyPage(() => import("./CYSubscribers"));
const CYGrantedAccess = lazyPage(() => import("./CYGrantedAccess"));

/** Cookie Yeti → Subscribers: Subscribers, Granted Access. */
export default function CookieYetiSubscribers() {
  return (
    <SectionTabs
      title="Subscribers"
      description="Cookie Yeti subscriptions, activations, the Stripe log, and comp access."
      tabs={[
        { value: "subscribers", label: "Subscribers", render: () => <CYSubscribers embedded /> },
        { value: "granted", label: "Granted Access", render: () => <CYGrantedAccess embedded /> },
      ]}
    />
  );
}
