/**
 * What Scout says (the Clippy part). Voice: plain, quick, a little cheeky, never cutesy. Sentence case, no emoji.
 * He never claims something he didn't do, and every line is whole: nothing here is ever cut off with "...".
 *
 * Pure data and pure functions (the hooks that use them live in useScoutMood.ts), so the Scout Lab can show them all.
 */

/** What he says while he is actually using a tool. */
export const TOOL_LINES: Record<string, string> = {
  run_sql: "Reading the database",
  read_file: "Reading the code",
  list_files: "Reading the code",
  today: "Checking what needs you",
  incidents: "Looking at what broke",
  pi_command: "Knocking on the Pi",
  mac_run: "Getting the Mac mini ready",
  mac_command: "Getting the Mac mini ready",
  meeting_transcript: "Reading the call notes",
  send_email: "Writing that email",
  notify: "Leaving you a note",
  learn: "Making a note for next time",
  make_video: "Rolling the camera",
};

/** Tools that only read: the "searching" face (pupils zoom in and sweep). */
export const READ_TOOLS = new Set(["run_sql", "read_file", "list_files", "today", "incidents", "meeting_transcript"]);

/** When no tool is known yet, these rotate (every 3.5 s, shuffled, no repeats until the list has been used). */
export const WORKING_LINES = [
  "Adjusting focus",
  "Taking a closer look",
  "Squinting at it",
  "Following a lead",
  "Lining it up",
  "Zooming in",
  "Checking twice",
];

/** After this long a run gets the "big one" line. */
export const BIG_ONE_MS = 45_000;
export const BIG_ONE_LINE = "This one's a big one. Still on it";
/** First seconds of a run are "thinking"; after that, "working". */
export const THINKING_MS = 6_000;
export const ROTATE_MS = 3_500;

/** A free-AI progress note ends "(step 23, 4 min in)": the numbers are real, so the line can use them. */
export function parseProgress(body: string | undefined | null): { step: number; min: number } | null {
  const m = body?.match(/\(step (\d+), (\d+) min in\)/);
  return m ? { step: Number(m[1]), min: Number(m[2]) } : null;
}

export function progressLine(p: { step: number; min: number }): string {
  return `Step ${p.step}, ${p.min} min in`;
}

/** The line for what he is doing, in the plan's order: real progress, then a long run, then the tool, then rotation. */
export function workingLine(o: {
  tool: string | null;
  elapsedMs: number;
  progress: { step: number; min: number } | null;
  chainOnly: boolean;
  rotating: string;
}): string {
  if (o.progress) return progressLine(o.progress);
  if (o.elapsedMs >= BIG_ONE_MS) return BIG_ONE_LINE;
  if (o.tool && TOOL_LINES[o.tool]) return TOOL_LINES[o.tool];
  if (o.chainOnly) return "Still going on its own";
  return o.rotating;
}

/** What a screen reader hears: only changes when the tool changes, never the rotating lines. */
export function announceLine(tool: string | null): string {
  return tool && TOOL_LINES[tool] ? TOOL_LINES[tool] : "Scout is working";
}

/** A shuffled bag: every line once before any repeats, and never the same line twice in a row across refills. */
export function makeBag(lines: string[] = WORKING_LINES) {
  let bag: string[] = [];
  let last = "";
  return () => {
    if (!bag.length) {
      bag = [...lines];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      if (bag.length > 1 && bag[bag.length - 1] === last) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
    }
    last = bag.pop() as string;
    return last;
  };
}

/* ---- Reactions: the one short line in the bubble beside the launcher when the panel is closed ---- */
export type ReplyTone = "happy" | "proud" | "confused" | "sad";

export const REACTION_LINES: Record<ReplyTone, string> = {
  happy: "Got it.",
  proud: "Done. Want the details?",
  confused: "Quick question for you.",
  sad: "That didn't work. I'll tell you why.",
};
export const NEEDS_LINE = "Something needs you.";

/** "Done with the Pi ports." from his own first line, only when it is one whole short sentence. Otherwise null. */
export function firstSentence(body: string, max = 52): string | null {
  const line = body.trim().split("\n")[0]?.trim() ?? "";
  if (line.length < 4 || line.length > max) return null;
  if (/[`*#|<>[\]{}_]/.test(line)) return null;
  return /^[^.!?]+\.$/.test(line) ? line : null;
}

export function replyBubble(tone: ReplyTone, body: string): string {
  if (tone === "proud") {
    const s = firstSentence(body);
    return s ? `${s} Want the details?` : REACTION_LINES.proud;
  }
  return REACTION_LINES[tone];
}

export function welcomeBack(n: number): string {
  return `Welcome back. ${n} ${n === 1 ? "reply" : "replies"} waiting.`;
}

/* ---- Greeting (empty state), by time of day in Pacific time ---- */
export function greeting(d: Date = new Date()): string {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Los_Angeles" }).format(d)) % 24;
  if (h >= 23 || h < 5) return "Late one, huh?";
  if (h < 12) return "Morning.";
  if (h < 17) return "Afternoon.";
  return "Evening.";
}

export const DEFAULT_PITCH = "I read the data, fix things and run jobs on the Mac mini. I know which page you're on.";

/** A page-aware offer: the line he says, and the message tapping it sends (same as an opener). */
export function pageOffer(pathname: string): { line: string; send: string } | null {
  if (pathname.startsWith("/admin/turo")) {
    return { line: "Want me to check today's trips?", send: "Check today's Turo trips and tell me what needs me." };
  }
  if (pathname.startsWith("/admin/security")) {
    return { line: "Want a quick security sweep?", send: "Run a quick security sweep and tell me what needs me." };
  }
  return null;
}
