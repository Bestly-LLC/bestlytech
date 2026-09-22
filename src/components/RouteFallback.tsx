import { useLocation } from "react-router-dom";
import { BrandLoader } from "@/components/BrandLoader";

/** Suspense fallback used while lazy-loaded route chunks are fetched. */
export const RouteFallback = () => {
  const { pathname } = useLocation();
  // The partner portal is the admin shell wearing a different hat, so it gets the
  // same binoculars loader rather than the marketing site's mark.
  const dark = pathname.startsWith("/admin") || pathname.startsWith("/partner");
  return <BrandLoader tone={dark ? "dark" : "light"} fullScreen={dark} />;
};
