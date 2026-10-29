// Family Cookbook: the one place the app's state lives.

import type { Role, Viewer } from "./people";

export interface Photo { id: string; side: "front" | "back" }
/** A line in the list (no ingredients or steps yet). */
export interface Row {
  id: string; title: string; by: Role; added: string; status: string | null; category: string;
  flaggedBy: Role | null; flaggedAt: string | null; note: string; closer: boolean;
  deletedAt: string | null; deletedBy: Role | null; yield: any; photos: Photo[]; hay: string; doc?: any;
}
/** A whole recipe: the doc (ingredients, steps, ...) with the row's facts on top. `id` is the row id, `slug` the doc's own id. */
export interface Rec {
  id: string; slug: string; by: Role; added: string; status: string | null; flaggedBy: Role | null; flaggedAt: string | null;
  note: string; closer: boolean; photos: Photo[]; canEdit: boolean; title: string; category: string;
  yield: any; ingredients: any[]; steps: any[]; [k: string]: any;
}
export interface Cap {
  id: string; status: "uploading" | "reading" | "closer" | "ready" | "failed"; draft?: any; closer?: boolean; lowconf?: boolean;
  hasBack: boolean; error?: string | null; photos: Photo[]; created?: string;
  tmp?: boolean; blob?: Blob; localUrl?: string; p?: Promise<string>;
}
export interface RState {
  factor: number; omni: boolean; split: boolean; notes: string; log: { date: string; desc: string; note: string; by?: string | null }[];
  have: { desc: string; ing: string } | null; checked: Record<string, boolean>;
}
export interface Timer { id: number; key: string; label: string; endAt: number; total: number; remain: number; done: boolean; max: number | null }

export interface AppState {
  me: (Viewer & { activeRoles?: string[] }) | null;
  view: "signin" | "home" | "review" | "deleted" | "check" | "recipe";
  vp: { kind?: "queue" | "recipe"; id?: string; from?: string; fromVp?: any };
  rows: Row[]; review: Row[]; deleted: Row[]; caps: Cap[];
  loaded: boolean; loadErr: string;
  recs: Record<string, Rec>; drafts: Record<string, any>; rs: Record<string, RState>;
  capN: Record<string, number>; capSeq: number;
  q: string; tab: "recipe" | "card"; side: "front" | "back"; zoom: boolean; note: string; ingOpen: boolean; viewBatch: number;
  cam: any; cook: any; timers: Timer[]; tid: number; sheetOpen: boolean; lastFocus: HTMLElement | null; msg: string; busy: boolean; _step?: number;
}

export const S: AppState = {
  me: null, view: "signin", vp: {}, rows: [], review: [], deleted: [], caps: [], loaded: false, loadErr: "",
  recs: {}, drafts: {}, rs: {}, capN: {}, capSeq: 0,
  q: "", tab: "recipe", side: "front", zoom: false, note: "", ingOpen: false, viewBatch: 1,
  cam: null, cook: null, timers: [], tid: 0, sheetOpen: false, lastFocus: null, msg: "", busy: false,
};

export function resetState() {
  S.me = null; S.view = "signin"; S.vp = {}; S.rows = []; S.review = []; S.deleted = []; S.caps = []; S.loaded = false; S.loadErr = "";
  S.recs = {}; S.drafts = {}; S.rs = {}; S.capN = {}; S.capSeq = 0; S.q = ""; S.tab = "recipe"; S.side = "front"; S.zoom = false; S.note = "";
  S.ingOpen = false; S.viewBatch = 1; S.cam = null; S.cook = null; S.timers = []; S.tid = 0; S.sheetOpen = false; S.lastFocus = null; S.busy = false;
}

export type Act = (t: HTMLElement, e: Event) => void;
/** Click handlers, keyed by data-act. Each module adds its own. */
export const ACT: Record<string, Act> = {};
/** Submit handlers, keyed by data-form. */
export const FORM: Record<string, (f: HTMLElement) => void> = {};

/** Late-bound screen functions, so modules can call each other without importing in a circle. */
export const hooks: {
  render: (enter?: boolean) => void;
  go: (view: AppState["view"], vp?: AppState["vp"]) => void;
  refreshHome: () => void;
  closeCam: () => void;
  signOut: () => void;
} = { render() {}, go() {}, refreshHome() {}, closeCam() {}, signOut() {} };
