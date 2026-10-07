# Scout gets his real face back, and a personality (opusplan)

Jared, 2026-10-06 7:49 PM: "Put the real Scout on the Scout chat. We created a weird other version. I want the
actual Scout, our logo Scout from the loading page and the animated top-left logo. That exact style, but a unique
one, still the binoculars, with more expressions, more character, phrases while Scout is working. Give him
personality, like Clippy from Microsoft Word."

Design pass: Apple HIG principles (motion that means something, quiet at rest, one memorable thing, reduced motion,
44 pt targets) checked against ui-ux-pro-max (infinite animation only for loading; feedback within 100 ms; 150-300 ms
micro-motion; spring curves; never block input; no emoji). Planned by Opus, built by Sonnet.

---

## 1. The problem

The chat draws `Scoutie` (Scout.tsx line ~231): a 26x20 doodle of two thin rings, a bar and dot eyes. It shares
nothing with the real mark, `AdminMark` (src/components/AdminMark.tsx): the 72-grid binoculars with the heavy
5.5 stroke (`.am-st`), filled pupils (`.am-fl`), masked lenses and the side-eye lids, phase-locked to a 3.2 s glance
(`ADMIN_MARK_PERIOD_MS`) so every copy on screen looks left, right and blinks together. That mark is Scout everywhere
else (loader, login, top-left, outage screen). The chat is the one place he looks like someone else.

## 2. The character: `ScoutBuddy`

New file `src/components/admin/scout/ScoutBuddy.tsx`. **Do not modify `AdminMark`**: the logo stays exactly the logo.
ScoutBuddy is the same drawing, extended into a character:

- **Identical body.** Copy AdminMark's geometry verbatim: the two barrel paths, the bridge (`M25.5 27H46.5M30 42H42`),
  lens circles r=13 at (19,44) and (53,44), pupils r=4.8, lid rects, the masks and clip paths, `useId()` ids, `.am-st`
  / `.am-fl`. At rest he must be indistinguishable from the top-left logo: idle reuses the global `am-look` / `am-lid`
  keyframes from index.html with the same `--am-delay` phase lock, so the chat Scout and the logo glance in unison.
- **One signature addition: the focus wheel.** A small knurled wheel on the bridge (circle r≈3.4 at (36,24) with 4-6
  short tick strokes, same stroke family, scaled stroke 2.2). Real binoculars focus with it, so it is the honest way to
  show "thinking": it turns while Scout works. This is the one bold thing; nothing else gets added to the body.
- **Expressions come from parts he already has** (lids = eyebrows, pupils = gaze, the whole body = posture) plus a few
  small extras that appear only in the moods that need them: a lens glint (white highlight arc), a "?" stroke above the
  right lens, a single sweat drop, "z" strokes, two tiny sparkle crosses. All drawn at the mark's stroke weight.
- **Ignore the stroke color question**: everything is `currentColor`. On the white launcher pill it is black, in the
  dark panel it is white. The only colored pixels allowed: the existing orange/purple dots live outside the SVG.
- **Sizes.** `size` prop: `"sm"` (≤ 24 px: launcher, header, working row) hides wheel ticks, glint and extras except the
  wheel disc and "?"; `"md"` (32-48 px); `"lg"` (72-96 px, the empty state "hero"). Pupil reach and stare radius
  scale with size the way AdminMark does.
- **Cursor stare.** Reuse `useStare` from AdminMark exactly (desktop pointer only), but only in `idle`. Never in
  `working` (he's busy), never on touch.
- **Self-healing.** Wrap ScoutBuddy in a tiny error boundary that falls back to `<AdminMark />`, so a mascot bug can
  never blank the Scout window.

### Moods (the expression set)

Each mood = lid transform + pupil transform + body transform + optional extra, defined as CSS keyframes in one
`SCOUT_BUDDY_CSS` string (prefix `sb-`), all `transform`/`opacity` only, `transform-box: view-box` like the mark.
Durations: reactions 600-1400 ms with a spring curve `cubic-bezier(.34,1.56,.64,1)`; loops only where noted.

| Mood | Looks like | Loops? |
|---|---|---|
| `idle` | the logo: glance left, right, blink (global keyframes, phase-locked). Stares at a nearby cursor, lids squinting like the logo does. | yes (same as logo) |
| `listening` | he's typing to Scout: lids up, pupils centered and slightly up, tiny lean forward (body translateY -1). | no, holds |
| `thinking` | request in flight, first ~6 s: focus wheel turns (rotate 0→360 every 1.4 s), pupils drift up-left, lids half. | yes (loading only, HIG/ux-pro-max allow) |
| `working` | long run / chain alive: wheel turns, pupils scan left↔right across the lenses, lids low and focused, every ~5 s a quick "lens refocus" (lens stroke scale 0.94→1). | yes (loading only) |
| `searching` | a read tool is running (run_sql, read_file, list_files, today, incidents, meeting_transcript): pupils shrink to r 3.4 (zoomed in), sweep slowly, body tilts 4°. | yes while it applies |
| `surprised` | a new Scout reply lands while the panel is closed: lids snap fully up, pupils pinpoint (scale .7), body hop 3 px. 700 ms, then → `needs`/`waiting`. | no |
| `happy` | a normal reply arrived: lids curve into smile eyes (lid rotate ±14° with translateY so the bottom edge reads as ^ ^), little hop. 1.2 s → idle. | no |
| `proud` | a reply after tool steps that reports work done (body matches /\b(done|fixed|sent|pushed|cleared|resolved|deployed)\b/i and the run used tools): happy + lens glint sweep + two sparkle crosses. 1.6 s. | no |
| `confused` | reply asks him something (`QUESTIONS:`) or free AI is stuck (`I'd need paid AI`, `STUCK`): left lid up, right lid down, head tilt -8°, "?" draws in. Holds while that message is the latest unread/visible state. | no |
| `needs` | orange dot state (needs you): lids wide, pupils look down-right toward the chat, and every 12 s a small bob (reuse the existing `scout-nudge` cadence, not faster). | gentle, 12 s |
| `waiting` | purple dot state (unread, nothing urgent): idle glance, but the blink comes twice as often. | logo loop |
| `sad` | error / Stop / a tool failed and the reply says so: lids droop outward (the AdminMark "sad" lid angles ±16°), pupils down, one sweat drop. 1.6 s then holds a softer version. | no |
| `sleepy` | panel closed, nothing waiting, no activity for 15 min: lids drop to half, slow breathing (body scaleY 1↔.98 every 4 s), "z" drifts every 8 s. Any pointer near / any event wakes him (`surprised`-lite). | slow |

Reduced motion: every mood renders its key pose statically (no loops, no hops); `thinking`/`working` show the wheel
at a fixed 30° plus the text line, so progress is still communicated in words.

### Mood state machine

New file `src/components/admin/scout/useScoutMood.ts`. Input: `{ open, busy, chainAlive, typing, msgs, lastAction,
unread: {anyUnread, anyNeedsYou}, urgentCount, pendingJobs, lastActivityAt }`. Output: `mood`.
- Priority (highest first): reaction in progress (surprised/happy/proud/sad, timed) > `confused` > `searching` >
  `working` > `thinking` > `listening` > `needs` > `waiting` > `sleepy` > `idle`.
- Reactions fire on transitions only (new assistant message id, busy true→false, Stop), never on re-render.
  Don't replay a reaction for messages that were already on screen when the thread loaded.
- `lastAction`: the newest `admin_chat_actions` row for the thread since the run started (tool name). Check RLS:
  if admins can't SELECT `admin_chat_actions`, add a migration with an admin read policy
  (`using (has_role(auth.uid(), 'admin'::app_role))`, same as admin_chat_messages). Poll it every 2 s only while
  `running`; stop when idle.

## 3. Phrases (the Clippy part)

New file `src/components/admin/scout/scoutLines.ts`. Voice: plain, quick, a little cheeky, never cutesy. No emoji.
Sentence case. Never claim something he didn't do. Whole lines only; never cut text off (no truncation with "...").

**While working** (replaces "Scout is working..." in the working row; the animated dots stay, the elapsed clock stays).
Pick the line from what he is actually doing:
- by tool: `run_sql` "Reading the database" · `read_file`/`list_files` "Reading the code" · `today` "Checking what needs you"
  · `incidents` "Looking at what broke" · `pi_command` "Knocking on the Pi" · `mac_run` "Getting the Mac mini ready"
  · `meeting_transcript` "Reading the call notes" · `send_email` "Writing that email" · `notify` "Leaving you a note"
  · `learn` "Making a note for next time" · `make_video` "Rolling the camera"
- no tool known yet, rotate every 3.5 s (shuffle, no repeats until the list is used): "Adjusting focus", "Taking a closer
  look", "Squinting at it", "Following a lead", "Lining it up", "Zooming in", "Checking twice".
- by elapsed time (overrides): ≥ 45 s "This one's a big one. Still on it" · long free run with a progress note:
  "Step 23, 4 min in" taken from the progress note text (`(step N, M min in)`), so the number is real.
- reduced motion: same lines, no rotation animation (swap text without a transition).

**Reactions** (one short line in the existing small bubble beside the launcher when the panel is closed; inside the
panel they don't show, the reply speaks for itself): happy "Got it.", proud "Done. Want the details?", confused
"Quick question for you.", sad "That didn't work. I'll tell you why.", needs "Something needs you." (keep today's
count copy when there is a count: "2 things need you. Want the detail?").

**Greeting** (empty state, `lg` Scout above "What do you need?"): by time of day in Pacific, 12-hour world:
before 12 PM "Morning.", 12-5 PM "Afternoon.", after 5 PM "Evening.", after 11 PM "Late one, huh?" Then the existing
line. Page-aware second line when the route is known (use `location.pathname`): /admin/turo "Want me to check today's
trips?", /admin/security "Want a quick security sweep?", default keeps "I read the data, fix things and run jobs on the
Mac mini." These are offers only; tapping one sends it as a message, exactly like OPENERS.

**Unprompted bubbles** (the Clippy moment, done politely):
- At most one unprompted bubble per 30 min, never while he's typing, never while a menu/sheet is open, gone after 9 s
  (current behavior) or on any tap. Only for real reasons: something needs him, a run finished while the panel was
  closed ("Done with the Pi ports. Want the details?" using the first line of the final reply, whole sentence only,
  or the generic proud line if it doesn't fit), or he came back after 2 h away ("Welcome back. 3 replies waiting.").
- A tiny "Not now" on the bubble mutes unprompted bubbles until tomorrow (localStorage key `scout-quiet-until`,
  wrapped in try/catch). Needs-you bubbles still show (those are the 4 kinds of news).

## 4. Where he appears (replace every `Scoutie`)

| Place | Size | Mood source |
|---|---|---|
| Launcher pill (desktop) | sm, 1.25 rem tall | full state machine (closed) |
| Panel header (left of title) | sm | full state machine (open) |
| Empty state | lg, 72-80 px | idle + greeting; stares at cursor |
| Working row | sm | thinking/working/searching + phrase |
| Phone: MobileNav center button / "Ask Scout" tile | keep their current icons this round; just export ScoutBuddy so they can switch later | - |

Delete `Scoutie` and its `.scoutie*` CSS once nothing uses it. Keep `scout-nudge`, `scout-dots`, `scout-shimmer`.

## 5. Quality floor (HIG + ui-ux-pro-max checklist)
- At rest only the eyes move (like the logo). Loops only for thinking/working/searching (loading) and the slow sleepy
  breath; everything else is a one-shot reaction tied to an event.
- All motion is transform/opacity, ≤ 1.6 s, spring easing, interruptible (a new mood replaces the old one instantly;
  never queue reactions), never blocks input.
- `prefers-reduced-motion`: static poses, words still update.
- The SVG is `aria-hidden`; the launcher's aria-label carries the meaning ("Scout, needs you" / "Scout, working");
  the working phrase sits in the existing `aria-live="polite"` row. Don't announce every rotating line: only announce
  when the tool changes (use a separate visually-hidden live region fed by tool changes).
- No layout shift: phrase changes don't change the row height; the launcher width doesn't jump when the mood changes.
- No new emoji. Times 12-hour. Copy never truncates.
- Phase lock: idle ScoutBuddy and the top-left AdminMark glance in sync (same `--am-delay` math).

## 6. Scout Lab (so Jared and Claude can see every face)
Admin-only route `/admin/scout-lab` (lazy-loaded page `src/pages/admin/ScoutLab.tsx`, behind the existing admin guard,
not in the sidebar): a grid of every mood at sm / md / lg on the dark admin surface plus one row on a white pill (the
launcher look), each with its name and a "Replay" button for one-shot reactions, a reduced-motion preview toggle, and
the working phrases cycling. This is how the result gets reviewed visually after deploy.

## 7. Verify (Sonnet, before committing)
- `npx tsc --noEmit -p tsconfig.app.json` clean; `npm run build` passes.
- grep: no `Scoutie` left; `AdminMark.tsx` unchanged (`git diff --stat` shows no change to it).
- If a migration was needed for admin_chat_actions, it is applied via Supabase MCP and saved as a file.
- No edge function changes in this plan.

## Ship
Commit with the session attribution lines, `git fetch origin main && git rebase origin/main && git push origin HEAD:main`,
confirm origin/main == HEAD. Vercel deploys the admin from main.
