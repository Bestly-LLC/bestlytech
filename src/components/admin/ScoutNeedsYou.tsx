import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  ShieldAlert,
  CircleDollarSign,
  UserRound,
  ServerCrash,
  CircleAlert,
  ChevronDown,
  ArrowUpRight,
  Sparkles,
} from "lucide-react";

/**
 * What the red badge on the Scout button is counting (2026-10-06, Jared: "I get these alerts but when I click
 * Scout it has nothing to show me"). The badge is the rank-1 rows of admin_today() (Needs you after the autonomy
 * gate: security nobody could fix, money, a person waiting, down an hour). Opening Scout now shows those same rows
 * at the top, each with its own button and "Ask Scout", so the number always has something behind it.
 */
export interface TodayRow {
  key: string;
  source: string | null;
  severity: string | null;
  title: string;
  detail: string | null;
  action_label: string | null;
  url: string | null;
  since: string | null;
  rank: number;
}

const POLL_MS = 120_000;

/** admin_today(), kept fresh: every 2 minutes, and again whenever Scout opens or closes. */
export function useNeedsYou(open: boolean) {
  const [rows, setRows] = useState<TodayRow[] | null>(null);
  const refresh = useCallback(async () => {
    const { data, error } = await (supabase.rpc as any)("admin_today");
    if (error) return; // a failed read is not "nothing needs you": keep what we had
    setRows(((data ?? []) as TodayRow[]).slice().sort((a, b) => a.rank - b.rank));
  }, []);
  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, POLL_MS);
    const onFocus = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);
  useEffect(() => {
    refresh();
  }, [open, refresh]);
  return { rows, urgent: (rows ?? []).filter((r) => r.rank <= 1), refresh };
}

function kindOf(r: TodayRow) {
  const s = `${r.key} ${r.source ?? ""} ${r.title}`.toLowerCase();
  if (r.key.startsWith("sec:") || s.includes("security")) return { Icon: ShieldAlert, tint: "text-[#FF453A]", label: "Security" };
  if (r.key.startsWith("down:") || /still down|down for/.test(s)) return { Icon: ServerCrash, tint: "text-[#FF9F0A]", label: "Down" };
  if (/money|payment|refund|charge|turo|blue steel|claims|invoice|\$/.test(s)) return { Icon: CircleDollarSign, tint: "text-[#30D158]", label: "Money" };
  if (/client|lead|person|waiting|reply|ask/.test(s)) return { Icon: UserRound, tint: "text-[#0A84FF]", label: "Person" };
  return { Icon: CircleAlert, tint: "text-[#FF9F0A]", label: r.source ?? "Needs you" };
}

/** "for 3 hr", "for 2 days": how long it has been waiting, never a raw timestamp. */
function waited(iso: string | null): string | null {
  if (!iso) return null;
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (!Number.isFinite(min)) return null;
  if (min < 60) return `${Math.max(1, min)} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} hr`;
  return `${Math.round(h / 24)} days`;
}

const HIDE_KEY = "scout.needsyou.hidden";

export function NeedsYouCard({
  rows,
  extra,
  onAsk,
  onOpen,
  disabled,
}: {
  rows: TodayRow[];
  /** Lower-rank items on the Today page, counted but not listed here. */
  extra: number;
  onAsk: (r: TodayRow) => void;
  onOpen: (url: string) => void;
  disabled?: boolean;
}) {
  // Folded state is remembered for this exact set of items: a new item unfolds it again.
  const sig = rows.map((r) => r.key).join("|");
  const [folded, setFolded] = useState(() => {
    try { return sessionStorage.getItem(HIDE_KEY) === sig; } catch { return false; }
  });
  const [openKey, setOpenKey] = useState<string | null>(null);
  useEffect(() => {
    try { setFolded(sessionStorage.getItem(HIDE_KEY) === sig); } catch { /* private mode */ }
  }, [sig]);
  if (!rows.length) return null;

  const fold = (v: boolean) => {
    setFolded(v);
    try { v ? sessionStorage.setItem(HIDE_KEY, sig) : sessionStorage.removeItem(HIDE_KEY); } catch { /* private mode */ }
  };

  return (
    <section aria-label="Needs you" className="scout-card-in mx-3 mt-3 flex min-h-[2.875rem] max-h-[min(42vh,20rem)] shrink flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.04] sm:mx-4">
      <button
        type="button"
        onClick={() => fold(!folded)}
        aria-expanded={!folded}
        className="flex min-h-11 w-full items-center gap-2 px-3.5 text-left"
      >
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#FF453A] px-1.5 text-[0.6875rem] font-bold tabular-nums text-white">
          {rows.length}
        </span>
        <span className="flex-1 text-sm font-semibold text-white">
          {rows.length === 1 ? "1 thing needs you" : `${rows.length} things need you`}
        </span>
        <ChevronDown className={cn("h-4 w-4 text-white/50 transition-transform duration-200", folded && "-rotate-90")} aria-hidden />
      </button>

      <div className={cn("scout-collapse min-h-0", !folded && "is-open")}>
        <div className="!overflow-y-auto overscroll-contain">
          <ul className="divide-y divide-white/[0.06] border-t border-white/[0.06]">
            {rows.map((r) => {
              const k = kindOf(r);
              const isOpen = openKey === r.key;
              const age = waited(r.since);
              return (
                <li key={r.key}>
                  {/* One line per item; tap it for the detail and the buttons (progressive disclosure keeps
                      the card short enough that the conversation still has room on a laptop). */}
                  <button
                    type="button"
                    onClick={() => setOpenKey(isOpen ? null : r.key)}
                    aria-expanded={isOpen}
                    className="flex min-h-11 w-full items-start gap-2.5 px-3.5 py-2.5 text-left hover:bg-white/[0.03]"
                  >
                    <k.Icon className={cn("mt-0.5 h-[1.125rem] w-[1.125rem] shrink-0", k.tint)} aria-label={k.label} />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-[0.9375rem] font-medium leading-snug text-white sm:text-sm">{r.title}</span>
                      <span className="mt-0.5 block text-xs text-white/50">
                        {k.label}
                        {age && <> · waiting <span className="whitespace-nowrap">{age}</span></>}
                      </span>
                    </span>
                    <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-white/40 transition-transform duration-200", !isOpen && "-rotate-90")} aria-hidden />
                  </button>
                  <div className={cn("scout-collapse", isOpen && "is-open")}>
                    <div>
                      <div className="pb-3 pl-[2.75rem] pr-3.5">
                        {r.detail && (
                          <p className="whitespace-pre-wrap break-words rounded-xl bg-black/30 px-3 py-2 text-[0.8125rem] leading-relaxed text-white/80">
                            {r.detail}
                          </p>
                        )}
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => onAsk(r)}
                            className="scout-press inline-flex min-h-9 items-center gap-1.5 rounded-full bg-white px-3.5 text-[0.8125rem] font-semibold text-black disabled:opacity-40"
                          >
                            <Sparkles className="h-3.5 w-3.5" aria-hidden />
                            Ask Scout
                          </button>
                          {r.url && (
                            <button
                              type="button"
                              onClick={() => onOpen(r.url!)}
                              className="scout-press inline-flex min-h-9 items-center gap-1 rounded-full border border-white/15 px-3.5 text-[0.8125rem] font-medium text-white hover:bg-white/[0.06]"
                            >
                              {r.action_label || "Open"}
                              <ArrowUpRight className="h-3.5 w-3.5 text-white/60" aria-hidden />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {extra > 0 && (
            <button
              type="button"
              onClick={() => onOpen("/admin")}
              className="flex min-h-11 w-full items-center justify-between border-t border-white/[0.06] px-3.5 text-left text-[0.8125rem] text-white/60 hover:text-white"
            >
              <span>{extra === 1 ? "1 smaller item on Today" : `${extra} smaller items on Today`}</span>
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
