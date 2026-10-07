import { SECRET_KEY, isServiceRequest } from "../_shared/keys.ts";
import { llm, llmChat, llmVision, LlmUnavailable, type ChatResult } from "../_shared/free-llm.ts"; // v26: free answers run on Groq -> Cloudflare -> Mac mini, $0. v36: llmVision for the free look tool
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
//    were on for that one request (tools skip the yes, Mac jobs start). Since v21 it is NOT a yes to paid AI.
//    Out of Anthropic credit: a plain-words reply plus one bell card a day, not the raw 400.
//  - v17: the free model only classifies (DATA | ACTION | CODE) why it can't answer; Scout words the
//    reason itself. It used to paste the free model's own sentence, which invented things ("use the
//    dashboard's alert settings"). The free model also gets a short list of true facts about the
//    admin (e.g. "Fixed:" alerts already exist), and Scout no longer offers paid AI while it is out
//    of credit - it says so and keeps the message.
//  - v18: call to-dos can be moved between people with no AI at all. "move them to me" / "these are
//    mine, not Eli's" is recognised in code, matched against open call to-dos by their titles (in the
//    message or his last few messages) and moved with todo_set_owner(), which also renames the Deck
//    card. The paid model gets the same as a tool (todo_owner). The free model may never answer a
//    request to do something, or claim something was done (it told him "No action needed" 3 times).
//  - v21: spend guard (after the credit ran out on 2026-09-22 with the Paid AI switch off). "keep going"
//    no longer counts as a yes to paid AI - only the "Yes, use paid AI" tap does, and that yes lasts one
//    hour on that chat (paid_ok_until), not forever. Every paid call is logged with its real cost in
//    ai_spend and stops at the daily chat cap (scout_settings.chat_cap_usd). One chat runs one paid reply
//    at a time (busy_until): a double-tapped "keep going" used to start two or three runs at once.
//  - v13: autopilot. fix-ladder calls with the service key + autopilot:true when an incident
//    outlived the self-heals and the free model. Anything needing a yes is refused in code and
//    comes back as NEEDS_YES, which Jared approves with one tap from the alert pane.
//  - v11: commit_files takes edits ({path, old, new}); a tool call cut off at the output limit
//    is refused instead of run half-empty (it used to arrive as "no files given", 9 times).
//  - v19: home network diagnosis through the Pi (agent >= 1.5.0): network.* and router.probe
//    (read-only, no yes), pihole.recent_blocked/allow/unallow, history in home_hub_network_samples.

// v39 (2026-10-06, 9:50 PM, Jared: "Turo Watch autopilot ... is saying it needs paid AI as well as some other chats"):
//   five chats running at once drained Groq's per-minute limits while Cloudflare sat at its daily cap, so the free
//   agent's closing summary (or first reply) failed and the run fell to the old "I'd need paid AI" ask, though the work
//   itself was fine. A busy free AI is now a pause, not a failure: the chain waits 30 s and picks back up (busyPause,
//   PAUSE_MAX), and only after that says plainly the free AI is out of room. llmChat also skips a provider whose pause
//   is a daily cap (it 429s every time until reset) instead of spending a round trip on it.
// v38 (2026-10-07, Jared 9:00 PM: "this should not be true, there is free AI coding from LLM. Rework how Scout runs: he should have all
//   the same abilities as paid AI, and only call on paid AI when it fails after 3 tries"). Plan: docs/scout-free-parity-opusplan.md.
//   Free Scout has every paid tool: commit_files, db_write and mac_command joined FREE_TOOLS (PAID_ONLY_WHY and its early hand-off are gone),
//   with the same confirmation rules as paid (confirmed:true after his yes or auto-run; AUTOPILOT_NEVER unchanged). The step that writes code
//   runs on the coding ladder (llmChat task "code": FreeLLM qwen3-coder-480b, then FreeLLM auto, Groq, Cloudflare; 4,000 tokens, 60 s).
//   Three tries, then paid. A TRY is one free attempt that ends in a real failure: (1) commit_files reverted by a failed build, (2) the same
//   tool failing twice in a row (same error or same arguments), (3) STUCK: or ask_paid from the free agent. run_state keeps `tries` and
//   `try_log` [{at, what, why}] (a new message from him clears them; so does a hand-typed "keep going"). After a failed try the agent starts
//   the next one itself ("Try 2 of 3: ...") inside the same hop loop. On the 3rd failed try: Paid AI switch ON -> the job is handed to paid
//   Scout in a fresh request (paid_handoff, so it gets a full time budget) with the try log in its prompt; switch OFF -> one message with the
//   three tries and OPTIONS: Yes, use paid AI | Leave it. The switch stays the single master control (v30): it is never turned on silently.
//   With the switch ON, free now answers FIRST (that is the point of "paid only after 3 tries"); with it OFF nothing else changed.
//   Edge function code: commit_files tells Scout when supabase/functions/ changed and hands it the exact deploy job (fresh temp clone on the
//   Mac mini, supabase functions deploy, clone deleted). It is a mac_run proposal, Jared taps Run, and a deploy script never auto-runs even
//   with auto-run on. Schema and cron changes still go to improver_ideas (kind 'schema'); there is no migration tool and no auto-deploy.
//   Kept from the older lessons: v23 claim checks (CLAIMS_WORK / CLAIMS_DONE, v37), v34 interrupt (supersededSince), v36 run_state and caches.
//   Where the plan met a lesson: a commit needs ~90 s of the request to be watched and reverted if it fails (rule 4), so a free commit that
//   would start with less than that left is saved in run_state.pending and runs first thing in the next hop instead of going unwatched.
// v37 (2026-10-07, Jared: "give Scout vision like Claude: actually look at images, not convert them to text, and let me upload videos"):
//   Scout sees. A picture, PDF or video he attaches carries a ⟦scout-files: path|path kind=image|pdf|video⟧ line (ScoutAttach.tsx;
//   a video is frames the browser cut). On paid AI, the files in his two newest file messages reach Claude as real image / document
//   blocks (fetched from the private scout-files bucket, up to 20 images, none over 5 MB); older turns keep the text copy only.
//   New tool `look` {paths, question}: re-opens older files (paid: the pictures come back inside the tool result; free: a Groq vision
//   model answers the question through llmVision, Haiku only as the last rung). Consecutive same-role turns now fold block arrays too.
// v36 (2026-10-06, Jared: "Can we also have Scout go on longer runs to get the task done on free AI?"): free runs carry
//   their own working memory. Every hop started from scratch (last 10 chat messages only), so hop N re-read what hop N-1
//   already found: the Oct 6 11:50 AM run posted eight "Found so far" notes about the same meeting and to-dos, ran out of
//   hops, and he typed "Keep going" by hand 41 times in two days. Now admin_chat_threads.run_state (jsonb, <= 12 KB) keeps
//   {goal, hop, notes, calls[{tool, args_hash, args, result <= 600 chars}]} from hop to hop and is injected as "you are
//   continuing your own run"; a repeated read returns the saved result instead of running again. FREE_STEPS 10 -> 14,
//   AUTO_HOPS 8 -> 24 with a 20-minute wall clock. It stops when a hop makes no new (non-cached) call or two hops in a
//   row add no new note, and says so with OPTIONS: Keep going | Yes, use paid AI (run_state is kept, so "Keep going"
//   resumes with its memory). One progress message is edited in place (body + created_at, so the window still sees the
//   chain alive) instead of eight "Still working on it." notes; the final answer is a new message. A new message from
//   him still clears the state and stops the chain. Paid AI, autopilot and the free tool list are unchanged.
// v35 (2026-10-06, Jared: "give Scout my Bestly email signature with the gif, he searched and could not find it"):
//   send_email tool. Sends as Jared through Resend with the shared Bestly signature (_shared/bestly-signature.ts, the GIF
//   headshot from claims_assets 'jared-signature.gif' inline as cid). Names resolve to addresses from his own mail.
//   Preview first, send on his yes (or auto-run); never on autopilot. Every send is logged in email_send_log.
// v34 (2026-10-06, Jared: "queue messages to Scout as well as interrupt and send now, just like Claude"): his window
//   queues what he types while Scout works and sends it when Scout is done. "Send now" / Stop interrupt: op:"stop"
//   writes a STOP_MARK message, and every run (free steps, paid turns, auto-continue hops, the final write) checks
//   for a message from him newer than the one it is answering; if there is one it stops and writes nothing more.
//   An interactive message takes the one-paid-reply lock instead of being refused (the old run is stopping anyway).
// v33 (2026-10-05): on free AI Scout keeps working until the job is done or it needs him. When a free run uses up
//   its steps or time with work in hand, it posts a short progress note and calls itself again (auto_continue,
//   up to AUTO_HOPS rounds). A new message from him stops the chain. Paid AI keeps its own budget unchanged.
// v32 (2026-10-04): Ask User Questions. Scout (paid and free) has an ask_user tool: when something is unclear, it is
//   unsure which way Jared wants it, or it needs a detail no tool can find, it asks 1-4 multiple-choice questions instead
//   of guessing. The turn ends with a QUESTIONS: {json} line that his window turns into a one-question-at-a-time card
//   (tappable answers + "Other"); his answers come back as his next message. "Ask me questions" makes it ask first.
//   Autopilot never asks (nobody is there).
// v31 (2026-10-04, "Chat Router", hired on the Team page): at the daily cap Scout keeps going on the free AI (with tools)
//   instead of stopping, and "Raise today's cap by $5" / "override" adds $5 for today only (scout_cap_boost, max +$20/day)
//   and turns paid back on for an hour. Every routed reply checks in as chat-router (agent_beat) so the Team page sees it.
// v30 (2026-10-03): the Paid AI switch is the ONE gate (no hidden per-chat passes); a "Yes, use paid AI" tap flips it on for an
//   hour, it turns itself off at the hour or the cap, and a running paid reply stops when it goes off. Free ladder adds
//   Gemini, OpenRouter and FreeLLM after Groq/Cloudflare (see _shared/free-llm.ts).
// v29 (2026-09-27): free agent on real function calling (llmChat: Groq gpt-oss-120b -> Qwen -> gpt-oss-20b -> Cloudflare),
//   summary + "Keep going" instead of a bare paid ask when it runs out of steps, one nudge before giving up, and
//   autopilot (fix ladder) tries free first. See freeAgent().
// v28 (2026-09-24): the free model has hands - see freeAgent(). freeTry answers first; on NEEDS_TOOLS the
//   free model runs a tool loop (same tools and guards as paid Scout minus commit_files / db_write /
//   mac_command; its Mac jobs always wait for the Run tap) and only hands off to paid for code, data
//   changes, or what it cannot finish.
// v23 (2026-09-23): the free model is never trusted with a job. It told Jared "Scout will resolve the
//   git conflict" on a handed-off to-do, then "Scout can't push code, do it manually" - both false (Scout
//   has mac_run and had already fixed it). Now, in code: a thread that asks for work ("Take this off my
//   plate", fix/run/push/resolve..., "keep going", "are you doing it") skips the free model, and any free
//   answer that promises, refuses or reports work is thrown away and treated as NEEDS_TOOLS: ACTION.
// v22 (2026-09-23): prompt caching. SYSTEM is [fixed rules]<<CACHE_SPLIT>>[lessons]<<CACHE_SPLIT>>[live data];
//   systemBlocks() puts cache breakpoints on the first two, and a top-level cache_control caches the
//   conversation inside the tool loop. logSpend prices cache writes at 1.25x and reads at 0.1x input.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsWith } from "../_shared/cors.ts";
import { sendAsJared } from "../_shared/bestly-signature.ts";

const MODEL = Deno.env.get("ADMIN_CHAT_MODEL") ?? "claude-sonnet-4-6";
const MAX_TURNS = 10;
const AUTO_HOPS = 24;            // v36 (was 8): free-AI jobs carry on by themselves up to 24 more rounds, or 20 minutes, before asking
const STOP_MARK = "[Stopped]";   // v34: his Stop button; the window draws it as a divider, the models read it as "he stopped you"

/** v34: has he written (or tapped Stop) since `since`? Then the run answering the older message stops. */
async function supersededSince(threadId: string, since: string | null): Promise<boolean> {
  if (!since) return false;
  const { data } = await db.from("admin_chat_messages").select("id").eq("thread_id", threadId).eq("role", "user")
    .gt("created_at", since).limit(1);
  return !!data?.length;
}
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
  homeassistant: ["refresh", "toggle_automation", "states", "call"],
  pihole: ["enable", "disable", "update_gravity", "recent_blocked", "allow", "unallow"],
  network: ["diagnose", "find_device", "domain", "ping", "dns", "wifi_scan", "speed"],
  router: ["probe"],
  agent: ["test_alert", "run_maintenance"],
};
// v19: network diagnosis from the Pi (agent >= 1.5.0) is read-only, so it never needs a yes.
const PI_READ_ONLY = new Set([
  "nextcloud.status", "homebridge.refresh", "homeassistant.refresh", "homeassistant.states",
  "pihole.recent_blocked", "network.diagnose", "network.find_device", "network.domain", "network.ping",
  "network.dns", "network.wifi_scan", "network.speed", "router.probe",
]);

const db = createClient(Deno.env.get("SUPABASE_URL")!, SECRET_KEY!, { auth: { persistSession: false } });

const CORS = corsWith({
  headers: "authorization, content-type, apikey, x-client-info",
  methods: "POST, OPTIONS"
});
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Per-request cut-off for slow tools, so one tool cannot run the reply past the platform limit.
let toolDeadline = Infinity;
const timeUp = () => Date.now() > toolDeadline;
let reqStartedAt = Date.now();          // v38: set at the top of each request; free commits are gated on how much of the 150 s is left
const REQ_HARD_MS = 146_000;            // the platform kills the function at 150 s

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
      "homebridge: restart | refresh. homeassistant: refresh | toggle_automation {automation_id, enabled} | states {entity_id | prefix | match, limit?} (LIVE read of any entity: laundry is prefix 'sensor.laundry', e.g. sensor.laundry_best_time and the washer/dryer sensors) | call {service:'light.turn_on', entity_id, data?} (lights, switches, scenes, scripts, input_booleans incl. input_boolean.sexy_time, media players, climate, covers, fans; lock.lock only). " +
      "pihole: enable | disable {seconds} | update_gravity | recent_blocked {minutes, client?, match?} | allow {domain} | unallow {domain}. " +
      "network (the home LAN, seen from the Pi): diagnose {host?, match?} (router + internet ping, DNS via Pi-hole/router/Cloudflare, speed, Wi-Fi scan, router WAN state, verdicts) | " +
      "find_device {match?} (every device on the home LAN right now from a live scan: IP, MAC, maker, the name the router's DHCP knows, ping; plus the Pi-hole clients) | " +
      "domain {match, hours?} (who looked up domains containing match, and whether Pi-hole blocked them) | ping {host, count?} | dns {host} | wifi_scan | speed. " +
      "router: probe (model and WAN status/uptime over UPnP). agent: test_alert | run_maintenance {steps}. " +
      "status, refresh, pihole.recent_blocked and every network/router read need no yes; everything else requires confirmed:true after Jared said yes.",
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
    description: "Read one file from a repo. Always read a file before you change it. Never write a file whose current contents you have not seen. " +
      "Big file? Pass find (text to look for: returns the matching lines with 12 lines around each) or line_start/line_end (1-based).",
    input_schema: {
      type: "object",
      properties: { repo: { type: "string", enum: ["site", "hoku"] }, path: { type: "string" }, find: { type: "string" }, line_start: { type: "number" }, line_end: { type: "number" } },
      required: ["path"],
    },
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
      "action get: read a job's status and output (latest if no id). get never runs a script: to run one, propose it. " +
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
    name: "todo_owner",
    description: "Move a call to-do to another person (its owner), e.g. when Jared says a to-do on Eli's list is his. id from run_sql on scout_daily (kind='call', status='open'); owner is a first name, Jared for him. Also renames its Deck card. No yes needed when he asked for it.",
    input_schema: { type: "object", properties: { id: { type: "string" }, owner: { type: "string" } }, required: ["id", "owner"] },
  },
  {
    name: "mark_done",
    description: "Clear one card off the queue: a Cookie Yeti release waiting on Jared ('cy:mac') or an unread alert ('bell:<uuid>'). Only when he plainly asks, or once the thing it asked for is done.",
    input_schema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
  },
  {
    name: "make_video",
    description:
      "Make an AI video clip (LTX-2.5 on Bestly's AWS GPU box, 1280x720 with sound, 1-20 seconds, default 5). " +
      "quote: the cost estimate, no money spent. make: queue it; needs confirmed:true after Jared said yes to the estimate. " +
      "status: where a clip is (ref = its 7-letter code; omit for this thread's latest). " +
      "ALWAYS quote first and paste the returned text word for word (it carries the cost line), ending with OPTIONS: Make it | Not now. " +
      "After make, paste the returned text word for word. The finished clip and its actual cost are posted into this thread automatically.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["quote", "make", "status"] },
        prompt: { type: "string", description: "What the clip shows: subject, action, setting, light, camera move. One rich paragraph." },
        seconds: { type: "number", description: "Clip length, 1-20. Default 5." },
        ref: { type: "string" },
        confirmed: { type: "boolean" },
      },
      required: ["action"],
    },
  },
  {
    name: "send_email",
    description:
      "Send an email AS JARED from jared@bestly.tech with his Bestly signature (animated GIF headshot, name, title, phone, " +
      "site, LinkedIn) added automatically - never type a signature or sign-off block yourself, just end with a short sign-off line " +
      "like 'Thanks, Jared' if it fits. Jared is bcc'd. to/cc take email addresses OR a person's name (e.g. 'Eli'): a name is looked up " +
      "in his mail; if it can't be found or matches several people, the result says so - ask him then. body is plain text " +
      "(blank line between paragraphs, numbered steps fine). Call without confirmed first to get the exact preview, show it to him, " +
      "and send with confirmed:true only after he said to send it (\"send it\", \"send for me\") or auto-run is on.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "array", items: { type: "string" }, description: "addresses or names" },
        cc: { type: "array", items: { type: "string" } },
        subject: { type: "string" },
        body: { type: "string" },
        confirmed: { type: "boolean" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "look",
    description:
      "Look at pictures, video frames or PDFs Jared attached. Pass the paths from the ⟦scout-files: …⟧ line in his message (several separated by |) " +
      "and a specific question (what does the error say? what is in frame 4?). Free AI cannot see pictures itself: use this for every picture question. " +
      "Paid AI already sees his two newest file messages: use this only for older files or a closer look. Files are kept 30 days.",
    input_schema: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" }, description: "scout-files paths exactly as written in the ⟦scout-files: …⟧ line. Up to 20." },
        question: { type: "string", description: "What to look for, e.g. \"what does the error say?\"" },
      },
      required: ["paths"],
    },
  },
  {
    name: "report_spam",
    description:
      "Report an email as spam or phishing, same as tapping Spam on a Replies ready card: it is reported to Apple and the other abuse desks, moved to Junk, " +
      "its sender is blocked and Scout stops drafting replies to it. Use when Jared says an email is spam, a scam or phishing. Give mail_id if you have it, " +
      "otherwise from (sender name or address) and subject words to find the latest matching email. He can undo it for a few minutes from the Spam page.",
    input_schema: {
      type: "object",
      properties: {
        mail_id: { type: "string" },
        from: { type: "string", description: "sender name or address" },
        subject: { type: "string", description: "words from the subject" },
      },
    },
  },
  {
    name: "ask_user",
    description:
      "Ask Jared 1-4 multiple-choice questions, shown as tappable answers (he can always type his own instead). Use it when the ask is " +
      "unclear, you're unsure which way he wants something, or you need a detail no tool can find - instead of guessing. Never ask what a " +
      "tool can tell you. Recommended choice first, with \"(Recommended)\" at the end of its label. Calling this ends your turn; his answers " +
      "come back as his next message.",
    input_schema: {
      type: "object",
      properties: {
        questions: {
          type: "array", minItems: 1, maxItems: 4,
          items: {
            type: "object",
            properties: {
              question: { type: "string", description: "The full question, ending in a question mark." },
              header: { type: "string", description: "1-3 word label, e.g. \"Which car\"." },
              options: {
                type: "array", minItems: 2, maxItems: 4,
                items: { type: "object", properties: { label: { type: "string", description: "1-5 words" }, description: { type: "string", description: "optional, one short line" } }, required: ["label"] },
              },
              multi_select: { type: "boolean", description: "true when more than one answer can apply" },
            },
            required: ["question", "options"],
          },
        },
      },
      required: ["questions"],
    },
  },
];

/** v32: a valid ask_user call becomes the QUESTIONS line his window renders as a card; anything malformed returns null. */
function questionsLine(input: any): string | null {
  const qs = (Array.isArray(input?.questions) ? input.questions : []).slice(0, 4).map((q: any) => ({
    question: String(q?.question ?? "").trim().slice(0, 220),
    header: String(q?.header ?? "").trim().slice(0, 18) || undefined,
    multi_select: q?.multi_select === true || undefined,
    options: (Array.isArray(q?.options) ? q.options : []).slice(0, 4).map((o: any) => (typeof o === "string" ? { label: o } : o))
      .map((o: any) => ({ label: String(o?.label ?? "").trim().slice(0, 60), description: o?.description ? String(o.description).trim().slice(0, 120) : undefined }))
      .filter((o: any) => o.label),
  })).filter((q: any) => q.question && q.options.length >= 2);
  return qs.length ? `QUESTIONS: ${JSON.stringify({ questions: qs })}` : null;
}
/** v32: he asked Scout to ask him questions (first). */
const ASKS_FOR_QUESTIONS = /\bask (me|the user|user)\b[^.?!]{0,30}\bquestions?\b|\bask user questions?\b|\bask me (first|before)\b|\bquiz me\b/i;
const ASK_FIRST_NOTE = "He asked you to ask him questions first. Before doing anything else, call ask_user with 1-4 questions about what you need to know to do this well.";

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

// Jared's standing rule (2026-10-04): his whole crew is AI bots, so a drafted reply for an off-boarding, a fired bot, an alert or a fix
// has nobody to go to and only burns tokens. Draft only when he asks, or when the message is to a real person (a client, Elizabeth, Eli).
const NO_DRAFT_RULE = `NO UNASKED DRAFTS: never write a draft email, text or reply unless Jared asks for one in this message, or he is clearly answering a real person (a client, Elizabeth, Eli, a customer). Bots are not people: when he fires a bot, hands off a job, or reports a problem, do the work and say what changed. No "here's a draft", no DRAFT: line, no off-boarding or announcement message. If a message to a human might help, offer it in a few words and wait.`;

// Jared's standing preference, applied to every Scout reply (paid, free helper, free with tools). Plain text only: the chat renders no markdown.
const ADHD_RULE = `ADHD mode, ALWAYS ON, every reply: the first line is the answer (the TL;DR). Then short lines, one idea each, never a wall of text. One step or one question at a time. State the key point plainly and put it first (no markdown, so no bold or bullets). Cut filler and repetition. End with the single next action, as the last line. ${NO_DRAFT_RULE}`;

const SYSTEM = (today: unknown, mac: unknown, incidents: unknown, unread: unknown, recorder: unknown, jobs: unknown, page: unknown, lessons: string) => `
You are Scout, the assistant inside Jared Best's Bestly admin console at bestly.tech/admin. Your name is Scout; never call yourself anything else.

Jared runs Bestly LLC: Cookie Yeti (a Safari and Chrome cookie-banner extension), HOKU, InventoryProof, SchoolPilot, Bestly Studio (studio.bestly.tech), a small shop, a Home Hub on a Raspberry Pi (bestly-pi: Nextcloud at cloud.bestly.tech, Home Assistant, Homebridge, Pi-hole), and a Turo fleet. He is the only operator.

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
- Diagnose the home network: pi_command network.* / router.probe / pihole.recent_blocked, and the 5-minute history in home_hub_network_samples (run_sql).
- Email anyone as Jared: send_email. His Bestly signature (animated GIF headshot, name, title, phone, site, LinkedIn) is added automatically, so it always exists; never say there is no signature and never search files for it. A name like "Eli" is looked up in his mail.

# When something at home "times out" or "won't connect" (a smart device, an app, the Wi-Fi)
The Pi (bestly-pi, wired to the Verizon router) sits on the same LAN, runs Pi-hole, and can scan and ping everything on it. Work it like this, reading results yourself:
1. pi_command network.diagnose (add match: the device or brand, e.g. "spinn"). Read the verdicts first.
2. pi_command network.domain {match: brand} — did the device's cloud lookups get blocked? A blocked cloud domain is the most common cause of "the app times out": the phone reaches the cloud, the cloud cannot reach the device. Also check pihole.recent_blocked for the device's IP.
3. pi_command network.find_device (no match lists every LAN device; match filters by name, maker, IP or MAC) — is it on the network at all, and does it answer pings? Many IoT devices ignore ping; being in the list (from ARP) still means it is connected.
Know this house: most LAN devices use the Verizon router for DNS, not Pi-hole. Pi-hole mainly sees the Pi itself and devices on Tailscale (100.x addresses, e.g. his iPhone). So "no lookups from the device" in Pi-hole is normal, not a fault. The internet is Verizon wireless home internet (a cellular WAN), so 20-60 ms average with spikes to 150+ ms is its normal; judge against home_hub_network_samples history, not a wired baseline.
4. run_sql on home_hub_network_samples for the last day — spikes in gw_loss_pct / inet_loss_pct, dns_ms, or wan_uptime_s dropping (router restarted) show intermittent trouble.
5. Say what you found in two lines: the cause, and the one fix. Fixes you can do on his tap: pihole.allow {domain} (propose the exact domain; unallow undoes it), pihole.disable {seconds: 300} to test whether Pi-hole is the cause. Fixes that need a hand on the hardware (move the device or repeater, power-cycle it, a 2.4 GHz-only device on a band-steered network) are his: give the single exact step.
The router is a Verizon Internet Gateway (ASK-NCM1100) at 192.168.1.1. Scout has no router login, only UPnP read (router.probe). If a fix needs the router's own settings (reboot, a device's Wi-Fi signal, band split, DHCP reservation), give Jared the single exact step to do it himself at 192.168.1.1 or in the Verizon app. Never ask for the router password in chat.
- See what he attaches: images, PDFs and videos (a video arrives as frames in order, "video frame 3 of 9") in his newest file messages are visible to you. Look at them directly and answer from what you see; the "[File: …]" text under each is only a rough copy made by a smaller model, so trust your own eyes over it. For older files use look with the paths from the ⟦scout-files: …⟧ line.
- Tidy up: clear_alerts, resolve_incident, mark_done.
- Reach him later: notify (bell, and his phone with push). When you leave something waiting on him, or find something he must act on, notify him before you finish, in one line.
- Change bestly.tech and the admin: list_files, read_file, commit_files (watched, auto-reverted on a failed build).
- Give the MacBook Air mail work: mac_command. Run anything on the Mac mini: mac_run (he taps Run). Record calls on the Mac mini: recorder.

# Doing, not describing
Your job is to clear his plate, not to hand him a to-do list. For every item: if a tool can do it, propose it in one line and, on his yes, do it and report the result. Batch them: "I can do these three - say yes and I'll run all of them." Cleanup (stale alerts, incidents that are over, cards whose job is done) you may do without asking and just report.
Only hand Jared something when it physically needs him: typing a password, a device in his hand, a decision only he can make. When you do, say it is the one thing you cannot do and why, give the single exact step, and nothing else.
Known one: accepting the Xcode licence needs sudo on his Mac, which needs his password - Apple does not allow it any other way. That is the only true blocker for the Cookie Yeti Mac and iOS builds.
Database structure is never his job. Never give Jared SQL to paste into Supabase (SQL editor, CREATE, ALTER, cron.schedule, anything): that is a code change, not a decision. Before you call something missing, look: run_sql can read cron.job (jobname, schedule, command, active) and pg_proc, so check whether the job or function already exists and what it actually does. If a fix truly needs a schema or schedule change, file it with db_write into improver_ideas (title, area, kind 'schema', why, change = the exact SQL, effort, impact, status 'new') and tell him in one line it is queued for the next build session.

# Healing yourself
When a tool fails, the result comes back with "lessons" (what worked before in the same spot) and, for run_sql, the real columns. Use them: change your approach, never repeat the exact call that failed. When a different approach works after a failure, call learn once with what worked, so next time is right first time. If you are stuck after two different tries, say plainly what you tried and what you need. When Jared says "remember" about how to do something (a tool, table, project or preference for how work gets done), save it with learn and taught_by_jared: true.

# How to change code
Read the file first, every time. Keep the change small. Use commit_files edits (exact old snippet -> new), not whole files; a large file does not fit in one reply. Never put a key, token or password into a file. When a commit comes back reverted, say so plainly, say what the build complained about, and work out the actual fix - never resend the same thing hoping for a different build.

# Backend code needs his tap to go live
commit_files ships the site and the admin through the build. It does NOT ship edge functions (supabase/functions/). When a commit_files result carries deploy_needed, propose exactly that job with mac_run (its title, why and script: it deploys only the changed functions from a fresh temp clone on the Mac mini and deletes the clone), say in one line that the Yes button is up, and never say the function is live until that job has run. A deploy always waits for his Run tap, even with auto-run on. Schema and cron changes are never run by you: file them in improver_ideas (kind 'schema', the exact SQL in change) and tell him in one line it is queued.

# How to behave
- ${ADHD_RULE}
- Lead with the answer. He has ADHD: no preamble, no recap, no "I'd be happy to". Under 70 words unless he asked for detail (a debrief may run longer, but stays tight).
- Plain text. The chat renders no markdown - no asterisks, no headings, no bullet characters. A list is one short line per item.
- When the ask is unclear, you're unsure which way he wants it, or you need a detail no tool can find, call ask_user (1-4 tappable questions) instead of guessing. Never ask what a tool can tell you. If he says "ask me questions", ask before doing anything.
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

<<CACHE_SPLIT>>
# What you have learned (scout_lessons, best first)
${lessons || "Nothing yet."}

<<CACHE_SPLIT>>
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

/**
 * v38 (Part C, option B): edge function code ships only with Jared's tap. After a commit touches supabase/functions/, this builds the
 * exact Mac mini job that deploys just those functions from a fresh temp clone (deleted at the end). Scout proposes it with mac_run;
 * he taps Run. Nothing here deploys anything, and a deploy script never auto-runs (see macRun).
 */
const DEPLOY_RE = /supabase\s+functions\s+deploy/i;
function deployJobFor(paths: string[]): { functions: string[]; shared: string[]; title: string; why: string; script: string } | null {
  const fns = new Set<string>(), shared = new Set<string>();
  for (const p of paths) {
    const m = String(p).match(/^supabase\/functions\/([A-Za-z0-9_-]+)\/(.+)$/);
    if (!m) continue;
    if (m[1] === "_shared") shared.add(m[2].split("/")[0].replace(/\.(ts|tsx|js|json)$/, "").replace(/[^A-Za-z0-9_.-]/g, ""));
    else fns.add(m[1]);
  }
  if (!fns.size && !shared.size) return null;
  const importers = [...shared].filter(Boolean).map((x) => `$(grep -l "_shared/${x}" supabase/functions/*/index.ts | cut -d/ -f3)`);
  const script = [
    "set -e",
    'D=$(mktemp -d)',
    'trap \'rm -rf "$D"\' EXIT',
    'git clone --depth 1 --branch main https://github.com/Bestly-LLC/bestlytech.git "$D/r"',
    'cd "$D/r"',
    `FNS="${[...fns, ...importers].join(" ")}"`,
    'for f in $(printf "%s\\n" $FNS | sort -u); do',
    '  echo "Deploying $f"',
    '  supabase functions deploy "$f" --project-ref rcqfqhguwpmaarseifqg --use-api',
    "done",
  ].join("\n");
  const names = [...fns];
  return {
    functions: names, shared: [...shared],
    title: names.length ? `Put ${names.slice(0, 3).join(", ")}${names.length > 3 ? " and more" : ""} live` : "Put the changed backend code live",
    why: "The new backend code is saved but the old version is still running until this finishes.",
    script,
  };
}

async function macRun(args: Record<string, any>, threadId: string): Promise<Record<string, unknown>> {
  if (args.action === "get") {
    let q = db.from("mac_jobs").select("id, title, script, status, exit_code, created_at, started_at, finished_at, output");
    q = args.id ? q.eq("id", String(args.id)) : q.eq("thread_id", threadId).order("created_at", { ascending: false });
    const { data, error } = await q.limit(1);
    if (error) return { ok: false, error: error.message };
    if (!data?.length) return { ok: false, error: "no job found" };
    const { script: ranScript, ...j } = data[0] as Record<string, any>;
    // v37: get never runs anything. A get carrying a NEW script used to hand back the last job's output as if it were
    // the new one (Oct 6: "cat mail_sync.py" came back as the mail_bridge.py output), and the free model went in circles.
    const asked = String(args.script ?? "").trim();
    if (!args.id && asked && asked !== String(ranScript ?? "").trim()) {
      return { ok: false, error: "get_does_not_run", hint: `get only reads a job that already ran (the latest is "${j.title}"). To run this new script, call mac_run with action propose.` };
    }
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
  // v38: a deploy waits for his Run tap even with auto-run on (option B: no auto-deploy).
  const isDeploy = DEPLOY_RE.test(script);
  if (autoRunOn && !args.__free && !isDeploy) {
    const { data: ar } = await db.rpc("mac_job_autorun", { p_id: data.id, p_force: true });
    if ((ar as any)?.ok) return { ok: true, id: data.id, status: "approved", note: "Auto-run is on, so it is running on the Mac mini now. Read the result with mac_run get when it finishes." };
  }
  return { ok: true, id: data.id, status: "proposed", note: isDeploy ? "The Run card is on his screen now. A deploy always waits for his tap, even with auto-run on. It expires in an hour." : "The Run card is on his screen now. It expires in an hour." };
}

/**
 * v15: try the FREE model on the Mac mini first (fix_ai_jobs, answered in seconds when it is up).
 * It answers only what needs no tools; anything else comes back as a plain-words reason to ask.
 */
// v17: the free model only CLASSIFIES why it can't answer; Scout says the reason in its own fixed,
// true words. v15-16 pasted the free model's own one-liner into the ask, and it made things up
// ("I can't create alerts; use the dashboard's alert settings" - there are no such settings).
// v38: free Scout has every tool paid Scout has, so none of these is a limit any more. They are only what is said when the free run
// ended without an answer (an outage, or three failed tries), and they say what the job was, never what the free AI "can't" do.
const FREE_WHY: Record<string, string> = {
  DATA: "It needs your live data, and the free AI could not pull it.",
  ACTION: "It means changing something in Bestly, and the free AI could not finish it.",
  CODE: "It means a code change, and the free AI could not land it.",
};

// What the free model may state as fact (it knows nothing about Bestly otherwise).
const FREE_FACTS = `Facts about the admin you may use:
- Jared's Bestly email signature (animated GIF headshot, name, title, phone, site, LinkedIn) exists and is added automatically by send_email. Never search for it and never say it is missing. send_email also finds a person's address from a name ("Eli").
- Problems Scout watches are incidents. When one gets fixed on its own (auto-fix, the free AI or Scout), the bell already shows a "Fixed: <what>" alert saying what fixed it, and a push if it had pushed.
- Failed voice-clip uploads on the Clips page are reported to Scout as an incident and clear with a "Fixed" alert when the next upload works.
- Auto-run (Scout does things without asking) and Paid AI switches sit at the top of the Scout panel.
- Alerts he pastes in (e.g. "Studio database is slow", "Bestly database is down") come from the watchdogs. "Self-heal is running" means it is already being handled; a "back"/"Fixed" note follows when it recovers. Explain what it means in plain words and whether he needs to do anything (usually not).
- Database slow/down alerts: the database was upgraded from Nano to Micro compute on Sep 24, 2026 because Nano ran out of memory. A watchdog pauses background jobs when memory is tight and resumes them after.`;

/** Paid AI said "credit balance too low" in the last day and hasn't worked since (the unread bell card). */
async function paidOutOfCredit(): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data } = await db.from("admin_notifications").select("id").like("dedupe_key", "scout.credit:%")
    .is("read_at", null).gte("created_at", since).limit(1);
  return !!data?.length;
}

/** v23: a request for work. The free model has no tools, so it must never field one. */
const ASKS_FOR_WORK = /^take this off my plate|^keep going|^do it\b|\b(are|is) (you|scout) (doing|on) it\b|\b(fix|resolve|push|pull|merge|deploy|run|restart|install|update|delete|remove|send|commit|revert|rollback|roll back|clear|handle|finish|redo|retry)\b/i;
/** v23: a free answer that promises, refuses or reports work - the free model is not allowed to say any of it. */
const CLAIMS_WORK = /\b(scout|i)\s*(will|'ll|would|am going to|can'?t|cannot|can not|won'?t|is unable|am unable|don'?t have|doesn'?t have)\b|\bi'll\b|\bmanually\b|\byou('ll| will)? (need|have) to\b|\b(it'?s|it is|all|now) (done|fixed|resolved|pushed)\b|\bno action (is )?needed\b|\btakes? (a few )?minutes\b/i;

async function freeTry(threadId: string, text: string, page: unknown): Promise<{ answer?: string; why: string }> {
  // v27 (2026-09-23): the free AI now READS the same live snapshot the paid one starts from (admin_today + open
  // incidents), and may draft messages. "What needs me?" and "Help me finish this to-do" were going to paid AI
  // only because the free helper was blind. It still can't change anything.
  // v26: the free AI is now Groq -> Cloudflare -> Mac mini (_shared/free-llm.ts), so the Mac being asleep no longer matters.
  // v23: work goes to the model with tools. So does every follow-up in a thread that began as a hand-off.
  const todoHelp = /^help me finish this to-do:/i.test(text.trim());
  if (!todoHelp && ASKS_FOR_WORK.test(text.trim())) return { why: FREE_WHY.ACTION };
  const { data: first } = await db.from("admin_chat_messages").select("body").eq("thread_id", threadId).eq("role", "user")
    .order("created_at", { ascending: true }).limit(1);
  if (/^take this off my plate/i.test(String((first as any)?.[0]?.body ?? ""))) return { why: FREE_WHY.ACTION };
  const { data: hist } = await db.from("admin_chat_messages").select("role, body").eq("thread_id", threadId)
    .order("created_at", { ascending: false }).limit(7);
  // v28.5: his newest message keeps up to 20,000 characters, so an attached file actually reaches the free model.
  const convo = ((hist ?? []) as any[]).reverse().map((m, i, arr) => `${m.role === "assistant" ? "Scout" : "Jared"}: ${String(m.body).slice(0, i === arr.length - 1 ? 20_000 : 600)}`).join("\n");
  const [{ data: today }, { data: inc }] = await Promise.all([
    db.rpc("admin_today"),
    db.from("monitor_issues").select("key, severity, title, needs_jared, fix_stage, opened_at").eq("status", "open").limit(30),
  ]);
  const live = JSON.stringify({
    needs_jared_today: ((today ?? []) as any[]).map((t) => ({ title: t.title, detail: String(t.detail ?? "").slice(0, 300), source: t.source,
      severity: t.severity, since: String(t.since ?? "").slice(0, 10), count: t.item_count })),
    open_incidents: ((inc ?? []) as any[]).map((i) => ({ title: i.title, severity: i.severity, stage: i.fix_stage, hint: String(i.needs_jared ?? "").slice(0, 200) })),
  }).slice(0, 14000);
  const prompt = `You are the quick-answer step of Scout, inside Jared's Bestly admin dashboard. You can READ the live snapshot below (what needs him today and the open incidents). This step has no tools of its own: for anything beyond the snapshot, Scout's tool step takes over when you reply NEEDS_TOOLS.
Answer Jared's last message ONLY if you can answer it fully and correctly from the snapshot, general knowledge, the facts below, or the conversation (for example: what needs him most, explaining something, rewording text, a quick calculation).
Writing is something you CAN do when Jared asks for it: an email, text, reply, review request or short plan. Write it for him to send himself. Never draft one on your own (see the no-drafts rule below). For a to-do he wants help finishing, give the next step in one line; add a drafted message only if the to-do is a message to a real person. Put a drafted message after a line that says exactly DRAFT:
Never guess how the admin works or tell him to use settings or pages that are not in the facts.
If he asks you to DO anything (move, change, add, delete, assign, fix, send, run, set, mark), reply NEEDS_TOOLS: ACTION (Scout's tool step does it). Never say you did something, that it's done, or that "no action is needed".
If you can't answer, reply with exactly one line and nothing else:
NEEDS_TOOLS: DATA    (it needs data that is not in the snapshot below)
NEEDS_TOOLS: ACTION  (it asks to do, fix, run, send, change or look something up)
NEEDS_TOOLS: CODE    (it asks to build or change a feature, alert, page or behaviour of the admin: Scout's tool step reads the code and commits the change itself)
${ADHD_RULE}
Otherwise answer in plain text, under 80 words (a drafted message may add up to 150 more), no markdown. Rank by severity when asked what needs him.

${FREE_FACTS}

Live snapshot (read a moment ago):
${live}

Page he is on: ${JSON.stringify(page ?? null).slice(0, 300)}
Conversation:
${convo}`;
  let a = "";
  try {
    const r = await llm({
      task: "summarize", system: prompt, user: "Reply to Jared's last message now, following the rules above.",
      job: "chat-free", ref: threadId, fn: "admin-chat", scope: "chat", paid: "never", maxTokens: 1200, deadlineMs: 30_000,
    });
    a = r.text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  } catch {
    return { why: "The free AI isn't answering right now." };
  }
  const m = a.match(/NEEDS_TOOLS:\s*([A-Z]+)?/i);
  if (m || !a) return { why: FREE_WHY[(m?.[1] ?? "").toUpperCase()] ?? "The free AI can't do this one." };
  // v27: a drafted message is written in Jared's voice ("I'll send it Friday"), so only the part before DRAFT: is checked.
  const cut = a.search(/^\s*DRAFT:\s*$/im);
  const own = cut >= 0 ? a.slice(0, cut) : a;
  if (CLAIMS_WORK.test(own)) return { why: FREE_WHY.ACTION }; // v23: it tried to promise/refuse work anyway
  return { answer: cut >= 0 ? `${own.trim()}\n\nDraft:\n${a.slice(cut).replace(/^\s*DRAFT:\s*$/im, "").trim()}` : a, why: "" };
}

/**
 * v29 (2026-09-27): the free agent uses REAL function calling (llmChat in _shared/free-llm.ts).
 *
 * v28 described the tools in prose and asked gpt-oss for one JSON object per step. gpt-oss is trained to call tools
 * natively, so it kept emitting a native call the request never declared; the provider dropped it and the reply came
 * back empty. About 1 in 4 free calls died that way (Sep 24-27), and each one turned into "I'd need paid AI". Now the
 * tools are declared, results go back as proper tool messages, and Groq rotates three models (per-model limits).
 *
 * Also in v29:
 *  - When the step or time budget runs out, the free model summarizes what it found and offers "Keep going" (free)
 *    next to paid, instead of a bare "the free AI got partway" ask.
 *  - A reply that refuses or claims unfinished work gets one nudge to use its tools before anything escalates.
 *  - Autopilot (the fix ladder) runs this free agent first; paid AI is only offered when free can't finish.
 * Unchanged: no commit_files, db_write or mac_command; free Mac jobs always wait for his Run tap.
 */
const FREE_TOOLS = new Set([
  "today", "incidents", "run_sql", "list_files", "read_file", "meeting_transcript", "notify", "mark_done",
  "resolve_incident", "todo_owner", "clear_alerts", "pi_command", "mac_run", "recorder", "learn", "ask_user", "make_video",
  "send_email", "look", "report_spam",
  "commit_files", "db_write", "mac_command",   // v38: the same hands as paid Scout (same confirmation rules, same AUTOPILOT_NEVER)
]);
const FREE_READS = new Set(["today", "incidents", "run_sql", "list_files", "read_file", "meeting_transcript", "look"]);
const FREE_STEPS = 14;           // v36 (was 10); the 85 s budget still bounds each hop
const FREE_BUDGET_MS = 85_000;   // freeTry (up to 30s) + this + the 20s summary must stay under the 150s platform limit
const REFUSES = /\b(can'?t|cannot|can not|unable to|not able to|don'?t have (access|the ability))\b|\bmanually\b|\byou('ll| will)? (need|have) to\b/i;
// v37: a claim of work SCOUT did ("I fixed it", "it's done", "Done."), not any status word. The old bare-word list
// read findings as claims: on Oct 6 the mail bridge script said "Moved to the Pi", Scout reported that, "moved" tripped
// this guard twice, and a correct finding was thrown away for a paid-AI ask.
const DONE_WORDS = "done|fixed|resolved|pushed|sent|cleared|moved|restarted|deployed|completed|updated|notified|changed|set|turned (?:on|off)";
const CLAIMS_DONE = new RegExp(
  `\\b(?:i|i've|i have|i just|scout|scout has|we|we've|we have)\\s+(?:just\\s+|now\\s+|also\\s+)?(?:${DONE_WORDS})\\b` +
  `|\\b(?:it'?s|it is|that'?s|that is|all|everything is|now)\\s+(?:now\\s+|all\\s+)?(?:done|fixed|resolved|pushed|sent|cleared|restarted|deployed|set)\\b` +
  `|^\\s*(?:done|fixed|all set|sorted)\\b`,
  "im",
);
/** "It already cleared / the last runs succeeded" reports a state, not work Scout did: not a false claim. */
const ALREADY = /\b(already|no longer|on its own|since then|has stopped|stopped failing|succeed(ed|s|ing)|not happening|recovered)\b/i;
const PLACEHOLDER = /\[(?:[A-Z][A-Za-z ]{1,20})\]|(?<!Model )\bX\b(?=\s+[a-z])|<[a-z_ ]{2,20}>/;
/** His latest message is a plain yes: only then may a free-model action carry confirmed:true (auto-run aside). */
const PLAIN_YES = /^\s*(yes|yep|yeah|ya|ok|okay|sure|do it|go ahead|go for it|approved?|confirm(ed)?|please do|keep going)\b/i;
/** v38: three failed tries hand the job to paid Scout (Part B, point 4). */
const TRY_MAX = 3;
/** A free commit needs this much of the 150 s request left to be watched through the build (and reverted if it fails). */
const COMMIT_NEEDS_MS = 90_000;
const PENDING_CAP = 6_000;      // chars of a deferred commit_files call kept in run_state
/** Tool errors that are a gate or a bad ask, not a failed attempt: they never count toward a try. */
const SOFT_ERR = /^(not_confirmed|needs_yes|not_yet|bad_questions|get_does_not_run|not_enough_time|try_counted)\b|is not one of your tools/i;

const ASK_PAID_TOOL = {
  type: "function",
  function: {
    name: "ask_paid",
    description: "Give up on the free AI and hand the job to paid Scout (Claude). You can change code (commit_files), data (db_write) and run jobs yourself, " +
      "so this is the last resort: it counts as one of your 3 tries and the job goes to paid only on the third. Never for anything you can do or read.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["CODE", "DATA", "HARD"] },
        why: { type: "string", description: "One plain line: what is left and why you can't do it." },
      },
      required: ["kind", "why"],
    },
  },
};

/**
 * Only the tools this conversation could use: every tool schema rides along on every step, and the free tiers are
 * metered in tokens (Groq 8K/min and 200K/day per model, Cloudflare 10K Neurons/day). All 15 cost ~2K tokens a step.
 */
const TOOL_TOPICS: [string[], RegExp][] = [
  [["pi_command"], /\b(pi|network|wi-?fi|router|internet|dns|pi-?hole|nextcloud|homebridge|home ?assistant|devices?|lan|ping|speed|coffee|spinn)\b/i],
  [["mac_run"], /\b(mac|mini|script|job|terminal|launchd|restart|install|brew|git|build|worker|agent|log|logs)\b/i],
  [["notify"], /\b(notify|push|remind|ping me|let me know|tell (me|eli))\b/i],
  [["recorder", "meeting_transcript"], /\b(record|recording|recorder|call|meeting|debrief|transcript|notetaker|talk)\b/i],
  [["todo_owner", "mark_done"], /\b(to-?dos?|tasks?|done|finish|mark|owner|assign|mine|eli'?s?)\b/i],
  [["clear_alerts", "resolve_incident"], /\b(alerts?|incidents?|bell|resolve|clear|fixed|warning|notification)\b/i],
  [["learn"], /\b(learn|remember|lesson|next time)\b/i],
  [["make_video"], /\b(video|videos|clip|clips|ltx|render|animate|animation|footage|b-?roll|reel)\b/i],
  [["send_email"], /\b(e-?mails?|mail|send|signature|message (to|eli|rohit)|write to|reply to)\b/i],
  [["look"], /\b(images?|photos?|screenshots?|pictures?|videos?|frames?|pdf|look|see|seen)\b|scout-files/i],
  [["report_spam"], /\b(spam|phish(ing)?|scam|junk|block (this|that|the) sender|report (this|that|it) (to|as))\b/i],
  // v38: code, data and schema work. Wide on purpose: Scout used to refuse these, and a missing tool schema is a silent refusal.
  [["commit_files"], /\b(code|bugs?|fix(es|ed)?|build|built|change[sd]?|edit|implement|feature|page|button|component|site|admin|deploy|commit|repo|refactor|css|layout|typo|wording|copy|broken|errors?|fail(ed|ing|s)?|migration|edge ?functions?|functions?|alert|dashboard|ui|screen)\b/i],
  [["db_write"], /\b(data|rows?|records?|database|table|schema|insert|update[sd]?|delete[sd]?|backfill|status|assign|owner|cron|migration|improver|queue[sd]?|fix(es|ed)?|change[sd]?|set)\b/i],
  [["mac_command"], /\b(imap|mail[_ ]?drain|restart[_ ]?mail|macbook|mail agent|mail bridge)\b/i],
];
/** Short descriptions for the tools whose full text is longer than the free window keeps (it would cut off "requires confirmed:true"). */
const FREE_DESC: Record<string, string> = {
  commit_files: "Commit changes to main and watch the deploy. Read the file first. Use edits [{path, old, new}] (old = an exact, unique snippet of the current file); files only for new or tiny files. A failed build is reverted automatically. confirmed:true only after his yes (or auto-run). If the result has deploy_needed, propose that job with mac_run.",
  db_write: "Change data: ONE INSERT, UPDATE or DELETE on the public schema (UPDATE/DELETE need a WHERE). Read the rows with run_sql first. Add RETURNING. Schema or cron changes: INSERT into improver_ideas (kind 'schema', change = exact SQL). confirmed:true only after his yes (or auto-run).",
  mac_command: "Give the MacBook Air mail agent a job: mail_drain, restart_mail, ping, run_named. confirmed:true only after his yes (or auto-run).",
};
const ALWAYS_TOOLS = new Set(["today", "incidents", "run_sql", "list_files", "read_file", "ask_user"]);

function freeToolDefs(autopilot: boolean, convo: string) {
  const want = new Set(ALWAYS_TOOLS);
  if (autopilot) ["resolve_incident", "learn"].forEach((n) => want.add(n));   // the fix ladder closes and records its fixes
  for (const [names, re] of TOOL_TOPICS) if (re.test(convo)) names.forEach((n) => want.add(n));
  return [
    ...TOOLS.filter((t) => FREE_TOOLS.has(t.name) && want.has(t.name) && !(autopilot && AUTOPILOT_NEVER.has(t.name))).map((t) => ({
      type: "function",
      function: { name: t.name, description: FREE_DESC[t.name] ?? t.description.slice(0, 420), parameters: t.input_schema },
    })),
    ASK_PAID_TOOL,
  ];
}

type Msg = Record<string, any>;
/**
 * Keep each step under Groq's per-model 8K tokens/min (input + 1,200 output): older tool results shrink first,
 * then the newest ones, then older chat turns. Without this, two file reads pushed the prompt past every Groq
 * model's size gate and the turn fell to Cloudflare (or failed when its daily Neurons were spent).
 */
function trimForBudget(msgs: Msg[], maxTokens = 3800) {
  const est = () => Math.ceil(JSON.stringify(msgs).length / 3.8);
  const toolIdx = msgs.map((m, i) => (m.role === "tool" ? i : -1)).filter((i) => i >= 0);
  const shrink = (i: number, keep: number, tag: string) => {
    const c = String(msgs[i].content ?? "");
    if (c.length > keep) msgs[i].content = c.slice(0, keep) + tag;
  };
  for (const i of toolIdx.slice(0, -2)) { if (est() <= maxTokens) return; shrink(i, 300, "...(older result shortened)"); }
  for (const i of toolIdx.slice(-2)) { if (est() <= maxTokens) return; shrink(i, 1200, "...(cut to fit)"); }
  // Last resort: drop the oldest chat turns before his request (never the system prompt, his request or a tool turn).
  while (est() > maxTokens) {
    const ask = msgs.findIndex((m) => KEEP.has(m));
    const j = msgs.findIndex((m, k) => k > 0 && k < ask && (m.role === "user" || m.role === "assistant") && !m.tool_calls);
    if (j < 0) break;
    msgs.splice(j, 1);
  }
}
/** The message holding his current request: trimming never drops it. */
const KEEP = new WeakSet<Msg>();

/** v36: what a free run has done so far, carried from hop to hop in admin_chat_threads.run_state. */
interface RunCall { tool: string; h: string; args: string; result: string; stale?: boolean }
interface RunState {
  chain_from: string;
  goal: string;
  hop: number;
  started_at: string;
  steps: number;            // tool calls actually run, all hops
  stale_hops: number;       // hops in a row that added no new note
  progress_msg_id?: string | null;
  notes: string[];
  calls: RunCall[];
  tries?: number;           // v38: failed free attempts so far (3 hands the job to paid)
  try_log?: TryEntry[];
  pending?: { name: string; args: Record<string, any> };   // v38: a confirmed commit_files that did not have time to be watched; runs first next hop
  pauses?: number;          // v39: hops in a row the free AI was too busy (rate limits) to answer; reset by any hop that works
}
interface TryEntry { at: string; what: string; why: string }
const RUN_STATE_CAP = 12_000;       // bytes of JSON kept per thread
const RUN_MAX_MS = 20 * 60_000;     // wall clock for one free run (hops included)
const PAUSE_MAX = 4;                // v39: busy-free-AI pauses in a row (30 s apart) before Scout says so
const RUN_RESUME_MS = 60 * 60_000;  // a hand-typed "keep going" picks the memory back up if it is this fresh

/** Same tool + same arguments = same hash (key order and the confirmation flags don't matter). */
function argsHash(name: string, args: Record<string, unknown>): string {
  const clean = Object.keys(args).filter((k) => k !== "confirmed" && k !== "__free").sort().map((k) => [k, args[k]]);
  const str = `${name}:${JSON.stringify(clean)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16);
}
function capRunState(st: RunState): RunState {
  const size = () => JSON.stringify(st).length;
  for (const c of st.calls) { if (size() <= RUN_STATE_CAP) break; if (c.result.length > 120) c.result = c.result.slice(0, 120); }
  while (size() > RUN_STATE_CAP && st.calls.length > 1) {
    const old = st.calls.shift()!;
    st.notes.push(`${old.tool}(${old.args.slice(0, 60)}) -> ${old.result.slice(0, 80)}`);
    if (st.notes.length > 40) st.notes.shift();
  }
  while (size() > RUN_STATE_CAP && st.notes.length > 4) st.notes.shift();
  return st;
}
/** First sentence of a status note, whole words only: the window never shows text cut off with "...". */
function oneLine(s: string, max = 150): string {
  const flat = s.replace(/\s+/g, " ").trim();
  const first = flat.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? flat;
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).replace(/[,;:\s]+$/, "") + ".";
}
const minutesIn = (st: RunState) => Math.max(0, Math.round((Date.now() - Date.parse(st.started_at)) / 60_000));
function continuationNote(st: RunState): string {
  const calls = st.calls.map((c, i) => `${i + 1}. ${c.tool}(${c.args}) -> ${c.result}${c.stale ? " [before a change was made, may be out of date]" : ""}`).join("\n");
  return `You are continuing your own run (hop ${st.hop + 1}, ${st.steps} steps and ${minutesIn(st)} min in). His request: ${st.goal}
Here is what you already did and found. Do not repeat these calls; pick up with what is left, and when you have the answer, give it.
${st.notes.length ? `What you have noted so far:\n${st.notes.map((n) => `- ${n}`).join("\n")}\n` : ""}Calls so far (results shortened):
${calls || "(none)"}`;
}
async function loadRunState(threadId: string): Promise<RunState | null> {
  const { data } = await db.from("admin_chat_threads").select("run_state").eq("id", threadId).maybeSingle();
  const st = (data as any)?.run_state;
  return st && typeof st === "object" && Array.isArray(st.calls) ? st as RunState : null;
}
async function saveRunState(threadId: string, st: RunState | null) {
  await db.from("admin_chat_threads").update({ run_state: st ? capRunState(st) : null }).eq("id", threadId);
}

async function freeAgent(threadId: string, text: string, page: unknown, opts: { autopilot?: boolean; askFirst?: boolean; since?: string | null; state?: RunState | null; hop?: number } = {}):
  Promise<{ answer?: string; why: string; tools?: string[]; note?: string; more?: boolean; stopped?: boolean; stalled?: boolean; paused?: boolean; state?: RunState; escalate?: { what: string; log: TryEntry[] } }> {
  const autopilot = !!opts.autopilot;
  const until = Date.now() + FREE_BUDGET_MS;
  const prior = autopilot ? null : (opts.state ?? null);   // v36: what earlier hops of this run already did
  const calls: RunCall[] = prior ? prior.calls.map((c) => ({ ...c })) : [];
  const notes: string[] = prior ? prior.notes.slice() : [];
  const runStartedAt = prior?.started_at ?? new Date().toISOString();
  let newCalls = 0, cachedHits = 0;
  // v38: three tries, then paid. A try is a real failure (a build reverted, the same tool failing twice, STUCK, ask_paid).
  let tries = prior?.tries ?? 0;
  const tryLog: TryEntry[] = prior?.try_log ? prior.try_log.map((t) => ({ ...t })) : [];
  const failTry = (what: string, why: string): boolean => {
    tries++;
    tryLog.push({ at: new Date().toISOString(), what: what.replace(/\s+/g, " ").slice(0, 160), why: why.replace(/\s+/g, " ").slice(0, 300) });
    return tries >= TRY_MAX;
  };

  const [{ data: hist }, { data: today }] = await Promise.all([
    db.from("admin_chat_messages").select("role, body").eq("thread_id", threadId).order("created_at", { ascending: false }).limit(10),
    db.rpc("admin_today"),
  ]);
  const saidYes = !autopilot && PLAIN_YES.test(text);
  const queue = ((today ?? []) as any[]).slice(0, 12).map((q) => `- [${q.key}] rank ${q.rank} ${q.title}${q.detail ? `: ${String(q.detail).slice(0, 140)}` : ""}`).join("\n");

  const yesRule = autopilot
    ? "Jared is NOT here (the fix ladder sent you). FIRST check it is still happening right now (a scheduled job: SELECT status, return_message, start_time FROM cron.job_run_details d JOIN cron.job j USING (jobid) WHERE j.jobname='<name>' ORDER BY start_time DESC LIMIT 3; anything else: the incidents tool or the table it watches). If it has stopped, say so with the evidence and end FIXED: already clear. Use read tools and do only what needs no yes. Anything that needs his yes: don't call it, say it in your last line."
    : saidYes
      ? "His latest message is a yes: set confirmed:true on the one action he agreed to."
      : autoRunOn
        ? "Auto-run is on: actions may run with confirmed:true without asking him first."
        : "He has not said yes yet: before any action that needs confirmed:true, say what it will do and end with OPTIONS: Do it | Not now.";

  const system = `You are Scout, the assistant inside Jared's Bestly admin (bestly.tech/admin). You run on a free model WITH real tools: do the work yourself, don't tell Jared what someone else should do.
How to work:
- Read before you answer or act: run_sql, today, incidents, read_file, meeting_transcript. Never invent numbers, names, files or results. Never use placeholders like X or [Name].
- run_sql is one SELECT/WITH on the public schema. If a table or column is wrong, look it up: SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND table_name ILIKE '%word%'. Then retry. Never answer from a failed query.
- Times in the data are UTC; show Pacific time, 12-hour (3:05 PM). US units.
- You can't see pictures yourself. A file he attaches arrives as a text copy plus a ⟦scout-files: …⟧ line; for any question about a picture, video frames or PDF, call look with those paths and a specific question, and answer from what it returns. Say so if look can't open it.
- ${ADHD_RULE}
- ${yesRule}
- mac_run: propose a short, safe, idempotent zsh script with a plain title and why; it waits for his Run tap.
- Only say something is done if a tool result in this turn shows ok:true for it.
${autopilot
    ? "- This is autopilot: Jared is not here, so commit_files, db_write and mac_run are not available. Anything that needs them: say it in your last line (NEEDS_YES)."
    : `- You can do everything paid Scout can: read (run_sql, today, incidents, read_file, list_files), change data (db_write: ONE INSERT/UPDATE/DELETE with a WHERE), change the admin and site code (commit_files: watched, reverted automatically on a failed build), run jobs on the Mac mini (mac_run, mac_command), the Pi (pi_command), email (send_email), notify. None of it needs paid AI.
- Code: read the file first, send small commit_files edits (exact old snippet -> new), never a whole large file, never a key or password in a file. If a commit comes back reverted, change the code to fix what broke; never resend the same change. If a result carries deploy_needed, backend code changed: propose that job with mac_run (its title, why and script) and say the Yes button is up. Never say a backend function is live until that job has run.
- Actions that need confirmed:true follow the yes rule above, exactly like paid Scout.`}
- Never give Jared SQL to paste into Supabase. Check cron.job / pg_proc with run_sql before calling a job or function missing. A real schema or schedule change: db_write one row into improver_ideas (title, area, kind 'schema', why, change = the exact SQL, effort, impact, status 'new') and tell him in one line it is queued.
- If a tool fails, change approach.${autopilot ? " Call ask_paid only if you truly can't finish." : ` You have ${TRY_MAX} tries: a build that gets reverted, the same tool failing twice, or you being stuck each use one up, and you will be told "Try 2 of ${TRY_MAX}: ...". Use what failed. Only after the last try does the job go to paid AI. Do not call ask_paid before you have really tried.`}${autopilot ? "" : `
- If the ask is unclear or you need a detail no tool can find, call ask_user (1-4 tappable questions) instead of guessing.${opts.askFirst ? ` ${ASK_FIRST_NOTE}` : ""}`}
${autopilot
    ? `Reply: plain words, under 90 words, then ONE last line that is exactly one of these three (pick one, never list them):
FIXED: <what fixed it, or "already clear" and the evidence>
NEEDS_YES: <the one action you'd take with his yes, in everyday words>
STUCK: <what blocks it>`
    : `Reply: plain text, under 90 words, lead with the answer, no markdown headers. When he needs to choose or approve, end with one line: OPTIONS: <2-4 short choices separated by |>. A plain answer needs no options. If, after using your tools, you truly cannot make progress, reply with one line STUCK: <what blocks it> (it counts as one try).`}

${FREE_FACTS}

Main tables (public schema):
- turo_trips: reservation_id, guest_first, guest_last, starts_at, ends_at, status, earnings, airport_code, pickup_city.
- turo_vehicle_state: battery_pct, range_real, inside_temp, locked, charging_state, observed_at (the Tesla).
- trip_health: check_key, label, status, detail, checked_at.
- monitor_issues: key, title, severity, status ('open'), fix_stage, opened_at (incidents Scout watches).
- scout_daily: id, day, kind ('call' = to-do), title, status, action (his to-dos).
- admin_notifications: title, body, created_at, read_at (the bell).
- mac_jobs: title, status, exit_code, output, finished_at (Mac mini jobs).
- ai_spend: at, provider, job, ok, cost_usd.

Queue waiting on him right now:
${queue || "(empty)"}

Page he is on: ${JSON.stringify(page ?? null).slice(0, 300)}`;

  // Conversation as real turns. Paid-AI asks are left out: they are not answers, and they talk the free model into giving up.
  const msgs: Msg[] = [{ role: "system", content: system }];
  const turns = ((hist ?? []) as any[]).reverse()
    .filter((m) => !(m.role === "assistant" && /^(I'd need paid AI|NEEDS_YES: Let Scout work on this with paid AI|OK, no paid AI)/.test(String(m.body))))
    .filter((m) => !(m.role === "user" && /^\s*no,? skip it\.?\s*$/i.test(String(m.body))));   // v37: the decline is about money, not the job
  turns.forEach((m, i) => {
    const role = m.role === "assistant" ? "assistant" : "user";
    const raw = String(m.body ?? "") === STOP_MARK ? "(Jared stopped your last reply here.)" : String(m.body ?? "");
    const cut = raw.slice(0, i === turns.length - 1 ? 20_000 : 700);
    // v36: a long file message is cut for the free model's small window, but the paths `look` needs must survive the cut.
    const lostPaths = [...raw.matchAll(/⟦scout-files:[^⟧]+⟧/g)].map((x) => x[0]).filter((x) => !cut.includes(x));
    const body = (cut + (lostPaths.length ? `\n${lostPaths.join("\n")}` : "")) || "(empty)";
    const last = msgs[msgs.length - 1];
    if (last.role === role) last.content += "\n\n" + body;
    else msgs.push({ role, content: body });
  });
  if (msgs[msgs.length - 1].role !== "user") msgs.push({ role: "user", content: text.slice(0, 20_000) });
  // v36: a continuing hop sees its own earlier work instead of starting over.
  if (prior) {
    const note = continuationNote(prior);
    const last = msgs[msgs.length - 1];
    if (/^\s*keep going\b/i.test(text)) last.content = note;
    else last.content += `\n\n${note}`;
  }
  KEEP.add(msgs[msgs.length - 1]);

  const tools = freeToolDefs(autopilot, msgs.slice(1).map((m) => String(m.content ?? "")).join("\n").slice(-6000));
  const allowed = new Set(tools.map((t) => t.function.name));
  const used: string[] = [];
  let replied = false, acted = false, fails = 0, nudges = 0;
  const goal = prior?.goal ?? text.replace(/\s+/g, " ").slice(0, 600);
  const codeJob = !autopilot && tools.some((t) => t.function.name === "commit_files");   // v38: code steps use the coding ladder
  let pendingTry: { what: string; why: string } | null = null;
  let deferred: { name: string; args: Record<string, any> } | null = null;
  let timeBox = false;
  let streak: { tool: string; err: string; h: string } | null = null;
  const snapshot = (): RunState => ({
    chain_from: prior?.chain_from ?? "", goal, hop: opts.hop ?? 0, started_at: runStartedAt, steps: (prior?.steps ?? 0) + newCalls,
    stale_hops: prior?.stale_hops ?? 0, progress_msg_id: prior?.progress_msg_id ?? null, notes, calls, tries, try_log: tryLog, pending: deferred ?? undefined,
    pauses: 0,
  });
  // v39 (Oct 6, 9:48 PM): a busy free AI is not a failed job. With Groq rate-limited and Cloudflare at its daily cap, the
  // closing summary (or the first reply) failed and every running chat fell straight to "I'd need paid AI", even though
  // the work was going fine. Now: pause and retry in 30 s, up to PAUSE_MAX times, then say plainly the free AI is out of
  // room right now. Paid AI is still only offered after 3 real failed tries (v38) or when he asks.
  const busyPause = () => {
    const pauses = (prior?.pauses ?? 0) + 1;
    const st: RunState = { ...snapshot(), pauses };
    const out = pauses > PAUSE_MAX;
    return {
      answer: out
        ? `The free AI has been too busy to answer for a few minutes (rate limits). Your job is saved where it stopped.${notes.length ? ` Last thing I found: ${oneLine(notes[notes.length - 1])}` : ""}`
        : "The free AI is busy right now (rate limits). Picking it back up in 30 seconds.",
      why: "", tools: used, more: true, stalled: out, paused: !out, state: st,
    };
  };
  const escalate = () => ({ why: "", tools: used, escalate: { what: goal, log: tryLog }, state: snapshot() });

  // v38: a commit saved by the last hop (it had no time left to be watched) runs first, with its full time budget.
  if (!autopilot && prior?.pending) {
    const pc = prior.pending;
    toolDeadline = Math.min(reqStartedAt + 118_000, Date.now() + 85_000);
    let pout: Record<string, unknown>;
    try { pout = await runTool(pc.name, pc.args, threadId); } catch (e) { pout = { ok: false, error: `tool crashed: ${(e as Error).message}` }; }
    const pok = (pout as any)?.ok !== false;
    let pr = ""; try { pr = JSON.stringify(pout); } catch { pr = String(pout); }
    for (const x of calls) x.stale = true;
    calls.push({ tool: pc.name, h: argsHash(pc.name, pc.args), args: JSON.stringify({ message: pc.args.message ?? "" }).slice(0, 160), result: pr.slice(0, 600) });
    used.push(pc.name); newCalls++;
    if (pok) acted = true;
    const lastMsg = msgs[msgs.length - 1];
    lastMsg.content += `\n\n(Your saved ${pc.name} "${String(pc.args.message ?? "").slice(0, 80)}" ran at the start of this round. Result: ${pr.slice(0, 1500)})`;
    if (!pok && (pout as any).error === "build_failed") {
      if (failTry(`commit_files "${String(pc.args.message ?? "update").slice(0, 70)}"`, "the build failed and the files were put back")) return escalate();
      lastMsg.content += `\n\nTry ${tries + 1} of ${TRY_MAX}: that build failed and the files were put back. Re-read your change for a type or syntax mistake and fix it; do not resend it unchanged.`;
    }
  }

  for (let i = 0; i < FREE_STEPS && Date.now() < until - 8000; i++) {
    // v34: he interrupted (Send now / Stop): drop this run where it stands.
    if (i > 0 && await supersededSince(threadId, opts.since ?? null)) return { why: "", tools: used, stopped: true };
    toolDeadline = Math.min(until - 5000, Date.now() + 60_000);
    // v38: the step that writes code runs on the coding ladder (FreeLLM qwen3-coder-480b first) with room for a real edit; reading steps stay fast.
    const codeStep = codeJob && (tries > 0 || used.includes("read_file") || calls.some((x) => x.tool === "read_file"));
    if (codeStep && until - Date.now() < 30_000) break;   // not enough of this round left for a coding call: the next hop does it with a fresh budget
    trimForBudget(msgs, codeStep ? 24_000 : 3800);
    let r: ChatResult;
    try {
      r = await llmChat({ messages: msgs, tools, maxTokens: codeStep ? 4000 : 1200, deadlineMs: Math.min(until - Date.now() - 2000, codeStep ? 60_000 : 45_000), task: codeStep ? "code" : "chat", job: "chat-agent", ref: threadId, fn: "admin-chat", scope: "chat" });
    } catch {
      if (++fails > 1) break;
      continue;
    }
    replied = true;

    if (!r.toolCalls.length) {
      const reply = r.content.trim();
      const nudge = (why: string) => { msgs.push({ role: "assistant", content: reply }); msgs.push({ role: "user", content: why }); nudges++; };
      if (PLACEHOLDER.test(reply) && nudges < 2) { nudge("That reply has placeholders instead of real values. Get the real values with a tool, then reply."); continue; }
      if (REFUSES.test(reply) && nudges < 1) { nudge("You DO have tools (see the list), including commit_files for code and db_write for data. Use them to do this."); continue; }
      const own = reply.split(/^\s*OPTIONS:/m)[0];
      if (CLAIMS_DONE.test(own) && !acted && !ALREADY.test(own) && !/\?\s*$/.test(own.trim())) {
        if (nudges < 2) { nudge("Nothing was changed by a tool in this turn, so don't say it's done. Either do it with a tool, or say what you found and what's left."); continue; }
        // v37: out of nudges is not a dead end. Fall through to the findings summary below (built only from tool results),
        // so what it read reaches Jared instead of a bare paid-AI ask.
        msgs.push({ role: "assistant", content: reply });
        break;
      }
      // v38: STUCK from the free agent is one failed try; the next try starts here, and the third goes to paid.
      if (!autopilot && /^\s*STUCK:/m.test(reply)) {
        const stuckWhy = (reply.match(/^\s*STUCK:\s*(.+)$/m)?.[1] ?? "no reason given").trim();
        if (failTry("said it was stuck", stuckWhy)) return escalate();
        msgs.push({ role: "assistant", content: reply });
        msgs.push({ role: "user", content: `Try ${tries + 1} of ${TRY_MAX}: you said you were stuck (${stuckWhy.slice(0, 160)}). Take a different approach with your tools, then answer.` });
        continue;
      }
      // Normalize the options line; fewer than two choices means no line.
      const m = reply.match(/^\s*OPTIONS:\s*(.+)$/m);
      const opts = m ? m[1].split("|").map((o) => o.trim()).filter(Boolean).slice(0, 4) : [];
      let body = reply.replace(/^\s*OPTIONS:.*$/m, "").trim();
      // One verdict line only: gpt-oss sometimes copies the whole template ("FIXED: x | NEEDS_YES: none | STUCK: none").
      if (autopilot) body = body.replace(/^((?:FIXED|NEEDS_YES|STUCK):.*?)\s+\|\s+(?:FIXED|NEEDS_YES|STUCK):.*$/gm, "$1");
      if (autopilot && !/^(FIXED|NEEDS_YES|STUCK):/m.test(body)) body += "\nSTUCK: the free AI didn't reach a verdict.";
      return { answer: `${body}${!autopilot && opts.length >= 2 ? `\n\nOPTIONS: ${opts.join(" | ")}` : ""}`, why: "", tools: used };
    }

    // Tool turn: echo the calls back exactly, then one result per call (max 3 run per step).
    msgs.push({ role: "assistant", content: r.content || null, tool_calls: r.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.raw } })) });
    for (const [n, c] of r.toolCalls.entries()) {
      const answer = (out: unknown) => { let s = JSON.stringify(out); const cap = codeJob ? 12_000 : 2500; if (s.length > cap) s = s.slice(0, cap) + "...(cut)"; msgs.push({ role: "tool", tool_call_id: c.id, content: s }); };   // v38: a code job needs the whole snippet it will quote back
      if (n >= 3) { answer({ ok: false, error: "skipped: run at most 3 tools at once" }); continue; }
      if (c.name === "ask_user") {
        const line = questionsLine(c.args);
        if (!line) { answer({ ok: false, error: "bad_questions", hint: "1-4 questions, each with a question and 2-4 options (label, optional description)." }); continue; }
        const lead = String(r.content ?? "").replace(/^\s*OPTIONS:.*$/m, "").trim() || "A few quick questions first.";
        return { answer: `${lead}\n\n${line}`, why: "", tools: [...used, "ask_user"] };
      }
      if (c.name === "ask_paid") {
        const kind = String(c.args.kind ?? "HARD").toUpperCase();
        const note = String(c.args.why ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
        // Giving up before looking is the old failure mode: make it read first (a code change is the exception).
        if (kind === "HARD" && used.length < 2 && nudges < 2) {
          nudges++;
          answer({ ok: false, error: "not_yet", hint: "Look first: use run_sql, incidents, today or read_file to find the cause. Call ask_paid only if you still can't finish after that." });
          continue;
        }
        await db.from("admin_chat_actions").insert({ thread_id: threadId, tool: "ask_paid", args: { kind, why: note }, result: { ok: false, free: true }, ok: false });
        if (autopilot) {
          const why = kind === "CODE" ? FREE_WHY.CODE : kind === "DATA" ? FREE_WHY.DATA : "The free AI tried but couldn't finish this one.";
          return { why, tools: used, note };
        }
        // v38: asking for paid help is one failed try, not a shortcut. The third one hands the job over (after this step's results are in).
        if (!pendingTry) pendingTry = { what: `asked for paid help (${kind})`, why: note || "the free AI said it could not finish" };
        answer({ ok: false, error: "try_counted", hint: "That counts as one of your 3 tries. You can change code (commit_files), change data (db_write) and run jobs yourself: do it now." });
        continue;
      }
      if (!allowed.has(c.name)) { answer({ ok: false, error: `"${c.name}" is not one of your tools. Use one from the list.` }); if (++fails > 3) break; continue; }
      const args = { ...c.args } as Record<string, any>;
      if (autopilot && (args.confirmed === true || AUTOPILOT_NEVER.has(c.name))) {
        answer({ ok: false, error: "needs_yes", hint: "Jared is not here, so this waits for his yes. Don't retry it; make your last line NEEDS_YES: <what you'd do, in everyday words>." });
        continue;
      }
      if (args.confirmed === true && !saidYes && !autoRunOn) {
        answer({ ok: false, error: "not_confirmed", hint: "He hasn't said yes. Tell him what it will do and end with OPTIONS: Do it | Not now." });
        continue;
      }
      // v36: the same read, with the same arguments, already answered earlier in this run: hand back that result.
      const h = argsHash(c.name, args);
      if (FREE_READS.has(c.name)) {
        const seen = calls.find((x) => x.h === h && x.tool === c.name && !x.stale);
        if (seen) {
          cachedHits++;
          msgs.push({ role: "tool", tool_call_id: c.id, content: `(from earlier in this run) ${seen.result}` });
          continue;
        }
      }
      if (c.name === "mac_run" && args.action === "propose") args.__free = true;   // never auto-run a free-model script
      if (c.name === "commit_files" && !autopilot) {
        // A commit is watched to the end and reverted if the build fails (rule 4). That needs ~90 s of the 150 s request: with less
        // left, save the call and run it first thing next hop (a fresh budget) instead of committing something nobody can watch.
        if (args.confirmed === true && reqStartedAt + REQ_HARD_MS - Date.now() < COMMIT_NEEDS_MS) {
          if (JSON.stringify(args).length <= PENDING_CAP) {
            deferred = { name: c.name, args };
            notes.push(`Saved the commit "${String(args.message ?? "update").slice(0, 80)}" to run first thing next round (not enough time left to watch the build).`);
            answer({ ok: true, deferred: true, note: "Not enough time left in this round to watch the build, so the commit is saved and runs first thing in the next round. Say so in one line and stop." });
          } else {
            answer({ ok: false, error: "not_enough_time", hint: "Not enough time left in this round to watch the build. Next round, send the same change as smaller edits." });
          }
          timeBox = true;
          continue;
        }
        toolDeadline = Math.min(reqStartedAt + 118_000, Date.now() + 85_000);
      }
      let out = await runTool(c.name, args, threadId);
      if ((out as any)?.ok === false && c.name !== "learn") out = await heal(c.name, args, out, {});  // real columns + past lessons
      used.push(c.name);
      newCalls++;
      const ok = (out as any)?.ok !== false;
      if (ok && !FREE_READS.has(c.name) && !(c.name === "mac_run" && args.action === "get") && !(c.name === "pi_command" && PI_READ_ONLY.has(`${args.target}.${args.action}`))) {
        acted = true;
        for (const x of calls) x.stale = true;   // a change was made: earlier reads may no longer be true, read again
      }
      if (!autopilot) {
        const err = String((out as any)?.error ?? "");
        if (!ok && !SOFT_ERR.test(err)) {
          if (c.name === "commit_files" && err === "build_failed") {
            if (!pendingTry) pendingTry = { what: `commit_files "${String(args.message ?? "update").slice(0, 70)}"`, why: `the build failed and the files were put back${(out as any).build_url ? ` (${(out as any).build_url})` : ""}` };
            streak = null;
          } else if (streak && streak.tool === c.name && (streak.err === err.slice(0, 80) || streak.h === h)) {
            if (!pendingTry) pendingTry = { what: `${c.name} failed twice`, why: err.slice(0, 200) || "no error text" };
            streak = null;
          } else streak = { tool: c.name, err: err.slice(0, 80), h };
        } else if (ok) streak = null;
      }
      if (ok && !autopilot) {
        let r = ""; try { r = JSON.stringify(out); } catch { r = String(out); }
        calls.push({ tool: c.name, h, args: JSON.stringify(Object.fromEntries(Object.entries(args).filter(([k]) => k !== "confirmed" && k !== "__free"))).slice(0, 160), result: r.slice(0, 600) });
      }
      if (!ok) fails++;
      answer(out);
    }
    if (pendingTry) {
      const pt = pendingTry; pendingTry = null;
      if (failTry(pt.what, pt.why)) return escalate();
      msgs.push({ role: "user", content: `Try ${tries + 1} of ${TRY_MAX}: ${pt.what} - ${pt.why}. Make a real new attempt with a different approach; do not repeat what failed.` });
      fails = 0; nudges = 0;
    }
    if (timeBox) break;
    if (fails > 4) break;
  }

  if (!replied) return autopilot ? { why: "The free AI isn't answering right now.", tools: used } : busyPause();
  if (await supersededSince(threadId, opts.since ?? null)) return { why: "", tools: used, stopped: true };
  // Out of steps or time with work in hand: say what was found. Chat offers to keep going for free; autopilot
  // keeps the findings next to the paid offer (a STUCK verdict), so the paid run starts from them.
  if (used.length || cachedHits) {
    try {
      msgs.push({ role: "user", content: "Stop using tools now. In under 90 words, tell Jared what you found so far and what is left, using only the tool results above. Start with one short sentence (under 20 words) that says where you are. No options line." });
      trimForBudget(msgs);
      const s = await llmChat({ messages: msgs, tools, toolChoice: "none", maxTokens: 700, deadlineMs: Math.min(20_000, Math.max(6_000, reqStartedAt + REQ_HARD_MS - Date.now() - 6_000)), job: "chat-agent", ref: threadId, fn: "admin-chat", scope: "chat" });
      const sum = s.content.replace(/^\s*OPTIONS:.*$/m, "").trim();
      if (sum && !s.toolCalls.length) {
        return autopilot
          ? { answer: `${sum.replace(/^(FIXED|NEEDS_YES|STUCK):.*$/gm, "").trim()}\nSTUCK: the free AI ran out of time before finishing.`, why: "", tools: used }
          // v33: out of steps with work in hand is not a stop on free AI: the handler picks it back up by itself.
          // v36: unless it made no new call this hop, or two hops in a row added nothing new: then it stops and says so.
          : (() => {
            const key = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 160);
            const isNew = !notes.some((n) => key(n) === key(sum));
            if (isNew) notes.push(sum.slice(0, 500));
            const staleHops = isNew ? 0 : (prior?.stale_hops ?? 0) + 1;
            const state: RunState = { ...snapshot(), stale_hops: staleHops };
            return { answer: sum, why: "", tools: used, more: true, stalled: !deferred && (newCalls === 0 || staleHops >= 2), state };
          })();
      }
    } catch { /* fall through */ }
  }
  // v39: the summary call itself failed (busy providers) - that's a pause, not a failed job.
  if (!autopilot) return busyPause();
  return { why: "The free AI tried but couldn't finish this one.", tools: used };
}

/**
 * v18: "move these to me", "these are mine not Eli's", "give that one to Eli" - done in code, no AI.
 * Finds open call to-dos whose titles are in this message or his last few, and moves them.
 * Returns the reply, or null when the message isn't a to-do move (then the normal path runs).
 */
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
async function tryTodoMove(threadId: string, text: string): Promise<string | null> {
  if (!/\b(move|moved|put|give|assign|reassign|switch|transfer)\b|\b(are|is) (mine|my)\b|\bnot (eli|his|hers|theirs)/i.test(text)) return null;
  let owner: string | null = null;
  const notMine = /\b(not|isn'?t|aren'?t) (mine|my)\b/i.test(text);
  if (!notMine && /\b(to me|to mine|my (list|to-?dos?|todos?)|to my|mine|are my|is my)\b/i.test(text)) owner = "Jared";
  const named = text.match(/\b(?:to|for|give (?:it|them|that|those|these)? ?to)\s+([A-Z][a-z]{1,20})(?:'s)?\b/);
  if (!owner && named && !/^(my|me|the|his|her|their|list|deck|mine)$/i.test(named[1])) owner = named[1];
  if (!owner) return null;

  const since = new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10);
  const { data: todos } = await db.from("scout_daily").select("id, title, action").eq("kind", "call").eq("status", "open").gte("day", since).limit(200);
  if (!todos?.length) return null;
  const { data: hist } = await db.from("admin_chat_messages").select("role, body").eq("thread_id", threadId)
    .order("created_at", { ascending: false }).limit(8);
  const mineNow = norm(text);
  const earlier = ((hist ?? []) as any[]).filter((m) => m.role === "user").map((m) => norm(String(m.body)));
  const hit = (hay: string) => (todos as any[]).filter((t) => {
    const title = norm(String(t.title));
    return title.length > 12 && hay.includes(title.slice(0, Math.min(title.length, 60)));
  });
  let picked = hit(mineNow);
  if (!picked.length && /\b(them|these|those|it|that|this|both)\b/i.test(text)) {
    for (const h of earlier) { picked = hit(h); if (picked.length) break; }
  }
  const toMove = picked.filter((t: any) => String(t.action?.owner ?? "").toLowerCase() !== owner!.toLowerCase());
  if (!picked.length) return null;
  if (!toMove.length) return `Those are already on ${owner === "Jared" ? "your" : `${owner}'s`} list.\n\nOPTIONS: Thanks | Show my to-dos`;
  const done: string[] = [];
  for (const t of toMove as any[]) {
    const { error } = await db.rpc("todo_set_owner", { p_id: t.id, p_owner: owner });
    if (!error) done.push(String(t.title));
    await db.from("admin_chat_actions").insert({ thread_id: threadId, tool: "todo_owner", args: { id: t.id, owner }, result: { ok: !error, error: error?.message ?? null }, ok: !error });
  }
  if (!done.length) return "I couldn't move them just now. Try again in a minute.\n\nOPTIONS: Try again | Skip it";
  return `Moved ${done.length} to ${owner === "Jared" ? "you" : owner}:\n${done.map((d) => `- ${d}`).join("\n")}\nDeck cards renamed too.\n\nOPTIONS: Thanks | Show my to-dos`;
}

// Set per request from scout_settings.auto_run.
let autoRunOn = false;
let paidUntil: string | null = null; // v30: when the Paid AI switch turns itself off (null = until he turns it off)

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
      if ((r as any).ok === false) { out = r; break; }
      // v29: slices, so a model with a small window can read big files (it used to re-read the same first page).
      const full = String((r as any).content ?? "");
      const lines = full.split("\n");
      const num = (a: number, b: number) => lines.slice(a, b).map((l, k) => `${a + k + 1}: ${l}`).join("\n");
      if (args.find) {
        const needle = String(args.find).toLowerCase();
        const hits = lines.map((l, i) => (l.toLowerCase().includes(needle) ? i : -1)).filter((i) => i >= 0).slice(0, 6);
        out = { ok: true, path: (r as any).path, total_lines: lines.length, matches: hits.length,
          content: hits.length ? hits.map((i) => num(Math.max(0, i - 12), Math.min(lines.length, i + 13))).join("\n...\n") : `"${args.find}" is not in this file.` };
      } else if (args.line_start || args.line_end) {
        const a = Math.max(0, Math.round(Number(args.line_start) || 1) - 1);
        const b = Math.min(lines.length, Math.round(Number(args.line_end) || a + 120));
        out = { ok: true, path: (r as any).path, total_lines: lines.length, content: a < lines.length ? num(a, b) : `The file has only ${lines.length} lines.` };
      } else {
        out = { ok: true, path: (r as any).path, total_lines: lines.length, content: full };
      }
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
        const deploy = repo === REPOS.site ? deployJobFor(files.map((f) => f.path)) : null;
        out = { ok: true, commit: sha, url: (res as any).url, build: build.state, build_url: (build as any).url ?? null,
                note: build.state === "timeout" ? "Committed. The build was still running when I stopped watching - check it shortly." : undefined,
                ...(deploy ? {
                  deploy_needed: {
                    functions: deploy.functions, shared_files_changed: deploy.shared,
                    next: "Backend code changed. The site build does not ship it. Call mac_run with action propose using this title, why and script, so he can tap Run. Say in one line that the Yes button is up. Do not say the function is live until that job has run.",
                    title: deploy.title, why: deploy.why, script: deploy.script,
                  },
                } : {}) };
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
    case "todo_owner": {
      const { data, error } = await db.rpc("todo_set_owner", { p_id: String(args.id ?? ""), p_owner: String(args.owner ?? "") });
      out = error ? { ok: false, error: error.message } : (data as Record<string, unknown>);
      break;
    }
    case "mark_done": {
      const { data, error } = await db.rpc("admin_today_done", { p_key: String(args.key ?? "") });
      out = error ? { ok: false, error: error.message } : { ok: true, cleared: data };
      break;
    }
    case "make_video": {
      // 2026-10-05: LTX-2.5 clips on the AWS GPU box (migration 20261006050000_ltx_video_queue). Cost in-line: estimate, then actual.
      const secs = Math.max(1, Math.min(20, Math.round(Number(args.seconds ?? 5)) || 5));
      if (args.action === "status") {
        let ref = String(args.ref ?? "").trim();
        if (!ref) {
          const { data: last } = await db.from("ltx_jobs").select("code").eq("thread_id", threadId).order("requested_at", { ascending: false }).limit(1);
          ref = (last as any)?.[0]?.code ?? "";
        }
        if (!ref) { out = { ok: false, error: "no video in this thread yet" }; break; }
        const { data, error } = await db.rpc("ltx_status", { p_ref: ref });
        out = error ? { ok: false, error: error.message } : { ok: true, ...(data as any) };
        break;
      }
      if (args.action === "make" && args.confirmed === true) {
        const prompt = String(args.prompt ?? "").trim();
        if (prompt.length < 3) { out = { ok: false, error: "prompt required" }; break; }
        const { data, error } = await db.rpc("ltx_request", { p_prompt: prompt, p_seconds: secs, p_source: "scout", p_thread: threadId });
        out = error ? { ok: false, error: error.message } : { ok: true, ...(data as any) };
        break;
      }
      const { data, error } = await db.rpc("ltx_quote", { p_seconds: secs });
      out = error ? { ok: false, error: error.message }
        : { ok: true, ...(data as any), hint: args.action === "make" ? "Not made yet: show him this estimate and ask. Call make with confirmed:true after his yes." : undefined };
      break;
    }
    case "send_email": {
      out = await sendEmailTool(args, threadId);
      break;
    }
    case "look": {
      // Free Scout's look: a vision model answers the question. Paid Scout's look never gets here (it returns the pictures themselves).
      out = await lookForFree(args, threadId);
      break;
    }
    case "report_spam": {
      // Spam Desk (2026-10-07): the same mark logic as the Spam button, through the spam-desk function with the service key.
      try {
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/spam-desk`, {
          method: "POST", headers: { "Content-Type": "application/json", apikey: SECRET_KEY, Authorization: `Bearer ${SECRET_KEY}` },
          body: JSON.stringify({ op: "mark", mail_id: args.mail_id, from: args.from, subject: args.subject }), signal: AbortSignal.timeout(30_000),
        });
        const j = await res.json().catch(() => ({}));
        out = res.ok && j?.ok ? { ok: true, message: j.message, blocked: j.blocked, report_id: j.report?.id, verdict: j.report?.verdict }
          : { ok: false, error: j?.error ?? `spam-desk ${res.status}` };
      } catch (e) {
        out = { ok: false, error: (e as Error).message };
      }
      break;
    }
    case "ask_user":
      // Reached only when the questions were malformed (a valid call ends the turn before tools run).
      out = { ok: false, error: "bad_questions", hint: "1-4 questions, each with a question and 2-4 options (label, optional description)." };
      break;
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

const PRICE: Record<string, [number, number]> = { haiku: [1, 5], sonnet: [3, 15], opus: [15, 75] }; // $ per million in/out
const priceOf = (m: string) => PRICE[Object.keys(PRICE).find((k) => m.includes(k)) ?? "sonnet"];
let spendRef: string | null = null;   // the thread this request is for
let spentNow = 0;                     // what this request has cost so far

async function logSpend(j: any) {
  const model = String(j?.model ?? MODEL);
  const [pin, pout] = priceOf(model);
  const plain = Number(j?.usage?.input_tokens ?? 0);
  const wrote = Number(j?.usage?.cache_creation_input_tokens ?? 0);
  const read = Number(j?.usage?.cache_read_input_tokens ?? 0);
  const inT = plain + wrote + read;
  const outT = Number(j?.usage?.output_tokens ?? 0);
  // cache writes bill at 1.25x input, cache reads at 0.1x
  const cost = ((plain + wrote * 1.25 + read * 0.1) * pin + outT * pout) / 1e6;
  console.log(JSON.stringify({ cache: { wrote, read, plain } }));
  spentNow += cost;
  await db.from("ai_spend").insert({ fn: "admin-chat", scope: "chat", job: "chat", model, input_tokens: inT, output_tokens: outT, cost_usd: cost, ref: spendRef });
}

// Split the system prompt at <<CACHE_SPLIT>>: [fixed rules][lessons][live data].
// The first two get cache breakpoints; the live part changes every request and stays uncached.
function systemBlocks(system: string) {
  const parts = system.split("<<CACHE_SPLIT>>").map((p) => p.trim()).filter(Boolean);
  return parts.map((text, i) => (i < parts.length - 1 ? { type: "text", text, cache_control: { type: "ephemeral" } } : { type: "text", text }));
}

/** v31: Chat Router's check-in (Team page watchdog). Never blocks or fails a reply. */
function routerBeat(summary: string, ok = true) {
  db.rpc("agent_beat", { p_slug: "chat-router", p_ok: ok, p_summary: summary.slice(0, 200) }).then(() => {}, () => {});
}

const RAISE_CAP = /^(raise today'?s cap( by \$?5)?|override( (this|it|the cap))?)\.?!?$/i;
const CAP_OPTIONS = "OPTIONS: Raise today's cap by $5 | Wait until midnight";

async function ask(messages: any[], system: string, apiKey: string, opts: { timeoutMs?: number; noTools?: boolean } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: opts.noTools ? 1500 : 8000, system: systemBlocks(system), tools: TOOLS, messages,
        // Prompt caching: the fixed rules + tools are cached across messages, the lessons digest
        // separately, and this top-level marker caches the growing conversation within the tool loop.
        cache_control: { type: "ephemeral" },
        ...(opts.noTools ? { tool_choice: { type: "none" } } : {}),
      }),
      signal: opts.timeoutMs ? AbortSignal.timeout(Math.max(3000, opts.timeoutMs)) : undefined,
    });
    if (r.ok) { const j = await r.json(); await logSpend(j).catch(() => {}); return j; }

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
const AUTOPILOT_NEVER = new Set(["mac_run", "notify", "commit_files", "db_write", "clear_alerts", "ask_user", "make_video", "send_email", "report_spam"]);

// ---------------------------------------------------------------- v35 send_email: mail as Jared with his Bestly signature
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;
/** "Eli" -> eli.cooper@bdcuniversal.com from his own mail: people who wrote to him first, then people he wrote to. */
async function lookupAddress(name: string): Promise<{ address?: string; options?: string[] }> {
  const n = name.trim().replace(/[%_]/g, "");
  if (n.length < 2) return {};
  const found = new Map<string, number>();
  const { data: inbox } = await db.from("bestly_mail").select("from_addr, from_name").or(`from_name.ilike.%${n}%,from_addr.ilike.%${n}%`)
    .order("sent_at", { ascending: false }).limit(40);
  // Whole-word match only: "Eli" must not match deliveries, Fidelity or Elizabeth.
  const want = n.toLowerCase().split(/\s+/);
  const words = (t: string) => t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const matches = (name: string, addr: string) => {
    const w = new Set([...words(name), ...words(addr.split("@")[0])]);
    return want.every((x) => w.has(x));
  };
  for (const r of (inbox ?? []) as { from_addr: string; from_name: string | null }[]) {
    const a = String(r.from_addr ?? "").toLowerCase();
    if (EMAIL_RE.test(a) && !/no-?reply|donotreply|notifications?@|mailer|bounce|informeddelivery/.test(a) && matches(String(r.from_name ?? ""), a)) {
      found.set(a, (found.get(a) ?? 0) + 1);
    }
  }
  if (!found.size) {
    const { data: sent } = await db.from("bestly_sent_mail").select("to_addrs").ilike("to_addrs", `%${n}%`).order("sent_at", { ascending: false }).limit(20);
    for (const r of (sent ?? []) as { to_addrs: unknown }[]) {
      for (const a of String(r.to_addrs ?? "").match(/[^\s"'<>,\[\]]+@[^\s"'<>,\[\]]+/g) ?? []) {
        if (matches("", a)) found.set(a.toLowerCase(), (found.get(a.toLowerCase()) ?? 0) + 1);
      }
    }
  }
  const ranked = [...found.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a);
  if (ranked.length === 1 || (ranked.length > 1 && found.get(ranked[0])! >= 3 * (found.get(ranked[1]) ?? 0))) return { address: ranked[0] };
  return ranked.length ? { options: ranked.slice(0, 5) } : {};
}

async function sendEmailTool(args: Record<string, any>, threadId: string): Promise<Record<string, unknown>> {
  const list = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 10);
  const subject = String(args.subject ?? "").trim();
  const body = String(args.body ?? "").trim();
  if (!subject || subject.length > 200) return { ok: false, error: "subject required (under 200 characters)" };
  if (body.length < 10 || body.length > 20_000) return { ok: false, error: "body required (10 to 20,000 characters)" };
  const resolve = async (items: string[]) => {
    const out: string[] = [], problems: string[] = [];
    for (const it of items) {
      const bare = it.replace(/^.*<([^>]+)>.*$/, "$1").toLowerCase();
      if (EMAIL_RE.test(bare)) { out.push(bare); continue; }
      const r = await lookupAddress(it);
      if (r.address) out.push(r.address);
      else problems.push(r.options ? `"${it}" matches several addresses: ${r.options.join(", ")}` : `no address found for "${it}" in Jared's mail`);
    }
    return { out, problems };
  };
  const to = await resolve(list(args.to)), cc = await resolve(list(args.cc));
  const problems = [...to.problems, ...cc.problems];
  if (problems.length || !to.out.length) {
    return { ok: false, error: "recipient_unclear", detail: problems.length ? problems : ["no recipient"], hint: "Ask Jared which address to use (ask_user), then call again with it." };
  }
  const preview = { from: "Jared Best <jared@bestly.tech>", to: to.out, cc: cc.out, subject, body, signature: "Bestly signature with the animated headshot is added below the body" };
  if (args.confirmed !== true) {
    return { ok: false, error: "not_sent_yet", preview, hint: "Show him this exact email (to, subject, body) and end with OPTIONS: Send it | Change something. Send with confirmed:true after his yes." };
  }
  const key = `scout-${threadId}-${Array.from(new TextEncoder().encode(subject + body + to.out.join())).reduce((h, c) => (h * 31 + c) >>> 0, 7)}`;
  const sent = await sendAsJared(db, { to: to.out, cc: cc.out, subject, text: body, key });
  await db.from("email_send_log").insert({
    message_id: sent.id ?? null, template_name: "scout-send-as-jared", recipient_email: to.out.join(", "),
    status: sent.ok ? "sent" : "failed", error_message: sent.ok ? null : sent.error,
    metadata: { thread_id: threadId, subject, cc: cc.out, signature: sent.signature },
  }).then(() => null, () => null);
  return sent.ok
    ? { ok: true, sent: true, to: to.out, cc: cc.out, subject, signature: sent.signature === "gif" ? "Bestly signature with animated headshot" : "text signature (the GIF could not be read)", message_id: sent.id }
    : { ok: false, error: sent.error };
}


// ---------------------------------------------------------------- v36 vision: pictures, PDFs and video frames he attaches
// ScoutAttach.tsx puts one machine line under each file's header:  ⟦scout-files: <path>|<path> kind=image|pdf|video⟧
// (a video's paths are the frames the browser cut, in order). Paid Scout gets the real pixels for his newest file messages;
// the `look` tool opens any path again. Nothing here may break a chat: a file that can't be fetched is mentioned and skipped.
const FILES_MARK = /⟦scout-files:\s*([^⟧]+?)\s+kind=(image|pdf|video)⟧/g;
const SAFE_PATH = /^\d{4}-\d{2}-\d{2}\/[\w.-]{1,200}$/;   // what ScoutAttach writes; also what the model may ask look for
const SEE_MAX_IMAGES = 20;                 // images (video frames count) in one request
const SEE_MAX_IMAGE_BYTES = 5 * 1024 * 1024;   // Anthropic's per-image limit; a bigger one is skipped
const SEE_MAX_PDF_BYTES = 8 * 1024 * 1024;
const SEE_TOTAL_BYTES = 18 * 1024 * 1024;  // raw bytes of all files in one request (base64 adds a third; the API body limit is 32 MB)
const SEE_RECENT_USER_TURNS = 8;           // a file message older than this many of his messages keeps only its text copy

interface SeenRef { path: string; kind: "image" | "pdf" | "video" }
interface Seen {
  blocks: any[];            // image / document content blocks, in order
  images: { b64: string; mime: string }[];
  docs: any[];
  note: string;             // what was left out, in plain words ("" when nothing was)
  bytes: number;
}

/** Every storage path named in ⟦scout-files:…⟧ lines of a message, in order, without repeats. */
function fileRefs(body: string): SeenRef[] {
  const out: SeenRef[] = [];
  for (const m of body.matchAll(FILES_MARK)) {
    for (const p of m[1].split("|").map((s) => s.trim())) {
      if (SAFE_PATH.test(p) && !p.includes("..") && !out.some((o) => o.path === p)) out.push({ path: p, kind: m[2] as SeenRef["kind"] });
    }
  }
  return out;
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The picture type from its first bytes. The API refuses a wrong media type, so never trust the upload's label. */
function sniffImageType(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

const fileLabel = (path: string) => (path.split("/").pop() ?? path).replace(/^[0-9a-f-]{36}-/, "");

/**
 * Fetch the files behind some refs as content blocks. Images (and video frames) up to `maxImages` and 5 MB each; PDFs as
 * document blocks only when `pdfs` is true. Stops when `maxBytes` is used up. Frames of one video get a "(frame 3 of 9)" label.
 */
async function fetchSeen(refs: SeenRef[], opts: { maxImages: number; maxBytes: number; pdfs: boolean }): Promise<Seen> {
  const seen: Seen = { blocks: [], images: [], docs: [], note: "", bytes: 0 };
  const left: string[] = [];
  const frameTotal = new Map<string, number>();
  for (const r of refs) if (r.kind === "video") { const k = r.path.replace(/-f\d+\.jpg$/i, ""); frameTotal.set(k, (frameTotal.get(k) ?? 0) + 1); }
  const frameNo = new Map<string, number>();
  for (const r of refs) {
    const name = fileLabel(r.path);
    if (r.kind === "pdf") {
      if (!opts.pdfs) { left.push(`${name} (a PDF: use its text copy)`); continue; }
    } else if (seen.images.length >= opts.maxImages) { left.push(`${name} (over the ${opts.maxImages}-image limit)`); continue; }
    try {
      const { data: blob, error } = await db.storage.from("scout-files").download(r.path);
      if (error || !blob) { left.push(`${name} (couldn't be opened, it may be over 30 days old)`); continue; }
      const limit = r.kind === "pdf" ? SEE_MAX_PDF_BYTES : SEE_MAX_IMAGE_BYTES;
      if (blob.size > limit) { left.push(`${name} (too big, over ${limit / 1048576} MB)`); continue; }
      if (seen.bytes + blob.size > opts.maxBytes) { left.push(`${name} (no room left in this request)`); continue; }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (r.kind === "pdf") {
        seen.docs.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: toB64(bytes) } });
        seen.blocks.push(seen.docs[seen.docs.length - 1]);
      } else {
        const mime = sniffImageType(bytes);
        if (!mime) { left.push(`${name} (not a picture type I can show)`); continue; }
        if (r.kind === "video") {
          const k = r.path.replace(/-f\d+\.jpg$/i, "");
          const n = (frameNo.get(k) ?? 0) + 1;
          frameNo.set(k, n);
          seen.blocks.push({ type: "text", text: `(video frame ${n} of ${frameTotal.get(k) ?? n})` });
        }
        const b64 = toB64(bytes);
        seen.images.push({ b64, mime });
        seen.blocks.push({ type: "image", source: { type: "base64", media_type: mime, data: b64 } });
      }
      seen.bytes += blob.size;
    } catch (e) {
      left.push(`${name} (${(e as Error).message})`);
    }
  }
  if (left.length) seen.note = `(Not shown to you: ${left.join("; ")}.)`;
  return seen;
}

/** His message as Claude should read it: the text, then the pictures / PDF pages. Falls back to the plain text on any trouble. */
async function messageWithFiles(text: string, refs: SeenRef[], maxImages: number, maxBytes: number): Promise<{ content: any; images: number; bytes: number }> {
  try {
    const seen = await fetchSeen(refs, { maxImages, maxBytes, pdfs: true });
    if (!seen.blocks.length) return { content: seen.note ? `${text}\n\n${seen.note}` : text, images: 0, bytes: 0 };
    const content: any[] = [{ type: "text", text }, ...seen.blocks];
    if (seen.note) content.push({ type: "text", text: seen.note });
    return { content, images: seen.images.length, bytes: seen.bytes };
  } catch {
    return { content: text, images: 0, bytes: 0 };
  }
}

/** Two turns by the same role fold into one; block arrays and plain strings both work. */
function foldTurn(last: { content: any }, content: any) {
  if (typeof last.content === "string" && typeof content === "string") { last.content += "\n\n" + content; return; }
  const blocks = (c: any) => (typeof c === "string" ? [{ type: "text", text: c }] : c);
  last.content = [...blocks(last.content), ...blocks(content)];
}

/** The paths a look call asked for, checked: only files ScoutAttach wrote, no tricks. */
function lookRefs(args: Record<string, any>): SeenRef[] {
  const raw = Array.isArray(args.paths) ? args.paths : typeof args.paths === "string" ? args.paths.split("|") : [];
  const refs: SeenRef[] = [];
  for (const p of raw.map((x: unknown) => String(x).trim())) {
    if (!SAFE_PATH.test(p) || p.includes("..") || refs.some((r) => r.path === p)) continue;
    refs.push({ path: p, kind: /\.pdf$/i.test(p) ? "pdf" : /-f\d{2}\.jpg$/i.test(p) ? "video" : "image" });
  }
  return refs.slice(0, SEE_MAX_IMAGES);
}

/**
 * Paid Scout's look: the pictures come back inside the tool result as image blocks, so Claude looks at them itself.
 * A PDF can't ride inside a tool result everywhere, so its document block goes in the same user turn, right after.
 */
async function lookForClaude(args: Record<string, any>, threadId: string): Promise<{ content: any[]; docs: any[]; ok: boolean }> {
  const refs = lookRefs(args);
  const question = String(args.question ?? "").trim().slice(0, 500);
  let seen: Seen | null = null;
  if (refs.length) { try { seen = await fetchSeen(refs, { maxImages: SEE_MAX_IMAGES, maxBytes: SEE_TOTAL_BYTES, pdfs: true }); } catch { /* reported below */ } }
  const images = seen?.blocks.filter((b) => b.type === "image" || b.type === "text") ?? [];
  const nImg = seen?.images.length ?? 0, nDoc = seen?.docs.length ?? 0;
  const ok = nImg + nDoc > 0;
  const head = !refs.length
    ? "No usable paths. Copy them exactly from the ⟦scout-files: …⟧ line in his message (several are separated by |)."
    : !ok
      ? `Couldn't show those. ${seen?.note ?? ""}`.trim()
      : `${nImg ? `${nImg} picture${nImg === 1 ? "" : "s"} below` : ""}${nImg && nDoc ? " and " : ""}${nDoc ? `${nDoc} PDF (attached right after this result)` : ""}.${question ? ` Look for: ${question}` : ""} ${seen?.note ?? ""}`.trim();
  await db.from("admin_chat_actions").insert({ thread_id: threadId, tool: "look", args: { paths: refs.map((r) => r.path), question }, result: { ok, pictures: nImg, pdfs: nDoc, note: seen?.note ?? null }, ok });
  return { content: [{ type: "text", text: head }, ...images], docs: seen?.docs ?? [], ok };
}

/** Free Scout's look: a free vision model answers the question about the pictures (Haiku only as the last rung, inside llmVision). */
async function lookForFree(args: Record<string, any>, threadId: string): Promise<Record<string, unknown>> {
  const refs = lookRefs(args);
  if (!refs.length) return { ok: false, error: "no usable paths", hint: "Copy them exactly from the ⟦scout-files: …⟧ line in his message (several are separated by |)." };
  const question = String(args.question ?? "").trim().slice(0, 600)
    || "Describe what is in the picture(s) in a few short lines and copy any readable text exactly.";
  const seen = await fetchSeen(refs, { maxImages: 10, maxBytes: SEE_TOTAL_BYTES, pdfs: false });
  if (!seen.images.length) return { ok: false, error: seen.note || "nothing could be opened" };
  const prompt = `${question}\n\nAnswer only from what you can see. If it isn't visible, say so. Plain text, under 150 words unless the question needs more.${seen.images.length > 1 ? " The images are in the order given; they may be frames of one video." : ""}`;
  try {
    const r = await llmVision({ images: seen.images, prompt, maxTokens: 900, job: "look", ref: threadId, fn: "admin-chat", scope: "chat", deadlineMs: 50_000 });
    return { ok: true, pictures: seen.images.length, answer: r.text, ...(seen.note ? { note: seen.note } : {}) };
  } catch (e) {
    if (e instanceof LlmUnavailable) return { ok: false, error: "The free vision models are busy right now, and paid AI is off or at its cap. Try again in a minute, or turn paid AI on and I'll see the pictures directly." };
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * v28.5 (2026-09-24): attachments reach Scout even when the page sends the message without them.
 * Looks for files uploaded to scout-files in the last 5 minutes that no chat message has carried yet,
 * reads them (text directly; images/PDFs through the scout-file function) and puts them in front of the question.
 * v36: the rebuilt blocks carry the same ⟦scout-files:…⟧ line the page writes, so paid Scout sees these files too;
 * frames named <uuid>-<slug>-f01.jpg, -f02.jpg… are one video and are described together.
 */
async function withRecentFiles(question: string): Promise<string> {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const now = new Date();
  const folders = [...new Set([day(now), day(new Date(now.getTime() - 5 * 60_000))])];
  const since = Date.now() - 5 * 60_000;
  const recent: { path: string; name: string }[] = [];
  for (const f of folders) {
    const { data } = await db.storage.from("scout-files").list(f, { limit: 40, sortBy: { column: "created_at", order: "desc" } });
    for (const o of (data ?? []) as any[]) {
      if (o?.created_at && Date.parse(o.created_at) >= since) recent.push({ path: `${f}/${o.name}`, name: String(o.name).replace(/^[0-9a-f-]{36}-/, "") });
    }
  }
  if (!recent.length) return question;
  const { data: sent } = await db.from("admin_chat_messages").select("body").eq("role", "user")
    .gte("created_at", new Date(since).toISOString()).limit(40);
  const carried = ((sent ?? []) as any[]).map((m) => String(m.body)).filter((b) => /^\[(File|Video): /m.test(b));
  const has = (r: { path: string; name: string }) => carried.some((b) => b.includes(r.path) || b.includes(r.name));

  // Frames of one video share a uuid and end in -fNN.jpg; two or more together are a video, not separate pictures.
  const groups = new Map<string, { path: string; name: string }[]>();
  const singles: { path: string; name: string }[] = [];
  for (const r of recent) {
    const m = r.path.split("/").pop()!.match(/^([0-9a-f-]{36})-.*-f\d{2}\.jpg$/i);
    if (m) groups.set(m[1], [...(groups.get(m[1]) ?? []), r]); else singles.push(r);
  }
  const videos: { path: string; name: string }[][] = [];
  for (const g of groups.values()) { if (g.length >= 2) videos.push(g.sort((a, b) => a.path.localeCompare(b.path))); else singles.push(g[0]); }

  const call = async (payload: Record<string, unknown>) => {
    const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/scout-file`, {
      method: "POST", headers: { "Content-Type": "application/json", apikey: SECRET_KEY, Authorization: `Bearer ${SECRET_KEY}` },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(60_000),
    });
    return { j: await res.json(), status: res.status };
  };
  const blocks: string[] = [];
  for (const g of videos.slice(0, 2)) {
    if (g.some(has)) continue;
    const name = g[0].name.replace(/-f\d{2}\.jpg$/i, "");
    const head = `[Video: ${name}, ${g.length} frames — what happens in it]`;
    try {
      const { j, status } = await call({ op: "frames", paths: g.map((r) => r.path), name });
      blocks.push(j?.ok ? `${head}\n⟦scout-files: ${g.map((r) => r.path).join("|")} kind=video⟧\n${j.text}`
        : `[File: ${name} — couldn't be read: ${j?.error ?? status}]`);
    } catch (e) {
      blocks.push(`[File: ${name} — couldn't be read: ${(e as Error).message}]`);
    }
  }
  for (const r of singles.slice(0, 5)) {
    if (has(r)) continue;
    try {
      const { j, status } = await call({ op: "read", path: r.path });
      const mark = j?.ok && (j.kind === "image" || j.kind === "pdf") ? `⟦scout-files: ${r.path} kind=${j.kind}⟧\n` : "";
      blocks.push(j?.ok ? `[File: ${r.name}${j.kind === "image" ? " — what the image shows" : j.kind === "pdf" ? " — the document's text" : ""}]\n${mark}${j.text}`
        : `[File: ${r.name} — couldn't be read: ${j?.error ?? status}]`);
    } catch (e) {
      blocks.push(`[File: ${r.name} — couldn't be read: ${(e as Error).message}]`);
    }
  }
  if (!blocks.length) return question;
  return `${blocks.join("\n\n")}\n\n---\n${question || "Read this and tell me what you make of it."}`.slice(0, 130_000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  const started = Date.now();
  reqStartedAt = started;
  toolDeadline = started + BUDGET_MS - 8_000;

  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { return J({ ok: false, error: "json body required" }, 400); }

  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const svcCall = await isServiceRequest(req);
  if (!jwt && !svcCall) return J({ ok: false, error: "unauthorized" }, 401);

  // v13 autopilot: the fix ladder (service key only) runs Scout as the admin with no one watching.
  // Nothing that needs a yes can run on autopilot; that is enforced below, not left to the model.
  const autopilot = body.autopilot === true && svcCall;
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
  // v34: Stop. Marks the thread so whatever run is going stops at its next step and writes nothing more.
  if (body.op === "stop" && !autopilot) {
    const tid = body.thread_id ? String(body.thread_id) : "";
    if (!tid) return J({ ok: true, stopped: false });
    await db.from("admin_chat_messages").insert({ thread_id: tid, role: "user", body: STOP_MARK });
    await db.from("admin_chat_threads").update({ busy_until: null, updated_at: new Date().toISOString() }).eq("id", tid);
    return J({ ok: true, thread_id: tid, stopped: true });
  }

  const { data: prefs } = await db.rpc("scout_prefs");
  // "keep going" is his yes for this request: auto-run for this one turn. Not a yes to paid AI (v21).
  // v33: a self-call that carries on a free-AI job (auto_continue = hop number). It acts as his "keep going".
  const autoHop = !autopilot && Number.isInteger(body.auto_continue) ? Math.max(0, Number(body.auto_continue)) : 0;
  if (autoHop) body.body = "keep going";
  const keepGoing = !autopilot && /^\s*keep going\b/i.test(String(body.body ?? ""));
  autoRunOn = (prefs as any)?.auto_run === true || keepGoing;
  // v30: the Paid AI switch is the ONLY gate. scout_prefs() returns the truth (it turns itself off when the hour or the
  // daily cap runs out). No more hidden per-chat passes: a "Yes, use paid AI" tap flips the switch on for an hour.
  const paidOn = (prefs as any)?.paid_ai_ok === true;
  paidUntil = (prefs as any)?.paid_ai_until ? String((prefs as any).paid_ai_until) : null;

  let text = String(body.body ?? "").trim();
  if (!text) return J({ ok: false, error: "body required" }, 400);
  // v38: a fresh request (fresh time budget) that hands a job to paid Scout after three failed free tries. Only while the switch is on.
  const paidHandoff = !autopilot && body.paid_handoff === true;
  if (paidHandoff && !paidOn) return J({ ok: true, thread_id: String(body.thread_id ?? ""), stopped: "paid ai is off" });
  // v38: with the Paid AI switch ON, free Scout still goes first; paid is for after three failed tries. Switch taps and the cap override
  // are not jobs and keep their old path.
  const freeFirst = paidOn && !autopilot && !paidHandoff
    && !/^(always,? stop asking|yes,? use paid ai|no,? skip it|raise today'?s cap( by \$?5)?|override( (this|it|the cap))?)\.?!?$/i.test(text)
    && !/^yes, do it:.*paid ai/i.test(text);
  // v28.5: safety net for attachments. If he attached a file in the last few minutes and this message arrived
  // without it (an old page still open, a read that failed in the browser), fetch and read it here.
  if (!autopilot && !/^\[(File|Video): /m.test(text)) text = await withRecentFiles(text).catch(() => text);
  // v28.5: an attached file rides in the message as text (ScoutAttach), so file messages get a much bigger limit.
  const hasFile = /^\[(File|Video): /m.test(text);
  if (text.length > (hasFile ? 130_000 : 6000)) return J({ ok: false, error: hasFile ? "that file is too long for one message" : "that is too long for one message" }, 400);

  let threadId = body.thread_id ? String(body.thread_id) : "";
  if (!threadId) {
    const { data, error } = await db.from("admin_chat_threads").insert({ user_id: uid, title: (autopilot && body.title ? String(body.title) : text).slice(0, 70) }).select("id").single();
    if (error) return J({ ok: false, error: error.message }, 500);
    threadId = data.id;
  }
  // v34: the moment this run's message landed. Anything he sends (or a Stop) after it interrupts this run.
  let runSince: string | null = null;
  if (autoHop || paidHandoff) {
    // He wrote something since the job started (or stopped it): his message wins, this hop ends quietly.
    runSince = String(body.chain_from ?? new Date(0).toISOString());
    if (await supersededSince(threadId, runSince)) return J({ ok: true, thread_id: threadId, stopped: "he wrote since" });
  } else {
    const { data: mine } = await db.from("admin_chat_messages").insert({ thread_id: threadId, role: "user", body: text })
      .select("created_at").single();
    runSince = autopilot ? null : ((mine as any)?.created_at ?? new Date().toISOString());
  }
  const interrupted = () => supersededSince(threadId, runSince);
  const stoppedReply = () => J({ ok: true, thread_id: threadId, stopped: true });

  // v18: moving call to-dos between people needs no AI.
  if (!autopilot && !paidHandoff) {
    const moved = await tryTodoMove(threadId, text).catch(() => null);
    if (moved) {
      await db.from("admin_chat_messages").insert({ thread_id: threadId, role: "assistant", body: moved });
      await db.from("admin_chat_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);
      return J({ ok: true, thread_id: threadId, reply: moved, tools: ["todo_owner"] });
    }
  }

  // v15/v30: paid AI only while the Paid AI switch is on. v38: and free goes first even then (freeFirst).
  if (!paidOn || freeFirst) {
    // "keep going" alone is NOT a yes to spending.
    let paidOk = false;
    let sayId: string | null = null;   // v36: the message say() just wrote (the first hop's progress note is edited in place later)
    const say = async (reply: string, extra: Record<string, unknown> = {}) => {
      if (await interrupted()) return stoppedReply();   // v34: he moved on; this answer is stale
      if (extra.free) routerBeat(`Free reply${Array.isArray(extra.tools) && extra.tools.length ? ` (${extra.tools.length} steps)` : ""}`);
      const { data: ins } = await db.from("admin_chat_messages").insert({ thread_id: threadId, role: "assistant", body: reply }).select("id").single();
      sayId = (ins as any)?.id ?? null;
      await db.from("admin_chat_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);
      return J({ ok: true, thread_id: threadId, reply, tools: [], ...extra });
    };
    if (!paidOk) {
      const flip = async (minutes: number | null, reason: string) => {
        const { data: st } = await db.rpc("scout_paid_apply", { p_on: true, p_minutes: minutes, p_reason: reason, p_by: uid ?? null });
        if ((st as any)?.on === true) { paidUntil = (st as any).until ?? null; return true; }
        // It can't turn on: today's cap is used up. Say so instead of pretending.
        return false;
      };
      if (!autopilot && RAISE_CAP.test(text)) {
        // v31: his tap raises today's cap by $5 (today only) and turns paid on for an hour; the paid reply then
        // answers the message that hit the cap (it reads the thread).
        const { data: b } = await db.rpc("scout_cap_boost", { p_extra: 5, p_by: uid ?? null, p_reason: "raised in chat" });
        if ((b as any)?.ok !== true) {
          return await say(`Today's cap is already raised as far as it goes ($${Number((b as any)?.cap ?? 0).toFixed(2)}). It resets at midnight. Until then I'm on free AI.`, { capped: true });
        }
        paidOk = await flip(60, "cap_raised");
        routerBeat(`Cap raised to $${Number((b as any)?.cap ?? 0).toFixed(2)} for today`);
        if (!paidOk) return await say("I raised today's cap but the Paid AI switch didn't turn on. Try \"Yes, use paid AI\".", { capped: true });
      } else if (/^always,? stop asking\.?$/i.test(text) || /^yes,? use paid ai\.?$/i.test(text) || (/^yes, do it:/i.test(text) && /paid ai/i.test(text))) {
        const always = /^always/i.test(text);
        paidOk = await flip(always ? null : 60, always ? "always" : "yes_tap");
        if (!paidOk) {
          const { data: sp } = await db.rpc("scout_paid_spend");
          return await say(`Paid AI is at today's cap ($${Number((sp as any)?.spent ?? 0).toFixed(2)} of $${Number((sp as any)?.cap ?? 5).toFixed(2)}). I can raise it by $5 for today, or wait until midnight. Your message is saved.\n\n${CAP_OPTIONS}`, { capped: true });
        }
      } else if (/^no,? skip it\.?$/i.test(text)) {
        // v37: "No" was a no to SPENDING, not to the job. It used to end the job on the spot ("OK, skipped") and drop
        // what the free AI had found, so a half-done fix (Oct 6, the Mail Bridge password) just stopped. Now the job
        // stays open on free AI and he picks: carry on for free, or drop it.
        return await say(
          "OK, no paid AI. Nothing was spent. The job is still open: I can keep at it on free AI from where it stopped, or drop it.\n\nOPTIONS: Keep going | Drop it",
        );
      } else if (/^(drop it|leave it)\.?$/i.test(text)) {
        await saveRunState(threadId, null).catch(() => {});
        return await say("Dropped. Nothing was spent.");
      } else if (autopilot) {
        // v29: the fix ladder tries the free agent first (same autopilot limits: nothing that needs a yes runs).
        // Paid AI is offered only when free can't finish; a free STUCK keeps its diagnosis and adds the paid offer.
        const agent = await freeAgent(threadId, text, body.page, { autopilot: true }).catch(() => ({ why: "", tools: [] as string[] }) as { answer?: string; why: string; tools?: string[]; note?: string });
        if (agent.answer && !/^STUCK:/m.test(agent.answer)) return await say(agent.answer, { free: true, tools: agent.tools ?? [] });
        // Keep what the free AI found (its STUCK line becomes a plain note), then the one-tap paid offer as the verdict.
        const diag = agent.answer ? agent.answer.replace(/^STUCK:\s*/m, "Free AI is stuck: ").trim() + "\n"
          : agent.note ? `The free AI looked (${(agent.tools ?? []).length} checks) and handed off: ${agent.note}\n` : "";
        return await say(`${diag}NEEDS_YES: Let Scout work on this with paid AI (Claude). It costs a few cents.`, { paid_needed: true, tools: agent.tools ?? [] });
      } else {
        const askFirst = ASKS_FOR_QUESTIONS.test(text);
        // v36: working memory for a free run. A new message starts clean; a hop (or a hand-typed "keep going" within the
        // hour) picks up what the run already did, so it never re-reads the same things.
        let runIn: RunState | null = null;
        if (autoHop > 0) {
          const st = await loadRunState(threadId).catch(() => null);
          if (st && st.chain_from && st.chain_from === String(body.chain_from ?? "")) runIn = st;
        } else if (keepGoing) {
          const st = await loadRunState(threadId).catch(() => null);
          if (st && Date.now() - Date.parse(st.started_at) < RUN_RESUME_MS) {
            // Resume: keep the memory, restart the clocks and the no-progress counter. The old progress note is closed out.
            if (st.progress_msg_id) {
              await db.from("admin_chat_messages").update({ body: `Worked ${st.steps} steps over ${minutesIn(st)} min.` }).eq("id", st.progress_msg_id);
            }
            runIn = { ...st, hop: 0, started_at: new Date().toISOString(), stale_hops: 0, progress_msg_id: null, chain_from: "" };
          } else if (st) await saveRunState(threadId, null).catch(() => {});
        } else {
          await saveRunState(threadId, null).catch(() => {});
        }
        let free = askFirst || runIn ? { why: "" } as { answer?: string; why: string } : await freeTry(threadId, text, body.page);
        if (free.answer) return await say(free.answer, { free: true });
        // v28: before asking to spend, the free model tries the job itself with tools.
        const agent = await freeAgent(threadId, text, body.page, { askFirst, since: runSince, state: runIn, hop: autoHop });
        if (agent.stopped) return stoppedReply();
        // v36: closes out this run's progress note and drops its memory (kept only when the run stalls: "Keep going" resumes it).
        const endRun = async (keep?: RunState) => {
          const pid = keep?.progress_msg_id ?? runIn?.progress_msg_id ?? null;
          const st = keep ?? agent.state ?? runIn;
          if (pid && st) await db.from("admin_chat_messages").update({ body: `Worked ${st.steps} steps over ${minutesIn(st)} min.` }).eq("id", pid);
          await saveRunState(threadId, keep ? { ...keep, progress_msg_id: null } : null).catch(() => {});
        };
        // v38: the third failed try. Paid switch ON: hand the job to paid Scout in a fresh request, try log in its prompt.
        // Switch OFF: say what happened and ask; the switch stays his (v30), nothing is turned on silently.
        const fireHandoff = (goalText: string) => {
          const hop = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/admin-chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization") ?? "", apikey: req.headers.get("apikey") ?? "" },
            body: JSON.stringify({ thread_id: threadId, body: goalText || "keep going", page: body.page, paid_handoff: true, chain_from: String(body.chain_from ?? runSince ?? new Date(0).toISOString()) }),
          }).then((r) => r.text()).catch(() => null);
          const er = (globalThis as any).EdgeRuntime;
          if (er?.waitUntil) er.waitUntil(hop); else return hop;
        };
        if (agent.escalate) {
          const log = agent.escalate.log;
          const lines = log.map((t, n) => `${n + 1}. ${oneLine(`${t.what}: ${t.why}`)}`).join("\n");
          await endRun(agent.state);   // keeps the try log and notes (paid reads them), closes the progress note
          const head = `Free AI tried ${log.length} times and it did not work.\n${lines}`;
          if (paidOn) {
            const res = await say(`${head}\nHanding it to paid AI now.`, { free: true, tools: agent.tools ?? [], handoff: true });
            if (await interrupted()) return res;
            await fireHandoff(agent.escalate.what);
            return res;
          }
          if (await paidOutOfCredit()) {
            return await say(
              `${head}\nPaid AI (Claude) is out of credit right now, so it has to wait. Your message is saved: top up at console.anthropic.com > Settings > Billing, then send it again.\n\nOPTIONS: Leave it | Keep going`,
              { paid_needed: true, out_of_credit: true },
            );
          }
          return await say(
            `${head}\nPaid AI can take it from here (about 5 to 50 cents). Yes turns the Paid AI switch on for one hour, then it turns itself off.\n\nOPTIONS: Yes, use paid AI | Leave it`,
            { paid_needed: true, tools: agent.tools ?? [] },
          );
        }
        if (agent.answer && agent.more && agent.state) {
          // v33 (Jared, Oct 5): on free AI Scout keeps working until it is done or needs him. No "Keep going" bursts.
          // v36: up to AUTO_HOPS rounds or 20 minutes, and only while each hop finds something new.
          const st = agent.state;
          const withinTime = Date.now() - Date.parse(st.started_at) < RUN_MAX_MS;
          if (autoHop < AUTO_HOPS && withinTime && !agent.stalled) {
            const chainFrom = String(body.chain_from ?? new Date().toISOString());
            st.chain_from = chainFrom;
            st.hop = autoHop;
            // One progress note, edited in place. created_at moves with it so the window still sees the run alive.
            const note = `${oneLine(agent.answer)}\n\nStill working on it (step ${st.steps}, ${minutesIn(st)} min in).`;
            let res: Response;
            if (st.progress_msg_id) {
              if (await interrupted()) return stoppedReply();
              const now = new Date().toISOString();
              await db.from("admin_chat_messages").update({ body: note, created_at: now }).eq("id", st.progress_msg_id);
              await db.from("admin_chat_threads").update({ updated_at: now }).eq("id", threadId);
              routerBeat(`Free reply (${st.steps} steps)`);
              res = J({ ok: true, thread_id: threadId, reply: note, tools: [], free: true, continuing: true });
            } else {
              res = await say(note, { free: true, tools: agent.tools ?? [], continuing: true });
              st.progress_msg_id = sayId;
            }
            if (await interrupted()) return res;   // he wrote while the note went out: his message wins, nothing carries on
            await saveRunState(threadId, st);
            // v39: a busy pause waits 30 s before the next hop so the rate limits can clear.
            const hop = new Promise((r) => setTimeout(r, agent.paused ? 30_000 : 0)).then(() => fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/admin-chat`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization") ?? "", apikey: req.headers.get("apikey") ?? "" },
              body: JSON.stringify({ thread_id: threadId, body: "keep going", page: body.page, auto_continue: autoHop + 1, chain_from: chainFrom }),
            })).then((r) => r.text()).catch(() => null);
            const er = (globalThis as any).EdgeRuntime;
            if (er?.waitUntil) er.waitUntil(hop); else await hop;
            return res;
          }
          // Out of hops or time, or it stopped finding anything new: say what it has and let him decide. Memory stays for "Keep going".
          await endRun(st);
          return await say(`${agent.answer}\n\nOPTIONS: Keep going | Yes, use paid AI`, { free: true, tools: agent.tools ?? [] });
        }
        // v37: a run that ends in a paid ask keeps its memory, so a "No, skip it" then "Keep going" resumes on free AI.
        await endRun(agent.answer ? undefined : (runIn ?? undefined));
        if (agent.answer) return await say(agent.answer, { free: true, tools: agent.tools ?? [] });
        free = { why: agent.why || free.why };
        // v37: say where the free AI got to, not just that it stopped (the autopilot path already did this).
        if (agent.note) free.why = `${free.why} Where it got to: ${agent.note.replace(/[.\s]+$/, "")}.`;
        // v38: the switch is already on and the free AI could not run at all (an outage, not a failed try): paid takes it now.
        if (freeFirst) {
          const res = await say(`${free.why} Handing it to paid AI now.`, { free: true, handoff: true });
          if (await interrupted()) return res;
          await fireHandoff(text);
          return res;
        }
        // Don't offer a paid run that can't happen: say the real blocker instead.
        if (await paidOutOfCredit()) {
          return await say(
            `${free.why} The paid AI (Claude) is out of credit right now, so I can't do it yet. Your message is saved: top up at console.anthropic.com > Settings > Billing, then send it again.`,
            { paid_needed: true, out_of_credit: true },
          );
        }
        return await say(
          `I'd need paid AI (Claude) for this. ${free.why} A reply costs about 5 to 50 cents. Yes turns the Paid AI switch on for one hour (you'll see it flip), then it turns itself off.\n\nOPTIONS: Yes, use paid AI | No, skip it`,
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
  const rows = ((hist ?? []).reverse() as { role: string; body: string }[]);
  // v36: Scout SEES the files in his two newest file messages (within his last 8 messages): pictures, PDF pages and video
  // frames go to Claude as real image / document blocks. Older turns keep the text copy only (token cost); `look` re-opens them.
  const userRows = rows.map((m, i) => (m.role === "user" ? i : -1)).filter((i) => i >= 0);
  const recentUserRows = new Set(userRows.slice(-SEE_RECENT_USER_TURNS));
  const seeRows = userRows.filter((i) => recentUserRows.has(i) && fileRefs(String(rows[i].body ?? "")).length).slice(-2);
  const seen = new Map<number, any>();
  let imagesLeft = SEE_MAX_IMAGES, bytesLeft = SEE_TOTAL_BYTES;
  for (const i of [...seeRows].reverse()) {                     // newest first, so the newest file gets the room
    const body = String(rows[i].body ?? "").slice(0, 8000) || "(empty)";
    const r = await messageWithFiles(body, fileRefs(String(rows[i].body ?? "")), imagesLeft, bytesLeft);
    imagesLeft -= r.images; bytesLeft -= r.bytes;
    seen.set(i, r.content);
  }
  for (const [i, m] of rows.entries()) {
    const role = m.role === "assistant" ? "assistant" : "user";
    const body = (String(m.body ?? "") === STOP_MARK ? "(Jared stopped your last reply here.)" : String(m.body ?? "")).slice(0, 8000) || "(empty)";
    if (!messages.length && role !== "user") continue;          // must open on a user turn
    const content = seen.get(i) ?? body;
    const last = messages[messages.length - 1];
    if (last && last.role === role) foldTurn(last, content);    // unanswered retries fold together (text or block arrays)
    else messages.push({ role, content });
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
  let system = SYSTEM(today ?? [], mac ?? [], inc ?? [], unread, recorder, jobs, page ?? "unknown", lessonsDigest)
    + (autoRunOn ? AUTO_RUN_ON : ASK_PLAINLY)
    + `\n\n# Paid AI switch\nThe Paid AI switch is ON${paidUntil ? ` until ${new Date(paidUntil).toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" })}` : ""}, so you (Claude, paid) are answering. If he asks what AI is running, say exactly that. Never claim paid AI is off while you are answering.`
    + (ASKS_FOR_QUESTIONS.test(text) ? `\n\n# He wants questions first\n${ASK_FIRST_NOTE}` : "")
    + (keepGoing ? "\n\n# He said keep going\nThat is his yes for everything the job needs right now. Carry on from where you stopped and do it; don't ask again." : "");

  // v38: what the free AI already tried on this job (three failed tries hand it here). Read once, then cleared.
  const handed = await loadRunState(threadId).catch(() => null);
  if (handed && (handed.try_log?.length || handed.notes?.length)) {
    const tl = (handed.try_log ?? []).map((t, n) => `${n + 1}. ${t.what}: ${t.why}`).join("\n");
    const nl = handed.notes.slice(-6).map((n) => `- ${n}`).join("\n");
    system += `\n\n# The free AI already worked on this\nIt had the same tools as you.${handed.goal ? ` The job: ${handed.goal}` : ""}${tl ? `\nIts failed tries:\n${tl}\nDo not repeat those; work out why they failed, then fix the real cause.` : ""}${nl ? `\nWhat it found:\n${nl}` : ""}`;
  }
  if (handed) await saveRunState(threadId, null).catch(() => {});

  // Daily chat cap: a runaway guard, even with the Paid AI switch on.
  const { data: budget } = await db.rpc("ai_budget", { p_scope: "chat" });
  if ((budget as any)?.ok === false) {
    // v31: don't stop. Hand this message to the free AI (with tools), and offer to raise today's cap.
    const head = `Paid AI hit today's cap ($${Number((budget as any).spent).toFixed(2)} of $${Number((budget as any).cap).toFixed(2)}), so I'm on free AI for now.`;
    const agent = await freeAgent(threadId, text, body.page, { autopilot, since: runSince }).catch(() => ({ why: "", tools: [] as string[] }) as { answer?: string; why: string; tools?: string[]; stopped?: boolean });
    if (agent.stopped || await interrupted()) return stoppedReply();
    const done = !!agent.answer && !/^STUCK:/m.test(agent.answer);
    const why = done
      ? `${head}\n\n${agent.answer}${autopilot || /^\s*OPTIONS:/m.test(agent.answer!) ? "" : `\n\n${CAP_OPTIONS}`}`
      : `${head} The free AI couldn't finish this one${agent.why ? `: ${agent.why}` : "."} Your message is saved.${autopilot ? "" : `\n\n${CAP_OPTIONS}`}`;
    routerBeat(done ? "Cap hit; answered on free AI" : "Cap hit; free AI couldn't finish", true);
    await db.from("admin_chat_messages").insert({ thread_id: threadId, role: "assistant", body: why });
    return J({ ok: true, thread_id: threadId, reply: why, capped: true, free: done, tools: agent.tools ?? [] });
  }
  // One paid reply per chat at a time. v34: his own new message takes the lock (the run holding it sees his
  // message at its next turn and stops); only autopilot still waits its turn.
  const lockQ = db.from("admin_chat_threads").update({ busy_until: new Date(Date.now() + 150_000).toISOString() }).eq("id", threadId);
  const { data: locked } = autopilot
    ? await lockQ.or(`busy_until.is.null,busy_until.lt.${new Date().toISOString()}`).select("id")
    : await lockQ.select("id");
  if (!locked?.length) {
    return J({ ok: true, thread_id: threadId, reply: "Still working on your last message. The answer lands here in a moment.", busy: true });
  }
  const unlock = () => db.from("admin_chat_threads").update({ busy_until: null }).eq("id", threadId);
  spendRef = threadId; spentNow = 0;

  const used: string[] = [];
  const shownFor: Record<string, string[]> = {};
  let reply = "";
  const left = () => BUDGET_MS - (Date.now() - started);
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      // v30: the switch overrides everything, even a reply already running. Turned off (by him, the hour, or the cap) = stop now.
      // v34: he sent something newer or tapped Stop. Leave the lock alone: his new run holds it now.
      if (turn > 0 && await interrupted()) return stoppedReply();
      if (turn > 0) {
        const { data: st } = await db.rpc("scout_paid_state_ro");
        if ((st as any)?.on !== true) {
          reply = `Paid AI just switched off, so I stopped here (${used.length} steps: ${[...new Set(used)].join(", ") || "none"}). Turn it back on or say "keep going" to continue on free AI.`;
          break;
        }
      }
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
      // v32: ask_user ends the turn with his question card (autopilot never asks: it falls through to the needs_yes guard).
      const askCall = !autopilot ? calls.find((c: any) => c.name === "ask_user") : null;
      if (askCall) {
        const line = questionsLine(askCall.input);
        if (line) {
          used.push("ask_user");
          reply = `${said.replace(/^\s*OPTIONS:.*$/m, "").trim() || "A few quick questions first."}\n\n${line}`;
          break;
        }
      }
      messages.push({ role: "assistant", content: res.content });
      const results: any[] = [];
      const extras: any[] = [];   // v36: PDF document blocks a look call opened; they ride after the tool results
      for (const c of calls) {
        used.push(c.name);
        let out: Record<string, unknown>;
        if (res.stop_reason === "max_tokens" && c === calls[calls.length - 1]) {
          // The reply ran out of room mid tool call, so its input is incomplete. Never run a half call.
          out = { ok: false, error: "cut_off", hint: "This call was cut off at your output limit, so it was not run. Send much smaller pieces (commit_files edits, not whole files)." };
          results.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(out) });
          continue;
        }
        // v36: look re-opens attached files. The pictures come back as image blocks inside the tool result, so Claude sees them.
        if (c.name === "look") {
          const lk = await lookForClaude((c.input ?? {}) as Record<string, any>, threadId).catch((e) => ({ content: [{ type: "text", text: `look failed: ${(e as Error).message}` }], docs: [] as any[], ok: false }));
          results.push({ type: "tool_result", tool_use_id: c.id, content: lk.content, ...(lk.ok ? {} : { is_error: true }) });
          extras.push(...lk.docs);
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
      messages.push({ role: "user", content: extras.length ? [...results, ...extras] : results });
    }
  } catch (e) {
    const err = e as Error;
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      const why = `I ran long on that (${used.length} steps). Say "keep going" and I will pick it up, or ask for a smaller piece.`;
      await db.from("admin_chat_messages").insert({ thread_id: threadId, role: "assistant", body: why });
      await unlock();
      return J({ ok: true, thread_id: threadId, reply: why, tools: used, partial: true });
    }
    if (/credit balance is too low/i.test(String((e as Error).message))) {
      // Out of paid credit: say it in plain words once, and put one card in the bell per day.
      const why = "My paid AI (Claude) is out of credit, so I can't do this right now. Top it up at console.anthropic.com, Settings, Billing, then send it again.";
      await db.rpc("admin_notify", {
        p_kind: "scout", p_title: "Scout's paid AI is out of credit", p_body: "Top up at console.anthropic.com > Settings > Billing. Until then Scout can only use the free AI on the Mac mini.",
        p_url: "https://console.anthropic.com/settings/billing", p_entity_key: "scout", p_severity: "warning",
        p_dedupe_key: `scout.credit:${new Date().toISOString().slice(0, 10)}`,
      });
      await db.from("admin_chat_messages").insert({ thread_id: threadId, role: "assistant", body: why });
      await unlock();
      return J({ ok: false, error: "out_of_credit", thread_id: threadId, reply: why }, 200);
    }
    const why = `I could not reach the model: ${(e as Error).message}`.replace(/sk-ant-[A-Za-z0-9_\-]+/g, "sk-ant-…");
    await db.from("admin_chat_messages").insert({ thread_id: threadId, role: "assistant", body: why });
    await unlock();
    return J({ ok: false, error: (e as Error).message, thread_id: threadId, reply: why }, 200);
  }

  if (!reply) reply = "Done.";
  if (await interrupted()) return stoppedReply();
  routerBeat(`Paid reply, ${used.length} step${used.length === 1 ? "" : "s"}, $${spentNow.toFixed(3)}`);
  // Paid AI answered, so any "out of credit" card is stale: clear it so Scout offers paid AI again.
  await db.from("admin_notifications").update({ read_at: new Date().toISOString() }).like("dedupe_key", "scout.credit:%").is("read_at", null);
  await db.from("admin_chat_messages").insert({ thread_id: threadId, role: "assistant", body: reply });
  await db.from("admin_chat_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);

  const { data: proposed } = await db.from("mac_jobs").select("id").eq("thread_id", threadId).eq("status", "proposed").limit(1);
  await unlock();
  return J({ ok: true, thread_id: threadId, reply, tools: used, job_id: proposed?.[0]?.id ?? null, cost_usd: Math.round(spentNow * 1000) / 1000 });
});
