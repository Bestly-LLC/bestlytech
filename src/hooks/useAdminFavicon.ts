import { useEffect } from "react";

/**
 * Swaps the tab icon to the side-eye binoculars while any admin screen is mounted,
 * and puts the marketing icons back when you leave. index.html does the same swap
 * before JS runs, so a hard load of /admin never flashes the Bestly mark.
 */
const ADMIN_ICONS: Record<string, string> = {
  "image/x-icon": "/admin-favicon.ico",
  "image/svg+xml": "/admin-favicon.svg",
  "image/png": "/admin-favicon-512.png",
  "apple-touch-icon": "/admin-apple-touch-icon.png",
};

let mounted = 0;

function iconLinks() {
  return Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]'));
}

function apply() {
  for (const link of iconLinks()) {
    if (!link.dataset.siteHref) link.dataset.siteHref = link.getAttribute("href") ?? "";
    const key = link.rel === "apple-touch-icon" ? "apple-touch-icon" : link.type;
    link.href = ADMIN_ICONS[key] ?? "/admin-favicon.ico";
  }
}

function restore() {
  for (const link of iconLinks()) {
    if (link.dataset.siteHref) link.href = link.dataset.siteHref;
  }
}

export function useAdminFavicon() {
  useEffect(() => {
    mounted += 1;
    apply();
    return () => {
      mounted -= 1;
      // Defer so a login → dashboard handoff doesn't flicker back to the site icon.
      setTimeout(() => {
        if (mounted === 0 && !location.pathname.startsWith("/admin")) restore();
      }, 0);
    };
  }, []);
}
