import { useLocation } from "react-router-dom";
import { BrandLoader } from "@/components/BrandLoader";
import { isAdminSurface } from "@/lib/adminNext";

/** Suspense fallback used while lazy-loaded route chunks are fetched. */
export const RouteFallback = () => {
  const { pathname } = useLocation();
  // The partner portal is the admin shell wearing a different hat, so it gets the
  // same binoculars loader rather than the marketing site's mark.
  const dark = isAdminSurface(pathname) || pathname.startsWith("/partner");
  // Cards under the mark: facts, tips and quotes on /admin (the deck only holds facts once an admin is
  // signed in, so before that it is tips and quotes), quotes only in the partner portal, nothing on the public site.
  const cards = isAdminSurface(pathname) ? "full" : pathname.startsWith("/partner") ? "quotes" : "none";
  return <BrandLoader tone={dark ? "dark" : "light"} fullScreen={dark} cards={cards} />;
};
