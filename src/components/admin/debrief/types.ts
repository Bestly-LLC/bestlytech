/**
 * Call debrief: the shapes the admin UI works with.
 *
 * These are the UI's own shapes, not the database's. Everything that talks to the call_debrief_*
 * functions goes through api.ts, which turns whatever the server sends into these. If the server's
 * field names move, api.ts is the only file that changes.
 */

/** A debrief waiting on Jared ("pending"), or one already handled. */
export type DebriefStatus = "pending" | "sent" | "dismissed" | (string & {});

/** One line of call_debrief_list(): enough to draw the pop-up before the full debrief has loaded. */
export interface DebriefRow {
  id: string;
  clientSlug: string | null;
  clientName: string | null;
  /** The name to use in sentences: "Elizabeth", or the client's name for a test client. */
  person: string | null;
  /** A rehearsal with the test client: nothing here is a real client's. */
  sandbox: boolean;
  meetingId: string | null;
  meetingName: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  durationMin: number | null;
  createdAt: string | null;
  /** 0 to 100: how much of the call's length the transcript covers. null when unknown. */
  coverage: number | null;
  herCount: number;
  draftCount: number | null;
  teamCount: number;
  status: DebriefStatus;
  /** Set while snoozed: the debrief stays hidden until this time. */
  remindAt: string | null;
  sentAt: string | null;
  sentCount: number | null;
}

/** An item that would land on the client's list once Jared presses Send. */
export interface HerItem {
  id: string;
  title: string;
  detail: string | null;
  /** YYYY-MM-DD, or null when no date was said. */
  due: string | null;
  /** False when the call gave no date and `due` is a default Scout picked. */
  dueSaid: boolean | null;
  /** What was said in the call, word for word. */
  quote: string | null;
  /** Where in the call it was said, as the clock reads it: "12:04". */
  at: string | null;
  /**
   * draft = waiting on Jared, dropped = Jared removed it, open = on her list,
   * ours = she handed it back to the team, done = finished.
   */
  status: "draft" | "dropped" | "open" | "ours" | "done" | (string & {});
}

/** An item that belongs to Jared or Eli. It never needs Jared's OK; it can only be moved. */
export interface TeamItem {
  /** scout_daily_id: what the server wants back when this one is moved. */
  id: string;
  /** Lower case first name of the owner: "jared", "eli". */
  owner: string;
  title: string;
  due: string | null;
  quote: string | null;
}

export interface DebriefHeader {
  id: string;
  clientSlug: string | null;
  clientName: string | null;
  /** The name to use in sentences: "Elizabeth", or the client's name for a test client. */
  contactName: string | null;
  sandbox: boolean;
  meetingId: string | null;
  meetingName: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  durationMin: number | null;
  /** 0 to 100, or null when unknown. */
  coverage: number | null;
  createdAt: string | null;
  people: string[];
  status: DebriefStatus;
  remindAt: string | null;
  sentAt: string | null;
  sentCount: number | null;
  /** True only in the 10 minutes after a Send that still has untouched items. null when the server did not say. */
  canUndo: boolean | null;
  recordingUrl: string | null;
  transcriptUrl: string | null;
}

export interface DebriefDetail {
  header: DebriefHeader;
  /** The short plain-words summary, one point per entry. */
  bullets: string[];
  her: HerItem[];
  team: TeamItem[];
  transcriptAvailable: boolean;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      /** Plain words, safe to show. */
      error: string;
      /** Set when the server gave one of its own reasons (not_draft, too_late, ...): `error` is then specific. */
      code?: string;
      /** The server function does not exist yet: the whole feature stays hidden. */
      missing?: boolean;
      /** The server said no (not an admin, signed out): also stays hidden. */
      forbidden?: boolean;
    };

/** Who a to-do can be handed to. */
export type MoveTarget = "her" | "jared" | "eli";
