/**
 * Leo in the official ElevenLabs widget (<elevenlabs-convai>), as a pull-out card on the trip pages.
 *
 * PREVIEW (2026-10-11): only on demo links with ?widget=1, so Jared can try it before it replaces the custom
 * helper sheet. Guests see nothing new.
 *
 * - Same pinned embed + SRI and self-hosted audio worklets as Maya's widget (loadEmbed in MayaWidget).
 * - Leo requires signed sessions: each open trades the trip token for a fresh signed URL + opaque trip_key
 *   (trip-voice {op:"session"}), so the widget never sees the trip token.
 * - The widget has no slot for custom suggestion buttons, so Leo opens by offering the two things that fit the
 *   trip right now (override-first-message from the trip's stage and key state).
 * - Mounted expanded when "Talk to our team 24/7" is tapped; unmounted when the sheet state closes.
 */
import { useEffect, useState, type ElementType } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { loadEmbed } from "@/components/maya/MayaWidget";
import type { TripContext } from "./AskSheet";
import { track } from "./track";

const Convai = "elevenlabs-convai" as unknown as ElementType;

/** Leo's opening line: says who he is, then offers the two things that fit this moment of the trip. */
export function leoGreeting(ctx: TripContext | undefined, home: boolean): string {
  const hi = "Hi, I'm Leo, your trip helper.";
  const k = ctx?.keyState ?? null;
  if (k === "soon" || k === "making") return `${hi} Your key shows up once your host has checked your license. I can check where it's at, or walk you through pickup. What would help?`;
  if (k === "problem") return `${hi} Looks like your key hit a snag. Want me to check it and send a fresh one?`;
  if (k === "ready") return `${hi} Your key is ready. Want help adding the car to your Tesla app, or is the link giving you trouble?`;
  if (ctx?.stage === "pickup") return `${hi} I can help you unlock and start the car, or find ${home ? "where it's parked" : "your way into the garage"}. What do you need?`;
  if (ctx?.stage === "return") return `${hi} I can find you a Supercharger, or tell you how much charge to bring it back with. What do you need?`;
  return `${hi} I can help with your phone key, charging, or anything about the trip. What do you need?`;
}

const TEXT = JSON.stringify({
  main_label: "Leo, trip helper",
  chatting_status: "Chatting with Leo, an AI helper",
  input_placeholder: "Type a message",
  input_placeholder_text_only: "Type a message",
  typing_indicator: "Leo is typing",
  agent_working: "Checking",
});

export function useWidgetPreview(token?: string): boolean {
  if (typeof window === "undefined" || !token?.startsWith("demo-")) return false;
  try { return new URLSearchParams(window.location.search).get("widget") === "1"; } catch { return false; }
}

export function LeoWidget({ token, context, home }: { token: string; context?: TripContext; home: boolean }) {
  const [s, setS] = useState<{ url: string; key: string } | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    track(token, "ask", { via: "leo-widget" });
    Promise.all([loadEmbed(), supabase.functions.invoke("trip-voice", { body: { op: "session", token } })]).then(([, res]) => {
      const r = res.data as { ok?: boolean; signed_url?: string; key?: string; error?: string } | null;
      if (!live) return;
      if (res.error || !r?.ok || !r.signed_url || !r.key) { setErr(r?.error ?? "Leo didn't load. Try again in a minute, or message your host in the Turo app."); return; }
      setS({ url: r.signed_url, key: r.key });
    }, () => live && setErr("Leo didn't load. Try again in a minute, or message your host in the Turo app."));
    return () => { live = false; };
  }, [token]);

  if (err) return <p role="alert" className="fixed inset-x-4 bottom-28 z-50 rounded-2xl bg-white p-4 text-[15px] text-[#B4232A] shadow-xl">{err}</p>;
  if (!s) return (
    <div className="fixed inset-x-0 bottom-28 z-50 flex justify-center" aria-live="polite">
      <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[15px] font-semibold text-[#0B0B0F] shadow-xl">
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Opening Leo
      </span>
    </div>
  );
  return (
    <Convai
      signed-url={s.url}
      dynamic-variables={JSON.stringify({ trip_key: s.key })}
      override-first-message={leoGreeting(context, home)}
      text-contents={TEXT}
      variant="full"
      placement="bottom"
      default-expanded="true"
      dismissible="true"
      text-input="true"
      transcript="true"
      avatar-orb-color-1="#FFB878"
      avatar-orb-color-2="#7C5CF0"
      worklet-path-raw-audio-processor="/maya/raw-audio-processor.js"
      worklet-path-audio-concat-processor="/maya/audio-concat-processor.js"
      worklet-path-libsamplerate="/maya/libsamplerate.worklet.js"
    />
  );
}
