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
