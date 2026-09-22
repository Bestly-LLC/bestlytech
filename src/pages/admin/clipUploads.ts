/**
 * Clip uploads, held outside React.
 *
 * A dropped clip can be 80MB and take a minute. If the upload lived in the Clips
 * page's state it would die the moment Jared clicked another tab, which is exactly
 * how "Upload failed: ... Load failed" happens. So the queue is a module singleton:
 * the page mounts and unmounts around it, the transfers keep going, and the header
 * pill (ClipActivity) reads the same store from anywhere in the admin.
 *
 * XHR rather than supabase-js storage.upload because we want real progress events.
 */
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = "https://rcqfqhguwpmaarseifqg.supabase.co";
const BUCKET = "voice-clips";

export type ClipUpload = {
  id: string;
  name: string;
  bytes: number;
  sent: number;
  /** 0-1, or null before the first progress event */
  pct: number | null;
  status: "uploading" | "saving" | "done" | "error";
  error?: string;
  startedAt: number;
};

type Listener = (items: ClipUpload[]) => void;

const items = new Map<string, ClipUpload>();
const listeners = new Set<Listener>();
const xhrs = new Map<string, XMLHttpRequest>();

const snapshot = () => [...items.values()].sort((a, b) => a.startedAt - b.startedAt);
const emit = () => {
  const s = snapshot();
  for (const fn of listeners) fn(s);
};

export function subscribeClipUploads(fn: Listener) {
  listeners.add(fn);
  fn(snapshot());
  return () => {
    listeners.delete(fn);
  };
}

export const activeUploads = () => snapshot().filter((u) => u.status === "uploading" || u.status === "saving");

/** Clear a finished row (done or error). In-flight rows ignore this. */
export function dismissUpload(id: string) {
  const u = items.get(id);
  if (!u || u.status === "uploading" || u.status === "saving") return;
  items.delete(id);
  emit();
}

export function cancelUpload(id: string) {
  xhrs.get(id)?.abort();
  xhrs.delete(id);
  items.delete(id);
  emit();
}

/** Called when a clip row lands, so the Clips page can refresh without polling. */
export const CLIPS_CHANGED = "bestly:clips-changed";
const changed = () => window.dispatchEvent(new Event(CLIPS_CHANGED));

// Warn before closing the tab while bytes are still moving. Navigating inside the
// admin is fine - only a real unload kills the transfer.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (!activeUploads().length) return;
    e.preventDefault();
    e.returnValue = "";
  });
}

function put(url: string, token: string, file: File, up: ClipUpload): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhrs.set(up.id, xhr);
    xhr.open("POST", url, true);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("x-upsert", "false");
    if (file.type) xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      up.sent = e.loaded;
      up.pct = e.total ? e.loaded / e.total : null;
      emit();
    };
    xhr.onload = () => {
      xhrs.delete(up.id);
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = `${xhr.status}`;
      try {
        const b = JSON.parse(xhr.responseText);
        msg = b.message || b.error || msg;
      } catch {
        if (xhr.responseText) msg = xhr.responseText.slice(0, 200);
      }
      // The one people actually hit: the file is bigger than the bucket allows.
      if (xhr.status === 413) msg = "too big for the bucket";
      reject(new Error(msg));
    };
    xhr.onerror = () => {
      xhrs.delete(up.id);
      reject(new Error("the connection dropped"));
    };
    xhr.onabort = () => {
      xhrs.delete(up.id);
      reject(new Error("cancelled"));
    };
    xhr.send(file);
  });
}

/** Queue one file. Returns once it's finished, but nothing needs to await it. */
export async function startClipUpload(file: File) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const up: ClipUpload = {
    id, name: file.name, bytes: file.size, sent: 0, pct: null,
    status: "uploading", startedAt: Date.now(),
  };
  items.set(id, up);
  emit();

  try {
    const { data: s } = await supabase.auth.getSession();
    const token = s.session?.access_token;
    if (!token) throw new Error("signed out");

    const clean = file.name.replace(/[^\w.\- ]+/g, "").slice(-120) || "clip.m4a";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const path = `upload/${stamp}-${clean}`;

    await put(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(path)}`, token, file, up);

    up.status = "saving";
    up.pct = 1;
    emit();

    const { error } = await supabase.from("voice_clips").insert({
      title: clean.replace(/\.[^.]+$/, ""),
      path,
      bytes: file.size,
      source: "upload",
      recorded_at: file.lastModified ? new Date(file.lastModified).toISOString() : null,
    });
    if (error) throw error;

    up.status = "done";
    emit();
    changed();
    // A finished row clears itself; an error stays until it's dismissed.
    setTimeout(() => dismissUpload(id), 4000);
  } catch (e) {
    if (!items.has(id)) return;            // cancelled
    up.status = "error";
    up.error = e instanceof Error ? e.message : String(e);
    emit();
    changed();
  }
}
