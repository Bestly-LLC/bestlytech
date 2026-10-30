// Family Cookbook: start-up. Three ways in:
//   /cookbook/callback?code=...&state=...  coming back from Bestly Cloud: trade the code for this app's own session
//   a saved session token                  open straight to the cookbook
//   nothing                                the sign-in screen

import "./cookbook.css";
import { ApiError, finishSignIn, getToken, rpc, setToken } from "./api";
import { ic } from "./dom";
import { S } from "./state";
import "./camera";
import "./recipe";
import "./nutrition";
import { enter, go, render, syncChrome } from "./views";

const path = location.pathname.replace(/\/+$/, "");

async function boot() {
  const play = document.getElementById("actionbar")!.querySelector(".btn")!;
  play.insertAdjacentHTML("afterbegin", ic("play", 24));

  if (path === "/cookbook/callback") {
    const q = new URLSearchParams(location.search);
    history.replaceState(null, "", "/cookbook");
    const code = q.get("code"), state = q.get("state");
    if (q.get("error") || !code || !state) {
      S.msg = q.get("error") === "access_denied" ? "Sign-in was cancelled." : "That sign-in did not finish. Try again.";
      render(true); syncChrome(); return;
    }
    S.busy = true; S.msg = ""; render(true);
    try {
      const r = await finishSignIn(code, state);
      setToken(r.token); S.busy = false;
      await enter(r.me);
      return;
    } catch (e: any) {
      S.busy = false;
      S.msg = e instanceof ApiError && e.message && /\s/.test(e.message) ? e.message : "Sign-in is not available right now. Please try again in a few minutes.";
      render(true); syncChrome(); return;
    }
  }

  if (path !== "/cookbook") history.replaceState(null, "", "/cookbook");

  if (getToken()) {
    try { const me = await rpc("family_me"); await enter(me); return; }
    catch (e: any) {
      if (e instanceof ApiError && e.code === "not_signed_in") { setToken(""); S.msg = "You were signed out. Sign in again."; }
      else S.msg = "Could not reach the cookbook. Check your connection and try again.";
    }
  }
  go("signin");
  syncChrome();
}
boot();
