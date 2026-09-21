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
