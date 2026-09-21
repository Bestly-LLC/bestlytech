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
- `talk_tracks.py` — transcribes each person's track, shifts it onto the recording clock, merges
  with Jared's mic. `stop.sh` uses it when the notetaker was in the call and falls back to
  `name_speakers.py` otherwise (Zoom, phone, one-to-one Talk rooms).
- `notetaker/tester.js` — a fake guest (Chrome fake mic, optional audio file) for testing.
