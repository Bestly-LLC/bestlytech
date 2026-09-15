import { useLocation } from "react-router-dom";
import { BrandLoader } from "@/components/BrandLoader";

/** Suspense fallback used while lazy-loaded route chunks are fetched. */
export const RouteFallback = () => {
  const { pathname } = useLocation();
  const isAdmin = pathname.startsWith("/admin");
  return <BrandLoader tone={isAdmin ? "dark" : "light"} fullScreen={isAdmin} />;
};
