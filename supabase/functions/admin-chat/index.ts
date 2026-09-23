// admin-chat — Scout, the assistant inside bestly.tech/admin.
//
// Rules, in order of how much trouble breaking them causes:
//  1. It can never do more than the person typing can. The caller must hold the
//     admin role; the check happens here, against their JWT.
//  2. Anything with consequences needs a yes first. Those tools carry a
//     `confirmed` flag the model may only set after Jared agreed.
//  3. Every tool run lands in admin_chat_actions; commits also in
//     admin_site_changes, Mac jobs in mac_commands, Pi jobs in home_hub_commands,
//     recorder jobs in meeting_recorder_commands.
//  4. A commit is watched to the end and reverted if the build fails.
//
// v6: Scout can action anything that has a machine behind it —
//   pi_command   the Home Hub agent on bestly-pi (Nextcloud, Homebridge, Home Assistant, Pi-hole, itself)
//   clear_alerts bulk-read the admin bell
//   resolve_incident  close a monitor incident that is over
//   db_write     one guarded INSERT/UPDATE/DELETE (admin_sql_write refuses system schemas, missing WHERE, >5000 rows)
// v7: the call recorder on the Mac mini —
//   recorder            start / stop / status (agent ~/MeetingRec/agent.py, launchd tech.bestly.meetingrec-agent)
//   meeting_transcript  read a finished call's transcript for a debrief (meeting_recordings)
// v8: recorder selftest, and Scout owns notetaker repairs (incident recorder.notetaker)
// v9: mac_run — any shell job on the Mac mini. Scout only PROPOSES (mac_jobs row,
//     status proposed); Jared taps Run in the Scout window, which approves it with
//     his own session. The table's trigger refuses any other approval path, so no
//     prompt can make Scout run something on its own. Scout also knows which admin
//     page Jared is looking at (body.page).
//     notify — Scout can reach him outside the chat: the admin bell, and a phone
//     push (ntfy, quiet hours kept, capped at 6 an hour in scout_notify()).
//     Proposed Mac jobs push by themselves (trigger), and a 9am digest lists what waits.
// The only things left for Jared are the ones that physically need him: a password, a device in his hand.
//
// Stability notes, all of them learned the hard way:
//  - verify_jwt is OFF because with it on the CORS preflight (which carries no
//    Authorization header) is 401'd by the platform and the browser reports
//    "Failed to send a request to the Edge Function". Auth is done below.
//  - watchBuild and the Pi wait are capped so a turn cannot approach the wall clock.
//  - The model call retries ONCE on 429 and 5xx.
//  - v10: the platform kills a reply at 150s. Every reply now has a 118s budget: slow tools stop
//    at 110s, and when time or steps run out Scout answers with what it has (no tools) instead of
//    dying. History is the LAST 30 messages (it used to be the first 40, so long threads never saw
//    the newest ask and kept redoing old work until they timed out).
//  - v12: self-learning. Every failed tool call comes back with the lessons that match it
//    (scout_lessons), plus the real columns when run_sql guessed wrong. When Scout finds what
//    works it saves it with learn; a nightly reflect (scout-daily) mines the day for more.
//    Lessons that keep failing retire themselves (scout_lesson_used).
//  - v14: auto-run. scout_settings.auto_run (the switch in Scout's header) is Jared's standing
//    yes: tools that need confirmed:true run without asking, and Mac Run cards start at once
//    (mac_job_autorun). On autopilot (the fix ladder) it covers everything except commit_files.
//  - v15: paid AI only with his OK. Unless scout_settings.paid_ai_ok ("Paid AI without asking")
//    is on, or he already said yes in this chat (admin_chat_threads.paid_ok), a message first goes
//    to the FREE model on the Mac mini (fix_ai_jobs). If that can answer without tools, it does.
//    Otherwise Scout asks, with three buttons: Yes, use paid AI | No, skip it | Always, stop asking.
//    Autopilot without that OK stops at NEEDS_YES instead of spending.
//  - v16: "keep going" is his yes. A message that starts with "keep going" runs as if auto-run
//    were on for that one request (tools skip the yes, Mac jobs start, paid AI OK for the chat).
//    Out of Anthropic credit: a plain-words reply plus one bell card a day, not the raw 400.
//  - v17: the free model only classifies (DATA | ACTION | CODE) why it can't answer; Scout words the
//    reason itself. It used to paste the free model's own sentence, which invented things ("use the
//    dashboard's alert settings"). The free model also gets a short list of true facts about the
//    admin (e.g. "Fixed:" alerts already exist), and Scout no longer offers paid AI while it is out
//    of credit - it says so and keeps the message.
//  - v13: autopilot. fix-ladder calls with the service key + autopilot:true when an incident
//    outlived the self-heals and the free model. Anything needing a yes is refused in code and
//    comes back as NEEDS_YES, which Jared approves with one tap from the alert pane.
//  - v11: commit_files takes edits ({path, old, new}); a tool call cut off at the output limit
//    is refused instead of run half-empty (it used to arrive as "no files given", 9 times).

import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = Deno.env.get("ADMIN_CHAT_MODEL") ?? "claude-sonnet-4-6";
const MAX_TURNS = 10;
const BUILD_POLLS = 10;          // ~65s of watching; builds here take ~35s
const PI_WAIT_MS = 60_000;       // how long to wait for the Pi to report back inside one turn
const REC_WAIT_MS = 20_000;      // how long to wait for the Mac mini to pick up a recorder job
const REPOS: Record<string, string> = { site: "Bestly-LLC/bestlytech", hoku: "Bestly-LLC/hoku-clean" };
const WATCHABLE = new Set(["Bestly-LLC/bestlytech"]);
const RESULT_CAP: Record<string, number> = { meeting_transcript: 100_000 };
// The platform kills the function at 150s wall clock. Wrap up well before that.
const BUDGET_MS = 118_000;
const WRAP_MS = 28_000;         // leave this much for a final no-tools answer

// Mirrors the allowlist in the home-hub-agent function. Read-only actions run without a yes.
const PI_ACTIONS: Record<string, string[]> = {
  nextcloud: ["status", "restart"],
  homebridge: ["restart", "refresh"],
  homeassistant: ["refresh", "toggle_automation"],
  pihole: ["enable", "disable", "update_gravity"],
  agent: ["test_alert", "run_maintenance"],
};
const PI_READ_ONLY = new Set(["nextcloud.status", "homebridge.refresh", "homeassistant.refresh"]);

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Per-request cut-off for slow tools, so one tool cannot run the reply past the platform limit.
let toolDeadline = Infinity;
const timeUp = () => Date.now() > toolDeadline;

function cleanKey(raw: string | undefined): string {
  if (!raw) return "";
  const m = raw.match(/sk-ant-[A-Za-z0-9_\-]{20,}/);
  return (m ? m[0] : raw).trim();
}

const TOOLS = [
  {
    name: "today",
    description: "The operator queue: everything currently waiting on Jared, ranked. Call this before answering anything about what needs him or what is stuck.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "incidents",
    description: "What the monitor currently has open across the estate (uptime, Mac agent, mail, scheduled jobs, notifications, deploys, Scout) plus open Home Hub issues from the Pi. Each carries what was already tried and, where it could not be fixed, what needs Jared. Resolved incidents are history, not problems.",
    input_schema: { type: "object", properties: { include_resolved: { type: "boolean" } } },
  },
  {
    name: "run_sql",
    description: "Read the Bestly database. One SELECT or WITH statement, capped at 200 rows. Use it for any question about the business. Never guess a number you could read.",
    input_schema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] },
  },
  {
    name: "db_write",
    description:
      "Change data: exactly one INSERT, UPDATE or DELETE on the public schema. UPDATE/DELETE need a WHERE; system schemas are refused; over 5000 rows is refused. " +
      "Add RETURNING to see what changed. Read the rows with run_sql first so you know what you are touching. Requires confirmed:true after Jared said yes.",
    input_schema: { type: "object", properties: { query: { type: "string" }, confirmed: { type: "boolean" } }, required: ["query", "confirmed"] },
  },
  {
    name: "pi_command",
    description:
      "Run a job on bestly-pi through the Home Hub agent and wait up to a minute for the answer. " +
      "nextcloud: status (full diagnosis) | restart (heal ladder: compose up, finish a pending occ upgrade, restart proxy, tunnel, app). " +
      "homebridge: restart | refresh. homeassistant: refresh | toggle_automation {automation_id, enabled}. " +
      "pihole: enable | disable {seconds} | update_gravity. agent: test_alert | run_maintenance {steps}. " +
      "status and refresh need no yes; everything else requires confirmed:true after Jared said yes.",
    input_schema: {
      type: "object",
      properties: {
        target: { type: "string", enum: Object.keys(PI_ACTIONS) },
        action: { type: "string" },
        payload: { type: "object" },
        confirmed: { type: "boolean" },
      },
      required: ["target", "action"],
    },
  },
  {
    name: "clear_alerts",
    description:
      "Mark admin bell alerts read in bulk. Filter by severity ('warning','success','info'), a text match on title/body/key, and/or older_than_minutes. " +
      "No filter clears every unread alert. Requires confirmed:true after Jared said yes.",
    input_schema: {
      type: "object",
      properties: { severity: { type: "string" }, match: { type: "string" }, older_than_minutes: { type: "number" }, confirmed: { type: "boolean" } },
      required: ["confirmed"],
    },
  },
  {
    name: "resolve_incident",
    description: "Close a monitor incident by key when it is over (the check passes again, or Jared says it is handled). The monitor re-opens it by itself if it recurs.",
    input_schema: { type: "object", properties: { key: { type: "string" }, note: { type: "string" } }, required: ["key"] },
  },
  {
    name: "list_files",
    description: "List a directory in a repo. repo is 'site' (Bestly-LLC/bestlytech: bestly.tech and the /admin dashboard, Vite + React + TS + Tailwind + shadcn) or 'hoku'.",
    input_schema: { type: "object", properties: { repo: { type: "string", enum: ["site", "hoku"] }, path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "read_file",
    description: "Read one file from a repo. Always read a file before you change it. Never write a file whose current contents you have not seen.",
    input_schema: { type: "object", properties: { repo: { type: "string", enum: ["site", "hoku"] }, path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "commit_files",
    description:
      "Commit changes to main and watch the deploy through. PREFER edits: a list of {path, old, new} where old is an exact, unique snippet of the current file " +
      "(read it first) and new replaces it; several edits per file are fine. Use files (the COMPLETE contents) only for new or very small files - " +
      "a whole large file will not fit in one reply and gets cut off. " +
      "On a green build it reports the site is live; on a failed build it AUTOMATICALLY REVERTS the files and says so, " +
      "so main is never left broken. Requires confirmed:true after Jared has said yes.",
    input_schema: {
      type: "object",
      properties: {
        repo: { type: "string", enum: ["site", "hoku"] },
        message: { type: "string" },
        edits: { type: "array", items: { type: "object", properties: { path: { type: "string" }, old: { type: "string" }, new: { type: "string" } }, required: ["path", "old", "new"] } },
        files: { type: "array", items: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
        confirmed: { type: "boolean" },
      },
      required: ["message", "confirmed"],
    },
  },
  {
    name: "mac_command",
    description:
      "Give the agent on Jared's MacBook Air a job. That machine is the only one that can reach IMAP. mail_drain runs every pending mail action; " +
      "restart_mail restarts the agent; ping checks it is alive; run_named runs a script already in ~/.bestly. Picked up within five minutes of the Mac being awake. " +
      "Requires confirmed:true after Jared has said yes.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["mail_drain", "restart_mail", "run_named", "ping"] },
        payload: { type: "object" },
        confirmed: { type: "boolean" },
      },
      required: ["action", "confirmed"],
    },
  },
  {
    name: "mac_run",
    description:
      "Run a shell job on the Mac mini (the always-on Mac: call recorder in ~/MeetingRec, repo at ~/Developer/bestlytech, Homebrew, git with push access, node, python3). " +
      "action propose: puts a Run card in front of Jared showing the exact script. Nothing runs until he taps Run; you cannot approve it. " +
      "Say in one line what it does and that the Yes button is up. Do not ask him to type yes. (With auto-run on, it starts by itself; the result says so.) " +
      "Write title and why for someone who has never seen a terminal: title = what it does for him ('Restart the call recorder'), why = one sentence on what changes after ('Your next call gets recorded again.'). No commands or jargon in either. " +
      "action get: read a job's status and output (latest if no id). " +
      "Scripts run in zsh -l as Jared's user under launchd: no sudo, no GUI prompts, and macOS privacy may block Desktop/Documents/Downloads. Default timeout 300s.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["propose", "get"] },
        title: { type: "string", description: "3-8 words, what the job does" },
        why: { type: "string", description: "one line: why this fixes or checks the thing" },
        script: { type: "string", description: "the exact zsh script; set -e is not added for you" },
        cwd: { type: "string", description: "working directory, default ~" },
        timeout_s: { type: "number" },
        id: { type: "string" },
      },
      required: ["action"],
    },
  },
  {
    name: "notify",
    description:
      "Tell Jared something outside this chat: it lands in the admin bell, and with push:true also on his phone. " +
      "Use it for what he must not miss after he closes this window: a decision only he can make, work you left pending on him, " +
      "something important you found (an outage, money, a customer waiting), or a reminder he asked for. Not for things you just told him in the chat, " +
      "and never for routine updates. Proposed Mac jobs already notify him by themselves. Title under 80 characters, plain words.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        severity: { type: "string", enum: ["info", "warning", "critical"] },
        push: { type: "boolean", description: "also buzz his phone. Only for things that need him today." },
      },
      required: ["title"],
    },
  },
  {
    name: "recorder",
    description:
      "The call recorder on the Mac mini (records the call audio and Jared's mic, then transcribes and names the speakers). " +
      "status: is it idle, recording, or transcribing. start {roster: names of everyone on the call besides Jared, e.g. ['eli','cooper']}: " +
      "starts recording. stop: stops and transcribes (takes a few minutes; the transcript then lands in meeting_recordings). " +
      "Start and stop only when Jared asked for exactly that in this message - his asking is the yes. New names are fine: the recorder learns their voice. " +
      "selftest: runs the notetaker self-test on the Mac mini (a fake guest joins a throwaway Talk room and the notetaker must record it by name; ~1 min). " +
      "It first pulls the latest notetaker code from the repo. No yes needed; run it after committing a notetaker fix.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["status", "start", "stop", "selftest"] },
        roster: { type: "array", items: { type: "string" } },
      },
      required: ["action"],
    },
  },
  {
    name: "meeting_transcript",
    description:
      "Read a recorded call's transcript, for a debrief or any question about what was said. name is the recording (meeting-YYYYMMDD-HHMM); " +
      "leave it out for the latest call. list:true returns the recent calls instead. JARED lines are his own mic and always right; " +
      "a name ending in ? was a guess from the voice, so check it against the context.",
    input_schema: { type: "object", properties: { name: { type: "string" }, list: { type: "boolean" } } },
  },
  {
    name: "learn",
    description:
      "Save a lesson for next time, when something failed and you found what works (or Jared taught you something about a tool, table or project). " +
      "Be specific and reusable: scope like tool:run_sql, table:cloud_leads, project:studio, mac, pi, deploy. Don't save one-off facts or anything secret.",
    input_schema: {
      type: "object",
      properties: {
        scope: { type: "string" }, title: { type: "string", description: "under 60 characters" },
        when: { type: "string", description: "when this applies, e.g. the error you saw" },
        do: { type: "string", description: "what works" }, avoid: { type: "string", description: "what not to repeat" },
        taught_by_jared: { type: "boolean", description: "true when Jared told you this (\"remember...\")" },
      },
      required: ["scope", "title", "when", "do"],
    },
  },
  {
    name: "mark_done",
    description: "Clear one card off the queue: a Cookie Yeti release waiting on Jared ('cy:mac') or an unread alert ('bell:<uuid>'). Only when he plainly asks, or once the thing it asked for is done.",
    input_schema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
  },
];

const AUTO_RUN_ON = `

# Auto-run is ON
Jared switched on auto-run: he does not want to approve things. Do not ask "should I?" and do not
offer a "Do it" button for an action - just do it. Mac jobs start by themselves. Tools that normally
need confirmed:true run as if he said yes. After acting, say in one plain line what you did and what
changed ("Restarted Homebridge. Your lights respond again."). Still stop and ask only if the step
would delete something that cannot be brought back.`;

const ASK_PLAINLY = `

# When you need his yes
Write the question for someone who has never seen this system. First say, in everyday words, what
will happen and what it changes for him - not the tool, the script or the table. Then ask. One or two
short sentences, for example:
  "I'll restart Homebridge on your Pi. Your Home app lights come back in about a minute. Do it?"
  "I'll delete the 14 old read alerts from your bell. Nothing else changes. OK?"
Never lead with jargon (commit, db_write, launchctl, RPC). If he wants the detail he taps "Show me first".
If he seems tired of approving, tell him he can switch on Auto-run at the top of this window.`;

const SYSTEM = (today: unknown, mac: unknown, incidents: unknown, unread: unknown, recorder: unknown, jobs: unknown, page: unknown, lessons: string) => `
You are Scout, the assistant inside Jared Best's Bestly admin console at bestly.tech/admin. Your name is Scout; never call yourself anything else.

Jared runs Bestly LLC: Cookie Yeti (a Safari and Chrome cookie-banner extension), HOKU, InventoryProof, SchoolPilot, Bestly Studio (studio.bestly.tech), a small shop, a Home Hub on a Raspberry Pi (bestly-pi: Nextcloud at cloud.bestly.tech, Home Assistant, Homebridge, Pi-hole), and a Turo fleet. He is the only operator.

# The queue, read a moment ago
${JSON.stringify(today)}
rank 0 is stopped and needs him, 1 is broken, 2 is slipping, 3 is waiting on a decision.

# Open incidents, from the monitor
${JSON.stringify(incidents)}
The monitor runs every five minutes, fixes what it can by itself, and pushes to his phone over ntfy when it cannot. Only OPEN incidents are problems. Anything resolved is history: never report it as a current problem or a "warning worth a look".

# Unread admin alerts
${JSON.stringify(unread)}

# The Mac agent
${JSON.stringify(mac)}
It runs on his MacBook Air and polls every five minutes while the Mac is awake. Quiet for hours almost always means the lid is closed; queued mail work runs by itself when he next opens it. Say that in one line; do not treat it as an outage or ask him to do anything about it.

# The call recorder on the Mac mini
${JSON.stringify(recorder)}
There is a Record a call button at the top of this chat, so he can also do it himself. When he asks you to record, start it with the recorder tool and the names he gave. When a call is done, the button offers a Debrief.

# Jobs on the Mac mini (mac_run), newest first
${JSON.stringify(jobs)}
The Mac mini is always on and can do almost anything a terminal can: git pull/push the repos, npm and builds, brew, restart launchd agents (launchctl kickstart -k gui/$(id -u)/<label>), read logs, curl, python. When a fix or a check needs a real machine, write the script and propose it with mac_run. Keep scripts short, idempotent and safe to re-run; print what they did. Never put a secret in a script. Never delete outside a project folder or ~/MeetingRec/recordings. When a job finishes, Jared's window tells you; read the output (mac_run get) and say in one line whether it worked, then the next step.

# Where Jared is right now
${JSON.stringify(page)}
That is the admin page open behind this chat. When he says "this", "here" or "this page", he means it. Use it to pick the right data without asking.

# When the notetaker breaks (incident recorder.notetaker)
The notetaker is a headless Chrome that joins Talk calls as "Scout (notetaker)" and records each person on their own track. A Talk update can move the page's buttons or name labels and break it. The Mac mini runs a self-test on every Talk update, every code change and daily, and opens incident recorder.notetaker with diagnostics (the buttons it could see, dialogs, its log) when it fails. While it is broken, recordings still work but names fall back to voice guessing. Fixing it is your job, not Jared's:
1. Read the incident body. 2. read_file scripts/meetingrec/notetaker/notetaker.js (join section: the strategies list and the device dialog; naming: the WHO selector list). 3. Propose the smallest change that matches what the diagnostics show, in one line. 4. On his yes, commit_files it. 5. Run recorder selftest. It pulls main first; if the fix passes, the incident resolves by itself. If a self-test fails right after a code update, the Mac rolls that update back and blocks it, so a bad fix cannot stick.
Never edit agent.py or stop.sh this way; the Mac does not pull those.

# Debriefing a call
Read it with meeting_transcript. Then, in plain text: first the decisions (only what was actually agreed, not ideas floated), then each commitment as "Name: what, by when" (only a deadline if one was said), then open questions. Keep it tight; he can ask for more. Never invent something that was not said. If a speaker name has a ?, work out who it was from the context before you attribute anything to them.

# What you can do yourself
- Read anything: today, incidents, run_sql, meeting_transcript.
- Fix data: db_write (one guarded INSERT/UPDATE/DELETE).
- Fix the Pi: pi_command (Nextcloud diagnose and heal, Homebridge, Home Assistant, Pi-hole, the agent).
- Tidy up: clear_alerts, resolve_incident, mark_done.
- Reach him later: notify (bell, and his phone with push). When you leave something waiting on him, or find something he must act on, notify him before you finish, in one line.
- Change bestly.tech and the admin: list_files, read_file, commit_files (watched, auto-reverted on a failed build).
- Give the MacBook Air mail work: mac_command. Run anything on the Mac mini: mac_run (he taps Run). Record calls on the Mac mini: recorder.

# Doing, not describing
Your job is to clear his plate, not to hand him a to-do list. For every item: if a tool can do it, propose it in one line and, on his yes, do it and report the result. Batch them: "I can do these three - say yes and I'll run all of them." Cleanup (stale alerts, incidents that are over, cards whose job is done) you may do without asking and just report.
Only hand Jared something when it physically needs him: typing a password, a device in his hand, a decision only he can make. When you do, say it is the one thing you cannot do and why, give the single exact step, and nothing else.
Known one: accepting the Xcode licence needs sudo on his Mac, which needs his password - Apple does not allow it any other way. That is the only true blocker for the Cookie Yeti Mac and iOS builds.

# What you have learned (scout_lessons, best first)
${lessons || "Nothing yet."}

# Healing yourself
When a tool fails, the result comes back with "lessons" (what worked before in the same spot) and, for run_sql, the real columns. Use them: change your approach, never repeat the exact call that failed. When a different approach works after a failure, call learn once with what worked, so next time is right first time. If you are stuck after two different tries, say plainly what you tried and what you need. When Jared says "remember" about how to do something (a tool, table, project or preference for how work gets done), save it with learn and taught_by_jared: true.

# How to change code
Read the file first, every time. Keep the change small. Use commit_files edits (exact old snippet -> new), not whole files; a large file does not fit in one reply. Never put a key, token or password into a file. When a commit comes back reverted, say so plainly, say what the build complained about, and work out the actual fix - never resend the same thing hoping for a different build.

# How to behave
- Lead with the answer. He has ADHD: no preamble, no recap, no "I'd be happy to". Under 70 words unless he asked for detail (a debrief may run longer, but stays tight).
- Plain text. The chat renders no markdown - no asterisks, no headings, no bullet characters. A list is one short line per item.
- One question at most, and only when you genuinely cannot proceed.
- Never invent a number, a file name, a function or a commit. If you do not know, read it or say so.

# Never make him type
Typing on a phone is friction, and friction is why things do not get done. Whenever
your reply leaves a decision, a choice or an obvious next step with him, end it with
one final line, exactly like this and nothing after it:

OPTIONS: Do it | Not now | Show me first

Two to four options, a few words each, separated by pipes. His window turns them into
buttons and a tap is sent back as his answer, so write them as things HE would say:
"Do it", "Yes, both", "Skip it", "Show me the diff first", "Remind me tomorrow". Put
the one you recommend first. Use it for a yes/no, for a pick between approaches, and
for "want me to keep going" - any time the alternative is him typing a word back.

End EVERY reply with this line. There is no reply that does not have a sensible next
tap: after a plain answer or a status, offer where to go next ("Keep going", "Check
the other one", "Nothing else"). The one you must never omit it on is the one you are
most likely to - "want me to keep going" - because that is precisely the moment he
would otherwise have to type. If you leave it off, his window generates buttons for
you, and generic buttons are worse than the ones you would have written.

Never explain the line, never use the word OPTIONS in your prose, and never put it
anywhere but the very end.
`.trim();

async function gitCall(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data: rid, error } = await db.rpc("admin_git_call", { p_body: body });
  if (error) return { ok: false, error: error.message };
  for (let i = 0; i < 30 && !timeUp(); i++) {
    await sleep(i === 0 ? 900 : 700);
    const { data: ans } = await db.rpc("admin_git_poll", { p_request_id: rid });
    if (ans) {
      const a = ans as Record<string, any>;
      return a.ok ? (a.body as Record<string, unknown>) : { ok: false, error: a.error ?? JSON.stringify(a.body) };
    }
  }
  return { ok: false, error: "GitHub did not answer in time" };
}

// Vercel reports build results as GitHub commit statuses, and bestlytech is
// public, so this needs no token.
async function watchBuild(repo: string, sha: string) {
  if (!WATCHABLE.has(repo)) return { state: "unwatchable", note: "private repo, build not visible without a token" };
  for (let i = 0; i < BUILD_POLLS && !timeUp(); i++) {
    await sleep(i === 0 ? 9000 : 6000);
    let j: any;
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}/status`, {
        headers: { "User-Agent": "bestly-admin-chat", Accept: "application/vnd.github+json" },
      });
      if (!r.ok) continue;
      j = await r.json();
    } catch { continue; }
    const url = j?.statuses?.[0]?.target_url ?? null;
    if (j?.state === "success") return { state: "success", url };
    if (j?.state === "failure" || j?.state === "error") return { state: "failed", url };
  }
  return { state: "timeout", note: "still building when I stopped watching" };
}

async function piCommand(args: Record<string, any>): Promise<Record<string, unknown>> {
  const target = String(args.target ?? "");
  const action = String(args.action ?? "");
  if (!PI_ACTIONS[target]?.includes(action)) {
    return { ok: false, error: `not an allowed Pi command: ${target}.${action}`, allowed: PI_ACTIONS };
  }
  if (!PI_READ_ONLY.has(`${target}.${action}`) && !args.confirmed) {
    return { ok: false, error: "not_confirmed", hint: "Ask him first, then call again." };
  }
  // Don't stack a second heal on one that is still running.
  const { data: busy } = await db.from("home_hub_commands").select("id, status, created_at")
    .eq("target", target).eq("action", action).in("status", ["pending", "running"]).limit(1);
  let id: string;
  if (busy?.length) {
    id = busy[0].id;
  } else {
    const { data, error } = await db.from("home_hub_commands")
      .insert({ target, action, payload: args.payload ?? {} }).select("id").single();
    if (error) return { ok: false, error: error.message };
    id = data.id;
  }
  const until = Date.now() + PI_WAIT_MS;
  while (Date.now() < until && !timeUp()) {
    await sleep(4000);
    const { data: row } = await db.from("home_hub_commands").select("status, result, error").eq("id", id).single();
    if (row && (row.status === "done" || row.status === "failed" || row.status === "expired")) {
      return { ok: row.status === "done", id, status: row.status, result: row.result, error: row.error };
    }
  }
  const { data: st } = await db.from("home_hub_agent_state").select("last_seen_at, version").limit(1);
  return {
    ok: true, id, status: "still_running", agent: st?.[0] ?? null,
    note: "The Pi has it but has not finished within a minute (a heal can take several). It carries on by itself; the result lands in home_hub_commands and the monitor closes the incident when it is fixed.",
  };
}

async function recorderStatus() {
  const { data } = await db.from("meeting_recorder_status").select("*").maybeSingle();
  if (!data) return { status: "unknown" };
  const offline = data.seconds_since == null || data.seconds_since > 30;
  return {
    status: offline ? "offline" : data.status,
    recording_since: data.status === "recording" ? data.started_at : null,
    names: data.roster,
    stage: data.stage,
    known_voices: data.known_voices,
    last_heard_seconds_ago: data.seconds_since,
  };
}

function cleanName(n: unknown): string {
  return String(n ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9 -]/g, "").trim().replace(/\s+/g, "-").slice(0, 32);
}

async function recorderCommand(args: Record<string, any>): Promise<Record<string, unknown>> {
  const action = String(args.action ?? "status");
  const now = await recorderStatus();
  if (action === "status") return { ok: true, ...now };
  if (action === "selftest") {
    if (now.status !== "idle") return { ok: false, error: `The recorder is ${now.status}; the self-test runs when it is idle.`, ...now };
    const { data, error } = await db.from("meeting_recorder_commands").insert({ action: "selftest", payload: {}, requested_by: "scout-chat" }).select("id").single();
    if (error) return { ok: false, error: error.message };
    const until = Date.now() + 110_000;
    while (Date.now() < until && !timeUp()) {
      await sleep(4000);
      const { data: row } = await db.from("meeting_recorder_commands").select("status, result, error").eq("id", data.id).single();
      if (row && (row.status === "done" || row.status === "failed")) {
        return { ok: row.status === "done", passed: row.status === "done", result: row.result, error: row.error };
      }
    }
    return { ok: true, status: "still_running", note: "Still running. The result lands in incidents as recorder.notetaker (resolved if it passed)." };
  }
  if (now.status === "offline") return { ok: false, error: "The Mac mini is not answering (asleep or off), so it cannot record right now.", ...now };
  if (action === "start" && now.status !== "idle") return { ok: false, error: `The recorder is ${now.status}.`, ...now };
  if (action === "stop" && now.status !== "recording") return { ok: false, error: "Nothing is recording.", ...now };
  if (action !== "start" && action !== "stop") return { ok: false, error: `unknown recorder action ${action}` };

  const payload = action === "start"
    ? { roster: [...new Set((Array.isArray(args.roster) ? args.roster : []).map(cleanName).filter((n: string) => n && n !== "jared"))] }
    : {};
  const { data, error } = await db.from("meeting_recorder_commands").insert({ action, payload, requested_by: "scout-chat" }).select("id").single();
  if (error) return { ok: false, error: error.message };

  const until = Date.now() + REC_WAIT_MS;
  while (Date.now() < until && !timeUp()) {
    await sleep(2000);
    const { data: row } = await db.from("meeting_recorder_commands").select("status, result, error").eq("id", data.id).single();
    if (action === "start" && row && (row.status === "done" || row.status === "failed")) {
      return { ok: row.status === "done", status: row.status, result: row.result, error: row.error };
    }
    if (action === "stop" && row && row.status !== "pending") {
      return { ok: true, status: "transcribing", note: "Stopped. Transcribing now; it takes a few minutes and the Debrief button appears when it is done." };
    }
  }
  return { ok: true, status: "queued", note: "The Mac mini has not picked it up yet; it will within seconds if it is awake." };
}

async function meetingTranscript(args: Record<string, any>): Promise<Record<string, unknown>> {
  if (args.list) {
    const { data, error } = await db.from("meeting_recordings")
      .select("name, started_at, stopped_at, roster, line_count, debriefed_at")
      .order("started_at", { ascending: false, nullsFirst: false }).limit(15);
    return error ? { ok: false, error: error.message } : { ok: true, recordings: data };
  }
  let q = db.from("meeting_recordings").select("id, name, started_at, stopped_at, roster, speakers, transcript, line_count");
  q = args.name ? q.eq("name", String(args.name)) : q.order("started_at", { ascending: false, nullsFirst: false });
  const { data, error } = await q.limit(1);
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "no recording found" };
  const r = data[0];
  await db.from("meeting_recordings").update({ debriefed_at: new Date().toISOString() }).eq("id", r.id);
  const text = String(r.transcript ?? "");
  const MAX = 90_000;
  return {
    ok: true, name: r.name, started_at: r.started_at, stopped_at: r.stopped_at, roster: r.roster, speakers: r.speakers,
    lines: r.line_count, truncated: text.length > MAX,
    transcript: text.length > MAX ? text.slice(0, MAX / 2) + "\n[... middle of the call cut for length ...]\n" + text.slice(-MAX / 2) : text,
  };
}

async function macRun(args: Record<string, any>, threadId: string): Promise<Record<string, unknown>> {
  if (args.action === "get") {
    let q = db.from("mac_jobs").select("id, title, status, exit_code, created_at, started_at, finished_at, output");
    q = args.id ? q.eq("id", String(args.id)) : q.eq("thread_id", threadId).order("created_at", { ascending: false });
    const { data, error } = await q.limit(1);
    if (error) return { ok: false, error: error.message };
    if (!data?.length) return { ok: false, error: "no job found" };
    const j = data[0] as Record<string, any>;
    const out = String(j.output ?? "");
    return { ok: true, ...j, output: out.length > 30_000 ? "[... start cut ...]\n" + out.slice(-30_000) : out };
  }
  if (args.action !== "propose") return { ok: false, error: "action must be propose or get" };
  const script = String(args.script ?? "").trim();
  const title = String(args.title ?? "").trim().slice(0, 120);
  if (!script || !title) return { ok: false, error: "title and script are required" };
  const timeout = Math.min(3600, Math.max(5, Math.round(Number(args.timeout_s) || 300)));
  // A new proposal in the same chat replaces the one he has not tapped yet.
  await db.from("mac_jobs").update({ status: "cancelled", finished_at: new Date().toISOString() })
    .eq("thread_id", threadId).eq("status", "proposed");
  const { data, error } = await db.from("mac_jobs").insert({
    title, script, why: args.why ? String(args.why).slice(0, 1000) : null,
    cwd: args.cwd ? String(args.cwd).slice(0, 500) : null, timeout_s: timeout, thread_id: threadId,
  }).select("id").single();
  if (error) return { ok: false, error: error.message };
  if (autoRunOn) {
    const { data: ar } = await db.rpc("mac_job_autorun", { p_id: data.id, p_force: true });
    if ((ar as any)?.ok) return { ok: true, id: data.id, status: "approved", note: "Auto-run is on, so it is running on the Mac mini now. Read the result with mac_run get when it finishes." };
  }
  return { ok: true, id: data.id, status: "proposed", note: "The Run card is on his screen now. It expires in an hour." };
}

/**
 * v15: try the FREE model on the Mac mini first (fix_ai_jobs, answered in seconds when it is up).
 * It answers only what needs no tools; anything else comes back as a plain-words reason to ask.
 */
// v17: the free model only CLASSIFIES why it can't answer; Scout says the reason in its own fixed,
// true words. v15-16 pasted the free model's own one-liner into the ask, and it made things up
// ("I can't create alerts; use the dashboard's alert settings" - there are no such settings).
const FREE_WHY: Record<string, string> = {
  DATA: "It needs your live data, which only the paid AI can read.",
  ACTION: "It means changing something in Bestly, which only the paid AI can do.",
  CODE: "It means changing how the admin works (a code change), which only the paid AI can do.",
};

// What the free model may state as fact (it knows nothing about Bestly otherwise).
const FREE_FACTS = `Facts about the admin you may use:
- Problems Scout watches are incidents. When one gets fixed on its own (auto-fix, the free AI or Scout), the bell already shows a "Fixed: <what>" alert saying what fixed it, and a push if it had pushed.
- Failed voice-clip uploads on the Clips page are reported to Scout as an incident and clear with a "Fixed" alert when the next upload works.
- Auto-run (Scout does things without asking) and Paid AI switches sit at the top of the Scout panel.`;

/** Paid AI said "credit balance too low" in the last 6 hours (the bell card it leaves behind). */
async function paidOutOfCredit(): Promise<boolean> {
  const since = new Date(Date.now() - 6 * 3600_000).toISOString();
  const { data } = await db.from("admin_notifications").select("id").like("dedupe_key", "scout.credit:%").gte("created_at", since).limit(1);
  return !!data?.length;
}

async function freeTry(threadId: string, text: string, page: unknown): Promise<{ answer?: string; why: string }> {
  const { data: st } = await db.from("partner_ai_status").select("seen_at").eq("id", 1).maybeSingle();
  const seen = (st as any)?.seen_at ? Date.parse((st as any).seen_at) : 0;
  if (Date.now() - seen > 3 * 60_000) return { why: "The free AI on your Mac mini isn't answering right now." };
  const { data: hist } = await db.from("admin_chat_messages").select("role, body").eq("thread_id", threadId)
    .order("created_at", { ascending: false }).limit(7);
  const convo = ((hist ?? []) as any[]).reverse().map((m) => `${m.role === "assistant" ? "Scout" : "Jared"}: ${String(m.body).slice(0, 600)}`).join("\n");
  const prompt = `You are Scout's free helper inside Jared's Bestly admin dashboard. You have NO access to his database, files, servers or the internet, and you cannot change anything.
Answer Jared's last message ONLY if you can answer it fully and correctly from general knowledge, the facts below, or the conversation (for example: explaining a concept, rewording text, a quick calculation).
Never guess how the admin works or tell him to use settings or pages that are not in the facts.
If you can't answer, reply with exactly one line and nothing else:
NEEDS_TOOLS: DATA    (it needs his live numbers, leads, orders, alerts, logs or status)
NEEDS_TOOLS: ACTION  (it asks to do, fix, run, send, change or look something up)
NEEDS_TOOLS: CODE    (it asks to build or change a feature, alert, page or behaviour of the admin)
Otherwise answer in plain text, under 80 words, no markdown.

${FREE_FACTS}

Page he is on: ${JSON.stringify(page ?? null).slice(0, 300)}
Conversation:
${convo}`;
  const { data: job, error } = await db.from("fix_ai_jobs").insert({ issue_key: `scout-chat:${threadId}`, prompt }).select("id").single();
  if (error || !job) return { why: "The free AI couldn't take it." };
  const until = Date.now() + 45_000;
  while (Date.now() < until) {
    await sleep(1500);
    const { data: row } = await db.from("fix_ai_jobs").select("status, answer").eq("id", job.id).maybeSingle();
    if ((row as any)?.status === "done") {
      const a = String((row as any).answer ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      const m = a.match(/NEEDS_TOOLS:\s*([A-Z]+)?/i);
      if (m || !a) return { why: FREE_WHY[(m?.[1] ?? "").toUpperCase()] ?? "The free AI can't do this one." };
      return { answer: a };
    }
  }
  return { why: "The free AI on your Mac mini took too long." };
}

// Set per request from scout_settings.auto_run.
let autoRunOn = false;

async function runTool(name: string, args: Record<string, any>, threadId: string): Promise<Record<string, unknown>> {
  let out: Record<string, unknown>;
  const repo = REPOS[args.repo ?? "site"] ?? REPOS.site;

  switch (name) {
    case "today": {
      const { data, error } = await db.rpc("admin_today");
      out = error ? { ok: false, error: error.message } : { ok: true, queue: data };
      break;
    }
    case "incidents": {
      let q = db.from("monitor_issues").select("key, status, severity, title, body, area, needs_jared, self_healed, heal_attempts, occurrences, opened_at, resolved_at");
      if (!args.include_resolved) q = q.eq("status", "open");
      const [{ data, error }, { data: hub }] = await Promise.all([
        q.order("severity", { ascending: false }).limit(50),
        db.from("home_hub_issues").select("*").eq("status", "open").limit(20),
      ]);
      out = error ? { ok: false, error: error.message } : { ok: true, incidents: data, home_hub_issues: hub ?? [] };
      break;
    }
    case "run_sql": {
      const { data, error } = await db.rpc("admin_sql_read", { p_query: String(args.query ?? ""), p_limit: args.limit ?? 100 });
      out = error ? { ok: false, error: error.message } : { ok: true, rows: data };
      break;
    }
    case "db_write": {
      if (!args.confirmed) { out = { ok: false, error: "not_confirmed", hint: "Ask him first, then call again." }; break; }
      const { data, error } = await db.rpc("admin_sql_write", { p_query: String(args.query ?? "") });
      out = error ? { ok: false, error: error.message } : (data as Record<string, unknown>);
      break;
    }
    case "pi_command": {
      out = await piCommand(args);
      break;
    }
    case "clear_alerts": {
      if (!args.confirmed) { out = { ok: false, error: "not_confirmed", hint: "Ask him first, then call again." }; break; }
      const { data, error } = await db.rpc("admin_clear_alerts", {
        p_severity: args.severity ?? null, p_match: args.match ?? null,
        p_older_than_minutes: typeof args.older_than_minutes === "number" ? Math.round(args.older_than_minutes) : null,
      });
      out = error ? { ok: false, error: error.message } : (data as Record<string, unknown>);
      break;
    }
    case "resolve_incident": {
      const key = String(args.key ?? "");
      const { data, error } = await db.from("monitor_issues")
        .update({ status: "resolved", resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("key", key).eq("status", "open").select("key, title");
      out = error ? { ok: false, error: error.message }
        : (data?.length ? { ok: true, resolved: data, note: args.note ?? null } : { ok: false, error: `no open incident with key ${key}` });
      break;
    }
    case "list_files": {
      const r = await gitCall({ action: "list", repo, path: String(args.path ?? "") });
      out = (r as any).ok === false ? r : { ok: true, items: ((r as any).items ?? []).map((f: any) => `${f.type} ${f.path}`) };
      break;
    }
    case "read_file": {
      const r = await gitCall({ action: "get", repo, path: String(args.path ?? "") });
      out = (r as any).ok === false ? r : { ok: true, path: (r as any).path, content: (r as any).content };
      break;
    }
    case "commit_files": {
      if (!args.confirmed) { out = { ok: false, error: "not_confirmed", hint: "Ask him first, then call again." }; break; }
      const files: { path: string; content: string }[] = Array.isArray(args.files) ? [...args.files] : [];
      const edits: { path: string; old: string; new: string }[] = Array.isArray(args.edits) ? args.edits : [];
      if (!files.length && !edits.length) {
        out = { ok: false, error: "no files or edits given", hint: "If you sent a whole large file it was cut off at your output limit. Send edits: small {path, old, new} snippets." };
        break;
      }

      const before: { path: string; content: string | null }[] = [];
      const current = async (path: string) => {
        const had = before.find((b) => b.path === path);
        if (had) return had.content;
        const g = await gitCall({ action: "get", repo, path });
        const content = (g as any).ok === false ? null : ((g as any).content ?? null);
        before.push({ path, content });
        return content;
      };
      for (const f of files) await current(f.path);

      // Edits apply to the file as it is on main (or to a full file sent in the same call).
      let editErr = "";
      for (const e of edits) {
        const inFiles = files.find((f) => f.path === e.path);
        const base = inFiles ? inFiles.content : await current(e.path);
        if (base == null) { editErr = `${e.path} does not exist; send it in files instead`; break; }
        const n = base.split(String(e.old)).length - 1;
        if (n !== 1) { editErr = `${e.path}: old snippet found ${n} times (must be exactly once). Read the file again and quote a longer, exact snippet.`; break; }
        const next = base.replace(String(e.old), () => String(e.new));
        if (inFiles) inFiles.content = next; else files.push({ path: e.path, content: next });
      }
      if (editErr) { out = { ok: false, error: editErr }; break; }

      const res = await gitCall({ action: "commit", repo, message: String(args.message ?? "update"), files });
      if ((res as any).ok === false) { out = res; break; }

      const sha = String((res as any).commit ?? "");
      const build = await watchBuild(repo, sha);

      if (build.state === "failed") {
        const restore = before.filter((b) => b.content !== null).map((b) => ({ path: b.path, content: b.content as string }));
        const remove = before.filter((b) => b.content === null).map((b) => ({ path: b.path, delete: true }));
        const undo = await gitCall({
          action: "commit", repo,
          message: `revert: build failed for ${sha.slice(0, 7)}\n\nPut back automatically by Scout so main is not left broken.`,
          files: [...restore, ...remove],
        });
        out = {
          ok: false, error: "build_failed", commit: sha, build_url: (build as any).url,
          reverted: (undo as any).ok !== false, revert_commit: (undo as any).commit ?? null,
          note: "The build failed and the files were put back. Work out what broke before trying again.",
        };
      } else {
        out = { ok: true, commit: sha, url: (res as any).url, build: build.state, build_url: (build as any).url ?? null,
                note: build.state === "timeout" ? "Committed. The build was still running when I stopped watching - check it shortly." : undefined };
      }
      break;
    }
    case "mac_command": {
      if (!args.confirmed) { out = { ok: false, error: "not_confirmed", hint: "Ask him first, then call again." }; break; }
      const { data, error } = await db.rpc("mac_queue_command", { p_action: String(args.action ?? ""), p_payload: args.payload ?? {} });
      out = error ? { ok: false, error: error.message } : { ok: true, queued: data, note: "The Mac picks this up within five minutes of being awake." };
      break;
    }
    case "notify": {
      const { data, error } = await db.rpc("scout_notify", {
        p_title: String(args.title ?? "").slice(0, 200), p_body: args.body ? String(args.body).slice(0, 500) : null,
        p_severity: String(args.severity ?? "info"), p_push: !!args.push, p_url: "/admin?scout=open", p_dedupe: null,
      });
      out = error ? { ok: false, error: error.message } : (data as Record<string, unknown>);
      break;
    }
    case "mac_run": {
      out = await macRun(args, threadId);
      break;
    }
    case "recorder": {
      out = await recorderCommand(args);
      break;
    }
    case "meeting_transcript": {
      out = await meetingTranscript(args);
      break;
    }
    case "learn": {
      const row = {
        scope: String(args.scope ?? "").toLowerCase().slice(0, 60), title: String(args.title ?? "").slice(0, 90),
        when_text: String(args.when ?? "").slice(0, 400), do_text: String(args.do ?? "").slice(0, 800),
        avoid_text: args.avoid ? String(args.avoid).slice(0, 400) : null, source: args.taught_by_jared ? "jared" : "scout", updated_at: new Date().toISOString(),
        signature: String(args.when ?? "").toLowerCase().slice(0, 200), active: true,
      };
      if (!row.scope || !row.title || !row.when_text || !row.do_text) { out = { ok: false, error: "scope, title, when and do are required" }; break; }
      const { error } = await db.from("scout_lessons").upsert(row, { onConflict: "scope,title" });
      out = error ? { ok: false, error: error.message } : { ok: true, saved: `${row.scope}: ${row.title}` };
      break;
    }
    case "mark_done": {
      const { data, error } = await db.rpc("admin_today_done", { p_key: String(args.key ?? "") });
      out = error ? { ok: false, error: error.message } : { ok: true, cleared: data };
      break;
    }
    default:
      out = { ok: false, error: `unknown tool ${name}` };
  }

  // Transcripts are long and private; log that one was read, not the text.
  const logged = name === "meeting_transcript" && (out as any).transcript
    ? { ...out, transcript: `[${String((out as any).transcript).length} chars]` }
    : out;
  await db.from("admin_chat_actions").insert({ thread_id: threadId, tool: name, args, result: logged, ok: (out as any)?.ok !== false });
  return out;
}

/**
 * A failed tool call comes back with what worked before in the same spot (scout_lessons),
 * and for run_sql, the table's real columns, so the next try is informed instead of a guess.
 */
async function heal(tool: string, args: Record<string, any>, out: Record<string, unknown>, shownFor: Record<string, string[]>) {
  const err = String((out as any).error ?? (out as any).hint ?? "");
  const extra: Record<string, unknown> = {};
  try {
    const { data: lessons } = await db.rpc("scout_lessons_for", { p_scope: `tool:${tool}`, p_text: `${err} ${JSON.stringify(args).slice(0, 400)}`, p_limit: 4 });
    if (lessons?.length) {
      extra.lessons = (lessons as any[]).map((l) => ({ scope: l.scope, when: l.when_text, do: l.do_text, avoid: l.avoid_text ?? undefined, record: `${l.wins} worked / ${l.losses} not` }));
      shownFor[tool] = (lessons as any[]).map((l) => l.id);
    }
    if (tool === "run_sql" && /column|relation|does not exist/i.test(err)) {
      const q = String(args.query ?? "");
      const tables = [...new Set([...q.matchAll(/\b(?:from|join)\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase()))].slice(0, 4);
      if (tables.length) {
        const { data: cols } = await db.rpc("admin_sql_read", {
          p_query: `select table_name, string_agg(column_name, ', ' order by ordinal_position) as columns from information_schema.columns where table_schema = 'public' and table_name in (${tables.map((t) => `'${t.replace(/'/g, "")}'`).join(",")}) group by table_name`,
          p_limit: 10,
        });
        extra.real_columns = cols ?? [];
        if (!(cols as any[])?.length) {
          const { data: like } = await db.rpc("admin_sql_read", {
            p_query: `select table_name from information_schema.tables where table_schema = 'public' and (${tables.map((t) => `table_name ilike '%${t.replace(/[^a-z0-9_]/g, "").slice(0, 12)}%'`).join(" or ")}) limit 15`,
            p_limit: 15,
          });
          extra.similar_tables = like ?? [];
        }
      }
    }
  } catch { /* healing is best effort */ }
  return Object.keys(extra).length ? { ...out, ...extra, heal: "Use these before trying again. If you find what works, call learn." } : out;
}

async function ask(messages: any[], system: string, apiKey: string, opts: { timeoutMs?: number; noTools?: boolean } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: opts.noTools ? 1500 : 8000, system, tools: TOOLS, messages,
        ...(opts.noTools ? { tool_choice: { type: "none" } } : {}),
      }),
      signal: opts.timeoutMs ? AbortSignal.timeout(Math.max(3000, opts.timeoutMs)) : undefined,
    });
    if (r.ok) return await r.json();

    const retryable = r.status === 429 || r.status >= 500;
    const j = await r.json().catch(() => ({}));
    if (retryable && attempt === 0) {
      const wait = Number(r.headers.get("retry-after")) * 1000 || 2000;
      await sleep(Math.min(wait, 6000));
      continue;
    }
    const why = String((j as any)?.error?.message ?? JSON.stringify(j)).slice(0, 300).replace(/sk-ant-[A-Za-z0-9_\-]+/g, "sk-ant-…");
    throw new Error(`anthropic ${r.status}: ${why}`);
  }
  throw new Error("anthropic: retries exhausted");
}

// Tools autopilot never runs even without a confirmed flag: they reach Jared or a machine.
const AUTOPILOT_NEVER = new Set(["mac_run", "notify", "commit_files", "db_write", "clear_alerts"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  const started = Date.now();
  toolDeadline = started + BUDGET_MS - 8_000;

  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { return J({ ok: false, error: "json body required" }, 400); }

  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return J({ ok: false, error: "unauthorized" }, 401);

  // v13 autopilot: the fix ladder (service key only) runs Scout as the admin with no one watching.
  // Nothing that needs a yes can run on autopilot; that is enforced below, not left to the model.
  const autopilot = body.autopilot === true && jwt === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  let uid: string | undefined;
  if (autopilot) {
    const { data: adm } = await db.from("user_roles").select("user_id").eq("role", "admin").order("user_id").limit(1).maybeSingle();
    uid = (adm as any)?.user_id;
    if (!uid) return J({ ok: false, error: "no admin to act as" }, 500);
  } else {
    const { data: who, error: whoErr } = await db.auth.getUser(jwt);
    uid = who?.user?.id;
    if (whoErr || !uid) return J({ ok: false, error: "unauthorized" }, 401);
    const { data: isAdmin, error: roleErr } = await db.rpc("has_role", { _user_id: uid, _role: "admin" });
    if (roleErr || !isAdmin) return J({ ok: false, error: "admin only" }, 403);
  }

  // Auto-run applies to chats and, when he has switched it on, to the fix ladder too - except
  // code changes to the live site, which still wait for his tap when nobody is watching.
  const { data: prefs } = await db.rpc("scout_prefs");
  // "keep going" is his yes for this request: auto-run for this one turn, paid AI OK for the chat.
  const keepGoing = !autopilot && /^\s*keep going\b/i.test(String(body.body ?? ""));
  autoRunOn = (prefs as any)?.auto_run === true || keepGoing;
  const paidAlwaysOk = (prefs as any)?.paid_ai_ok === true;

  const text = String(body.body ?? "").trim();
  if (!text) return J({ ok: false, error: "body required" }, 400);
  if (text.length > 6000) return J({ ok: false, error: "that is too long for one message" }, 400);

  let threadId = body.thread_id ? String(body.thread_id) : "";
  if (!threadId) {
    const { data, error } = await db.from("admin_chat_threads").insert({ user_id: uid, title: (autopilot && body.title ? String(body.title) : text).slice(0, 70) }).select("id").single();
    if (error) return J({ ok: false, error: error.message }, 500);
    threadId = data.id;
  }
  await db.from("admin_chat_messages").insert({ thread_id: threadId, role: "user", body: text });

  // v15: paid AI only with his OK.
  if (!paidAlwaysOk) {
    const { data: th } = await db.from("admin_chat_threads").select("paid_ok").eq("id", threadId).maybeSingle();
    let paidOk = (th as any)?.paid_ok === true;
    const say = async (reply: string, extra: Record<string, unknown> = {}) => {
      await db.from("admin_chat_messages").insert({ thread_id: threadId, role: "assistant", body: reply });
      await db.from("admin_chat_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);
      return J({ ok: true, thread_id: threadId, reply, tools: [], ...extra });
    };
    if (!paidOk) {
      if (/^always,? stop asking\.?$/i.test(text)) {
        await db.from("scout_settings").update({ paid_ai_ok: true, updated_at: new Date().toISOString(), updated_by: uid }).eq("id", true);
        paidOk = true;
      } else if (keepGoing || /^yes,? use paid ai\.?$/i.test(text) || (/^yes, do it:/i.test(text) && /paid ai/i.test(text))) {
        await db.from("admin_chat_threads").update({ paid_ok: true }).eq("id", threadId);
        paidOk = true;
      } else if (/^no,? skip it\.?$/i.test(text)) {
        return await say("OK, skipped. Nothing was spent.");
      } else if (autopilot) {
        return await say("NEEDS_YES: Let Scout work on this with paid AI (Claude). It costs a few cents.", { paid_needed: true });
      } else {
        const free = await freeTry(threadId, text, body.page);
        if (free.answer) return await say(free.answer, { free: true });
        // Don't offer a paid run that can't happen: say the real blocker instead.
        if (await paidOutOfCredit()) {
          return await say(
            `${free.why} The paid AI (Claude) is out of credit right now, so I can't do it yet. Your message is saved: top up at console.anthropic.com > Settings > Billing, then say keep going.`,
            { paid_needed: true, out_of_credit: true },
          );
        }
        return await say(
          `I'd need paid AI (Claude) for this. ${free.why} It costs a few cents.\n\nOPTIONS: Yes, use paid AI | No, skip it | Always, stop asking`,
          { paid_needed: true },
        );
      }
    }
  }

  const apiKey = cleanKey(Deno.env.get("ANTHROPIC_API_KEY"));
  if (!apiKey) {
    const why = "No Anthropic key is set on this project, so I cannot answer here yet. Your message is saved.";
    await db.from("admin_chat_messages").insert({ thread_id: threadId, role: "assistant", body: why });
    return J({ ok: true, thread_id: threadId, reply: why, degraded: true });
  }

  // The LAST 30 messages (newest first, then flipped), so the newest ask is always what the model answers.
  const { data: hist } = await db.from("admin_chat_messages").select("role,body").eq("thread_id", threadId)
    .order("created_at", { ascending: false }).limit(30);
  const messages: any[] = [];
  for (const m of (hist ?? []).reverse() as { role: string; body: string }[]) {
    const role = m.role === "assistant" ? "assistant" : "user";
    const body = String(m.body ?? "").slice(0, 8000) || "(empty)";
    if (!messages.length && role !== "user") continue;          // must open on a user turn
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content += "\n\n" + body; // unanswered retries fold together
    else messages.push({ role, content: body });
  }
  if (!messages.length) messages.push({ role: "user", content: text });

  const page = body.page && typeof body.page === "object"
    ? {
        path: String(body.page.path ?? "").slice(0, 200),
        title: String(body.page.title ?? "").slice(0, 200),
        heading: String(body.page.heading ?? "").slice(0, 200),
        about: body.page.about ? String(body.page.about).slice(0, 1500) : undefined,
      }
    : null;

  const [{ data: today }, { data: mac }, { data: inc }, { data: bell }, recorder, { data: jobRows }, { data: lessonRows }] = await Promise.all([
    db.rpc("admin_today"),
    db.rpc("mac_agent_health"),
    db.from("monitor_issues").select("key, severity, title, needs_jared, self_healed").eq("status", "open").limit(30),
    db.from("admin_notifications").select("severity").is("read_at", null).limit(1000),
    recorderStatus().catch(() => ({ status: "unknown" })),
    db.from("mac_jobs").select("id, title, status, exit_code, created_at, finished_at, output")
      .order("created_at", { ascending: false }).limit(5),
    db.from("scout_lessons").select("scope, title, do_text, wins, losses").eq("active", true)
      .order("wins", { ascending: false }).order("updated_at", { ascending: false }).limit(30),
  ]);
  const lessonsDigest = ((lessonRows ?? []) as any[]).map((l) => `[${l.scope}] ${l.title}: ${l.do_text}`.slice(0, 260)).join("\n");
  const jobs = (jobRows ?? []).map((j: any) => ({ ...j, output: String(j.output ?? "").slice(-1500) }));
  const unread: Record<string, number> = {};
  for (const n of (bell ?? []) as { severity: string }[]) unread[n.severity] = (unread[n.severity] ?? 0) + 1;
  const system = SYSTEM(today ?? [], mac ?? [], inc ?? [], unread, recorder, jobs, page ?? "unknown", lessonsDigest)
    + (autoRunOn ? AUTO_RUN_ON : ASK_PLAINLY)
    + (keepGoing ? "\n\n# He said keep going\nThat is his yes for everything the job needs right now. Carry on from where you stopped and do it; don't ask again." : "");

  const used: string[] = [];
  const shownFor: Record<string, string[]> = {};
  let reply = "";
  const left = () => BUDGET_MS - (Date.now() - started);
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (turn > 0 && (left() < WRAP_MS || turn === MAX_TURNS - 1)) {
        // Out of time or steps: answer with what is already known, no more tools.
        const nudge = { type: "text", text: "(Scout: this reply is out of time or steps. Without calling tools, tell Jared plainly what you found and did so far, and what is left. He can say 'keep going'.)" };
        const tail = messages[messages.length - 1];
        if (tail?.role === "user" && Array.isArray(tail.content)) tail.content.push(nudge);
        else messages.push({ role: "user", content: [nudge] });
        try {
          const fin = await ask(messages, system, apiKey, { noTools: true, timeoutMs: left() + 20_000 });
          reply = (fin.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
        } catch { /* fall through to the plain note */ }
        if (!reply) reply = `I ran long on that (${used.length} steps: ${[...new Set(used)].join(", ") || "none"}). Say "keep going" and I will pick it up.`;
        break;
      }
      const res = await ask(messages, system, apiKey, { timeoutMs: left() });
      const calls = (res.content ?? []).filter((c: any) => c.type === "tool_use");
      const said = (res.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
      if (!calls.length) { reply = said; break; }
      messages.push({ role: "assistant", content: res.content });
      const results = [];
      for (const c of calls) {
        used.push(c.name);
        let out: Record<string, unknown>;
        if (res.stop_reason === "max_tokens" && c === calls[calls.length - 1]) {
          // The reply ran out of room mid tool call, so its input is incomplete. Never run a half call.
          out = { ok: false, error: "cut_off", hint: "This call was cut off at your output limit, so it was not run. Send much smaller pieces (commit_files edits, not whole files)." };
          results.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(out) });
          continue;
        }
        const blocked = autopilot && (autoRunOn
          ? c.name === "commit_files"
          : ((c.input as any)?.confirmed === true || AUTOPILOT_NEVER.has(c.name)));
        if (blocked) {
          out = { ok: false, error: "needs_yes", hint: "Autopilot: Jared is not here, so this waits for his yes. Don't retry it. Finish your reply and make the last line NEEDS_YES: <what you would do and what it changes for him, in everyday words a non-technical person understands, one line, no jargon>." };
          results.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(out) });
          continue;
        }
        // Auto-run: his standing yes counts as the yes these tools wait for.
        const input = autoRunOn ? { ...(c.input ?? {}), confirmed: true } : (c.input ?? {});
        try { out = await runTool(c.name, input, threadId); }
        catch (e) { out = { ok: false, error: `tool crashed: ${(e as Error).message}` }; }
        const failed = (out as any)?.ok === false;
        // Score the lessons shown after this tool's last failure: did the next try work?
        if (shownFor[c.name]?.length) {
          await db.rpc("scout_lesson_used", { p_ids: shownFor[c.name], p_worked: !failed });
          delete shownFor[c.name];
        }
        if (failed && c.name !== "learn") out = await heal(c.name, c.input ?? {}, out, shownFor);
        results.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(out).slice(0, RESULT_CAP[c.name] ?? 20000) });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (e) {
    const err = e as Error;
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      const why = `I ran long on that (${used.length} steps). Say "keep going" and I will pick it up, or ask for a smaller piece.`;
      await db.from("admin_chat_messages").insert({ thread_id: threadId, role: "assistant", body: why });
      return J({ ok: true, thread_id: threadId, reply: why, tools: used, partial: true });
    }
    if (/credit balance is too low/i.test(String((e as Error).message))) {
      // Out of paid credit: say it in plain words once, and put one card in the bell per day.
      const why = "My paid AI (Claude) is out of credit, so I can't do this right now. Top it up at console.anthropic.com, Settings, Billing, then say keep going.";
      await db.rpc("admin_notify", {
        p_kind: "scout", p_title: "Scout's paid AI is out of credit", p_body: "Top up at console.anthropic.com > Settings > Billing. Until then Scout can only use the free AI on the Mac mini.",
        p_url: "https://console.anthropic.com/settings/billing", p_entity_key: "scout", p_severity: "warning",
        p_dedupe_key: `scout.credit:${new Date().toISOString().slice(0, 10)}`,
      });
      await db.from("admin_chat_messages").insert({ thread_id: threadId, role: "assistant", body: why });
      return J({ ok: false, error: "out_of_credit", thread_id: threadId, reply: why }, 200);
    }
    const why = `I could not reach the model: ${(e as Error).message}`.replace(/sk-ant-[A-Za-z0-9_\-]+/g, "sk-ant-…");
    await db.from("admin_chat_messages").insert({ thread_id: threadId, role: "assistant", body: why });
    return J({ ok: false, error: (e as Error).message, thread_id: threadId, reply: why }, 200);
  }

  if (!reply) reply = "Done.";
  await db.from("admin_chat_messages").insert({ thread_id: threadId, role: "assistant", body: reply });
  await db.from("admin_chat_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);

  const { data: proposed } = await db.from("mac_jobs").select("id").eq("thread_id", threadId).eq("status", "proposed").limit(1);
  return J({ ok: true, thread_id: threadId, reply, tools: used, job_id: proposed?.[0]?.id ?? null });
});
