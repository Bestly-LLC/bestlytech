/**
 * One debrief open on screen: what it contains, which of her items are ticked to send, the row being edited,
 * and the small actions on a row (remove, put back, move to someone else).
 *
 * Changes show at once and the server catches up behind them; if the server says no, the row goes back to
 * how it was and the host shows one plain error. Nothing here sends anything to the client: that is
 * `send()` in the host, after Jared presses the button.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { debriefApi, type ItemPatch } from "./api";
import type { DebriefDetail, HerItem, MoveTarget } from "./types";

export interface EditDraft { title: string; detail: string; due: string }

/** Which of her items Jared un-ticked, per debrief. Lives for the page, so closing and re-opening keeps his choices. */
const unticked = new Map<string, Set<string>>();

export function useReview(id: string | null, onError: (message: string) => void) {
  const [detail, setDetail] = useState<DebriefDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, bump] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  /** Why the row being edited could not be saved, shown right under its text (not in a toast somewhere else). */
  const [editError, setEditError] = useState<string | null>(null);
  const [moving, setMoving] = useState<ReadonlySet<string>>(new Set());

  const editingRef = useRef<string | null>(null);
  const draftRef = useRef<EditDraft | null>(null);
  /** The latest commitEdit, so startEdit can save the row being left without depending on it. */
  const commitEditRef = useRef<() => Promise<boolean>>(async () => true);
  const detailRef = useRef<DebriefDetail | null>(null);
  const idRef = useRef<string | null>(id);
  const seq = useRef(0);
  idRef.current = id;
  detailRef.current = detail;

  const setEditing = (rowId: string | null, d: EditDraft | null) => {
    editingRef.current = rowId;
    draftRef.current = d;
    setEditingId(rowId);
    setDraft(d);
  };

  const load = useCallback(async (quiet = false) => {
    const mine = ++seq.current;
    const target = idRef.current;
    if (!target) return;
    if (!quiet) { setLoading(true); setError(null); }
    const r = await debriefApi.get(target);
    if (mine !== seq.current || idRef.current !== target) return; // a newer request or another debrief took over
    setLoading(false);
    if (r.ok === true) { setDetail(r.data); setError(null); }
    else if (!quiet || !detailRef.current) setError(r.error);
  }, []);

  // A different debrief: start clean.
  useEffect(() => {
    seq.current += 1;
    setDetail(null);
    setError(null);
    setEditing(null, null);
    setEditError(null);
    setMoving(new Set());
    if (id) void load();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, load]);

  /* ── which of her items are ticked ── */
  const off = id ? unticked.get(id) : undefined;
  const isChecked = useCallback((itemId: string) => !(id && unticked.get(id)?.has(itemId)), [id]);
  const toggle = useCallback((itemId: string) => {
    if (!id) return;
    const set = new Set(unticked.get(id) ?? []);
    if (set.has(itemId)) set.delete(itemId); else set.add(itemId);
    unticked.set(id, set);
    bump((n) => n + 1);
  }, [id]);
  /** Put the ticks back the way they were for a given send (used by Undo send). */
  const restoreTicks = useCallback((debriefId: string, sentIds: string[], allIds: string[]) => {
    const sent = new Set(sentIds);
    unticked.set(debriefId, new Set(allIds.filter((x) => !sent.has(x))));
    bump((n) => n + 1);
  }, []);

  const selectedIds = useMemo(
    () => (detail?.her ?? []).filter((i) => i.status === "draft" && !off?.has(i.id)).map((i) => i.id),
    [detail, off],
  );

  /* ── small helpers on the loaded debrief ── */
  const patchHer = useCallback((itemId: string, patch: Partial<HerItem>) => {
    setDetail((d) => (d ? { ...d, her: d.her.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) } : d));
  }, []);

  /* ── editing one of her items ── */
  const startEdit = useCallback((item: HerItem) => {
    if (editingRef.current && editingRef.current !== item.id) void commitEditRef.current();
    setEditError(null);
    setEditing(item.id, { title: item.title, detail: item.detail ?? "", due: item.due ?? "" });
  }, []);
  const changeDraft = useCallback((patch: Partial<EditDraft>) => {
    const next = { ...(draftRef.current ?? { title: "", detail: "", due: "" }), ...patch };
    draftRef.current = next;
    setDraft(next);
    setEditError(null);
  }, []);
  const cancelEdit = useCallback(() => { setEditError(null); setEditing(null, null); }, []);

  /** Saves the row being edited. False means it did not save (the editor stays open with what was typed). */
  const commitEdit = useCallback(async (): Promise<boolean> => {
    const rowId = editingRef.current;
    const d = draftRef.current;
    const startedOn = idRef.current;
    const item = detailRef.current?.her.find((i) => i.id === rowId);
    if (!rowId || !d || !item) { setEditing(null, null); return true; }
    const title = d.title.trim();
    if (!title) { setEditing(null, null); return true; } // an empty title is ignored: the old words stay
    const detail = d.detail.trim();
    // Only what changed goes to the server. A cleared date is not a change: a date cannot be emptied here.
    const patch: ItemPatch = {};
    if (title !== item.title) patch.title = title;
    if (detail !== (item.detail ?? "")) patch.detail = detail;
    if (d.due && d.due !== item.due) patch.due = d.due;
    if (Object.keys(patch).length === 0) { setEditing(null, null); return true; }

    const before = { title: item.title, detail: item.detail, due: item.due, dueSaid: item.dueSaid };
    patchHer(rowId, {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.detail !== undefined ? { detail: patch.detail || null } : {}),
      ...(patch.due !== undefined ? { due: patch.due, dueSaid: true } : {}),
    });
    setEditing(null, null);
    const r = await debriefApi.updateItem(rowId, patch);
    if (r.ok === true) {
      setEditError(null);
      // Show what the server now holds, so what is on screen is what will be sent.
      if (r.data) patchHer(rowId, { title: r.data.title, detail: r.data.detail, due: r.data.due });
      return true;
    }
    patchHer(rowId, before);
    const why = r.code ? r.error : "Couldn't save that change. Try again.";
    if (idRef.current !== startedOn) { onError(why); return false; } // the sheet was closed meanwhile: nowhere to show it inline
    setEditing(rowId, d); // keep what was typed
    setEditError(why);
    return false;
  }, [onError, patchHer]);
  commitEditRef.current = commitEdit;

  /* ── remove, put back, move ── */
  const remove = useCallback(async (item: HerItem) => {
    if (editingRef.current === item.id) setEditing(null, null);
    patchHer(item.id, { status: "dropped" });
    const r = await debriefApi.removeItem(item.id);
    if (r.ok === false) { patchHer(item.id, { status: item.status }); onError(r.code ? r.error : "Couldn't remove that. Try again."); }
  }, [onError, patchHer]);

  const restore = useCallback(async (item: HerItem) => {
    patchHer(item.id, { status: "draft" });
    const r = await debriefApi.restoreItem(item.id);
    if (r.ok === false) { patchHer(item.id, { status: "dropped" }); onError(r.code ? r.error : "Couldn't put that back. Try again."); }
  }, [onError, patchHer]);

  const move = useCallback(async (itemId: string, to: MoveTarget) => {
    if (editingRef.current === itemId) setEditing(null, null);
    setMoving((s) => new Set(s).add(itemId));
    const r = await debriefApi.moveOwner(itemId, to);
    if (r.ok === true) await load(true);
    else onError(r.code ? r.error : "Couldn't move that. Try again.");
    setMoving((s) => { const n = new Set(s); n.delete(itemId); return n; });
  }, [load, onError]);

  return {
    detail, loading, error, reload: () => load(), reloadQuiet: () => load(true),
    isChecked, toggle, restoreTicks, selectedIds,
    editingId, draft, editError, startEdit, changeDraft, cancelEdit, commitEdit,
    remove, restore, move, moving,
  };
}

export type Review = ReturnType<typeof useReview>;
