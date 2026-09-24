/**
 * The car guide on the home pickup page, from Jared's printed Turo Guest Guide:
 * charging (+ the pickup % to return with), rules, Full Self-Driving, valet, accidents & roadside,
 * and the video links (all checked: Tesla's own YouTube channels).
 */
import { useEffect, useState, type ReactNode } from "react";
import { BeforeYouDrive } from "./BeforeYouDrive";
import { AlertTriangle, BatteryCharging, ChevronDown, Cpu, Download, ExternalLink, FileText, KeySquare, Phone, Play, PlayCircle, X } from "lucide-react";

const ACCENT = "var(--trip-accent)";
const yt = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const PLAYLIST = "PLk81eR51-zheKxIvRMA-b3FLZaIPfDCni";

export type Video = { title: string; sub: string; href: string; id?: string; list?: string; thumb: string };
const thumb = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

/** Opens the in-page player (VideoPlayer listens). */
export function playVideo(v: Video) { window.dispatchEvent(new CustomEvent("trip-video", { detail: v })); }

/** In-page YouTube player (privacy-enhanced embed), opened by playVideo(). */
export function VideoPlayer() {
  const [v, setV] = useState<Video | null>(null);
  useEffect(() => {
    const on = (e: Event) => setV((e as CustomEvent<Video>).detail);
    window.addEventListener("trip-video", on);
    return () => window.removeEventListener("trip-video", on);
  }, []);
  useEffect(() => {
    if (!v) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setV(null); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [v]);
  if (!v) return null;
  const src = v.list
    ? `https://www.youtube-nocookie.com/embed/videoseries?list=${v.list}&autoplay=1&playsinline=1&rel=0`
    : `https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&playsinline=1&rel=0&modestbranding=1`;
  return (
    <div role="dialog" aria-modal="true" aria-label={v.title} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-3 backdrop-blur-sm" onClick={() => setV(null)}>
      <div className="w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-[16px] font-semibold text-white">{v.title}</p>
          <button type="button" onClick={() => setV(null)} aria-label="Close video" className="grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="relative w-full overflow-hidden rounded-2xl bg-black ring-1 ring-white/15" style={{ aspectRatio: "16 / 9" }}>
          <iframe src={src} title={v.title} className="absolute inset-0 h-full w-full" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
        </div>
        <a href={v.href} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[13px] text-white/60">Open in YouTube <ExternalLink className="h-3.5 w-3.5" /></a>
      </div>
    </div>
  );
}

/** Video list with thumbnails; tapping plays it right here. */
export function VideoList() {
  return (
    <ul className="grid gap-2.5">
      {VIDEOS.map((v) => (
        <li key={v.title}>
          <button type="button" onClick={() => playVideo(v)} className="flex w-full items-center gap-3 rounded-2xl p-1.5 text-left active:bg-white/[0.06]">
            <span className="relative block h-[64px] w-[114px] shrink-0 overflow-hidden rounded-xl bg-black ring-1 ring-white/10">
              <img src={v.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
              <span className="absolute inset-0 grid place-items-center bg-black/25"><span className="grid h-8 w-8 place-items-center rounded-full" style={{ background: "var(--trip-accent)" }}><Play className="ml-0.5 h-4 w-4 fill-current text-[#132726]" /></span></span>
            </span>
            <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold leading-snug text-white">{v.title}</span><span className="block text-[13px] leading-snug text-white/60">{v.sub}</span></span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// Checked 2026-09-23 with YouTube oEmbed: every one is live on Tesla's official channels.
const v = (title: string, sub: string, id: string): Video => ({ title, sub, id, href: yt(id), thumb: thumb(id) });
export const VIDEOS: Video[] = [
  { title: "Full tutorial playlist", sub: "Tesla Tutorials · 8 short videos, plays in order", list: PLAYLIST, href: `https://www.youtube.com/playlist?list=${PLAYLIST}`, thumb: thumb("uhZf67ttS3U") },
  v("Essentials", "Getting in, keys and the basics", "uhZf67ttS3U"),
  v("Physical controls", "Shifting (right stalk), wipers, lights", "C5p4RlS09D0"),
  v("Touchscreen", "Climate, seats, mirrors, profiles", "esjtcjujV54"),
  v("Charging", "Superchargers and the charge port", "CN40_NNziCo"),
  v("Full Self-Driving (Supervised)", "3-minute overview from Tesla", "TUDiG7PcLBs"),
  v("Autopilot", "Cruise control and lane keeping", "-FeMwPUAOLM"),
];
const FSD = VIDEOS[5];

const INCIDENT_CARD = "https://support-resources.turo.com/incidents/US%20Incident%20Information%20Card.pdf";
const DINER = "7001 Santa Monica Blvd, West Hollywood, CA";
const maps = (q: string) => /android/i.test(typeof navigator === "undefined" ? "" : navigator.userAgent)
  ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : `https://maps.apple.com/?q=${encodeURIComponent(q)}`;

function Fold({ icon: Icon, title, sub, children, tone, open: start = false }: { icon: typeof Cpu; title: string; sub: string; children: ReactNode; tone?: "alert"; open?: boolean }) {
  const [open, setOpen] = useState(start);
  return (
    <div className={`border-b border-white/10 last:border-0 ${tone === "alert" ? "bg-[#E4527A]/[0.07] -mx-4 px-4" : ""}`}>
      <button type="button" onClick={() => setOpen((x) => !x)} aria-expanded={open}
        className="flex min-h-[60px] w-full items-center gap-3 py-3 text-left">
        <Icon className="h-6 w-6 shrink-0" style={{ color: tone === "alert" ? "#FF8FA8" : ACCENT }} strokeWidth={1.75} />
        <span className="min-w-0 flex-1"><span className="block text-[16px] font-semibold text-white">{title}</span><span className="block text-[13px] leading-snug text-white/60">{sub}</span></span>
        <ChevronDown className={`h-5 w-5 shrink-0 text-white/65 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="pb-4 text-[15px] leading-relaxed text-white/85">{children}</div>}
    </div>
  );
}

function Bullets({ items }: { items: ReactNode[] }) {
  return <ul className="mt-1.5 space-y-1.5">{items.map((x, i) => <li key={i} className="flex gap-2"><span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: ACCENT }} />{<span>{x}</span>}</li>)}</ul>;
}
function Numbered({ items }: { items: ReactNode[] }) {
  return <ol className="mt-1.5 space-y-1.5">{items.map((x, i) => <li key={i} className="flex gap-2.5"><span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-[#140826]" style={{ background: ACCENT }}>{i + 1}</span><span>{x}</span></li>)}</ol>;
}
const H = ({ children }: { children: ReactNode }) => <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/65 first:mt-0">{children}</p>;
const Call = ({ tel, label, shown, red }: { tel: string; label: string; shown?: string; red?: boolean }) => (
  <a href={`tel:${tel}`} className="inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 text-[15px] font-semibold text-[#140826] active:scale-95" style={{ background: red ? "#FF6B6B" : "#7CE0A5" }}>
    <Phone className="h-4 w-4" /> {label}{shown && <span className="font-medium opacity-70">{shown}</span>}
  </a>
);

export function ChargeBadge({ pct }: { pct: number | null | undefined }) {
  if (pct == null) return null;
  return (
    <div className="mt-3 flex items-center gap-3 rounded-2xl bg-white/[0.07] p-3 ring-1 ring-white/10">
      <BatteryCharging className="h-8 w-8 shrink-0 text-emerald-300" strokeWidth={1.5} />
      <p className="text-[14px] leading-snug text-white/80">You picked it up at <b className="text-[22px] font-bold text-white tabular-nums">{pct}%</b>. Return it with at least that much to avoid Turo's recharge fee.</p>
    </div>
  );
}

export function HomeGuide({ pickupBattery }: { pickupBattery?: number | null }) {
  return (
    <section className="mt-6 rounded-3xl bg-white/[0.06] px-4 pt-3 ring-1 ring-white/10" aria-label="Car guide">
      <p className="pt-1 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: ACCENT }}>Your car guide</p>
      <h2 className="mt-1 text-[20px] font-bold leading-snug text-white" style={{ fontFamily: "'Josefin Sans', Futura, 'Avenir Next', sans-serif" }}>Everything you need, at a glance</h2>

      <BeforeYouDrive />

      <Fold icon={BatteryCharging} title="Charging" sub="Return with the same charge · nearest Supercharger">
        {pickupBattery != null
          ? <ChargeBadge pct={pickupBattery} />
          : <p><b className="text-white">Return it at the same charge level as pickup</b> to avoid Turo's recharge fee. Note the % in your pickup photos.</p>}
        <H>Nearest Supercharger</H>
        <Bullets items={[
          <><a href={maps(DINER)} className="font-semibold text-white underline decoration-white/40 underline-offset-2">Tesla Diner, 7001 Santa Monica Blvd</a>: 80 fast stalls, open 24/7, free parking while you charge.</>,
          "The Sunset Blvd Supercharger charges for parking. The Diner doesn't.",
        ]} />
        <H>At a Supercharger: 4 steps, no card</H>
        <Numbered items={[
          "Navigate to it in the car so the battery warms up on the way.",
          "Back in, press the button on the handle.",
          "It starts by itself and bills to the car's account (your host invoices it through Turo).",
          "Press the handle button to unplug, then move off the stall right away. Idle fees are costly.",
        ]} />
        <H>Good to know</H>
        <Bullets items={[
          "The charge port is on the driver side. A J1772 adapter for regular chargers is in the driver-side door pocket.",
          <>Not near a Supercharger? The <b className="text-white">ChargePoint app</b> finds and pays for regular chargers around LA. Use the J1772 adapter to plug in.
            <a href={/android/i.test(typeof navigator === "undefined" ? "" : navigator.userAgent) ? "https://play.google.com/store/apps/details?id=com.coulombtech" : "https://apps.apple.com/us/app/chargepoint/id356866743"} target="_blank" rel="noreferrer"
              className="mt-2 flex min-h-[44px] w-fit items-center gap-2 rounded-full bg-white px-4 text-[15px] font-semibold text-[#132726]"><Download className="h-4 w-4" /> Get the ChargePoint app</a></>,
          "Real range is well below the rated number: speed, A/C, hills and cold all cut it.",
          "Driving over ~100 miles? Enter the destination in Navigation. The Trip Planner picks your charging stops and shows your arrival %.",
          "65–70 mph is the sweet spot. 80 mph can cost 25–30% of your range.",
        ]} />
      </Fold>


      <Fold icon={Cpu} title="Full Self-Driving (Supervised)" sub="How to turn it on, start, and take over">
        <p><b className="text-white">Hands on. Eyes up.</b> It steers, brakes, changes lanes, handles intersections and parks, but it isn't autonomous. You're the driver and responsible at all times. Rain, glare, faded lines and heavy traffic make it worse.</p>
        <H>Turn it on (in Park)</H>
        <Numbered items={["Tap the Car icon on the screen.", "Open Self-Driving.", "Under Self-Driving Features, choose Full Self-Driving.", "Accept the on-screen acknowledgment."]} />
        <H>Start from Park</H>
        <Numbered items={["Seatbelt on, doors closed, destination set.", "Tap Start Self-Driving, or pull the gear stalk down once.", "If Brake Confirm is on, press and release the brake."]} />
        <p className="mt-1.5 text-[13px] text-white/60">It may shift to Reverse, back out, then drive off. That's expected.</p>
        <H>Take back over: any one of these</H>
        <Bullets items={["Press the brake", "Turn the wheel", "Tap Cancel on the screen"]} />
        <p className="mt-2 text-[14px] text-white/70">No blue steering-wheel icon or blue path? It isn't available, so drive normally. Not sure? Don't turn it on: nothing about this trip needs FSD. Skip it in heavy construction, storms and tight parking garages. Speed Profiles (Sloth for calm city driving) and Arrival Options are in the same menu.</p>
        <button type="button" onClick={() => playVideo(FSD)} className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-full bg-white px-4 text-[15px] font-semibold text-[#140826]"><PlayCircle className="h-4 w-4" /> Watch the 3-minute video</button>
      </Fold>

      <Fold icon={KeySquare} title="Valet parking" sub="You keep your phone. No key card to hand over">
        <p>Start a 2-minute driving window in the Tesla app so the attendant can move the car.</p>
        <H>Drop-off</H>
        <Numbered items={["Open the Tesla app.", "Tap Controls.", "Tap Start. The attendant has 2 minutes to drive and park it."]} />
        <H>Pickup</H>
        <Numbered items={["Open the Tesla app.", "Tap Controls, then Start.", "Get in and drive away during the window. Repeat if needed."]} />
      </Fold>

      <Fold icon={AlertTriangle} title="Accidents & roadside" sub="Flat tire, bump or accident: what to do" tone="alert">
        <Numbered items={[
          <><b className="text-white">Anyone hurt?</b> Call 911 right away. A police report will be needed.</>,
          <><b className="text-white">No injuries?</b> California police usually don't file a report. Exchange information with everyone involved.</>,
          <><b className="text-white">Document it:</b> take photos of the scene and the cars for your records and insurance.</>,
          <><b className="text-white">Tell your host</b> in the Turo app. We'll help however we can. It will be okay.</>,
        ]} />
        <div className="mt-3 flex flex-wrap gap-2">
          <Call tel="911" label="Call 911" red />
          <Call tel="+14159654525" label="Turo 24/7 Roadside" shown="(415) 965-4525" />
        </div>
        <p className="mt-2 text-[13px] text-white/60">Turo Roadside sends help to you at no cost. Tesla Roadside is also in the Tesla app under Roadside. Be ready to share your location and what happened.</p>
        <a href={INCIDENT_CARD} target="_blank" rel="noreferrer" className="mt-3 flex min-h-[48px] items-center gap-2 rounded-2xl bg-white/[0.09] px-4 text-[15px] font-semibold ring-1 ring-white/15">
          <FileText className="h-5 w-5 shrink-0" style={{ color: ACCENT }} /> Turo incident information card (PDF) <ExternalLink className="ml-auto h-4 w-4 text-white/65" />
        </a>
        <H>Insurance notes</H>
        <Bullets items={[
          "Flat tires are on you unless your Turo protection plan covers them.",
          "Roadside may not be available if someone not approved by Turo is driving.",
        ]} />
      </Fold>
    </section>
  );
}
