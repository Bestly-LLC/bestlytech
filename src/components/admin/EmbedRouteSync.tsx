import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { postRouteToCloud } from "@/lib/cloudEmbed";

/** Inside Bestly Cloud: report every admin page change (path only) to the parent so its address bar follows. Renders nothing. */
export function EmbedRouteSync() {
  const { pathname } = useLocation();
  useEffect(() => postRouteToCloud(pathname), [pathname]);
  return null;
}
