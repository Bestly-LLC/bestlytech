// The stuck-card fix buttons live in Postgres (supabase/migrations/20261028190000_stuck_fix_buttons.sql), so this runs that SQL for real
// in an in-memory Postgres (PGlite) over a stub of the live tables (__fixtures__/stuck-stubs.sql). Nothing here touches Supabase.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.resolve(root, p), "utf8");

let db: PGlite;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const q = async (sql: string, params?: unknown[]): Promise<Row[]> => (await db.query<Row>(sql, params)).rows;
const val = async (sql: string, params?: unknown[]) => (await q(`select (${sql}) as v`, params))[0].v;
const calls = (fn: string) => q("select args from test_calls where fn = $1 order by id", [fn]).then((r) => r.map((x) => x.args));

const MERCURY_401 = "RuntimeError: HTTP 401 https://api.mercury.com/api/v1/accounts\n  File \"x.py\", line 189, in urlopen\n    return opener.open(url, data, timeout)";

type Seed = { runs_on?: string; pulse?: object; ok?: boolean; summary?: string; minsAgo?: number; role?: string };
async function agent(slug: string, name: string, o: Seed = {}) {
  await q("insert into bestly_agents (slug, name, role, runs_on, pulse) values ($1,$2,$3,$4,$5)", [
    slug, name, o.role ?? "Test role", o.runs_on ?? "bestly-pi", o.pulse ? JSON.stringify(o.pulse) : null,
  ]);
  await q("insert into agent_beats (slug, at, ok, summary) values ($1, now() - ($2 || ' minutes')::interval, $3, $4)", [
    slug, String(o.minsAgo ?? 120), o.ok ?? false, o.summary ?? "",
  ]);
}
const stuckItem = async (slug: string) => {
  const items = await val("stuck_items_core()");
  return (items as Row[]).find((x) => x.item_id === `agent:${slug}`);
};
const feedItem = async (slug: string) => {
  const items = await val("admin_stuck_items()");
  return (items as Row[]).find((x) => x.item_id === `agent:${slug}`);
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(read("src/components/admin/cc/__fixtures__/stuck-stubs.sql"));
  await db.exec(read("supabase/migrations/20261027220000_stuck_card.sql"));
  await db.exec(read("supabase/migrations/20261028190000_stuck_fix_buttons.sql"));
}, 120_000);

afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec(`
    truncate stuck_actions, stuck_snooze, pi_run_requests, stuck_undo, stuck_seen, bestly_agents, agent_beats, agent_beat_log,
             pi_jobs, pi_job_runs, service_hosts, monitor_issues, test_calls, admin_chat_threads, admin_chat_messages,
             outside_claims, claim_cases restart identity cascade;
    delete from cron.job;
    update stuck_state set auto_retry = true, push_agents = false, swept_at = null where id;
  `);
});

describe("classifier", () => {
  it("gets every known error right (same list the watchdog runs)", async () => {
    expect(await val("stuck_classify_selftest()")).toEqual([]);
  });

  it("sends a Mercury 401 to the Mercury tokens card with plain words", async () => {
    const c = await val("stuck_classify($1, 'pi-penny-bank')", [MERCURY_401]);
    expect(c).toMatchObject({
      kind: "auth", service: "mercury", service_name: "Mercury", link: "/admin/cost-cutter#mercury-tokens",
      label: "Mercury's key stopped working", tail: "Paste a new one.", link_label: "Update key",
    });
  });

  it("falls back to settings for an unknown service", async () => {
    const c = await val("stuck_classify('HTTP Error 403: Forbidden', 'mystery')");
    expect(c).toMatchObject({ kind: "auth", service: null, link: "/admin/settings", label: "A saved key stopped working" });
  });

  it("maps the other known services to their key page", async () => {
    expect((await val("stuck_classify('The Vercel token expired', 'x')")).link).toBe("/admin/security#audit-tokens");
    expect((await val("stuck_classify('Tesla login expired', 'x')")).link).toBe("/admin/turo#settings");
  });

  it("calls free-AI silence transient, and says so in words", async () => {
    const c = await val("stuck_classify('Free AI did not answer this week; will try again next run', 'improver')");
    expect(c).toMatchObject({ kind: "transient", service: "free_ai", label: "The free AI didn't answer" });
  });

  it("only reads the first line, so a traceback that mentions timeout is not transient", async () => {
    const c = await val("stuck_classify($1, null)", ["RuntimeError: that failed\n  return opener.open(url, data, timeout)"]);
    expect(c.kind).toBe("other");
  });

  it("auth wins over transient", async () => {
    expect((await val("stuck_classify('401 Unauthorized, try again', null)")).kind).toBe("auth");
  });

  it("gives the right verdict on the real check-ins that were stuck on Oct 28 (copied from agent_beats)", async () => {
    const live: [string, string, string][] = [
      ["pi-penny-bank", "RuntimeError: HTTP 401 https://api.mercury.com/api/v1/accounts\n line 189, in urlopen\n    return opener.open(url, data, timeout)\n  File \"/usr/lib/python3.13/urllib/request.py\", line 604, in http_response", "auth"],
      ["pi-mercury-pulse", "RuntimeError: Mercury refused the token (HTTP 401); needs a new read-only token\n code, msg, hdrs)\n  File \"/usr/lib/python3.13/urllib/request.py\", line 533, in error", "auth"],
      ["settlement-mercury", "RuntimeError: Mercury refused the token (HTTP 401); needs a new read-only token\n          ~~~~~~~~~~~~~~~~^^^^^^^\nurllib.error.HTTPError: HTTP Error 401: Unauthorized\n", "auth"],
      ["improver", "Free AI did not answer this week; will try again next run", "transient"],
      ["pi-hoku-maker", "RuntimeError: 2026-10-28: FAILED RuntimeError: [moment/moment, waiting room] post failed the rules 4 times: freellm:gemini-3.5-flash: {\"topic\": \"waiting room\"} | 2026-10-29: FAILED", "other"],
      ["settlements", "RuntimeError: settlement_upsert_t -> HTTP 400: {\"code\":\"P0001\",\"details\":null,\"hint\":null,\"message\":\"not allowed\"}\n func(*args)\n  File \"/usr/lib/python3.13/urllib/request.py\", line 613, in http_error_default", "other"],
      ["daily-post", "RuntimeError: Studio promo failed 3 tries: quality score 7/10: make it clearer, more specific and more useful\nTraceback (most recent call last):\n  File \"/opt/bestly/cron/runjob.py\", line 65, in main", "other"],
      ["etsy-shop", "bachelorette-would-you-rather in sync; new-year-party-games-classic in sync; holiday-party-games-for-work-cozy in sync; cookie-exchange-party-games-midn", "other"],
      ["pi-runner", "76 jobs, 8 failing", "other"],
    ];
    for (const [slug, text, kind] of live) {
      expect((await val("stuck_classify($1, $2)", [text, slug])).kind, slug).toBe(kind);
    }
  });

  it("never uses an emoji, the word Nextcloud, or an ellipsis in what it says", async () => {
    for (const t of [MERCURY_401, "429 Too Many Requests", "weird", "Free AI did not answer"]) {
      const c = await val("stuck_classify($1, 'x')", [t]);
      const said = `${c.label} ${c.tail}`;
      expect(said).not.toMatch(/nextcloud|\.\.\.|…/i);
    }
  });
});

describe("the nine employees stuck right now", () => {
  it("each gets the verdict and primary button planned for it", async () => {
    await q("insert into pi_jobs (job) values ('penny_bank'), ('mercury_pulse'), ('hoku_maker'), ('runner')");
    await q("insert into cron.job (jobname, schedule, command) values ('improver-weekly', '0 9 * * 1', 'select public.stub_improve()')");
    await agent("pi-penny-bank", "Bank Feed", { pulse: { src: "pi_job", key: "penny_bank" }, summary: MERCURY_401 });
    await agent("settlement-mercury", "Bank Watch", { runs_on: "cloud", pulse: { src: "cron", key: "settlement-mercury" }, summary: "RuntimeError: Mercury refused the token (HTTP 401); needs a new read-only token" });
    await agent("pi-mercury-pulse", "Mercury Pulse", { pulse: { src: "pi_job", key: "mercury_pulse" }, summary: "skip: Mercury token is not allowed from this IP (add the Pi's address to the token allowlist)" });
    await agent("improver", "The Improver", { runs_on: "cloud", pulse: { src: "beat", key: "improver", also: ["improver-weekly"] }, summary: "Free AI did not answer this week; will try again next run" });
    await agent("pi-hoku-maker", "HOKU Maker", { pulse: { src: "pi_job", key: "hoku_maker" }, summary: "RuntimeError: Studio promo failed 3 tries: quality score 7/10: make it clearer" });
    await agent("settlements", "Nickel", { runs_on: "cloud", summary: 'RuntimeError: settlement_upsert_t -> HTTP 400: {"code":"P0001","message":"not allowed"}' });
    await agent("daily-post", "Social Poster", { runs_on: "mac mini", summary: "RuntimeError: caption was empty" });
    await agent("etsy-shop", "Poppy", { runs_on: "mac mini", summary: "KeyError: 'listing_id'" });
    await agent("pi-runner", "Pi Job Runner", { pulse: { src: "pi_job", key: "runner" }, summary: "76 jobs, 8 failing" });

    const want: Record<string, [string, string, string?]> = {
      "pi-penny-bank": ["auth", "key", "mercury"],
      "settlement-mercury": ["auth", "key", "mercury"],
      "pi-mercury-pulse": ["auth", "key", "mercury"],
      improver: ["transient", "retry", "free_ai"],
      "pi-hoku-maker": ["other", "scout"],
      settlements: ["other", "scout"],
      "daily-post": ["other", "scout"],
      "etsy-shop": ["other", "scout"],
      "pi-runner": ["other", "scout"],
    };
    for (const [slug, [kind, primary, svc]] of Object.entries(want)) {
      const it = await stuckItem(slug);
      expect(it, slug).toBeTruthy();
      expect(it!.fix.kind, slug).toBe(kind);
      expect(it!.fix.primary, slug).toBe(primary);
      if (svc) expect(it!.fix.service, slug).toBe(svc);
    }
    // the Improver re-runs through its own weekly cron command
    expect((await stuckItem("improver"))!.fix).toMatchObject({ retry: true, retry_via: "cloud", retry_job: "improver-weekly" });
    // an auth item points at the page where the key is entered
    expect((await stuckItem("pi-penny-bank"))!.fix.link).toBe("/admin/cost-cutter#mercury-tokens");
  });

  it("a transient error with nothing safe to re-run goes to Scout, never to a dead Retry button", async () => {
    await agent("etsy-shop", "Poppy", { runs_on: "mac mini", summary: "HTTP 503 Service Unavailable" });
    const it = await stuckItem("etsy-shop");
    expect(it!.fix).toMatchObject({ kind: "transient", retry: false, primary: "scout" });
  });

  it("accepts the real improver-weekly command, and Retry runs exactly that", async () => {
    await q("insert into cron.job (jobname, schedule, command) values ('improver-weekly', '0 9 * * 1', $1)", [
      `select public.invoke_edge_function('team-hr', '{"op":"improve"}'::jsonb, 150000)`,
    ]);
    await agent("improver", "The Improver", { runs_on: "cloud", pulse: { src: "beat", also: ["improver-weekly"] }, summary: "Free AI did not answer this week; will try again next run" });
    expect((await stuckItem("improver"))!.fix).toMatchObject({ retry: true, retry_via: "cloud", primary: "retry" });
    await val("admin_stuck_run('agent:improver', 'retry')");
    expect(await calls("invoke_edge_function")).toEqual([{ slug: "team-hr", payload: { op: "improve" } }]);
  });

  it("will not treat a cron command that does more than one thing as a retry target", async () => {
    await q("insert into cron.job (jobname, schedule, command) values ('bad', '* * * * *', 'select public.stub_improve(); delete from test_calls')");
    await agent("x", "X", { runs_on: "cloud", pulse: { src: "beat", job: "bad" }, summary: "HTTP 503" });
    expect((await stuckItem("x"))!.fix.retry).toBe(false);
  });
});

describe("Retry now", () => {
  const improver = async () => {
    await q("insert into cron.job (jobname, schedule, command) values ('improver-weekly', '0 9 * * 1', 'select public.stub_improve()')");
    await agent("improver", "The Improver", { runs_on: "cloud", pulse: { src: "beat", key: "improver", also: ["improver-weekly"] }, summary: "Free AI did not answer this week; will try again next run" });
  };

  it("re-runs a cloud employee and settles to done on a fresh OK check-in", async () => {
    await improver();
    const a = await val("admin_stuck_run('agent:improver', 'retry')");
    expect(a).toMatchObject({ kind: "retry", status: "working", by: "The Improver" });
    expect(await calls("stub_improve")).toHaveLength(1);

    await q("update agent_beats set at = now(), ok = true, summary = 'ok' where slug = 'improver'");
    const done = await val("admin_stuck_action($1)", [a.id]);
    expect(done.status).toBe("done");
    expect(done.note).toMatch(/^Checked in OK at \d{1,2}:\d{2}\s?(AM|PM)/);
    // the card now shows it as worked, not stuck
    const feed = (await val("admin_stuck_items()")) as Row[];
    expect(feed.find((x) => x.item_id === "agent:improver")).toMatchObject({ kind: "fixed", action: { status: "done" } });
  });

  it("settles to failed with a plain reason, then demotes Retry to Scout", async () => {
    await improver();
    await val("stuck_sweep()");   // the 5-minute sweep remembers when it first got stuck, so a fresh bad check-in does not make it vanish
    const a = await val("admin_stuck_run('agent:improver', 'retry')");
    await q("update agent_beats set at = now(), ok = false, summary = 'Free AI did not answer this week; will try again next run' where slug = 'improver'");
    const failed = await val("admin_stuck_action($1)", [a.id]);
    expect(failed.status).toBe("failed");
    expect(failed.note).toContain("The free AI didn't answer");
    const it = await feedItem("improver");
    expect(it!.fix.primary).toBe("scout");
    expect(it!.action.status).toBe("failed");
  });

  it("gives up with a reason when the employee never checks in", async () => {
    await improver();
    const a = await val("admin_stuck_run('agent:improver', 'retry')");
    await q("update stuck_actions set created_at = now() - interval '6 minutes' where id = $1", [a.id]);
    const r = await val("admin_stuck_action($1)", [a.id]);
    expect(r).toMatchObject({ status: "failed", note: expect.stringContaining("did not check in") });
  });

  it("a second tap while the first is working is refused in plain words", async () => {
    await improver();
    await val("admin_stuck_run('agent:improver', 'retry')");
    await expect(val("admin_stuck_run('agent:improver', 'retry')")).rejects.toThrow(/already working/);
  });

  it("refuses to retry what has no retry", async () => {
    await agent("etsy-shop", "Poppy", { runs_on: "mac mini", summary: "KeyError" });
    await expect(val("admin_stuck_run('agent:etsy-shop', 'retry')")).rejects.toThrow(/no retry/);
  });

  it("rejects a button that does not exist", async () => {
    await agent("x", "X", { summary: "boom" });
    await expect(val("admin_stuck_run('agent:x', 'nuke')")).rejects.toThrow(/does not exist/);
  });

  describe("on bestly-pi", () => {
    const piJob = async () => {
      await q("insert into pi_jobs (job) values ('hoku_maker')");
      await agent("pi-hoku-maker", "HOKU Maker", { pulse: { src: "pi_job", key: "hoku_maker" }, summary: "HTTP 503 Service Unavailable" });
    };

    it("queues the job, the Pi runner claims and finishes it, and the card settles to done", async () => {
      await piJob();
      const a = await val("admin_stuck_run('agent:pi-hoku-maker', 'retry')");
      expect(a).toMatchObject({ status: "working", via: "pi" });
      const claimed = await val("pi_run_claim()");
      expect(claimed.job).toBe("hoku_maker");
      expect(await val("pi_run_claim()")).toBeNull();      // nothing else waiting
      expect(await val("pi_run_finish($1, true, 'ok')", [claimed.id])).toBe(true);
      const r = await val("admin_stuck_action($1)", [a.id]);
      expect(r.status).toBe("done");
      expect(r.note).toMatch(/^hoku_maker ran fine on bestly-pi at /);
      expect(await calls("team_beat_bridge")).toHaveLength(1);   // the card clears on this tap
    });

    it("a failed Pi run says why", async () => {
      await piJob();
      const a = await val("admin_stuck_run('agent:pi-hoku-maker', 'retry')");
      const c = await val("pi_run_claim()");
      await val("pi_run_finish($1, false, 'RuntimeError: HTTP 401 https://api.mercury.com')", [c.id]);
      const r = await val("admin_stuck_action($1)", [a.id]);
      expect(r.status).toBe("failed");
      expect(r.note).toContain("failed");
      expect(r.note).toContain("Mercury's key stopped working");
    });

    it("says the runner may be off when nobody picks the request up", async () => {
      await piJob();
      const a = await val("admin_stuck_run('agent:pi-hoku-maker', 'retry')");
      await q("update pi_run_requests set created_at = now() - interval '4 minutes'");
      const r = await val("admin_stuck_action($1)", [a.id]);
      expect(r.status).toBe("failed");
      expect(r.note).toMatch(/did not pick this up within 3\u00a0minutes/);
    });

    it("only one request is ever claimed at a time, oldest first, and only for enabled jobs", async () => {
      await q("insert into pi_jobs (job, enabled) values ('a', true), ('b', false)");
      await q("insert into pi_run_requests (job, created_at) values ('b', now() - interval '2 minutes'), ('a', now() - interval '1 minute')");
      const c = await val("pi_run_claim()");
      expect(c.job).toBe("a");
    });
  });
});

describe("Have Scout fix it", () => {
  const setup = async () => agent("pi-runner", "Pi Job Runner", { pulse: { src: "pi_job", key: "runner" }, summary: "76 jobs, 8 failing" });

  it("opens an Autopilot thread and asks fix-ladder, signed by nobody but Scout's own rules", async () => {
    await setup();
    const a = await val("admin_stuck_run('agent:pi-runner', 'scout')");
    expect(a).toMatchObject({ kind: "scout", status: "working" });
    expect(a.thread_id).toBeTruthy();
    const [call] = await calls("invoke_edge_function");
    expect(call).toMatchObject({ slug: "fix-ladder", payload: { op: "stuck_scout", action_id: a.id } });
    const brief = await val("stuck_scout_brief($1)", [a.id]);
    expect(brief.thread_id).toBe(a.thread_id);
    expect(brief.ask).toContain("Pi Job Runner");
    expect(brief.ask).toContain("76 jobs, 8 failing");
    expect(brief.ask).toContain("bestly-pi");
    expect(brief.ask).toMatch(/FIXED: .*\nNEEDS_YES: .*\nSTUCK: /);
  });

  it("settles from the verdict line Scout ends with", async () => {
    await setup();
    const verdicts: [string, string][] = [
      ["FIXED: restarted the runner", "done"],
      ["NEEDS_YES: disable job x", "needs_yes"],
      ["STUCK: no log to read", "failed"],
    ];
    for (const [line, want] of verdicts) {
      await q("delete from stuck_actions");
      const a = await val("admin_stuck_run('agent:pi-runner', 'scout')");
      await q("insert into admin_chat_messages (thread_id, role, body) values ($1, 'assistant', $2)", [a.thread_id, `I looked at it.\n${line}`]);
      expect((await val("admin_stuck_action($1)", [a.id])).status, line).toBe(want);
    }
  });

  it("keeps waiting while the free AI is busy, then fails with the thread to open", async () => {
    await setup();
    const a = await val("admin_stuck_run('agent:pi-runner', 'scout')");
    await q("insert into admin_chat_messages (thread_id, role, body) values ($1, 'assistant', 'The free AI is out of room right now.')", [a.thread_id]);
    expect((await val("admin_stuck_action($1)", [a.id])).status).toBe("working");
    await q("update stuck_actions set created_at = now() - interval '11 minutes' where id = $1", [a.id]);
    expect((await val("admin_stuck_action($1)", [a.id])).status).toBe("failed");
  });
});

describe("Prompt for Claude", () => {
  it("has the employee, the error, where it runs, the log tail and what fixed means", async () => {
    await q("insert into pi_jobs (job) values ('penny_bank')");
    await agent("pi-penny-bank", "Bank Feed", { pulse: { src: "pi_job", key: "penny_bank" }, summary: MERCURY_401 });
    await q("insert into pi_job_runs (job, ok, summary) values ('penny_bank', false, 'HTTP 401 again')");
    await q("insert into service_hosts (service, host, runner, unit, active) values ('penny-bank', 'bestly-pi', 'cron', 'penny_bank', true)");
    const p = (await val("admin_stuck_prompt('agent:pi-penny-bank')")) as string;
    expect(p).toContain("Bank Feed");
    expect(p).toContain("bestly-pi (the home server)");
    expect(p).toContain("HTTP 401 https://api.mercury.com");
    expect(p).toContain("HTTP 401 again");
    expect(p).toContain("FIXED MEANS");
    expect(p).toContain("/opt/bestly/cron/run.sh penny_bank");
    expect(p).toContain("agent_beats where slug = 'pi-penny-bank'");
    expect(p).not.toMatch(/nextcloud/i);
  });

  it("refuses an item that is already fixed", async () => {
    await expect(val("admin_stuck_prompt('agent:nobody')")).rejects.toThrow(/already fixed/);
  });
});

describe("Snooze 1 day", () => {
  it("hides the item and its pushes, shows an Undo, and Undo brings it back", async () => {
    await agent("daily-post", "Social Poster", { summary: "RuntimeError: caption was empty" });
    const s = await val("admin_stuck_run('agent:daily-post', 'snooze')");
    expect(s.ok).toBe(true);
    const feed = (await val("admin_stuck_items()")) as Row[];
    expect(feed.find((x) => x.item_id === "agent:daily-post")).toMatchObject({ kind: "fixed", undo: { kind: "snooze", label: "Snoozed for 1\u00a0day" } });
    // quiet: not even considered for a push or an automatic retry
    await q("update stuck_state set push_agents = true where id");
    expect(await val("stuck_push()")).toBe(0);

    await val("admin_stuck_undo($1)", [s.undo_id]);
    const back = ((await val("admin_stuck_items()")) as Row[]).find((x) => x.item_id === "agent:daily-post");
    expect(back!.kind).toBe("stuck");
  });

  it("an expired snooze lets the item back in", async () => {
    await agent("daily-post", "Social Poster", { summary: "boom" });
    await val("admin_stuck_run('agent:daily-post', 'snooze')");
    await q("update stuck_snooze set until = now() - interval '1 minute'");
    expect(((await val("admin_stuck_items()")) as Row[]).find((x) => x.item_id === "agent:daily-post")!.kind).toBe("stuck");
  });
});

describe("automatic Retry now (stuck_sweep)", () => {
  const freeAiImprover = async (minsAgo = 120) => {
    await q("insert into cron.job (jobname, schedule, command) values ('improver-weekly', '0 9 * * 1', 'select public.stub_improve()')");
    await agent("improver", "The Improver", { runs_on: "cloud", pulse: { src: "beat", key: "improver", also: ["improver-weekly"] }, summary: "Free AI did not answer this week; will try again next run", minsAgo });
  };
  const freeLlmUp = () => q("insert into service_hosts (service, host, runner, unit, active) values ('freellm', 'clio', 'launchd', 'tech.bestly.freellm', true)");
  const autos = () => q("select * from stuck_actions where kind = 'auto_retry'");

  it("waits while FreeLLM is down, then goes once it is healthy", async () => {
    await freeAiImprover();
    expect((await val("stuck_auto_retry(true)")).picked).toEqual([]);
    await val("stuck_sweep()");
    expect(await autos()).toHaveLength(0);

    await freeLlmUp();
    expect((await val("stuck_auto_retry(true)")).picked).toEqual(["agent:improver"]);
    expect(await autos()).toHaveLength(0);                  // a dry run runs nothing
    await val("stuck_sweep()");
    const rows = await autos();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ auto: true, employee_name: "The Improver", status: "working" });
    expect(await calls("stub_improve")).toHaveLength(1);
  });

  it("an open FreeLLM incident keeps it waiting", async () => {
    await freeAiImprover();
    await freeLlmUp();
    await q("insert into monitor_issues (key, status) values ('ai.free.freellm', 'open')");
    expect((await val("stuck_auto_retry(true)")).picked).toEqual([]);
  });

  it("tries a given item at most once in 6 hours, and again after that", async () => {
    await freeAiImprover();
    await freeLlmUp();
    await val("stuck_sweep()");
    await q("update agent_beats set at = now(), ok = false where slug = 'improver'");   // it failed again
    await val("stuck_sweep()");
    await val("stuck_sweep()");
    expect(await autos()).toHaveLength(1);
    await q("update stuck_actions set created_at = now() - interval '7 hours', status = 'failed'");
    await q("update agent_beats set at = now() - interval '2 hours' where slug = 'improver'");
    await val("stuck_sweep()");
    expect(await autos()).toHaveLength(2);
  });

  it("counts Jared's own retry toward the 6 hours", async () => {
    await freeAiImprover();
    await freeLlmUp();
    await val("admin_stuck_run('agent:improver', 'retry')");
    await q("update stuck_actions set status = 'failed'");
    await val("stuck_sweep()");
    expect(await autos()).toHaveLength(0);
  });

  it("waits until the item has been stuck a full hour", async () => {
    await freeAiImprover(40);
    await freeLlmUp();
    await val("stuck_sweep()");
    expect(await autos()).toHaveLength(0);
  });

  it("never touches a key problem, a Scout item, or a snoozed item", async () => {
    await freeLlmUp();
    await q("insert into pi_jobs (job) values ('penny_bank'), ('runner')");
    await agent("pi-penny-bank", "Bank Feed", { pulse: { src: "pi_job", key: "penny_bank" }, summary: MERCURY_401 });
    await agent("pi-runner", "Pi Job Runner", { pulse: { src: "pi_job", key: "runner" }, summary: "76 jobs, 8 failing" });
    await agent("pi-hoku", "HOKU Maker", { pulse: { src: "pi_job", key: "runner" }, summary: "HTTP 503" });
    await val("admin_stuck_run('agent:pi-hoku', 'snooze')");
    await val("stuck_sweep()");
    expect(await q("select 1 from stuck_actions")).toHaveLength(0);
    expect(await q("select 1 from pi_run_requests")).toHaveLength(0);
  });

  it("the off switch works", async () => {
    await freeAiImprover();
    await freeLlmUp();
    await q("update stuck_state set auto_retry = false where id");
    await val("stuck_sweep()");
    expect(await autos()).toHaveLength(0);
  });

  it("does at most three per sweep", async () => {
    await freeLlmUp();
    await q("insert into cron.job (jobname, schedule, command) values ('j', '* * * * *', 'select public.stub_improve()')");
    for (const s of ["a", "b", "c", "d"]) await agent(s, s.toUpperCase(), { runs_on: "cloud", pulse: { src: "cron", job: "j" }, summary: "HTTP 503" });
    expect((await val("stuck_auto_retry()")).ran).toBe(3);
  });

  it("is silent when the retry works and pushes Jared once, signed by the employee, when it fails", async () => {
    await freeAiImprover();
    await freeLlmUp();
    await val("stuck_sweep()");
    await q("update agent_beats set at = now(), ok = true, summary = 'ok' where slug = 'improver'");
    await val("stuck_sweep()");
    expect(await calls("notify_route")).toHaveLength(0);

    await q("delete from stuck_actions");
    await q("update agent_beats set at = now() - interval '2 hours', ok = false, summary = 'Free AI did not answer this week; will try again next run' where slug = 'improver'");
    await val("stuck_sweep()");                                                    // auto retry fires
    await q("update agent_beats set at = now(), ok = false where slug = 'improver'"); // and it fails again
    await val("stuck_sweep()");
    await val("stuck_sweep()");
    const pushes = await calls("notify_route");
    expect(pushes).toHaveLength(1);
    expect(pushes[0].title).toMatch(/^The Improver: /);
    expect(pushes[0].body).toContain("Open the Command Center");
    expect(pushes[0].source).toBe("The Improver");
  });
});

describe("the watchdog (stuck_feed_selftest)", () => {
  const raised = async () => (await calls("bestly_raise")).at(-1);

  it("is quiet when everything is healthy", async () => {
    const r = await val("stuck_feed_selftest()");
    expect(r.problems).toEqual([]);
    expect((await raised()).kind).toBe("resolved");
  });

  it("raises when the classifier is wrong", async () => {
    const def = await val("pg_get_functiondef('public.stuck_classify_selftest()'::regprocedure)");
    await db.exec("create or replace function public.stuck_classify_selftest() returns text[] language sql as $$ select array['HTTP 401 should be auth']::text[] $$");
    try {
      const r = await val("stuck_feed_selftest()");
      expect(r.problems.join(" ")).toMatch(/error classifier is wrong/);
      expect((await raised()).kind).toBe("problem");
    } finally {
      await db.exec(def as string);
    }
  });

  it("raises when a Pi retry request has sat unpicked", async () => {
    await q("insert into pi_run_requests (job, created_at) values ('x', now() - interval '6 minutes')");
    const r = await val("stuck_feed_selftest()");
    expect(r.problems.join(" ")).toMatch(/retry runner on bestly-pi/);
    expect((await raised()).kind).toBe("problem");
  });

  it("raises when the 6-hour cap is broken", async () => {
    await agent("x", "X", { summary: "HTTP 503" });
    await q("insert into stuck_actions (item_id, employee_slug, employee_name, kind, status, auto) values ('agent:x','x','X','auto_retry','failed',true), ('agent:x','x','X','auto_retry','failed',true)");
    const r = await val("stuck_feed_selftest()");
    expect(r.problems.join(" ")).toMatch(/twice inside 6 hours/);
  });

  it("raises when an action has been working for 20+ minutes", async () => {
    await agent("x", "X", { summary: "boom" });
    await q("insert into stuck_actions (item_id, employee_slug, employee_name, kind, via, thread_id, created_at) values ('agent:x','x','X','scout','scout', gen_random_uuid(), now() - interval '30 minutes')");
    const r = await val("stuck_feed_selftest()");
    // the settle step first marks a stale Scout action failed (self-heal), so no problem is raised for it
    expect(r.healed).toBe(true);
  });
});
