/** Emoji helpers for the wall graffiti picker. The server (wall_emoji_key) has the final say. */

export const PICKS = [
  "🌴", "🌈", "🔥", "✨", "💖", "🎉", "🥂", "🍹", "🍸", "🪩", "💃", "🕺", "🎤", "🎧", "🎸", "🎨",
  "📸", "🎬", "🛼", "🛹", "🚲", "🚗", "✈️", "🚀", "🛸", "👽", "👻", "💀", "🤖", "👑", "💎", "💋",
  "👀", "🫶", "🙌", "👏", "🤘", "✌️", "🤙", "😎", "🥳", "😍", "🤩", "😂", "🫠", "🥹", "😜", "🤠",
  "🐸", "🦖", "🐙", "🦩", "🦄", "🐶", "🐱", "🦋", "🐝", "🦚", "🌸", "🌻", "🌺", "🌵", "🪴", "🍀",
  "🌙", "⭐", "☀️", "🌊", "💫", "⚡", "🪐", "🎈", "🎁", "🎯", "🎲", "🧿", "🍒", "🍓", "🥑", "🌮",
  "🍕", "🍩", "🧁", "🍿", "☕", "🌶️", "🏳️‍🌈", "🏳️‍⚧️", "💜", "🧡", "💙", "💚",
];

// used by "Surprise me" once every pick above is taken
const MORE = [
  "🐢", "🦊", "🐼", "🐨", "🦁", "🐯", "🐮", "🐷", "🐵", "🦉", "🦜", "🐬", "🐳", "🦈", "🦀", "🐌",
  "🍉", "🍋", "🍍", "🥥", "🍔", "🌭", "🍟", "🥨", "🍦", "🍪", "🎂", "🍫", "🧋", "🍾", "🍷", "🍺",
  "⚽", "🏀", "🎾", "🏄", "🎳", "🎮", "🧩", "🪁", "🎺", "🥁", "🎻", "🪗", "📚", "💡", "🔮", "🧸",
  "🌍", "🌋", "🏝️", "🗽", "🎡", "🎢", "🏖️", "🌅", "🌃", "🌌", "☁️", "❄️", "☃️", "🌪️", "🍄", "🌷",
  "😇", "🤓", "🥸", "😺", "🙃", "😴", "🤯", "🥶", "😈", "🤡", "👾", "🦾", "🧠", "💌", "💯", "🆒",
];

const SEG = typeof Intl !== "undefined" && "Segmenter" in Intl
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ? new (Intl as any).Segmenter(undefined, { granularity: "grapheme" })
  : null;

export function graphemes(s: string): string[] {
  if (SEG) return Array.from(SEG.segment(s), (x: { segment: string }) => x.segment);
  return Array.from(s);
}

/** Same rule as the server: drop variation selectors and skin tones, so 👍 and 👍🏽 count as one. */
export function emojiKey(e: string): string {
  return e.replace(/[︎️]/g, "").replace(/\uD83C[\uDFFB-\uDFFF]/g, "").trim();
}

export function isOneEmoji(s: string): boolean {
  const g = graphemes(s.trim());
  if (g.length !== 1) return false;
  const e = g[0];
  if (/[\p{L}\p{N}\s]/u.test(e.replace(/[#*0-9]️?⃣/u, ""))) return false;
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(e);
}

/** Last emoji in whatever the guest typed (the emoji keyboard often appends). */
export function lastEmoji(s: string): string | null {
  const g = graphemes(s).filter((x) => isOneEmoji(x));
  return g.length ? g[g.length - 1] : null;
}

export function surprise(taken: Set<string>): string | null {
  const free = [...PICKS, ...MORE].filter((e) => !taken.has(emojiKey(e)));
  return free.length ? free[Math.floor(Math.random() * free.length)] : null;
}
