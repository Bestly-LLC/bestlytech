import { lazy } from "react";
import { SectionTabs } from "@/components/admin/SectionTabs";

const AdminMeetings = lazy(() => import("./AdminMeetings"));
const AdminClips = lazy(() => import("./AdminClips"));

/**
 * Work -> Meetings: recorded calls, and the loose voice clips that aren't calls.
 * Both are "something Jared said out loud, transcribed", so they live on one page.
 */
export default function AdminMeetingsSection() {
  return (
    <SectionTabs
      title="Meetings"
      description="Recorded calls from this Mac, and any voice clip you drop in or AirDrop to the mini."
      tabs={[
        { value: "calls", label: "Calls", render: () => <AdminMeetings embedded /> },
        { value: "clips", label: "Clips", render: () => <AdminClips embedded /> },
      ]}
    />
  );
}
