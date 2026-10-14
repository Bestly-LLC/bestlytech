/**
 * Jared's rule: a sentence that fits on one line never gets split across two. Each sentence is an
 * inline-block, so if it won't fit where it starts, it moves to the next line whole (a sentence longer than a
 * line still wraps inside itself). Strings and arrays of strings/elements; anything else renders as is.
 * Shared by the guest pages and the admin (src/pages/lax/Lines.tsx re-exports it).
 */
import { Fragment, isValidElement, type ReactNode } from "react";

const SPLIT = /(?<=[.!?])\s+(?=[A-Z0-9"“(¿¡])/;

function sentences(text: string): string[] {
  return text.split(SPLIT).filter((s) => s.trim());
}

const isFrag = (c: unknown) => isValidElement(c) && c.type === Fragment;

export function Lines({ children }: { children: ReactNode }) {
  // A fragment (<>Text. More text.</>) is just its children.
  if (isFrag(children)) return <Lines>{(children as { props: { children?: ReactNode } }).props.children}</Lines>;
  // Mixed text + elements (e.g. "Park on <b>P3</b>. Designated area only."): split each text piece.
  if (Array.isArray(children)) return <>{children.map((c, i) => <Fragment key={i}>{typeof c === "string" || isFrag(c) ? <Lines>{c as ReactNode}</Lines> : c}</Fragment>)}</>;
  if (typeof children !== "string") return <>{children}</>;
  const paras = children.split("\n");
  return (
    <>
      {paras.map((full, i) => {
        // A piece that starts with the end punctuation of the sentence before it (". Next one." / "). Next one.") keeps that
        // punctuation as plain text, so a lone "." can never wrap onto a line of its own.
        const tail = /^[)\]”"']*[.!?]*[)\]”"']*(?=\s|$)/.exec(full)?.[0] ?? "";
        const p = tail ? full.slice(tail.length) : full;
        return (
        <Fragment key={i}>
          {i > 0 && "\n"}
          {tail}
          {/^\s/.test(p) && " "}
          {sentences(p).map((s, j) => <Fragment key={j}>{j > 0 && " "}<span className="inline-block max-w-full">{s.trim()}</span></Fragment>)}
          {/\s$/.test(p) && p.trim() && " "}
        </Fragment>
        );
      })}
    </>
  );
}
