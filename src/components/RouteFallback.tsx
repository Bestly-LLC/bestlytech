import { Loader2 } from 'lucide-react';

/** Suspense fallback used while lazy-loaded route chunks are fetched. */
export const RouteFallback = () => (
  <div className="min-h-[60vh] flex items-center justify-center" role="status" aria-label="Loading">
    <Loader2 className="w-6 h-6 animate-spin text-primary" />
  </div>
);
