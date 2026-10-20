import { PageHeader } from "@/components/admin/PageHeader";
import { ActionInbox } from "@/components/admin/ActionInbox";

/** Everything waiting on you, in full. The home page shows the top three and links here ("All N"). */
export default function AdminNeedsYou() {
  return (
    <div className="mx-auto max-w-[60rem] space-y-6 pb-8">
      <PageHeader title="Needs you" description="Everything waiting on you, worst first" />
      <ActionInbox />
    </div>
  );
}
