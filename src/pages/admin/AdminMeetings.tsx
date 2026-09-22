import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

import { PageHeader } from "@/components/admin/PageHeader";
import { StatCard } from "@/components/admin/StatCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertTriangle,
  Clock,
  FileText,
  Mic,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
  Users,
  Calendar,
  MessageSquare,
} from "lucide-react";

type Speaker = { name: string; lines: number; share: number };

type Meeting = {
  id: string;
  day: string;
  startedAt: string | null;
  transcriptFile: string | null;
  usingNamed: boolean;
  hasAudio: boolean;
  totalBytes: number;
  files: { name: string; size: number }[];
  durationSeconds: number | null;
  lineCount: number;
  speakers: Speaker[];
  voiceConfirmed: number | null;
  inherited: number | null;
  assumed: number | null;
  diarizationSuspect: boolean;
  diarizationReasons: string[];
};

function fmtDuration(secs: number | null) {
  if (!secs) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtDate(iso: string | null, day: string) {
  const d = iso ? new Date(iso) : new Date(`${day}T00:00:00`);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtBytes(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
}

/**
 * Speaker labels come from the diarizer, which sometimes fails outright — a
 * phone call where the system audio track barely recorded produces a transcript
 * where every line is attributed to one person. That is a recording failure, not
 * a monologue, so participants are shown with an explicit warning rather than
 * being presented as fact.
 */
function ParticipantList({ m }: { m: Meeting }) {
  if (!m.speakers.length) {
    return <span className="text-white/30 text-xs">no transcript</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {m.speakers.map((s) => (
        <Badge
          key={s.name}
          variant="outline"
          className={
            m.diarizationSuspect
              ? "border-amber-500/30 text-amber-300/80 bg-amber-500/[0.06] font-normal"
              : "border-white/15 text-white/60 bg-white/[0.04] font-normal"
          }
        >
          {s.name}
          <span className="ml-1.5 text-white/30 tabular-nums">
            {Math.round(s.share * 100)}%
          </span>
        </Badge>
      ))}
    </div>
  );
}

export default function AdminMeetings() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  // transcript dialog
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<Meeting | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [textLoading, setTextLoading] = useState(false);

  // rename dialog
  const [renameTarget, setRenameTarget] = useState<Meeting | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);

  // delete dialog
  const [deleteTarget, setDeleteTarget] = useState<Meeting | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase.functions.invoke("meetings-archive", {
      body: { op: "list" },
    });
    if (error) {
      setErr(error.message ?? "Could not reach the meeting archive.");
      setRows([]);
    } else if (data?.error) {
      setErr(data.message ?? data.error);
      setRows([]);
    } else {
      setRows(data?.meetings ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startRename = (m: Meeting) => {
    setRenameTarget(m);
    setRenameValue(m.id);
  };

  const commitRename = async () => {
    if (!renameTarget) return;
    const newId = renameValue.trim();
    if (!newId || newId === renameTarget.id) { setRenameTarget(null); return; }
    if (!/^meeting-\d{8}-\d{4}$/.test(newId)) {
      toast({ title: "Invalid ID", description: "Format must be meeting-YYYYMMDD-HHMM", variant: "destructive" });
      return;
    }
    setRenaming(true);
    const { data, error } = await supabase.functions.invoke("meetings-archive", {
      body: { op: "rename", day: renameTarget.day, oldId: renameTarget.id, newId },
    });
    setRenaming(false);
    if (error || data?.error) {
      toast({ title: "Rename failed", description: error?.message ?? data?.error, variant: "destructive" });
      return;
    }
    setRows((prev) =>
      prev.map((r) =>
        r.id === renameTarget.id
          ? { ...r, id: newId, transcriptFile: r.transcriptFile?.replace(renameTarget.id, newId) ?? null }
          : r,
      ),
    );
    setRenameTarget(null);
    toast({ title: "Renamed", description: `${renameTarget.id} → ${newId}` });
  };

  const commitDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { data, error } = await supabase.functions.invoke("meetings-archive", {
      body: { op: "delete", day: deleteTarget.day, id: deleteTarget.id },
    });
    setDeleting(false);
    // supabase.functions.invoke puts non-2xx bodies in `error.context`;
    // parse the JSON there so we can show the real message.
    if (error || data?.error) {
      let desc = data?.message ?? data?.error ?? error?.message ?? "Unknown error";
      if (!data && error?.context) {
        try {
          const ctx = typeof error.context === "string" ? JSON.parse(error.context) : error.context;
          desc = ctx?.message ?? ctx?.error ?? desc;
        } catch { /* ignore */ }
      }
      toast({ title: "Delete failed", description: desc, variant: "destructive" });
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== deleteTarget.id));
    setDeleteTarget(null);
    toast({ title: "Deleted", description: deleteTarget.id });
  };

  const debriefMeeting = (m: Meeting) => {
    const msg = `Debrief my call ${m.id}: the decisions, who owes what, and the follow-ups.`;
    // Post into the Scout chat input if possible, else copy to clipboard.
    const input = document.querySelector<HTMLTextAreaElement>("[data-scout-input]");
    if (input) {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      nativeSetter?.call(input, msg);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    } else {
      navigator.clipboard.writeText(msg).catch(() => {});
      toast({ title: "Copied to clipboard", description: "Paste into Scout to debrief." });
    }
  };

  const openTranscript = async (m: Meeting) => {
    if (!m.transcriptFile) return;
    setActive(m);
    setOpen(true);
    setText(null);
    setTextLoading(true);
    const { data, error } = await supabase.functions.invoke("meetings-archive", {
      body: { op: "transcript", day: m.day, file: m.transcriptFile },
    });
    setTextLoading(false);
    if (error || data?.error) {
      toast({
        title: "Could not load transcript",
        description: error?.message ?? data?.error ?? "Unknown error",
        variant: "destructive",
      });
      setOpen(false);
      return;
    }
    setText(data.text ?? "");
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (m) =>
        m.id.toLowerCase().includes(needle) ||
        m.day.includes(needle) ||
        m.speakers.some((s) => s.name.toLowerCase().includes(needle)),
    );
  }, [rows, q]);

  const stats = useMemo(() => {
    const totalSecs = rows.reduce((n, m) => n + (m.durationSeconds ?? 0), 0);
    return {
      count: rows.length,
      hours: Math.round((totalSecs / 3600) * 10) / 10,
      suspect: rows.filter((m) => m.diarizationSuspect).length,
      bytes: rows.reduce((n, m) => n + m.totalBytes, 0),
    };
  }, [rows]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meetings"
        description="Recorded calls synced from this Mac to Nextcloud. Transcripts are read live from the archive."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={loading}
            className="border-white/10 text-white/70 hover:text-white"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Meetings" value={stats.count} icon={Mic} />
        <StatCard label="Recorded" value={`${stats.hours}h`} icon={Clock} />
        <StatCard
          label="Needs review"
          value={stats.suspect}
          icon={AlertTriangle}
          accentColor={stats.suspect > 0 ? "#f59e0b" : undefined}
          iconBg={stats.suspect > 0 ? "bg-amber-500/10" : undefined}
          iconColor={stats.suspect > 0 ? "text-amber-400" : undefined}
          tooltip="Meetings where speaker labelling looks unreliable."
        />
        <StatCard label="Archive size" value={fmtBytes(stats.bytes)} icon={FileText} />
      </div>

      {err && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-4">
          <p className="text-sm text-red-300 font-medium">
            Could not load the meeting archive
          </p>
          <p className="text-xs text-red-300/70 mt-1">{err}</p>
        </div>
      )}

      <Input
        placeholder="Filter by date or participant…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="max-w-sm bg-white/[0.03] border-white/[0.08] text-white placeholder:text-white/25"
      />

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl bg-white/[0.04]" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-10 text-center">
          <Calendar className="h-8 w-8 text-white/15 mx-auto mb-3" />
          <p className="text-sm text-white/40">
            {rows.length === 0 ? "No meetings in the archive yet." : "No meetings match that filter."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((m) => (
            <div
              key={m.id}
              className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 sm:p-5 hover:bg-white/[0.05] transition-colors"
            >
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                <div className="min-w-0 space-y-2.5">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="text-white font-medium">
                      {fmtDate(m.startedAt, m.day)}
                    </span>
                    <span className="text-white/30">·</span>
                    <span className="text-white/50 text-sm tabular-nums">
                      {fmtTime(m.startedAt)}
                    </span>
                    <Badge
                      variant="outline"
                      className="border-white/15 text-white/50 bg-white/[0.04] font-normal tabular-nums"
                    >
                      <Clock className="h-3 w-3 mr-1" />
                      {fmtDuration(m.durationSeconds)}
                    </Badge>
                    {m.diarizationSuspect && (
                      <Badge className="border-amber-500/40 text-amber-300 bg-amber-500/[0.12] font-normal hover:bg-amber-500/[0.12]">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        Speaker labels unreliable
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-start gap-2">
                    <Users className="h-3.5 w-3.5 text-white/25 mt-1 shrink-0" />
                    <ParticipantList m={m} />
                  </div>

                  {m.diarizationSuspect && (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2">
                      <p className="text-[11px] text-amber-300/90 leading-relaxed">
                        <span className="font-medium">
                          Do not trust who said what in this transcript.
                        </span>{" "}
                        {m.diarizationReasons.join("; ")}. The words are still
                        accurate — only the speaker attribution failed, usually
                        because the far end came through a phone rather than the
                        system audio track.
                      </p>
                    </div>
                  )}

                  <p className="text-[11px] text-white/25 tabular-nums">
                    {m.id} · {m.lineCount.toLocaleString()} lines ·{" "}
                    {fmtBytes(m.totalBytes)}
                    {m.hasAudio && " · audio archived"}
                    {m.voiceConfirmed !== null &&
                      ` · ${m.voiceConfirmed} voice-confirmed`}
                  </p>
                </div>

                <div className="shrink-0 flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!m.transcriptFile}
                    onClick={() => openTranscript(m)}
                    className="border-white/10 text-white/70 hover:text-white"
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    Read transcript
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-white/40 hover:text-white hover:bg-white/[0.06]"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem
                        disabled={!m.transcriptFile}
                        onClick={() => openTranscript(m)}
                      >
                        <FileText className="h-4 w-4 mr-2" />
                        Read transcript
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => debriefMeeting(m)}>
                        <MessageSquare className="h-4 w-4 mr-2" />
                        Debrief with Scout
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => startRename(m)}>
                        <Pencil className="h-4 w-4 mr-2" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-red-400 focus:text-red-400"
                        onClick={() => setDeleteTarget(m)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Rename dialog */}
      <Dialog open={!!renameTarget} onOpenChange={(o) => { if (!o) setRenameTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rename meeting</DialogTitle>
            <DialogDescription className="text-xs">
              Must stay in meeting-YYYYMMDD-HHMM format. All files in the archive are moved.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commitRename(); }}
            className="bg-white/[0.03] border-white/[0.08] text-white"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameTarget(null)} disabled={renaming}>
              Cancel
            </Button>
            <Button onClick={commitRename} disabled={renaming}>
              {renaming ? "Renaming…" : "Rename"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete meeting?</DialogTitle>
            <DialogDescription>
              This permanently removes all files for {deleteTarget?.id} from Nextcloud. There is no undo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={commitDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {active ? fmtDate(active.startedAt, active.day) : "Transcript"}
              {active && (
                <span className="text-white/40 font-normal ml-2 text-sm">
                  {fmtTime(active.startedAt)} · {fmtDuration(active.durationSeconds)}
                </span>
              )}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {active?.transcriptFile}
            </DialogDescription>
          </DialogHeader>

          {active?.diarizationSuspect && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-3 py-2 shrink-0">
              <p className="text-[11px] text-amber-300 leading-relaxed">
                <AlertTriangle className="h-3 w-3 inline mr-1 -mt-0.5" />
                <span className="font-medium">Speaker labels are unreliable.</span>{" "}
                {active.diarizationReasons.join("; ")}. Read the words, not the names.
              </p>
            </div>
          )}

          <div className="overflow-y-auto min-h-0 flex-1">
            {textLoading ? (
              <div className="space-y-2 py-2">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-4 w-full bg-white/[0.04]" />
                ))}
              </div>
            ) : (
              <pre className="text-xs text-white/70 whitespace-pre-wrap font-mono leading-relaxed">
                {text}
              </pre>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
