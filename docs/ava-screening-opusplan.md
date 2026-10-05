# Ava meets the screeners — opusplan (2026-10-05)

**Owner:** Jared · **Drafted:** 2026-10-05 · **Status:** proposed · **Planned by Opus, built by Sonnet**

**Ask (Jared):** Ava has blown several calls against the call-screening assistants built into iPhone, Android and Google Voice. She talks over them, doesn't listen, doesn't understand what's happening. Give her two skills — an iPhone one and an Android/Google Voice one — plus context, and let her learn from these calls so she handles them cleanly.

---

## TL;DR

- **The screeners aren't the bug. Her turn-taking settings are.** On 2026-10-04 she was tuned for speed: `turn_eagerness: "eager"`, `speculative_turn: true`, and a 1.0-second soft timeout that fires filler ("Yeah…", "Mm, right…"). Against a human that reads as natural. Against a recorded screening prompt it means **she starts talking over the announcement and drops filler words into a transcript a human is about to read.** That is the single biggest fix.
- **Four systems, three different scripts.** Apple Call Screening asks who's calling and why. Apple Live Voicemail transcribes while you speak. Google Call Screen announces itself and asks for name and reason. Google Voice says "say your name after the tone" and wants *only* a name. Treating all four as one conversation is why she fails.
- **The hardest part is the silence.** After she answers a screener, a human stares at a screen for 10–20 seconds deciding. Right now that silence looks to Ava like a dead call or a cue to talk. It is neither.
- **When a human finally picks up, she must start over.** They heard a clipped snippet, not her opener. Continuing mid-pitch is disorienting and is probably half of what reads as "obviously a robot."
- **On "more seamless":** the fix here is competence, not disguise. Screeners exist to protect people from unwanted calls, and a screener asking "who's calling and why" is asking a fair question. Ava should answer it clearly and truthfully — a crisp, honest name and reason is also what actually gets her through. **Nothing in this plan tells her to evade a screener, pretend to be human to one, or shade the reason for the call.** She keeps answering honestly when someone sincerely asks whether she's AI.
- **Learning:** tag every screened call, keep the opening seconds, and let a weekly pass *propose* new detection phrases. Proposed, never auto-applied — a bad phrase would make her freeze on live humans.

---

## 0. What's in the code today

| Thing | Where | State |
|---|---|---|
| Turn settings | `roofguard-caller/index.ts` `agentBody.conversation_config.turn` | `turn_eagerness: "eager"`, `speculative_turn: true`, `soft_timeout_config` at 1.0s with fillers. Tuned for speed on 2026-10-04. |
| Voicemail | `built_in_tools.voicemail_detection` + `VOICEMAIL` message | Handles plain answering machines. **Does not** handle an interactive screener, which expects a reply. |
| Bail-out rule | `STOPPER` block, "stuck in a phone menu or a robot loop… hold music over 2 minutes" | Her only machine-handling instruction. A screener is none of these, so it doesn't apply. |
| Outcomes | `OUTCOMES` set | `voicemail_left`, `gatekeeper_blocked`, `no_answer`… **no outcome for "screened"**, so these calls are miscounted in the scorecard today. |
| Learning loop | `docs/ava-learning-opusplan.md` (the Coach) | Planned, not built. This plan feeds it rather than duplicating it. |

---

## 1. The four systems and what each one wants

| System | What Ava hears (roughly) | What it wants | What kills the call |
|---|---|---|---|
| **Apple Call Screening** (iOS 26, unknown callers) | "Hi, the person you're calling can't take your call right now. Can I ask who's calling and why?" | A short name + reason. Then the human decides. | Talking over the greeting. Pitching. Filling the decision silence. |
| **Apple Live Voicemail** (iOS 17+) | A normal voicemail greeting, then the beep — but the recipient is reading a live transcript and may pick up mid-message. | A clean voicemail. Stay available in case they pick up. | Hanging up the instant the message ends. Rambling — they're *reading* it. |
| **Google Call Screen** (Pixel/Android) | "The person you're calling is using a screening service from Google and will get a copy of this conversation. Go ahead and say your name and why you're calling." | Name + reason, one breath. | Interrupting the long announcement. Treating it as a human who said hello. |
| **Google Voice screening** | "Say your name after the tone." *beep* | **Just the name.** Nothing else. | Saying anything beyond the name. Speaking before the beep. |

**The shape all four share:** machine talks → Ava answers briefly → long silence → either a human picks up, or the call ends. Her job in the middle is to be brief and then be quiet.

---

## 2. The fix, in order of how much it matters

### 2.1 Stop her talking over the opening *(the big one)*

The first few seconds of an outbound call are where this breaks. Options for Sonnet, in preference order:

1. **Check whether ElevenLabs allows per-call turn overrides.** If `conversation_config_override` can carry `turn`, give outbound cold calls a calmer opening profile: `turn_eagerness` lowered, `speculative_turn` off, soft-timeout fillers off for the first turn.
2. **If it can't be overridden per call**, this becomes a straight trade-off against the speed Jared asked for on 2026-10-04. Recommend dropping the soft-timeout filler on the RoofGuard agent only and keeping eager turns — filler words landing in a screening transcript are worse than a pause.
3. **Either way, the filler list must not fire during the opening.** "Yeah…" transcribed into a screening card is the single most robotic artifact in this whole flow.

**Do not skip the verification step.** Guessing the override shape is how this ships broken.

### 2.2 Teach her the four scripts

A new prompt block (shared by both Avas via `_shared`, since the personal line gets screened too):

- **Recognise, then shut up.** If the first thing you hear is a recorded announcement rather than a person, stop talking and let it finish. Never start your opener over an announcement.
- **Apple Call Screening / Google Call Screen** — answer exactly what was asked, in one short sentence: who you are, who you're with, and why, then stop. Example shape: "This is Ava calling for Eli Cooper at RoofGuard, about roof maintenance for their buildings." No pitch, no question.
- **Google Voice "say your name after the tone"** — wait for the beep, then say *only* the name. Nothing else. Then wait.
- **Live Voicemail / any voicemail** — leave the normal voicemail message, unhurried, and stay on a few seconds after in case someone picks up.
- **The silence afterwards is normal.** Someone is reading a screen and deciding. Wait quietly up to about 20 seconds. Don't speak, don't fill, don't hang up.
- **If a human then picks up, start over.** Greet them properly from the top — they heard a clipped line, not your opener. Never continue mid-sentence.
- **Honesty is unchanged.** Give the screener your real name and the real reason. Never tell a screener, or a person, that you're human.

### 2.3 Give her the detection phrases as data, not hard-coded text

A small `ava_screening_systems` table: `key` (apple_screen, apple_live_vm, google_screen, google_voice), `phrases` (text[]), `how_to_answer`, `active`, plus hit counts. It lands in the prompt at setup time the way `ava_knowledge` already does.

Why a table and not prompt text: these announcements change with OS releases, and Jared should be able to add a phrase he heard without a deploy.

### 2.4 Count it properly

- New outcome `screened` in `OUTCOMES`, and `screening_system` + `screen_passed` on `rg_calls` / `ava_calls` (new migration — never edit a committed one).
- Data collection fields so the post-call webhook can fill them.
- **Scorecard honesty:** a screened call that never reached a human is not a failed pitch. Today it silently drags the funnel down. Once tagged, show screened calls as their own step so the Law-of-Averages maths stays true.

### 2.5 Let her learn, with a human in the way

- Keep the first ~15 seconds of transcript on any call tagged `screened`, plus any call where she was cut off inside 20 seconds (the signature of a missed screener).
- A **weekly** pass over those — on the Pi or the Mac mini with free AI, per the token rule, not a Claude scheduled task — proposes new phrases for `ava_screening_systems`.
- **Proposals land in a review queue in `/admin/roofguard`. Jared approves.** Never auto-applied: a phrase that matches normal human speech would make her freeze on real people, which is a worse failure than the one we're fixing.
- This feeds the Coach in `docs/ava-learning-opusplan.md` rather than competing with it.

### 2.6 Watchdog + team card *(standing rules)*

- Watchdog: if the share of calls ending inside 20 seconds with no outcome jumps week over week, that's screeners she isn't recognising — push Scout, signed by Ava.
- Update Ava's `/admin/team` card: the new alert prefix in `owns`, the weekly learning job in `pulse`.

---

## 3. Build order

| # | Step | Why first |
|---|---|---|
| 1 | Verify the ElevenLabs turn-override shape against the live API | Everything in 2.1 depends on it, and guessing breaks the agent |
| 2 | Turn/filler fix for the opening | Biggest single win, smallest change |
| 3 | Prompt block with the four scripts | Useless without step 2 — she'll still talk over them |
| 4 | Migration: `screened` outcome, `screening_system`, `screen_passed`, `ava_screening_systems` | Needed before anything can be measured |
| 5 | Detection phrases moved into the table, loaded at setup | Lets Jared fix a phrase without a deploy |
| 6 | Scorecard: screened as its own step | Stops the funnel lying |
| 7 | Weekly proposal pass + review queue | Only worth it once there's tagged data |
| 8 | Watchdog + team card | Standing rule |

---

## 4. Decisions for Jared

1. **Speed vs. screeners.** You asked for faster replies even at the cost of filler. If turn settings can't be overridden per call, the filler has to go on the RoofGuard agent. Accept that trade?
2. **Both Avas or RoofGuard only?** Your personal line gets screened too, and the fix is the same.
3. **How long should she wait in the decision silence?** 20 seconds is my recommendation; longer costs money on every screened call.

---

## 5. What could go wrong

- **Over-eager detection.** A phrase that matches a real person makes Ava go silent on a live human. Hence phrases as reviewable data, and Jared approving every addition.
- **The turn fix slows every call.** Watch booked-per-week for two weeks after; the scorecard will show it.
- **OS updates change the wording.** The table is the mitigation, plus the weekly proposal pass.
- **Screened calls were never free.** They already cost voice minutes. Counting them properly may make the cost-per-meeting look worse — that number was always real, it just wasn't visible.
