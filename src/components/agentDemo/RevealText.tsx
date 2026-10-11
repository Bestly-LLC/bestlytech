import { Fragment, memo, type ReactNode } from "react";

/**
 * Text that types in word by word without ever re-flowing: the whole line is laid out from the start and the words
 * not yet spoken are just invisible. Amounts, times, phone numbers and "12 minutes" style phrases are kept in one
 * no-wrap group, so a number never wraps away from its unit.
 */
const GLUE =
  /(\$[\d,]+(?:\.\d+)?K?|\d{1,2}:\d{2}\s?[AP]M|\(\d{3}\)\s?\d{3}-\d{4}|\b\d+(?:\s(?:to|-)\s\d+)?\s(?:business\sdays?|minutes?|mins?|hours?|seats?|bd|ba|beds?|baths?)\b|\b(?:Sat|Sun|Mon|Tue|Wed|Thu|Fri)\s\d{1,2}:\d{2}\s?[AP]M|\bOctober\s\d+(?:st|nd|rd|th)?)/g;

type Seg = { words: { w: string; i: number }[]; glue: boolean };

export function segments(text: string): { segs: Seg[]; count: number } {
  const ws: { w: string; start: number; end: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) ws.push({ w: m[0], start: m.index, end: m.index + m[0].length });

  const ranges: [number, number][] = [];
  GLUE.lastIndex = 0;
  while ((m = GLUE.exec(text))) ranges.push([m.index, m.index + m[0].length]);

  // Which glue range (if any) each word sits in.
  const group = ws.map((w) => ranges.findIndex(([a, b]) => w.start >= a && w.end <= b + 1));
  const segs: Seg[] = [];
  let prevGroup = -1;
  ws.forEach((w, i) => {
    const g = group[i];
    const item = { w: w.w, i };
    if (g >= 0 && g === prevGroup) segs[segs.length - 1].words.push(item);
    else segs.push({ words: [item], glue: g >= 0 });
    prevGroup = g;
  });
  return { segs, count: ws.length };
}

function RevealTextBase({ text, shown, className }: { text: string; shown: number; className?: string }) {
  const { segs } = segments(text);
  const word = (x: { w: string; i: number }): ReactNode => (
    <span key={x.i} className={x.i < shown ? "ad-w ad-w-on" : "ad-w"}>
      {x.w}
    </span>
  );
  return (
    <span className={className}>
      {segs.map((s, k) => (
        <Fragment key={k}>
          {k > 0 ? " " : null}
          {s.glue ? (
            <span className="whitespace-nowrap">
              {s.words.map((x, j) => (
                <Fragment key={x.i}>
                  {j > 0 ? " " : null}
                  {word(x)}
                </Fragment>
              ))}
            </span>
          ) : (
            word(s.words[0])
          )}
        </Fragment>
      ))}
    </span>
  );
}

export const RevealText = memo(RevealTextBase);

/** Plain text with the same no-break grouping (scene line, outcome bullets). */
export function Glued({ text }: { text: string }) {
  return <RevealText text={text} shown={Infinity} />;
}
