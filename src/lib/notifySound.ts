/**
 * The Bestly notification sound. One file, one function, both sides of the house:
 * Scout finishing a job in the admin, and Eli's portal when something lands for him.
 *
 * To change the sound, replace public/notify.mp3. Nothing else needs to know.
 *
 * Two things browsers make awkward and this handles:
 *  - Autoplay. A page cannot make noise until the person has interacted with it, so
 *    the first play is primed off their first tap or key and silently skipped before
 *    that. Nothing throws, nothing logs, it just doesn't play.
 *  - Repeats. Two events landing together would otherwise fire two overlapping
 *    copies, which sounds like a glitch rather than a notification.
 */
const SRC = "/notify.mp3";
const MUTE_KEY = "bestly-notify-muted";
const MIN_GAP_MS = 1200;

let el: HTMLAudioElement | null = null;
let unlocked = false;
let last = 0;

function audio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!el) {
    el = new Audio(SRC);
    el.preload = "auto";
    el.volume = 0.55;
  }
  return el;
}

export function notifySoundMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setNotifySoundMuted(muted: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* private mode: the setting just doesn't stick */
  }
}

/**
 * Called once from the app shell. Arms the sound on the first real interaction,
 * which is the only moment a browser will let us load and play audio.
 */
export function armNotifySound() {
  if (typeof window === "undefined" || unlocked) return;
  const arm = () => {
    unlocked = true;
    audio()?.load();
    window.removeEventListener("pointerdown", arm);
    window.removeEventListener("keydown", arm);
  };
  window.addEventListener("pointerdown", arm, { once: true });
  window.addEventListener("keydown", arm, { once: true });
}

/** Play it, unless the person muted it, the tab is silent, or it just played. */
export function playNotifySound() {
  if (!unlocked || notifySoundMuted()) return;
  const now = Date.now();
  if (now - last < MIN_GAP_MS) return;
  last = now;
  const a = audio();
  if (!a) return;
  try {
    a.currentTime = 0;
    // A rejected promise here means the browser said no; that is not an error worth
    // surfacing to anyone, so it dies quietly.
    void a.play().catch(() => undefined);
  } catch {
    /* same */
  }
}

/*
 * The "done" sound: Scout finished a job or answered. Kept apart from the alert sound above,
 * which is for things that need you. Replace public/notify-success.mp3 to change it; until that
 * file exists, a short bubble pop is synthesised so there is always a happy sound.
 */
const SUCCESS_SRC = "/notify-success.mp3";
let okEl: HTMLAudioElement | null = null;
let okMissing = false;
let lastOk = 0;

function bubblePop() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const pop = (at: number, from: number, to: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(from, ctx.currentTime + at);
      o.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + at + 0.07);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.11);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + 0.12);
    };
    pop(0, 520, 1100);
    pop(0.09, 700, 1500);
    setTimeout(() => ctx.close().catch(() => undefined), 500);
  } catch {
    /* no audio: fine */
  }
}

/** Play the success sound (same mute switch and autoplay rules as the alert sound). */
export function playSuccessSound() {
  if (!unlocked || notifySoundMuted()) return;
  const now = Date.now();
  if (now - lastOk < MIN_GAP_MS) return;
  lastOk = now;
  if (okMissing) { bubblePop(); return; }
  if (!okEl) {
    okEl = new Audio(SUCCESS_SRC);
    okEl.preload = "auto";
    okEl.volume = 0.6;
    okEl.addEventListener("error", () => { okMissing = true; }, { once: true });
  }
  try {
    okEl.currentTime = 0;
    void okEl.play().catch(() => { okMissing = true; bubblePop(); });
  } catch {
    bubblePop();
  }
}
