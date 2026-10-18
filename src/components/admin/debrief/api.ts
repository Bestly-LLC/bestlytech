/**
 * The one place the call debrief talks to the database.
 *
 * The call_debrief_* functions are written by the backend lane (shapes in DEBRIEF-RPC-SHAPES.md) and may not
 * exist yet when this ships. Every call here therefore (a) never throws, (b) says plainly whether the function
 * is missing so the whole feature can stay hidden, and (c) turns whatever came back into the UI's own shapes
 * (types.ts). The readers are deliberately forgiving about field names (snake_case or camelCase, a bare array
 * or a wrapper object) so a small difference in the server's answer cannot blank the screen.
 *
 * All of them return jsonb {ok:true, ...} or {ok:false, error:"<code>"}; a non-admin gets a thrown 42501.
 *   call_debrief_list()
 *   call_debrief_get(p_id)
 *   call_debrief_item_update(p_item, p_title, p_detail, p_due)   null = leave as is, '' clears the detail
 *   call_debrief_item_remove(p_item)        draft -> dropped
 *   call_debrief_item_restore(p_item)       dropped -> draft
 *   call_debrief_move_owner(p_item, p_to)   her draft <-> a team item
 *   call_debrief_send(p_id, p_items)        the chosen drafts become open
 *   call_debrief_undo_send(p_id)            open -> draft, within 10 minutes
 *   call_debrief_snooze(p_id)               remind in 1 hour
 *   call_debrief_dismiss(p_id)
 */
import { supabase } from "@/integrations/supabase/client";
import { callOffset } from "./format";
import type {
  ApiResult, DebriefDetail, DebriefHeader, DebriefRow, HerItem, MoveTarget, TeamItem,
} from "./types";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** First key that is present, in the order given (snake_case first, then camelCase). */
function pick(o: Json, ...keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
}
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
/** A list of names: strings, or objects that carry a name. */
function names(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = typeof x === "string" ? x : isObj(x) ? str(pick(x, "name", "label", "display_name")) : null;
    if (s && s.trim()) out.push(s.trim());
  }
  return out;
}
/** A date column can arrive as "2026-10-23" or a full timestamp; the screen only wants the day. */
const dayOnly = (v: unknown): string | null => {
  const s = str(v);
  const m = s ? /^(\d{4}-\d{2}-\d{2})/.exec(s) : null;
  return m ? m[1] : null;
};
/** Where in the call: "12:04" as the server writes it, or a count of seconds turned into the same. */
function atLabel(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return /^\d{1,3}(:\d{2}){1,2}$/.test(t) ? t : null;
  }
  const n = num(v);
  return n == null ? null : callOffset(n) || null;
}

/* ───────────────────────── the call ───────────────────────── */

const MISSING_CODES = new Set(["PGRST202", "42883", "42P01", "PGRST205"]);
const FORBIDDEN_CODES = new Set(["42501", "PGRST301", "401", "403"]);

/** What each error code from the server means, in the words Jared reads. */
const ERROR_WORDS: Record<string, string> = {
  not_found: "That one isn't there any more. Reopen the debrief.",
  not_draft: "That one has already been sent, so it can't be changed here.",
  not_removed: "That one wasn't removed here, so it can't be put back.",
  not_pending: "This debrief isn't waiting on you any more.",
  title_too_short: "Give it a few more words.",
  title_too_long: "That's too long. Shorten it a little.",
  detail_too_long: "The note is too long. Shorten it a little.",
  unknown_owner: "Scout doesn't know that person.",
  same_owner: "It's already with them.",
  nothing_selected: "Pick at least one item to send.",
  nothing_sent: "None of those could go out. They may have changed, so reopen the debrief.",
  too_late: "It has been more than 10 minutes, so these can't be taken back from here.",
  nothing_to_undo: "There's nothing left to take back.",
};

async function call(fn: string, args: Json = {}): Promise<ApiResult<unknown>> {
  let res: { data: unknown; error: { message?: string; code?: string; details?: string } | null };
  try {
    // Called inline (not stored in a variable) so the client keeps its own `this`.
    res = await (supabase.rpc as any)(fn, args);
  } catch {
    return { ok: false, error: "Couldn't reach the server. Try again." };
  }
  if (res.error) {
    const code = String(res.error.code ?? "");
    const msg = String(res.error.message ?? "");
    if (MISSING_CODES.has(code) || /could not find the function|schema cache|function .* does not exist/i.test(msg)) {
      return { ok: false, error: "Not set up yet.", missing: true };
    }
    if (FORBIDDEN_CODES.has(code) || /permission denied|not authori[sz]ed|admin only|not an admin|jwt/i.test(msg)) {
      return { ok: false, error: "Not allowed.", forbidden: true };
    }
    return { ok: false, error: "Something went wrong. Try again." };
  }
  const d = res.data;
  if (isObj(d) && d.ok === false) {
    const e = String(d.error ?? "");
    if (/not.*admin|forbidden|not authori[sz]ed/i.test(e)) return { ok: false, error: "Not allowed.", forbidden: true };
    const words = ERROR_WORDS[e];
    return { ok: false, error: words ?? "Something went wrong. Try again.", ...(words ? { code: e } : {}) };
  }
  return { ok: true, data: d };
}

/** The payload of an {ok:true, ...} answer, whether it sits at the top or under a wrapper key. */
function body(d: unknown, ...wrappers: string[]): unknown {
  if (isObj(d)) {
    for (const k of wrappers) if (d[k] !== undefined && d[k] !== null) return d[k];
  }
  return d;
}

/* ───────────────────────── readers ───────────────────────── */

function readRow(r: unknown): DebriefRow | null {
  if (!isObj(r)) return null;
  const id = str(pick(r, "id", "debrief_id"));
  if (!id) return null;
  return {
    id,
    clientSlug: str(pick(r, "client_slug", "clientSlug")),
    clientName: str(pick(r, "client_name", "clientName")),
    person: str(pick(r, "person", "contact_name", "contactName")),
    sandbox: bool(r.sandbox) === true,
    meetingId: str(pick(r, "meeting_id", "meetingId")),
    meetingName: str(pick(r, "meeting_name", "meetingName", "name", "title")),
    startedAt: str(pick(r, "started_at", "startedAt")),
    stoppedAt: str(pick(r, "stopped_at", "stoppedAt")),
    durationMin: num(pick(r, "duration_min", "durationMin")),
    createdAt: str(pick(r, "created_at", "createdAt")),
    coverage: num(pick(r, "coverage")),
    herCount: num(pick(r, "her_count", "herCount")) ?? 0,
    draftCount: num(pick(r, "draft_count", "draftCount")),
    teamCount: num(pick(r, "team_count", "teamCount")) ?? 0,
    status: str(r.status) ?? "pending",
    remindAt: str(pick(r, "remind_at", "remindAt")),
    sentAt: str(pick(r, "sent_at", "sentAt")),
    sentCount: num(pick(r, "sent_count", "sentCount")),
  };
}

function readList(d: unknown): DebriefRow[] {
  const inner = body(d, "debriefs", "list", "rows", "items", "data");
  const arr = Array.isArray(inner) ? inner : [];
  return arr.map(readRow).filter((x): x is DebriefRow => !!x);
}

function readHeader(h: unknown, id: string): DebriefHeader {
  const o = isObj(h) ? h : {};
  return {
    id: str(pick(o, "id", "debrief_id")) ?? id,
    clientSlug: str(pick(o, "client_slug", "clientSlug")),
    clientName: str(pick(o, "client_name", "clientName")),
    contactName: str(pick(o, "person", "contact_name", "contactName")),
    sandbox: bool(o.sandbox) === true,
    meetingId: str(pick(o, "meeting_id", "meetingId", "recording_id")),
    meetingName: str(pick(o, "meeting_name", "meetingName", "name", "title")),
    startedAt: str(pick(o, "started_at", "startedAt")),
    stoppedAt: str(pick(o, "stopped_at", "stoppedAt")),
    durationMin: num(pick(o, "duration_min", "durationMin")),
    coverage: num(pick(o, "coverage")),
    createdAt: str(pick(o, "created_at", "createdAt", "ready_at")),
    people: names(pick(o, "people", "participants", "roster", "names")),
    status: str(o.status) ?? "pending",
    remindAt: str(pick(o, "remind_at", "remindAt")),
    sentAt: str(pick(o, "sent_at", "sentAt")),
    sentCount: num(pick(o, "sent_count", "sentCount")),
    canUndo: bool(pick(o, "can_undo", "canUndo")),
    recordingUrl: str(pick(o, "recording_url", "recordingUrl", "audio_url")),
    transcriptUrl: str(pick(o, "transcript_url", "transcriptUrl")),
  };
}

/**
 * One point per entry. The two plain sentences Scout wrote come first, kept together as one point; then
 * each decision. Also accepts a bare text, a list, or {bullets}, so a small change on the server cannot blank it.
 */
export function readBullets(summary: unknown, summaryText?: unknown): string[] {
  const out: string[] = [];
  const push = (s: unknown) => {
    const t = typeof s === "string" ? s : isObj(s) ? str(pick(s, "what", "text", "title", "decision", "summary")) : null;
    const clean = t?.replace(/^\s*[-•*]\s+/, "").replace(/\s+/g, " ").trim();
    if (clean && !out.some((x) => x.toLowerCase() === clean.toLowerCase())) out.push(clean);
  };

  push(str(summaryText));
  if (typeof summary === "string") summary.split(/\n+/).forEach(push);
  else if (Array.isArray(summary)) summary.forEach(push);
  else if (isObj(summary)) {
    const direct = pick(summary, "bullets", "points", "highlights");
    if (Array.isArray(direct)) direct.forEach(push);
    else {
      push(summary.summary);
      const decisions = summary.decisions;
      if (Array.isArray(decisions)) decisions.forEach(push);
    }
  }
  return out.slice(0, 5);
}

function readHer(i: unknown): HerItem | null {
  if (!isObj(i)) return null;
  const id = str(pick(i, "id", "item_id", "todo_id"));
  const title = str(pick(i, "title", "text"));
  if (!id || !title) return null;
  return {
    id,
    title,
    detail: str(pick(i, "detail", "details", "note")),
    due: dayOnly(pick(i, "due", "due_on", "due_date")),
    dueSaid: bool(pick(i, "due_said", "dueSaid")),
    quote: str(pick(i, "quote", "said")),
    at: atLabel(pick(i, "at", "at_seconds", "offset")),
    status: str(i.status) ?? "draft",
  };
}

function readTeam(i: unknown): TeamItem | null {
  if (!isObj(i)) return null;
  const id = str(pick(i, "scout_daily_id", "scoutDailyId", "id", "item_id"));
  const title = str(pick(i, "title", "text"));
  if (!id || !title) return null;
  return {
    id,
    owner: (str(pick(i, "owner", "who")) ?? "").trim().toLowerCase(),
    title,
    due: dayOnly(pick(i, "due", "due_on", "due_date")),
    quote: str(pick(i, "quote", "said")),
  };
}

function readDetail(d: unknown, id: string): DebriefDetail | null {
  const o = body(d, "debrief", "result", "data");
  if (!isObj(o)) return null;
  const header = readHeader(pick(o, "header") ?? o, id);
  const herRaw = pick(o, "her_items", "herItems", "her");
  const teamRaw = pick(o, "team_items", "teamItems", "team");
  const available = bool(pick(o, "transcript_available", "transcriptAvailable"));
  return {
    header,
    bullets: readBullets(pick(o, "summary", "bullets"), pick(o, "summary_text", "summaryText")),
    her: (Array.isArray(herRaw) ? herRaw : []).map(readHer).filter((x): x is HerItem => !!x),
    team: (Array.isArray(teamRaw) ? teamRaw : []).map(readTeam).filter((x): x is TeamItem => !!x),
    transcriptAvailable: available ?? !!header.meetingId,
  };
}

/* ───────────────────────── the calls the screen makes ───────────────────────── */

/** Who a to-do can be handed to, in the words the server uses: a team first name, or "her" for the client's list. */
const OWNER_WORD: Record<MoveTarget, string> = { her: "her", jared: "Jared", eli: "Eli" };

/** What Jared changed on a row. Only what changed is sent; '' clears the detail. */
export interface ItemPatch { title?: string; detail?: string; due?: string }

export const debriefApi = {
  async list(): Promise<ApiResult<DebriefRow[]>> {
    const r = await call("call_debrief_list");
    return r.ok === true ? { ok: true, data: readList(r.data) } : r;
  },

  async get(id: string): Promise<ApiResult<DebriefDetail>> {
    const r = await call("call_debrief_get", { p_id: id });
    if (r.ok === false) return r;
    const detail = readDetail(r.data, id);
    return detail ? { ok: true, data: detail } : { ok: false, error: "That debrief didn't load right. Try again." };
  },

  /** Returns the row as the server now holds it, so the screen shows what will really be sent. */
  async updateItem(item: string, patch: ItemPatch): Promise<ApiResult<HerItem | null>> {
    const r = await call("call_debrief_item_update", {
      p_item: item,
      p_title: patch.title ?? null,
      p_detail: patch.detail ?? null,
      p_due: patch.due ?? null,
    });
    if (r.ok === false) return r;
    const o = isObj(r.data) ? r.data : {};
    return { ok: true, data: readHer(pick(o, "item")) };
  },

  async removeItem(item: string): Promise<ApiResult<null>> {
    const r = await call("call_debrief_item_remove", { p_item: item });
    return r.ok === true ? { ok: true, data: null } : r;
  },

  async restoreItem(item: string): Promise<ApiResult<null>> {
    const r = await call("call_debrief_item_restore", { p_item: item });
    return r.ok === true ? { ok: true, data: null } : r;
  },

  async moveOwner(item: string, to: MoveTarget): Promise<ApiResult<null>> {
    const r = await call("call_debrief_move_owner", { p_item: item, p_to: OWNER_WORD[to] });
    return r.ok === true ? { ok: true, data: null } : r;
  },

  /** Nothing reaches the client's list until this succeeds. Returns how many actually went, and how many did not. */
  async send(id: string, items: string[]): Promise<ApiResult<{ sent: number; skipped: number }>> {
    const r = await call("call_debrief_send", { p_id: id, p_items: items });
    if (r.ok === false) return r;
    const o = isObj(r.data) ? r.data : {};
    const sent = num(pick(o, "sent", "sent_count", "count")) ?? 0;
    const skipped = Array.isArray(o.skipped) ? o.skipped.length : 0;
    return { ok: true, data: { sent, skipped } };
  },

  /** Takes the last Send back. `touched` is how many she had already started on, which stay on her list. */
  async undoSend(id: string): Promise<ApiResult<{ undone: number; touched: number }>> {
    const r = await call("call_debrief_undo_send", { p_id: id });
    if (r.ok === false) return r;
    const o = isObj(r.data) ? r.data : {};
    return { ok: true, data: { undone: num(o.undone) ?? 0, touched: num(o.touched) ?? 0 } };
  },

  async snooze(id: string): Promise<ApiResult<null>> {
    const r = await call("call_debrief_snooze", { p_id: id });
    return r.ok === true ? { ok: true, data: null } : r;
  },

  async dismiss(id: string): Promise<ApiResult<null>> {
    const r = await call("call_debrief_dismiss", { p_id: id });
    return r.ok === true ? { ok: true, data: null } : r;
  },

  /** The words of the call, from the recorder's archive (admins can read it). Null when there is none. */
  async transcript(meetingId: string): Promise<ApiResult<string | null>> {
    try {
      const { data, error } = await supabase
        .from("meeting_recordings" as never)
        .select("transcript")
        .eq("id", meetingId)
        .maybeSingle();
      if (error) return { ok: false, error: "Couldn't load the transcript. Try again." };
      const t = (data as { transcript?: string | null } | null)?.transcript;
      return { ok: true, data: typeof t === "string" && t.trim() ? t : null };
    } catch {
      return { ok: false, error: "Couldn't load the transcript. Try again." };
    }
  },
};
