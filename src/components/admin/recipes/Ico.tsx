// Icon paths from the approved preview (24x24 viewBox, 1.8 stroke), so the Recipes tab looks the same as the design.
import type { CSSProperties } from "react";

const PATHS: Record<string, string> = {
  search: "<circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"m20 20-3.5-3.5\"/>",
  plus: "<path d=\"M12 5v14M5 12h14\"/>",
  minus: "<path d=\"M5 12h14\"/>",
  x: "<path d=\"M6 6l12 12M18 6 6 18\"/>",
  back: "<path d=\"m15 18-6-6 6-6\"/>",
  next: "<path d=\"m9 18 6-6-6-6\"/>",
  camera: "<path d=\"M4 8h3l1.5-2h7L17 8h3v11H4z\"/><circle cx=\"12\" cy=\"13\" r=\"3.5\"/>",
  image: "<rect x=\"3.5\" y=\"4.5\" width=\"17\" height=\"15\" rx=\"2.5\"/><circle cx=\"9\" cy=\"10\" r=\"1.6\"/><path d=\"m4 17 5-4.5 4 3.5 3-2.5 4 3.5\"/>",
  link: "<path d=\"M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1\"/><path d=\"M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1\"/>",
  mic: "<rect x=\"9\" y=\"3\" width=\"6\" height=\"11\" rx=\"3\"/><path d=\"M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21\"/>",
  clock: "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M12 7.5V12l3 2\"/>",
  leaf: "<path d=\"M5 19c0-8 5-13 14-14 0 9-5 14-13 14\"/><path d=\"M5 19c3-4 6-7 9-9\"/>",
  "check": "<path d=\"m5 12.5 4.5 4.5L19 7.5\"/>",
  cart: "<path d=\"M3 4h2.5l2 11h10l2-8H7\"/><circle cx=\"9\" cy=\"19\" r=\"1.2\"/><circle cx=\"17\" cy=\"19\" r=\"1.2\"/>",
  bell: "<path d=\"M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z\"/><path d=\"M10 20.5a2 2 0 0 0 4 0\"/>",
  therm: "<path d=\"M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0z\"/>",
  jar: "<path d=\"M8 4h8M9 4v2.5C7 8 6 9.5 6 12v6a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6c0-2.5-1-4-3-5.5V4\"/>",
  loaf: "<path d=\"M4 14c0-4 3.5-7 8-7s8 3 8 7v3H4z\"/><path d=\"M9 11l1 2M13 10l1 2\"/>",
  glass: "<path d=\"M5 5h14l-6 7v6M9 20h6\"/>",
  bowl: "<path d=\"M4 11h16a8 8 0 0 1-16 0z\"/><path d=\"M8 7c0-1.5 1-2 1-3M12 7c0-1.5 1-2 1-3\"/>",
  cookie: "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><circle cx=\"9\" cy=\"10\" r=\"1\"/><circle cx=\"14\" cy=\"9\" r=\"1\"/><circle cx=\"13\" cy=\"14.5\" r=\"1\"/>",
  info: "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M12 11v5M12 8v.1\"/>",
  "list": "<path d=\"M9 7h10M9 12h10M9 17h10\"/><path d=\"M4.5 7h.1M4.5 12h.1M4.5 17h.1\"/>",
  whisk: "<path d=\"M5 19 13 11\"/><path d=\"M13 11c1.5-4 4.5-6 6-6 0 1.5-2 4.5-6 6z\"/><path d=\"M14.5 9.5 11 13M16.5 8 12.5 12\"/>",
  "repeat": "<path d=\"M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2\"/><path d=\"M20 4v5h-5M4 20v-5h5\"/>",
  screen: "<rect x=\"3\" y=\"5\" width=\"18\" height=\"12\" rx=\"2\"/><path d=\"M9 21h6M12 17v4\"/>",
  play: "<path d=\"M8 6v12l10-6z\"/>",
  sun: "<circle cx=\"12\" cy=\"12\" r=\"4\"/><path d=\"M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4\"/>",
};

export type IconName = keyof typeof PATHS;

/** Preview-style inline icon. `size` overrides the 22px default. */
export function Ico({ n, size, className, style }: { n: IconName; size?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg className={"i" + (className ? " " + className : "")} viewBox="0 0 24 24" aria-hidden="true"
      style={size ? { width: size, height: size, ...style } : style} dangerouslySetInnerHTML={{ __html: PATHS[n] }} />
  );
}

/** The big faded glyph behind a hero. */
export function Glyph({ n }: { n: IconName }) {
  return (
    <div className="glyph" aria-hidden="true">
      <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: PATHS[n] }} />
    </div>
  );
}
