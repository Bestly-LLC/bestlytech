import { useEffect, useMemo, useState } from "react";
import { BookMarked, FileText, Search, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { supabase } from "@/integrations/supabase/client";

/**
 * Ops → Claude Skills.
 *
 * A skill is the instruction file that changes how Claude behaves on a whole class
 * of work. The copies a session sees on disk are a READ-ONLY CACHE that dies with
 * the session, so this table is the copy we own. Backup only: restoring a skill
 * means re-proposing its SKILL.md through the skill review card in a session, not
 * editing anything here.
 *
 * Populated by the skills-ingest edge function (payload posted from a file, so the
 * content never has to travel through a session's context).
 */

type SkillFile = {
  skill: string;
  path: string;
  is_entrypoint: boolean;
  name: string | null;
  description: string | null;
  content: string;
  bytes: number;
  sha256: string;
  custom: boolean;
  captured_at: string;
};

const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

export default function AdminSkills() {
  const [files, setFiles] = useState<SkillFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("bestly_skills" as any)
        .select("*")
        .order("skill")
        .order("path");
      if (error) setError(error.message);
      else setFiles((data ?? []) as unknown as SkillFile[]);
      setLoading(false);
    })();
  }, []);

  // One entry per skill, with its SKILL.md as the headline and any extra files hanging off it.
  const skills = useMemo(() => {
    const by = new Map<string, { entry?: SkillFile; extras: SkillFile[] }>();
    for (const f of files) {
      const g = by.get(f.skill) ?? { extras: [] };
      if (f.is_entrypoint) g.entry = f;
      else g.extras.push(f);
      by.set(f.skill, g);
    }
    const list = [...by.entries()].map(([skill, g]) => ({ skill, ...g }));
    const needle = q.trim().toLowerCase();
    const matched = needle
      ? list.filter(
          (s) =>
            s.skill.toLowerCase().includes(needle) ||
            (s.entry?.description ?? "").toLowerCase().includes(needle) ||
            (s.entry?.content ?? "").toLowerCase().includes(needle),
        )
      : list;
    // Jared's own work first — that is the irreplaceable half.
    return matched.sort((a, b) => {
      const ca = a.entry?.custom ? 0 : 1;
      const cb = b.entry?.custom ? 0 : 1;
      return ca !== cb ? ca - cb : a.skill.localeCompare(b.skill);
    });
  }, [files, q]);

  const open = selected ? files.find((f) => `${f.skill}/${f.path}` === selected) : null;
  const capturedAt = files[0]?.captured_at;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Claude Skills"
        description="Backup of the skill files that shape how Claude works. Read-only — restoring one means re-proposing it in a session."
      />

      {capturedAt && (
        <p className="text-xs text-white/40">
          Snapshot captured {new Date(capturedAt).toLocaleString()} ·{" "}
          {new Set(files.map((f) => f.skill)).size} skills · {files.length} files ·{" "}
          {kb(files.reduce((n, f) => n + f.bytes, 0))}
        </p>
      )}

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search names, descriptions, contents…"
          aria-label="Search skills"
          className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-white/30 focus:border-white/20 focus:outline-none"
        />
      </div>

      {loading && <p className="text-sm text-white/50">Loading…</p>}

      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div className="text-sm">
            <p className="font-medium text-amber-200">Could not load the backup</p>
            <p className="mt-1 text-white/55">{error}</p>
          </div>
        </div>
      )}

      {!loading && !error && skills.length === 0 && (
        <p className="text-sm text-white/50">
          {q ? "Nothing matches that." : "No snapshot yet."}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-2">
          {skills.map((s) => {
            const active = open?.skill === s.skill;
            return (
              <div
                key={s.skill}
                className={`rounded-xl border p-4 transition-colors ${
                  active
                    ? "border-white/20 bg-white/[0.06]"
                    : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]"
                }`}
              >
                <button
                  onClick={() => setSelected(s.entry ? `${s.skill}/${s.entry.path}` : null)}
                  className="w-full text-left"
                  disabled={!s.entry}
                >
                  <div className="flex items-start gap-2.5">
                    <BookMarked className="mt-0.5 h-4 w-4 shrink-0 text-white/40" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-white">{s.skill}</span>
                        {!s.entry?.custom && (
                          <span className="shrink-0 rounded-full bg-white/[0.07] px-2 py-0.5 text-[0.625rem] uppercase tracking-wider text-white/45">
                            standard
                          </span>
                        )}
                      </div>
                      {s.entry?.description && (
                        <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-white/50">
                          {s.entry.description}
                        </p>
                      )}
                      {s.entry && (
                        <p className="mt-2 text-[0.6875rem] tabular-nums text-white/30">
                          {kb(s.entry.bytes)}
                        </p>
                      )}
                    </div>
                  </div>
                </button>

                {s.extras.length > 0 && (
                  <div className="mt-3 space-y-1 border-t border-white/[0.06] pt-3">
                    {s.extras.map((x) => (
                      <button
                        key={x.path}
                        onClick={() => setSelected(`${x.skill}/${x.path}`)}
                        className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs text-white/45 hover:bg-white/[0.04] hover:text-white/75"
                      >
                        <FileText className="h-3 w-3 shrink-0" />
                        <span className="truncate">{x.path}</span>
                        <span className="ml-auto shrink-0 tabular-nums text-white/25">
                          {kb(x.bytes)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="min-w-0">
          {open ? (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02]">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/[0.06] px-5 py-3.5">
                <div className="min-w-0">
                  <p className="truncate font-medium text-white">
                    {open.skill}
                    <span className="text-white/35"> / {open.path}</span>
                  </p>
                  <p className="mt-0.5 font-mono text-[0.6875rem] text-white/25">
                    sha256 {open.sha256.slice(0, 16)}…
                  </p>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-white/35">
                  {kb(open.bytes)}
                </span>
              </div>
              <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words px-5 py-4 font-mono text-[0.75rem] leading-relaxed text-white/75">
                {open.content}
              </pre>
            </div>
          ) : (
            !loading && (
              <div className="rounded-xl border border-dashed border-white/[0.08] px-6 py-16 text-center">
                <BookMarked className="mx-auto h-5 w-5 text-white/20" />
                <p className="mt-3 text-sm text-white/40">Pick a skill to read it.</p>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
