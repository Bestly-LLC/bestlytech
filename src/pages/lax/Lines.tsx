/**
 * Jared's rule: a sentence that fits on one line never gets split across two. Each sentence is an
 * inline-block, so if it won't fit where it starts, it moves to the next line whole (a sentence longer than a
 * line still wraps inside itself). Strings only; anything else renders as is.
 */
import { Fragment, type ReactNode } from "react";

const SPLIT = /(?<=[.!?])\s+(?=[A-Z0-9"“(¿¡])/;

function sentences(text: string): string[] {
  return text.split(SPLIT).filter(Boolean);
}

export function Lines({ children }: { children: ReactNode }) {
  // Mixed text + elements (e.g. "Park on <b>P3</b>. Designated area only."): split each text piece.
  if (Array.isArray(children)) return <>{children.map((c, i) => <Fragment key={i}>{typeof c === "string" ? <Lines>{c}</Lines> : c}</Fragment>)}</>;
  if (typeof children !== "string") return <>{children}</>;
  const paras = children.split("\n");
  return (
    <>
      {paras.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && "\n"}
          {/^\s/.test(p) && " "}
          {sentences(p).map((s, j) => <Fragment key={j}>{j > 0 && " "}<span className="inline-block max-w-full">{s.trim()}</span></Fragment>)}
          {/\s$/.test(p) && p.trim() && " "}
        </Fragment>
      ))}
    </>
  );
}
