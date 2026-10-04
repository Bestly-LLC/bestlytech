/**
 * "Hey Scout" voice card (wall round 4, W7). state.voice {on, sensitivity 'low'|'normal'|'high'} is the switch the
 * Pi's voice service (/opt/bestly/voice) reads; wall_admin_voice() adds what the Pi reports: mic, wake model,
 * the last thing it heard and a day of wake counts (false wakes are what Sensitivity tunes).
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Mic, MicOff } from "lucide-react";
import { Group, Row, Segmented, NW, swHit } from "@/components/admin/wallUi";

export type Voice = { on: boolean; sensitivity: "low" | "normal" | "high" };
export const VOICE_DEFAULT: Voice = { on: true, sensitivity: "normal" };

type Info = {
  status?: { mic_ok?: boolean; mic_err?: string | null; model?: string; dnd?: boolean; away?: boolean; hour?: { false?: number } } | null;
  status_at?: string | null;
  last?: { at: string; heard: string; reply: string } | null;
  day?: { commands: number; false_wakes: number; ignored: number; errors: number };
};

const when = (iso: string) => {
  const d = new Date(iso);
  const t = d.toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" });
  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" }) === d.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" });
  return today ? t : `${d.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", weekday: "short" })} ${t}`;
};

/** The one place Hey Scout is switched on or off (the full card and the Now area both use it). */
export const voiceSwitch = (voice: Voice | null | undefined, on: boolean): [Voice, string] =>
  [{ ...VOICE_DEFAULT, ...(voice ?? {}), on }, on ? "Hey Scout is listening." : "Hey Scout is muted."];

/** Compact Hey Scout switch row for the Now area. */
export function HeyScoutRow({ voice, onChange, id = "wall-now-voice" }: { voice?: Voice | null; onChange: (v: Voice, msg: string) => void; id?: string }) {
  const on = { ...VOICE_DEFAULT, ...(voice ?? {}) }.on;
  return (
    <Row label={<span className="inline-flex items-center gap-2">{on ? <Mic className="h-4 w-4 text-sky-400" aria-hidden /> : <MicOff className="h-4 w-4 text-white/50" aria-hidden />}Hey Scout</span>}
      detail={on ? "Listening for the wake word" : "Muted"} htmlFor={id}>
      <Switch id={id} className={swHit} checked={on} onCheckedChange={(v) => onChange(...voiceSwitch(voice, v))} />
    </Row>
  );
}

export function VoiceCard({ voice, onChange }: { voice?: Voice | null; onChange: (v: Voice, msg: string) => void }) {
  const v = { ...VOICE_DEFAULT, ...(voice ?? {}) };
  const [info, setInfo] = useState<Info | null>(null);
  const load = useCallback(async () => {
    const { data } = await (supabase.rpc("wall_admin_voice" as never) as unknown as Promise<{ data: Info | null }>);
    if (data) setInfo(data);
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);

  const st = info?.status;
  const fresh = info?.status_at ? Date.now() - Date.parse(info.status_at) < 12 * 60_000 : false;
  const model = st?.model === "hey_scout" ? "Hey Scout" : st?.model?.includes("hey_scout") ? "Hey Scout\u201d or \u201cHey Jarvis" : "Hey Jarvis";
  const state = !fresh ? "The Pi hasn't checked in for a while"
    : st?.mic_ok === false ? `Mic not found${st?.mic_err ? ` (${st.mic_err})` : ""}`
    : !v.on ? "Muted: not listening for the wake word"
    : st?.dnd ? "Quiet for Do Not Disturb"
    : st?.away ? "Paused while you're away"
    : `Listening for “${model}”`;

  return (
    <Group id="voice" title="Voice"
      footer={<>Only the wake word is detected on the Pi. What you say after it is sent once to a free Whisper speech-to-text service (Groq, or Cloudflare as a backup) and is never saved.
        The Pi keeps the last few wake-word clips (about 2&nbsp;s each) for tuning and deletes them after 24&nbsp;hours.</>}>
      <Row label={<span className="inline-flex items-center gap-2">{v.on ? <Mic className="h-4 w-4 text-sky-400" aria-hidden /> : <MicOff className="h-4 w-4 text-white/50" aria-hidden />}Hey Scout</span>}
        detail={state} htmlFor="wall-voice">
        <Switch id="wall-voice" className={swHit} checked={v.on}
          onCheckedChange={(on) => onChange(...voiceSwitch(voice, on))} />
      </Row>
      <div className="border-b border-white/[0.07] px-4 py-3">
        <div className="mb-2 text-[16px] text-white">Sensitivity</div>
        <Segmented label="Wake word sensitivity" value={v.sensitivity}
          options={[{ id: "low", label: "Low" }, { id: "normal", label: "Normal" }, { id: "high", label: "High" }]}
          onChange={(s) => onChange({ ...v, sensitivity: s }, `Sensitivity: ${s}.`)} />
        <p className="mt-2 text-[13px] leading-snug text-white/50">Low if it wakes up by itself; High if it misses you.
          {info?.day && <> Last 24&nbsp;hours: <NW>{info.day.commands} asked</NW>, <NW>{info.day.false_wakes} false {info.day.false_wakes === 1 ? "wake" : "wakes"}</NW>.</>}</p>
      </div>
      <Row label="Last heard" detail={info?.last ? <>&ldquo;{info.last.heard}&rdquo; <NW>· {when(info.last.at)}</NW></> : "Nothing yet"}>
        {null}
      </Row>
    </Group>
  );
}
