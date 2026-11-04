/**
 * Chrome extension ids allowed to receive a Scout Recorder sign-in key from /scout/connect.
 *
 * The page only ever hands a key to an id on this list. An empty list means nobody gets one,
 * which is the safe default. The ids are public (they appear in the Chrome Web Store URL), so
 * this file holds no secret.
 *
 * - While building: add the unpacked extension's id (chrome://extensions) to DEV_IDS, push, deploy.
 * - Ship step: add the Chrome Web Store id to STORE_IDS (32 letters, a to p). Then push.
 */
export const DEV_IDS: string[] = [];

export const STORE_IDS: string[] = [];

export const SCOUT_RECORDER_EXTENSION_IDS: string[] = [...STORE_IDS, ...DEV_IDS];

const ID_RE = /^[a-p]{32}$/;
const REDIRECT_RE = /^https:\/\/([a-p]{32})\.chromiumapp\.org\/connect$/;

/** The extension id inside a valid launchWebAuthFlow redirect, or null when it is not valid or not allowed. */
export function allowedIdFromRedirect(redirectUri: string | null): string | null {
  if (!redirectUri) return null;
  const m = REDIRECT_RE.exec(redirectUri);
  if (!m) return null;
  return SCOUT_RECORDER_EXTENSION_IDS.includes(m[1]) ? m[1] : null;
}

export const allowedIds = () => SCOUT_RECORDER_EXTENSION_IDS.filter((i) => ID_RE.test(i));
