# Meeting recorder (Mac mini)

Copies of what runs in `~/MeetingRec` on the Mac mini. The live files are there, not here.

- `agent.py` — launchd agent (`tech.bestly.meetingrec-agent`). Polls the `meeting-recorder`
  edge function every 3s, runs start/stop for Scout, reports state, ships transcripts to
  `meeting_recordings`. Key lives in `~/MeetingRec/.agent-key` (hash in `meeting_recorder_state`).
- Scout can't capture audio itself: macOS gives Screen Recording permission to
  `Start Recording.app` only. So the agent writes `.pending-name` / `.pending-roster` and opens
  that app, and `start.sh` picks the names up.
- `stop.sh` — stop, transcribe both tracks, `name_speakers.py`, upload to Nextcloud.
- `name_speakers.py` — names far-end voices from the roster. Voice match where a voiceprint exists,
  elimination for one new person (and learns their voice), and says "A/B" instead of guessing when
  the model can't tell two voices apart (it separates a man and a woman easily, two similar voices hardly at all).
- `stop_app.applescript` — source of `Stop & Transcribe.app` (wrapped in a 3h AppleEvent timeout;
  the old one threw -1712 on long calls).

## Notetaker (exact names on Talk calls)

- `notetaker/notetaker.js` — while a recording runs, the agent finds the Talk room with a live
  call, adds the Nextcloud user `scout-notetaker` ("Scout (notetaker)") to it, and runs this in
  headless Chrome (playwright-core, system Chrome). Talk sends every person's audio to every
  participant as a separate stream, so it records one track per person, named from Talk's tiles.
  Password is in the Mac keychain (`nextcloud-notetaker`). It leaves and is removed from the room
  when the recording stops.
- `talk_tracks.py` — transcribes each person's track and shifts it onto the recording clock. Jared's lines come from
  his own Talk track too (1.10.2; the Mac mini's mic only as a fallback, see "Jared's lines" below). `stop.sh` uses it when
  the notetaker was in the call and falls back to `name_speakers.py` otherwise (Zoom, phone, one-to-one Talk rooms).
- `notetaker/tester.js` — a fake guest (Chrome fake mic, optional audio file) for testing.
- `voicebank.py` — Ava's voice bank (2026-10-05). Hourly while idle, the agent runs it: from each meeting's
  `-mic.m4a` (Jared only) it keeps stretches where he talks and the far end (`-system.m4a`) is silent, drops clipped
  and Bluetooth-narrowband audio, takes the best 20 minutes, and hands them to the `ava-voicebank` edge function,
  which feeds his Pro voice clone in ElevenLabs, trains it, and switches Ava's "Use my voice" over once it speaks.
  Eli's voice never leaves the Mac. Log: `~/MeetingRec/voicebank.log`. Failures: monitor key `recorder.voicebank`.
- Since 1.8 the agent restarts itself (launchd KeepAlive) when the repo has a new `agent.py`, then self-tests.

## Auto-record (1.10, 2026-10-18)

Scout starts the recorder by itself when a Talk call in one of the `AUTO_ROOMS` (top of `agent.py`) has the right people in
it, and stops, transcribes and ingests it when the call empties. Every other room still needs a manual start
(Start Recording on the Desktop, or Scout's "Record a call"), and a manual start always works and always wins.

- Rooms and rules. `fyqvdsa4` (Centering YOU strategy call) and `sm33w3fu` (Eli & Jared - BDC Universal, added 2026-10-18 at
  Jared's request): Jared and at least one other human are in the call. Jared is the Nextcloud user `jared` or anyone in the
  call under the name Jared (a guest seat, Studio, his phone). `sm33w3fu` has no client: the row's `client_slug` stays empty,
  nothing is filed in a client folder, and the call is handled by scout-daily as before.
  `yqne2jpr` (Bestly call test, sandbox client `bestly-test`): any two humans; it switches itself off at midnight after
  Monday, Oct 19, 2026 (`until` in `AUTO_ROOMS`). Humans are `users`, `guests`, `emails` and `federated_users` attendees that
  Talk says are in the call (`inCall` bit 1) and have pinged in the last 75 s. `scout-notetaker` and `cowork-bot` never count.
  Talk's `hasCall` is only used to decide whether to look closer: it can stay true for days (Sep 29).
- Timing. The rule must hold 20 s before the recording starts (`AUTO_HOLD_S`). With no human in the call for 90 s
  (`AUTO_EMPTY_S`) or after 4 hours (`AUTO_CAP_S`) the normal `do_stop` runs (transcribe, upload, ingest, bot removed from the
  room). After a recording the rule has to be false for 30 s before the next auto-start; at most 3 auto-starts an hour.
- Measured in the rehearsal room (2026-10-18, 12:38 PM, two `calltest` seats, one with speech): the second seat was in the call
  at 12:38:54; `auto-start` 12:39:16 (22 s: the 20 s hold plus the 4 s loop); recorder running 12:39:27 (11 s: wake the display,
  open Start Recording.app); the bot was in the call at 12:39:55 (28 s after the recorder: Chrome, page, login, Join). So the
  first ~35 s of a call are not recorded at all and the per-person Talk tracks start about a minute in; the Mac's own mic and
  system audio cover the time in between. A seat that leaves stays in Talk's list for up to ~40 s (the session lingers until its
  last long-poll ends), so the call counts as empty ~30-40 s after the last person hangs up; the stop starts 90 s after that
  (12:42:48), the bot is out 6 s later, the row is in the admin ~28 s after the stop starts, and the client-folder copy is done ~35 s after that.
  Measured again at 1:30 PM on 1.10.2 (display awake, Jared at the Mac): second seat in the call 1:31:17, rule held 1:31:28, `auto-start`
  1:31:51, recorder running 1:31:54 (3 s with the display awake), the bot's Talk tracks from 1:32:22 (28 s later, 54 s after the second
  person arrived); last person left 1:34:15, that seat left Talk's list ~38 s later, stop 1:36:16 (2 min 01 s after the last person left),
  bot out 1:36:28, row in the admin 1:36:43 (27 s after the stop), client-folder copy 1:37:05 (49 s after the stop, 3 files, no mic audio).
- Never: "Scout self-test" rooms, the heal test room, one-to-one rooms, a second recording while one is running, a start
  while the notetaker self-test has Chrome. A recording somebody started by hand is never stopped for them (a reminder
  `recorder.longrec` goes out after 4 hours).
- Switches, no deploy needed: `touch ~/MeetingRec/.auto-off` turns all auto-recording off; `touch ~/MeetingRec/.auto-off-yqne2jpr`
  turns one room off; delete the file to turn it back on. `meeting_recorder_state.info.auto` shows what the agent sees.
- State files: `.auto` (the recording Scout started), `.meta/<recording>.json` (room, title, auto, jared_seen, ended, verified).
- The notetaker never starts a call: `notetaker.js` joins only a live call (it asks Talk first and only presses a button that
  says Join). Exit codes: 0 stopped, 1 crashed, 2 bad usage, 3 could not join, 4 no live call (not a failure, the agent looks
  again in 10 s), 5 dropped and could not get back in. It writes `alive.json` every few seconds; the agent kills one that goes
  quiet. If it is dropped mid-call it rejoins by itself.
- Ingest. Each row in `meeting_recordings` carries `room` and `client_slug` (the `meeting_client` trigger maps the room to
  `approval_clients.talk_room`). The audio is also copied (server-side WebDAV COPY) to the client's folder:
  `Bestly/CenteringYOU/Calls/<day>/` for `centering-you`, `Bestly/_admin/test-client-calls/<day>/` for `bestly-test`.
  Never if that folder, or a parent of it, is shared with anybody (it raises `recorder.clientfile` instead).
- Jared's lines (1.10.2, 2026-10-18). Jared joins from Studio on any device, so the Mac mini's mic is not his voice unless he is
  sitting at it, and in a room nobody is in it only hears the radio (the 12:39 PM rehearsal got 17 "JARED" lines of music). So:
  his own Talk track (what the bot heard from him) is the source for his lines. The Mac's mic stands in only when that track
  is missing or empty (fewer than 6 words) AND he was in the call. If he was not in the call (the rehearsal room with two test seats,
  Eli on his own) the mic is never used: `talk_tracks.py` takes the `JARED` lines out of the plain transcript too (so
  `name_speakers.py` cannot pick them up), and the ingest takes them out of whatever it is sent as a last safety net.
  "He was in the call" = he started the recording by hand, or Scout saw him in the call's participants while recording (`jared_seen` in
  `.meta/<recording>.json`, set at the auto-start and by every 4-second look at the room), or the notetaker recorded a track under his
  name (`jared_in_call` in `agent.py` and in `talk_tracks.py`, kept the same by tests). The mic *audio* is still recorded and still
  uploaded to Meeting Recordings; it is only left out of a client's folder, and of every transcript, when he was not in the call.
  The header of the transcript says which source was used; `meeting_recordings.speakers.jared` is `{in_call, source: talk | mic | none}`.
- Watchdogs (alerts signed by Scout Notetaker, prefix `recorder.`): `autostart` (two people in an auto room for 2 minutes and
  nothing is recording), `nofile` (no `meeting_recordings` row 45 minutes after a call ended), `clientfile`, `talkread` (the Mac
  cannot read Talk for 5 minutes), `longrec`, `notetaker`, and `offline` (server side, `recorder_offline_watch`: no poll for 15 minutes).
- Test rooms (`TEST_ROOMS` in `agent.py`, today `yqne2jpr`): recorded like any other room, but they never raise a Scout alert (the
  watchdogs only write to `agent.log`), never open or close a real room's alert (the `recorder.*` keys are shared by every room), and
  never show a macOS banner. Jared's rule, 2026-10-18: Scout must not push him about a test call.
- Tests: `cd scripts/meetingrec && python3 -W ignore -m unittest discover -s tests` (runs on the system python 3.9, no network).
- Rollback: `git revert` the 1.10 commits on `main` (the Mac pulls `agent.py` within 10 minutes), or in a hurry
  `touch ~/MeetingRec/.auto-off` and the agent keeps working as 1.9 did. Backup of the 1.9.0 files: `~/MeetingRec/.backup-1.9.0-2026-10-18/`.
