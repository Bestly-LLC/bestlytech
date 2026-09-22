/**
 * The partner's Nextcloud, inside the portal — no Nextcloud login, ever.
 *
 * Eli has a Nextcloud account whose password he has never seen; the partner-nc edge function signs
 * in as it server-side. So Talk, the Ops board and his cloud files open in a sheet here instead of
 * sending him to cloud.bestly.tech, where he would be asked to log in.
 *   TalkSheet    his conversations with Jared; messages he sends are his own
 *   BoardSheet   the Ops board, read-only
 *   CloudSheet   his cloud files, with the in-page previewer
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, Folder, Loader2, Send } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { DocPreview, kindOf, type PreviewFile } from "@/components/DocPreview";
import { cn } from "@/lib/utils";

const PT = { timeZone: "America/Los_Angeles" } as const;
const asRoster = () => new URLSearchParams(window.location.search).get("as")?.toLowerCase() || undefined;

export async function nc<T = any>(action: string, body: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke("partner-nc", { body: { action, as: asRoster(), ...body } });
  if (error) return { ok: false, error: error.message } as T & { ok: boolean; error?: string };
  return data as T & { ok: boolean; error?: string };
}

function Shell({ title, sub, open, onOpenChange, children }: { title: string; sub: string; open: boolean; onOpenChange: (o: boolean) => void; children: React.ReactNode }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 border-white/10 bg-[#0b0d12] p-0 text-white sm:max-w-xl bento:bg-[#F3F2EE]">
        <div className="border-b border-white/[0.06] px-5 pb-3 pt-6 bento:border-black/5">
          <SheetTitle className="text-lg font-semibold text-white">{title}</SheetTitle>
          <SheetDescription className="text-sm text-white/55">{sub}</SheetDescription>
        </div>
        {children}
      </SheetContent>
    </Sheet>
  );
}
const Empty = ({ children }: { children: React.ReactNode }) => <p className="p-6 text-center text-sm text-white/50">{children}</p>;
const Spin = () => <div className="grid flex-1 place-items-center p-10"><Loader2 className="h-6 w-6 animate-spin text-white/40" /></div>;

/* ───────── Talk ───────── */

type Room = { token: string; label: string; unread: number; last_at: string | null; preview: string | null };
type Msg = { id: number; actor_id: string; actor_name: string; body: string; system: string | null; sent_at: string };

export function useTalkUnread(enabled: boolean) {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let gone = false;
    const load = async () => {
      const r = await nc<{ rooms: Room[] }>("rooms");
      if (!gone && r?.ok) setUnread((r.rooms ?? []).reduce((n, x) => n + (x.unread ?? 0), 0));
    };
    load();
    const t = window.setInterval(() => { if (!document.hidden) load(); }, 120_000);
    return () => { gone = true; window.clearInterval(t); };
  }, [enabled]);
  return unread;
}

export function TalkSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [me, setMe] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cursor = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) { setRoom(null); setMsgs(null); return; }
    nc<{ rooms: Room[]; call_room: string | null }>("rooms").then((r) => {
      if (!r?.ok) { setErr(r?.error ?? "Couldn't reach Talk"); setRooms([]); return; }
      setRooms(r.rooms ?? []);
      const first = (r.rooms ?? []).find((x) => x.token === r.call_room) ?? r.rooms?.[0] ?? null;
      setRoom(first);
    });
  }, [open]);

  const load = useCallback(async (token: string, since = 0) => {
    const r = await nc<{ messages: Msg[]; cursor: number; me: string }>("sync", { room: token, since, limit: 80 });
    if (!r?.ok) { setErr(r?.error ?? "Couldn't read that conversation"); return; }
    setErr(null); setMe(r.me ?? "");
    cursor.current = r.cursor ?? since;
    setMsgs((old) => (since ? [...(old ?? []), ...(r.messages ?? [])] : (r.messages ?? [])));
    if (r.messages?.length) nc("read", { room: token, id: r.messages[r.messages.length - 1].id });
  }, []);

  useEffect(() => {
    if (!room) return;
    cursor.current = 0; setMsgs(null);
    load(room.token);
    const t = window.setInterval(() => { if (!document.hidden && cursor.current) load(room.token, cursor.current); }, 12_000);
    return () => window.clearInterval(t);
  }, [room, load]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [msgs?.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !room) return;
    setBusy(true);
    const r = await nc<{ message: Msg }>("send", { room: room.token, message: text });
    setBusy(false);
    if (!r?.ok) { setErr(r?.error === "rate_limited" ? "Too fast — try again in a moment." : "That didn't send."); return; }
    setDraft(""); setErr(null);
    if (r.message) { setMsgs((m) => [...(m ?? []), r.message]); cursor.current = r.message.id; }
  };

  return (
    <Shell open={open} onOpenChange={onOpenChange} title={room ? room.label : "Talk"} sub={room ? "Messages here are yours, under your own name." : "Your conversations with Jared."}>
      {rooms === null ? <Spin /> : !room ? (
        rooms.length === 0 ? <Empty>No conversations yet.</Empty> : (
          <ul className="flex-1 divide-y divide-white/[0.06] overflow-y-auto">
            {rooms.map((r) => (
              <li key={r.token}>
                <button onClick={() => setRoom(r)} className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-white/[0.04]">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2"><span className="truncate font-medium">{r.label}</span>
                      {r.unread > 0 && <span className="rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-[#fff]">{r.unread}</span>}</span>
                    {r.preview && <span className="mt-0.5 line-clamp-1 block text-xs text-white/45">{r.preview}</span>}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-white/30" />
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          {rooms.length > 1 && (
            <button onClick={() => setRoom(null)} className="flex items-center gap-1 px-5 py-2 text-sm text-[#0A84FF]"><ArrowLeft className="h-4 w-4" /> All conversations</button>
          )}
          <div className="flex-1 space-y-2.5 overflow-y-auto px-5 py-3">
            {msgs === null ? <Spin /> : msgs.length === 0 ? <Empty>No messages yet. Say hello.</Empty> : msgs.map((m) => {
              const mine = m.actor_id === me;
              if (m.system) return <p key={m.id} className="py-1 text-center text-xs text-white/35">{m.body}</p>;
              return (
                <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[0.95rem] leading-relaxed",
                    mine ? "bg-[#0A84FF] text-[#fff]" : "bg-white/[0.07] text-white bento:bg-[#fff] bento:text-black")}>
                    {!mine && <p className="mb-0.5 text-xs font-semibold text-white/60 bento:text-black/50">{m.actor_name}</p>}
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    <p className={cn("mt-1 text-[11px]", mine ? "text-[#fff]/70" : "text-white/35")}>
                      {new Date(m.sent_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...PT })}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={bottom} />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-end gap-2 border-t border-white/[0.06] p-4 bento:border-black/5">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={1} placeholder="Message"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              className="max-h-32 min-h-[48px] flex-1 resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-[16px] text-white outline-none placeholder:text-white/35 focus:border-white/30 bento:border-black/10 bento:bg-[#fff]" />
            <button type="submit" disabled={!draft.trim() || busy} aria-label="Send"
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-black disabled:opacity-40 bento:bg-[#111114] bento:text-[#fff]">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </form>
        </>
      )}
      {err && <p role="alert" className="px-5 pb-4 text-sm text-red-400">{err}</p>}
    </Shell>
  );
}

/* ───────── Ops board ───────── */

type Card = { id: number; title: string; description: string; due: string | null; labels: { title: string; color: string }[]; people: string[] };
type Stack = { id: number; title: string; cards: Card[] };

export function BoardSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [stacks, setStacks] = useState<Stack[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setStacks(null);
    nc<{ stacks: Stack[] }>("deck").then((r) => { if (r?.ok) setStacks(r.stacks ?? []); else { setErr(r?.error ?? "Couldn't load the board"); setStacks([]); } });
  }, [open]);
  return (
    <Shell open={open} onOpenChange={onOpenChange} title="Ops board" sub="What's moving at Bestly. Read-only here.">
      {stacks === null ? <Spin /> : (
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {err && <p className="text-sm text-red-400">{err}</p>}
          {stacks.map((s) => (
            <section key={s.id}>
              <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-white/45">
                {s.title} <span className="rounded-full bg-white/[0.07] px-1.5 text-[11px] text-white/55">{s.cards.length}</span>
              </h3>
              {s.cards.length === 0 ? <p className="text-sm text-white/35">Nothing here.</p> : (
                <ul className="space-y-2">
                  {s.cards.map((c) => (
                    <li key={c.id} className="rounded-2xl bg-white/[0.04] p-3.5 bento:bg-[#fff]">
                      <p className="text-[0.95rem] font-medium">{c.title}</p>
                      {c.description && <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-white/55">{c.description}</p>}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {c.labels.map((l) => (
                          <span key={l.title} className="rounded-full px-2 py-0.5 text-[11px] font-medium text-[#fff]" style={{ background: `#${l.color}` }}>{l.title}</span>
                        ))}
                        {c.people.map((p) => <span key={p} className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[11px] text-white/70">{p}</span>)}
                        {c.due && <span className="text-[11px] text-amber-300">Due {new Date(c.due).toLocaleDateString("en-US", { month: "short", day: "numeric", ...PT })}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </Shell>
  );
}

/* ───────── Cloud files ───────── */

type Item = { path: string; name: string; dir: boolean; type: string | null; size: number; modified: string | null };
const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export function CloudSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [path, setPath] = useState("/");
  const [items, setItems] = useState<Item[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewFile | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => { if (open) setPath("/"); }, [open]);
  useEffect(() => {
    if (!open) return;
    setItems(null);
    nc<{ items: Item[] }>("files", { path }).then((r) => { if (r?.ok) { setItems(r.items ?? []); setErr(null); } else { setErr(r?.error ?? "Couldn't open that folder"); setItems([]); } });
  }, [open, path]);

  // The file comes back as bytes from the function (his account, signed in server-side), so the
  // previewer gets a blob URL — no Nextcloud link, no login.
  const openFile = async (it: Item) => {
    setOpening(it.path);
    const { data, error } = await supabase.functions.invoke("partner-nc", { body: { action: "file", as: asRoster(), path: it.path } });
    setOpening(null);
    if (error) { setErr("Couldn't open that file."); return; }
    const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: it.type ?? "application/octet-stream" });
    setPreview({ name: it.name, type: it.type ?? blob.type, url: URL.createObjectURL(blob) });
  };

  const up = path === "/" ? null : path.replace(/\/[^/]+$/, "") || "/";
  return (
    <>
      <Shell open={open} onOpenChange={onOpenChange} title="Cloud files" sub={path === "/" ? "Your folders on cloud.bestly.tech." : path}>
        {up !== null && (
          <button onClick={() => setPath(up)} className="flex items-center gap-1 px-5 py-2 text-sm text-[#0A84FF]"><ArrowLeft className="h-4 w-4" /> Back</button>
        )}
        {items === null ? <Spin /> : items.length === 0 ? <Empty>{err ?? "This folder is empty."}</Empty> : (
          <ul className="flex-1 divide-y divide-white/[0.06] overflow-y-auto">
            {items.map((it) => (
              <li key={it.path}>
                <button onClick={() => (it.dir ? setPath(it.path) : openFile(it))} disabled={opening === it.path}
                  className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-white/[0.04] disabled:opacity-60">
                  <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white/70",
                    it.dir ? "bg-sky-500/15 text-sky-300" : kindOf(it.name, it.type) === "image" ? "bg-violet-500/15 text-violet-300" : "bg-white/[0.07]")}>
                    {opening === it.path ? <Loader2 className="h-4 w-4 animate-spin" /> : <Folder className={cn("h-[18px] w-[18px]", !it.dir && "hidden")} />}
                    {!it.dir && opening !== it.path && <span className="text-[10px] font-bold uppercase">{(it.name.split(".").pop() ?? "").slice(0, 4)}</span>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{it.name}</span>
                    <span className="block text-xs text-white/45">{it.dir ? "Folder" : size(it.size)}{it.modified ? ` · ${new Date(it.modified).toLocaleDateString("en-US", { month: "short", day: "numeric", ...PT })}` : ""}</span>
                  </span>
                  {it.dir && <ChevronRight className="h-4 w-4 shrink-0 text-white/30" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Shell>
      <DocPreview file={preview} onClose={() => { if (preview?.url) URL.revokeObjectURL(preview.url); setPreview(null); }} />
    </>
  );
}

/* ───────── Calendar ───────── */

type Ev = { title: string; start: string; end: string | null; all_day: boolean; join_url: string | null; location: string | null; calendar: string };

export function CalendarSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [events, setEvents] = useState<Ev[] | null>(null);
  useEffect(() => {
    if (!open) return;
    setEvents(null);
    supabase.functions.invoke("next-meeting", { body: {} }).then(({ data }) => setEvents((data?.events ?? []) as Ev[]));
  }, [open]);
  const when = (e: Ev) => new Date(e.start).toLocaleString("en-US", e.all_day
    ? { weekday: "short", month: "short", day: "numeric", ...PT }
    : { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...PT });
  return (
    <Shell open={open} onOpenChange={onOpenChange} title="Calendar" sub="What's booked with you over the next week.">
      {events === null ? <Spin /> : events.length === 0 ? <Empty>Nothing booked with you this week.</Empty> : (
        <ul className="flex-1 divide-y divide-white/[0.06] overflow-y-auto">
          {events.map((e, i) => (
            <li key={i} className="px-5 py-3.5">
              <p className="text-[0.95rem] font-medium">{e.title}</p>
              <p className="mt-0.5 text-sm text-white/50">{when(e)}{e.location ? ` · ${e.location}` : ""}</p>
              {e.join_url && (
                <a href={e.join_url} target="_blank" rel="noreferrer"
                  className="mt-2 inline-flex h-9 items-center rounded-full bg-white px-4 text-sm font-semibold text-black bento:bg-[#111114] bento:text-[#fff]">Join</a>
              )}
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
