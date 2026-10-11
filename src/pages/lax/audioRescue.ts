/**
 * iPhone "Leo doesn't speak" rescue (2026-10-11).
 *
 * What happened: the call connected and ElevenLabs sent Leo's greeting, but the phone played nothing and the mic sent
 * nothing (conversation conv_3401m4p9d6h3fjssaw9jf43dczff: 8 s of Leo audio out, 0 s of guest audio in). On iOS an
 * AudioContext made outside a tap stays "suspended", and the SDK's `await context.resume()` then waits forever, so the
 * session never finishes setting up. The SDK only unlocks audio if it was imported before the tap, and its unlocked
 * context expires 30 s after the first touch, so a fast first tap or a late one both went silent.
 *
 * Fix: wrap AudioContext before the SDK loads so every context it makes is tracked, and resume any suspended one on
 * the next tap anywhere on the page. A tap inside iOS's gesture window lets the stuck `resume()` finish and the call
 * carries on. LeoScreen shows a "Tap to hear Leo" button when a context is stuck, so there is always a tap to give.
 */
type Ctx = AudioContext;
const live = new Set<Ctx>();
let installed = false;

const stuck = (c: Ctx) => c.state !== "running" && c.state !== "closed";

/**
 * Second failure (2026-10-11, conv_3301m4pn7gkkfsjscgd9ef707nak): context running, mic fine (guest said "Hello"), 12 s of
 * Leo audio sent, phone silent. The SDK plays Leo through a hidden <audio> fed by a MediaStream and calls play() on it
 * after its awaits, in parallel with mic setup. If play() runs before the mic is live, iOS refuses it, the error is
 * swallowed, and the element stays paused for the whole call. So paused stream players count as locked too, get
 * play() on every tap, and get one more play() once the session is up (mic capturing = iOS allows it).
 */
function streamPlayers(): HTMLAudioElement[] {
  if (typeof document === "undefined") return [];
  return Array.from(document.querySelectorAll("audio")).filter((a) => a.srcObject instanceof MediaStream);
}
const pausedPlayers = () => streamPlayers().filter((a) => a.paused);

/** play() every paused Leo player. Safe outside a tap: it just fails quietly until one comes. */
export function playStreamPlayers() {
  for (const a of pausedPlayers()) void a.play().catch(() => { /* needs a tap */ });
}

/** Resume every suspended context and paused player. Call this from inside a tap handler. */
export function resumeAllAudio() {
  for (const c of live) if (stuck(c)) void c.resume().catch(() => { /* not allowed yet */ });
  playStreamPlayers();
}

/** True when audio exists but is not playing (iOS waiting for a tap): a stuck context or a paused player. */
export function audioLocked() {
  for (const c of live) if (stuck(c)) return true;
  return pausedPlayers().length > 0;
}

/** What the audio looks like right now, for the diag log. */
export function audioState() {
  return { contexts: Array.from(live).map((c) => c.state).join(",") || "none", players: streamPlayers().map((a) => (a.paused ? "paused" : "playing")).join(",") || "none" };
}

/** Install once, before the voice SDK is imported. Safe to call more than once and on any browser. */
export function installAudioRescue() {
  if (installed || typeof window === "undefined" || typeof document === "undefined") return;
  installed = true;
  const W = window as unknown as Record<string, unknown>;
  for (const name of ["AudioContext", "webkitAudioContext"]) {
    const Native = W[name] as (new (...a: unknown[]) => Ctx) | undefined;
    if (!Native) continue;
    try {
      const Tracked = class extends (Native as new (...a: unknown[]) => Ctx) {
        constructor(...args: unknown[]) {
          super(...args);
          live.add(this);
          this.addEventListener?.("statechange", () => { if (this.state === "closed") live.delete(this); });
        }
      };
      W[name] = Tracked;
    } catch { /* leave the native one in place */ }
  }
  // Capture phase, so it runs inside the gesture before any app handler awaits anything.
  for (const ev of ["touchend", "click", "keydown"]) document.addEventListener(ev, resumeAllAudio, true);
}
