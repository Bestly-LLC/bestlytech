/**
 * React.lazy for pages, healed against deploys.
 *
 * The admin keeps your place, so an open tab runs the build it loaded. When a new build ships,
 * the old build's page files are gone from the server, and opening a page you hadn't visited yet
 * died with "Failed to fetch dynamically imported module" (Jared, Playbook, 2026-09-23). The
 * 2-minute new-build check in useDeployRefresh narrows that window but can't close it.
 *
 * Now a failed page import:
 *   1. retries once (a blip on the network, not a deploy)
 *   2. then loads the address you were going to as a fresh page, which pulls the new build -
 *      you land exactly where you clicked. Once per address per build, so a genuinely broken
 *      deploy shows the error instead of looping.
 */
import { lazy, type ComponentType } from "react";

const TRIED = "bestly:lazy-heal";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function freshLoad(): boolean {
  const here = window.location.pathname + window.location.search;
  try {
    if (sessionStorage.getItem(TRIED) === here) return false; // already tried: let the error show
    sessionStorage.setItem(TRIED, here);
  } catch { /* storage off: still try once */ }
  window.location.assign(window.location.href);
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const m = await load();
      try { sessionStorage.removeItem(TRIED); } catch { /* fine */ }
      return m;
    } catch (first) {
      await wait(800);
      try {
        return await load();
      } catch {
        if (freshLoad()) return new Promise<{ default: T }>(() => {}); // the page is reloading
        throw first;
      }
    }
  });
}
