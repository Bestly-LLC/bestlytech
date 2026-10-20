import { useEffect } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { ScoutToday } from "@/components/admin/ScoutToday";

/**
 * Scout's day: what Scout prepared for today. Scout's picks, Replies ready, To-dos from your calls and Today's wrap.
 * Moved off the admin home by Command Center v2; the My day card and the sidebar link here.
 */
export default function AdminScoutDay() {
  // The To-dos from your calls anchor (#calls) lives inside ScoutToday and renders after it loads.
  useEffect(() => {
    if (window.location.hash !== "#calls") return;
    const t = window.setTimeout(() => document.getElementById("calls")?.scrollIntoView({ block: "start" }), 600);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div className="mx-auto max-w-[60rem] space-y-6 pb-8">
      <PageHeader title="Scout's day" description="Picks, replies ready, call to-dos and today's wrap" />
      <ScoutToday />
    </div>
  );
}
