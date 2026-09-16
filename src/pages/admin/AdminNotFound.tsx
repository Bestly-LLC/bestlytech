import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/admin/EmptyState";

/** Unknown /admin/* path: stay inside the admin shell instead of the public 404. */
export default function AdminNotFound() {
  const { pathname } = useLocation();
  return (
    <div className="max-w-xl mx-auto">
      <EmptyState
        icon={Compass}
        title="There's no admin page here"
        description={`Nothing lives at ${pathname}. It may have moved, or the link has a typo.`}
        action={
          <Button asChild variant="outline" className="h-9 border-white/15 bg-transparent text-white hover:bg-white/5 hover:text-white">
            <Link to="/admin">
              <ArrowLeft className="h-4 w-4 mr-2" aria-hidden />
              Back to Command Center
            </Link>
          </Button>
        }
      />
    </div>
  );
}
