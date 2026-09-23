import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * Keep a chat log pinned to its newest line — for real this time.
 *
 * Why the earlier versions kept jumping: they decided "is the reader at the bottom?" from
 * every scroll event. But scroll events also fire when the LAYOUT moves — a thinking row
 * swapped for the answer, a smooth-scroll animation passing through the middle, the list
 * reloading, a banner appearing. Each of those read as "the reader scrolled up", unpinned
 * the log, and it stayed wherever the reflow had left it (often near the top).
 *
 * Here only a person can unpin it. We listen for real input (wheel, touch, keys, dragging
 * the scrollbar) and only a scroll that follows such input within a moment may change the
 * pinned state. Everything else — streaming text, new rows, reloads — re-pins instantly
 * (no smooth scrolling, so there is never a half-way position to misread).
 *
 * `resetKey`: change it (thread id, sheet opened) to jump to the bottom and pin again.
 * Pass `"window"` instead of a ref when the page itself scrolls (the partner portal);
 * then `contentRef` is the element whose size changes (the message list).
 */
export function useStickToBottom<T extends HTMLElement>(
  ref: RefObject<T> | "window",
  resetKey?: unknown,
  contentRef?: RefObject<HTMLElement>,
) {
  const stuck = useRef(true);
  const userAt = useRef(0);
  const [atBottom, setAtBottom] = useState(true);

  const toBottom = useCallback(() => {
    if (ref === "window") {
      const d = document.scrollingElement ?? document.documentElement;
      window.scrollTo({ top: d.scrollHeight, behavior: "instant" as ScrollBehavior });
      return;
    }
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [ref]);

  const jump = useCallback(() => {
    stuck.current = true;
    setAtBottom(true);
    toBottom();
  }, [toBottom]);

  useEffect(() => {
    const el = ref === "window" ? null : ref.current;
    const watched = ref === "window" ? contentRef?.current : el;
    if (!watched) return;
    const input: HTMLElement | Window = el ?? window;
    const scroller: HTMLElement | Window = el ?? window;
    const gapNow = () => {
      if (el) return el.scrollHeight - el.scrollTop - el.clientHeight;
      const d = document.scrollingElement ?? document.documentElement;
      return d.scrollHeight - window.scrollY - window.innerHeight;
    };
    if (el) {
      el.style.scrollBehavior = "auto";
      el.style.overflowAnchor = "none";
    }

    const touched = () => { userAt.current = Date.now(); };
    const onKey = (e: Event) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes((e as KeyboardEvent).key)) touched();
    };
    const onScroll = () => {
      const gap = gapNow();
      if (Date.now() - userAt.current < 600) {
        stuck.current = gap < 48;
        setAtBottom(stuck.current);
      } else if (stuck.current && gap > 1) {
        // The layout moved us, not the reader. Put it back.
        toBottom();
      }
    };
    const opts = { passive: true } as AddEventListenerOptions;
    input.addEventListener("wheel", touched, opts);
    input.addEventListener("touchstart", touched, opts);
    input.addEventListener("touchmove", touched, opts);
    input.addEventListener("pointerdown", touched, opts);
    input.addEventListener("keydown", onKey);
    scroller.addEventListener("scroll", onScroll, opts);

    // Content grows without a scroll event (streaming text, images loading): watch sizes.
    const ro = new ResizeObserver(() => { if (stuck.current) toBottom(); });
    ro.observe(watched);
    const watchKids = () => { for (const c of Array.from(watched.children)) ro.observe(c); };
    watchKids();
    const mo = new MutationObserver(() => { watchKids(); if (stuck.current) toBottom(); });
    mo.observe(watched, { childList: true, subtree: true, characterData: true });

    return () => {
      input.removeEventListener("wheel", touched);
      input.removeEventListener("touchstart", touched);
      input.removeEventListener("touchmove", touched);
      input.removeEventListener("pointerdown", touched);
      input.removeEventListener("keydown", onKey);
      scroller.removeEventListener("scroll", onScroll);
      ro.disconnect();
      mo.disconnect();
    };
  }, [ref, contentRef, toBottom, resetKey]);

  // Start at the bottom (and again whenever the conversation changes), before paint.
  useLayoutEffect(() => {
    stuck.current = true;
    setAtBottom(true);
    toBottom();
    const id = requestAnimationFrame(toBottom);
    return () => cancelAnimationFrame(id);
  }, [resetKey, toBottom]);

  return { atBottom, jump, isStuck: () => stuck.current, pin: () => { if (stuck.current) toBottom(); } };
}
