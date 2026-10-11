/**
 * Test hook for Maya's browser tools (headless checks of fill_contact_form and friends).
 *
 * Does nothing unless the page was opened with ?mayatest=1 (production builds included). With the flag, it hands the
 * page the same handlers Maya's call registers, as window.__mayaTools, so a test can drive the forms exactly the way
 * she does. It adds no power: the handlers only operate on the visitor's own open page, and Send still goes through
 * the form's normal submit and the site's normal rate limits. Without the flag nothing is exposed and nothing runs.
 */
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { presenterTools } from "./presenter";

declare global {
  interface Window {
    __mayaTools?: ReturnType<typeof presenterTools>;
  }
}

export function MayaTestHook() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    let on = false;
    try {
      on = new URLSearchParams(window.location.search).get("mayatest") === "1";
    } catch {
      /* no flag */
    }
    if (!on) return;
    window.__mayaTools = presenterTools({
      navigate: () => navigateRef.current,
      path: () => pathRef.current,
      onShow: () => {},
    });
    return () => {
      delete window.__mayaTools;
    };
  }, []);

  return null;
}
