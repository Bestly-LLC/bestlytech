import { useState } from "react";
import { Bookmark, Check, LayoutGrid, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Desktop window furniture for Scout (2026-10-06): tiling, edge snapping, the dock for minimized windows, the
 * per-window status dot and saved layouts. Pure geometry + small presentational pieces; Scout.tsx owns the state.
 *
 * Colours follow the same rule as Scout.tsx: `white` / `black` are variable-backed in this repo, so they already
 * flip for the light theme. No `bento:` overrides on top.
 */

export type Box = { x: number; y: number; w: number; h: number };

/** Gap to the screen edge, and between tiles, when windows are arranged or snapped. */
export const MARGIN = 16;
export const GAP = 12;
export const MIN_W = 320;
export const MIN_H = 340;
/** Bottom strip kept free for the dock row when something is minimized. */
export const DOCK_RESERVE = 64;

/* ---------------------------------------------------------------- tiling (Arrange) */

/**
 * Evenly tile `n` windows over the whole viewport: 1 = large and centred, 2 = side by side, 3 = three columns,
 * 4 = 2x2. Same size for all. If the columns would be narrower than a window can be, it falls back to as many
 * columns as fit and more rows.
 */
export function tileBoxes(n: number, vw: number, vh: number, bottomReserve = 0): Box[] {
  const availW = vw - 2 * MARGIN;
  const availH = vh - 2 * MARGIN - bottomReserve;
  if (n <= 0) return [];
  if (n === 1) {
    const w = Math.min(availW, 960);
    return [{ x: Math.round((vw - w) / 2), y: MARGIN, w: Math.round(w), h: Math.round(availH) }];
  }
  let cols = n === 2 ? 2 : n === 3 ? 3 : 2;
  let cellW = (availW - GAP * (cols - 1)) / cols;
  if (cellW < MIN_W) {
    cols = Math.max(1, Math.floor((availW + GAP) / (MIN_W + GAP)));
    cellW = (availW - GAP * (cols - 1)) / cols;
  }
  const rows = Math.ceil(n / cols);
  const cellH = (availH - GAP * (rows - 1)) / rows;
  return Array.from({ length: n }, (_, i) => ({
    x: Math.round(MARGIN + (i % cols) * (cellW + GAP)),
    y: Math.round(MARGIN + Math.floor(i / cols) * (cellH + GAP)),
    w: Math.round(cellW),
    h: Math.round(cellH),
  }));
}

/** Keeps the arrangement roughly where the windows already were: left to right, and for four, top row then bottom row. */
export function orderForTiling<T extends { id: string; rect: Box }>(items: T[]): T[] {
  const cx = (t: T) => t.rect.x + t.rect.w / 2;
  const cy = (t: T) => t.rect.y + t.rect.h / 2;
  if (items.length !== 4) return [...items].sort((a, b) => cx(a) - cx(b));
  const byY = [...items].sort((a, b) => cy(a) - cy(b));
  return [...byY.slice(0, 2).sort((a, b) => cx(a) - cx(b)), ...byY.slice(2).sort((a, b) => cx(a) - cx(b))];
}

/* ---------------------------------------------------------------- snapping */

export type SnapZone = "left" | "right" | "top" | "tl" | "tr" | "bl" | "br";
const EDGE = 6; // pointer this close to the edge arms a snap
const CORNER = 96; // ...and this close to a corner along that edge makes it a quarter

export function snapZoneAt(x: number, y: number, vw: number, vh: number): SnapZone | null {
  const L = x <= EDGE, R = x >= vw - 1 - EDGE, T = y <= EDGE, B = y >= vh - 1 - EDGE;
  if (!(L || R || T || B)) return null;
  if (L || R) {
    if (y <= CORNER) return L ? "tl" : "tr";
    if (y >= vh - CORNER) return L ? "bl" : "br";
    return L ? "left" : "right";
  }
  if (T) return x <= CORNER ? "tl" : x >= vw - CORNER ? "tr" : "top";
  return x <= CORNER ? "bl" : x >= vw - CORNER ? "br" : null;
}

export function snapBox(zone: SnapZone, vw: number, vh: number): Box {
  const fullW = vw - 2 * MARGIN, fullH = vh - 2 * MARGIN;
  const halfW = Math.round((fullW - GAP) / 2), halfH = Math.round((fullH - GAP) / 2);
  const right = vw - MARGIN - halfW, bottom = vh - MARGIN - halfH;
  switch (zone) {
    case "top": return { x: MARGIN, y: MARGIN, w: fullW, h: fullH };
    case "left": return { x: MARGIN, y: MARGIN, w: halfW, h: fullH };
    case "right": return { x: right, y: MARGIN, w: halfW, h: fullH };
    case "tl": return { x: MARGIN, y: MARGIN, w: halfW, h: halfH };
    case "tr": return { x: right, y: MARGIN, w: halfW, h: halfH };
    case "bl": return { x: MARGIN, y: bottom, w: halfW, h: halfH };
    case "br": return { x: right, y: bottom, w: halfW, h: halfH };
  }
}

/* ---------------------------------------------------------------- status dot */

/** blue pulsing = working, green = finished since you last looked, orange = needs you, none = idle. */
export type DotKind = "working" | "done" | "needs" | null;
const DOT_HEX = { working: "#0A84FF", done: "#30D158", needs: "#FF9F0A" } as const;
export const dotLabel = (k: Exclude<DotKind, null>) =>
  k === "working" ? "Working" : k === "done" ? "Finished, not seen yet" : "Needs you";

export function StatusDot({ kind, className, labelled = true }: { kind: Exclude<DotKind, null>; className?: string; labelled?: boolean }) {
  return (
    <span
      {...(labelled ? { role: "img", "aria-label": dotLabel(kind), title: dotLabel(kind) } : { "aria-hidden": true })}
      data-dot={kind}
      style={{ background: DOT_HEX[kind] }}
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", kind === "working" && "scout-dot-pulse", className)}
    />
  );
}

/** Short enough for a chip, cut at a word, never with an ellipsis (it wraps if it still needs to). */
export function shortTitle(s: string, max = 34): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const i = cut.lastIndexOf(" ");
  return (i > 12 ? cut.slice(0, i) : cut).trim();
}

/* ---------------------------------------------------------------- dock */

export interface DockChip { id: string; title: string; dot: DotKind }

/** Minimized windows: a row of chips along the bottom-left. Stops short of the launcher at bottom-right. */
export function Dock({ chips, onRestore }: { chips: DockChip[]; onRestore: (id: string) => void }) {
  if (!chips.length) return null;
  return (
    <div
      role="toolbar"
      aria-label="Minimized Scout windows"
      data-scout-dock
      style={{ zIndex: 45 }}
      className="pointer-events-none fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-4 right-44 hidden flex-wrap-reverse items-end gap-2 md:flex"
    >
      {chips.map((c) => (
        <button
          key={c.id}
          type="button"
          data-dock-chip={c.id}
          onClick={() => onRestore(c.id)}
          aria-label={`Restore ${c.title}${c.dot ? `, ${dotLabel(c.dot).toLowerCase()}` : ""}`}
          className="scout-bubble-in scout-press pointer-events-auto inline-flex min-h-10 max-w-[15rem] items-center gap-2 rounded-2xl border border-white/10 bg-black/95 px-3 py-1.5 text-left text-[0.8125rem] font-medium leading-tight text-white shadow-lg backdrop-blur-xl hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {c.dot && <StatusDot kind={c.dot} labelled={false} />}
          <span className="min-w-0 break-words">{shortTitle(c.title)}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- saved layouts */

export const LAYOUTS_KEY = "bestly-scout-layouts";
export const MAX_LAYOUTS = 8;
export interface LayoutWin { threadId: string | null; box: Box; min: boolean }
export interface Layout { name: string; at: number; wins: LayoutWin[] }

const isBox = (b: unknown): b is Box =>
  !!b && typeof b === "object" && ["x", "y", "w", "h"].every((k) => typeof (b as Record<string, unknown>)[k] === "number");

export function loadLayouts(): Layout[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUTS_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((l): l is Layout => !!l && typeof l.name === "string" && Array.isArray(l.wins))
      .map((l) => ({
        name: l.name,
        at: typeof l.at === "number" ? l.at : 0,
        wins: l.wins
          .filter((w) => w && isBox(w.box))
          .map((w) => ({ threadId: typeof w.threadId === "string" ? w.threadId : null, box: w.box, min: !!w.min })),
      }))
      .filter((l) => l.wins.length > 0)
      .slice(0, MAX_LAYOUTS);
  } catch {
    return [];
  }
}
export function storeLayouts(l: Layout[]) {
  try { localStorage.setItem(LAYOUTS_KEY, JSON.stringify(l.slice(0, MAX_LAYOUTS))); } catch { /* private mode */ }
}

/* ---------------------------------------------------------------- the "Windows" menu */

interface MenuProps {
  canSpawn: boolean;
  maxWindows: number;
  onNew: () => void;
  /** Primary only, and only while it has been moved. */
  onCorner?: () => void;
  layouts: Layout[];
  canSave: boolean;
  onSave: (name: string) => "ok" | "full";
  onApply: (name: string) => void;
  onDelete: (name: string) => void;
  onClose: () => void;
}

const row = "scout-press flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm text-white hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:hover:bg-transparent";

/** New window, Layouts (save / reopen / delete) and "put back in the corner", kept out of the header so it stays calm. */
export function WindowsMenu({ canSpawn, maxWindows, onNew, onCorner, layouts, canSave, onSave, onApply, onDelete, onClose }: MenuProps) {
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const full = layouts.length >= MAX_LAYOUTS;
  const exists = (n: string) => layouts.some((l) => l.name.toLowerCase() === n.trim().toLowerCase());

  const commit = () => {
    const name = draft.trim().slice(0, 40);
    if (!name) return;
    if (full && !exists(name)) { setNote(`${MAX_LAYOUTS} layouts is the most. Delete one first.`); return; }
    if (onSave(name) === "ok") onClose();
  };

  return (
    <div
      role="menu"
      aria-label="Windows"
      data-scout-menu
      className="scout-bubble-in absolute right-2 top-12 z-30 w-[17rem] max-w-[calc(100%-1rem)] rounded-xl border border-white/10 bg-black p-1 shadow-2xl"
    >
      <button type="button" role="menuitem" aria-label="New Scout window" disabled={!canSpawn} onClick={onNew} className={row}>
        <Plus className="h-4 w-4 shrink-0 text-white/60" aria-hidden />
        <span className="flex-1">{canSpawn ? "New window" : `${maxWindows} windows is the most`}</span>
        <span className="whitespace-nowrap text-xs text-white/35">{"⇧⌘N"}</span>
      </button>
      {onCorner && (
        <button type="button" role="menuitem" aria-label="Put Scout back in the corner" onClick={onCorner} className={row}>
          <RotateCcw className="h-4 w-4 shrink-0 text-white/60" aria-hidden />
          <span className="flex-1">Put back in the corner</span>
        </button>
      )}
      <div className="mx-1 my-1 h-px bg-white/10" role="separator" />
      <p className="flex items-center gap-1.5 px-2.5 pb-1 pt-1.5 text-[0.6875rem] font-medium text-white/50">
        <LayoutGrid className="h-3 w-3" aria-hidden /> Layouts
      </p>

      {naming ? (
        <div className="flex min-h-11 items-center gap-1.5 px-1.5">
          <input
            autoFocus
            value={draft}
            maxLength={40}
            aria-label="Layout name"
            placeholder="Name this layout"
            onChange={(e) => { setDraft(e.target.value); setNote(null); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commit(); }
              if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); setNaming(false); setNote(null); }
            }}
            className="h-9 min-w-0 flex-1 rounded-lg border border-white/15 bg-white/[0.06] px-2.5 text-sm text-white placeholder:text-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="button"
            onClick={commit}
            disabled={!draft.trim()}
            aria-label="Save layout"
            className="scout-press flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-black disabled:opacity-40"
          >
            <Check className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => { setNaming(false); setNote(null); }}
            aria-label="Cancel"
            className="scout-press flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/50 hover:bg-white/5 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button type="button" role="menuitem" disabled={!canSave} onClick={() => setNaming(true)} className={row}>
          <Bookmark className="h-4 w-4 shrink-0 text-white/60" aria-hidden />
          <span className="flex-1">Save this layout{"…"}</span>
        </button>
      )}
      {note && <p className="px-2.5 pb-1 text-xs text-[#FF9F0A]" role="status">{note}</p>}

      {layouts.length === 0 ? (
        <p className="px-2.5 pb-2 pt-1 text-xs text-white/40">Saved layouts show up here.</p>
      ) : (
        <ul className="max-h-[17.5rem] overflow-y-auto">
          {layouts.map((l) => (
            <li key={l.name} data-layout={l.name} className="flex min-h-11 items-center rounded-lg hover:bg-white/[0.05]">
              <button
                type="button"
                role="menuitem"
                onClick={() => onApply(l.name)}
                aria-label={`Open layout ${l.name}, ${l.wins.length} window${l.wins.length === 1 ? "" : "s"}`}
                className="scout-press flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 text-left text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1 break-words leading-snug">{l.name}</span>
                <span className="whitespace-nowrap text-xs text-white/40">{l.wins.length} {l.wins.length === 1 ? "window" : "windows"}</span>
              </button>
              <button
                type="button"
                onClick={() => onDelete(l.name)}
                aria-label={`Delete layout ${l.name}`}
                className="scout-press mr-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/40 hover:bg-red-500/10 hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
