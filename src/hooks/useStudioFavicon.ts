import { useEffect } from "react";

/**
 * Bestly Studio pages (/studio, /studio/terms, /studio/privacy) show the Studio orb in the tab,
 * the same icon registered for the Bestly Studio app with TikTok, Meta, LinkedIn and Pinterest.
 * TikTok's app review rejects an app whose icon does not match the website's favicon
 * (rejection of 2026-11-03), so these pages must never show the Bestly site mark.
 * index.html does the same swap before JS runs, so a hard load never flashes the site icon.
 */
const STUDIO_ICONS: Record<string, string> = {
  "image/x-icon": "/studio-favicon.ico",
  "image/png": "/studio-favicon-512.png",
  "apple-touch-icon": "/studio-apple-touch-icon.png",
};

let mounted = 0;

function iconLinks() {
  return Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]'));
}

function apply() {
  for (const link of iconLinks()) {
    if (!link.dataset.siteHref) link.dataset.siteHref = link.getAttribute("href") ?? "";
    const key = link.rel === "apple-touch-icon" ? "apple-touch-icon" : link.type;
    link.href =
      key === "image/png" && link.getAttribute("sizes") === "32x32"
        ? "/studio-favicon.png"
        : STUDIO_ICONS[key] ?? "/studio-favicon.ico";
  }
}

function restore() {
  for (const link of iconLinks()) {
    if (link.dataset.siteHref) link.href = link.dataset.siteHref;
  }
}

export function useStudioFavicon() {
  useEffect(() => {
    mounted += 1;
    apply();
    return () => {
      mounted -= 1;
      setTimeout(() => {
        if (mounted === 0 && !location.pathname.startsWith("/studio") && !location.pathname.startsWith("/admin")) restore();
      }, 0);
    };
  }, []);
}
