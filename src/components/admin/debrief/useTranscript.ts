/**
 * The words of the call, fetched the first time Jared asks to read them (never up front: a 47-minute call is a lot of text).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { debriefApi } from "./api";
import type { TranscriptState } from "./DebriefPanel";

const IDLE: TranscriptState = { status: "idle", text: null, error: null };

export function useTranscript(meetingId: string | null, wanted: boolean) {
  const [state, setState] = useState<TranscriptState>(IDLE);
  const loadedFor = useRef<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!meetingId) return;
    const mine = ++seq.current;
    setState({ status: "loading", text: null, error: null });
    const r = await debriefApi.transcript(meetingId);
    if (mine !== seq.current) return;
    loadedFor.current = r.ok === true ? meetingId : null;
    setState(r.ok === true ? { status: "ready", text: r.data, error: null } : { status: "error", text: null, error: r.error });
  }, [meetingId]);

  // A different call: forget the old words.
  useEffect(() => {
    seq.current += 1;
    loadedFor.current = null;
    setState(IDLE);
  }, [meetingId]);

  useEffect(() => {
    if (!wanted) return;
    // The server did not say which recording this is: the transcript can only be opened in Nextcloud.
    if (!meetingId) { setState({ status: "external", text: null, error: null }); return; }
    if (loadedFor.current !== meetingId && state.status === "idle") void load();
  }, [wanted, meetingId, load, state.status]);

  return { transcript: state, retry: load };
}
