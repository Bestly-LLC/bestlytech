/**
 * Small shared pieces for the mock desktop apps: avatars, the feathered "Maya changed this" glow and tag, toasts,
 * and a FLIP helper so cards that change columns glide there. All of it is a pure function of the call time `t`.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { cn } from "@/lib/utils";
import type { FiredEvent } from "./timeline";
import { badgeSrc, logoSrc, personSrc } from "./brand";

export type AppProps = { events: FiredEvent[]; t: number; caller: { name: string; phone: string }; /** The call is over (t has reached the end). */ ended?: boolean };

export type ToastItem = { at: number; text: string };

export const MAYA = "#8E9BFF";

export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduce(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return reduce;
}

const AVATAR_COLORS = ["#5B6CF0", "#C2437A", "#1F8A70", "#C2701E", "#6D52C9", "#2D86C4", "#B24A4A", "#4F7F2E"];
export const initials = (name: string) =>
  name
    .replace(/[^A-Za-z\s.]/g, "")
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

/** A person's photo (or a business's round logo) when we have one; their initials otherwise, and if the image fails. */
export function Avatar({ name, size = 28, className }: { name: string; size?: number; className?: string }) {
  const src = personSrc(name) ?? badgeSrc(name);
  const [failed, setFailed] = useState<string | null>(null);
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length;
  const photo = src && failed !== src;
  return (
    <span
      aria-hidden="true"
      className={cn("ad-avatar", photo && "ad-avatar-photo", className)}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)), background: photo ? undefined : AVATAR_COLORS[hue] }}
    >
      {photo ? (
        <img src={src} alt="" width={size} height={size} decoding="async" loading="lazy" draggable={false} onError={() => setFailed(src)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}

/** A demo business's app icon (rounded square). Sized in px; never wider than it is tall. */
export function BizLogo({ slug, size = 16, className }: { slug: string; size?: number; className?: string }) {
  return (
    <img
      src={logoSrc(slug)}
      alt=""
      width={size}
      height={size}
      decoding="async"
      draggable={false}
      aria-hidden="true"
      className={cn("ad-logo", className)}
      style={{ width: size, height: size }}
    />
  );
}

/** 0 to 1 and back: ramps up in 0.25s, holds, fades out by 2.5s after `at`. */
export function envelope(t: number, at: number | null | undefined, total = 2.5): number {
  if (at == null) return 0;
  const d = t - at;
  if (d < 0 || d >= total) return 0;
  if (d < 0.25) return d / 0.25;
  if (d < total - 0.75) return 1;
  return (total - d) / 0.75;
}

/**
 * Wraps something Maya just changed. For ~2.5s a feathered glow (a gradient that fades to nothing, never a box) and a
 * tiny "Maya" tag show on it. Opacity comes from the call time, so pausing and scrubbing stay correct.
 */
export function Fx({
  at,
  t,
  tag = true,
  tagSide = "right",
  className,
  style,
  children,
  as: Tag = "div",
  rootRef,
}: {
  at: number | null | undefined;
  t: number;
  tag?: boolean;
  tagSide?: "left" | "right";
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  as?: "div" | "li" | "span";
  rootRef?: Ref<HTMLDivElement>;
}) {
  const e = envelope(t, at);
  const T = Tag as "div";
  return (
    <T ref={rootRef} className={cn("ad-fx", className)} style={style}>
      {at != null ? <span aria-hidden="true" className="ad-glow" style={{ opacity: e }} /> : null}
      {children}
      {at != null && tag ? (
        <span aria-hidden="true" className={cn("ad-mtag", tagSide === "left" && "ad-mtag-l")} style={{ opacity: e, transform: `translateY(${(1 - e) * 3}px)` }}>
          <i />
          Maya
        </span>
      ) : null}
    </T>
  );
}

/** Toasts slide in from the window's top-right corner and stay ~3.5s. */
export function Toasts({ toasts, t }: { toasts: ToastItem[]; t: number }) {
  let slot = 0;
  return (
    <div className="ad-toasts" aria-hidden="true">
      {toasts.map((x) => {
        const d = t - x.at;
        const live = d >= 0 && d < 3.5;
        const k = d < 0.3 ? d / 0.3 : d > 3.1 ? Math.max(0, (3.5 - d) / 0.4) : 1;
        const top = slot * 54;
        if (live) slot++;
        return (
          <div
            key={x.at}
            className="ad-toast"
            style={{ top, opacity: live ? k : 0, transform: `translateX(${live ? (1 - k) * 28 : 28}px)` }}
          >
            <span className="ad-toast-ic">
              <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3.5 8.5l3 3 6-7" />
              </svg>
            </span>
            <span className="ad-toast-t">
              <b>Maya</b>
              {x.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * FLIP: remember where every registered element was, and when `depKey` changes slide each one from its old spot to
 * its new one. Positions are measured inside `root`, so page scrolling cannot fake a move. An animation that is still
 * running when the next change arrives is picked up from where it visually is, so it can be interrupted.
 * Reduce Motion: no movement, only a short crossfade.
 */
export function useFlip(depKey: string) {
  const root = useRef<HTMLDivElement | null>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const prev = useRef(new Map<string, { x: number; y: number }>());
  const reduce = useReducedMotion();

  useLayoutEffect(() => {
    const r = root.current;
    if (!r) return;
    const base = r.getBoundingClientRect();
    const next = new Map<string, { x: number; y: number }>();
    els.current.forEach((el, key) => {
      if (!el.isConnected) return;
      const rect = el.getBoundingClientRect();
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      const here = { x: rect.left - base.left - m.m41, y: rect.top - base.top - m.m42 };
      next.set(key, here);
      const was = prev.current.get(key);
      if (!was) {
        if (prev.current.size) el.animate([{ opacity: 0, transform: "scale(.96)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: "cubic-bezier(.32,.72,0,1)" });
        return;
      }
      const dx = was.x + m.m41 - here.x;
      const dy = was.y + m.m42 - here.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.getAnimations().forEach((a) => a.cancel());
      if (reduce) {
        el.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 220, easing: "ease-out" });
      } else {
        el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], {
          duration: 520,
          easing: "cubic-bezier(.32,.72,0,1)",
        });
      }
    });
    prev.current = next;
  }, [depKey, reduce]);

  const ref = (key: string) => (el: HTMLElement | null) => {
    if (el) els.current.set(key, el);
    else els.current.delete(key);
  };
  return { root, ref };
}

/** "Just now" style helper kept here so each app reads the same. */
export const pill = (tone: "good" | "warn" | "bad" | "info" | "mute") => `ad-pill ad-pill-${tone}`;
