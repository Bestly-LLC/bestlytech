import { lazy, Suspense } from "react";

const AdminMeetings = lazy(() => import("./AdminMeetings"));

/**
 * Work -> Meetings: one list of calls, in the order they were recorded - the ones the Mac mini
 * recorded and the ones dropped in (phone, Soundcore, AirDrop), which the Mac mini names and files
 * the same way. The separate Clips tab is gone: everything dropped here is a meeting.
 */
export default function AdminMeetingsSection() {
  return (
    <Suspense fallback={null}>
      <AdminMeetings />
    </Suspense>
  );
}
