# Bestly Agent demo audio

Builds `public/agent-demo/<id>.mp3` (one mono 64 kbps / 44.1 kHz file per sample call, two voices alternating, 0.25 s
lead-in, 0.45 s between lines) and `<id>.json` (line start/end, per-word starts, total duration, content hash) for the
five calls in `src/components/agentDemo/scenarios.ts`. Model: `eleven_multilingual_v2`. Spoken text is `say ?? text`;
word timings come from ElevenLabs character alignment and are only written for lines without `say`.

## Re-record (only when a scenario's text or voice changed)

It is idempotent: each JSON stores a sha256 of the voice ids + spoken texts, and unchanged scenarios are skipped, so
nothing is paid for twice. Budget is about 3,600 characters for all five calls.

1. Print the SQL for scenarios that changed (add `--force` to redo one anyway, or pass an id):
   `node tools/agent-demo-audio/build.mjs sql [id] [--force]`
2. Run the printed `select public.invoke_edge_function('agent-demo-tts', ...)` with the Supabase MCP `execute_sql`
   (project `rcqfqhguwpmaarseifqg`). It returns a request id. Wait about 30 seconds, then
   `select status_code, content from net._http_response where id = <id>` and confirm `"ok":true` with every line in `files`.
   One scenario per call. The function (`supabase/functions/agent-demo-tts`) is service-role only and uploads each clip to
   the public Storage bucket `agent-demo` (fictional audio).
3. Build the final files (downloads clips into `tools/agent-demo-audio/clips/`, which is git-ignored, decodes them with
   ffmpeg, writes the mp3 and JSON):
   `node tools/agent-demo-audio/build.mjs [id] [--force]`
4. Verify: `node tools/agent-demo-audio/build.mjs check` (mp3 length equals JSON duration within 0.1 s, line starts
   increase, words-per-second is plausible, hash matches the scenarios).
5. Commit `public/agent-demo/*`.

If you re-record a scenario, delete `tools/agent-demo-audio/clips/<id>/` first so stale clips are not reused.

Needs ffmpeg and ffprobe on the PATH; uses the repo's existing esbuild to read the TypeScript scenarios. No new dependencies.

## Watchdog

`maya-watch` (Line Check) checks about hourly that `bestly.tech/agent` answers, every `/agent-demo/<id>.json` has a
duration over 20 s and every `.mp3` answers, and counts visitor-side `agent-demo-audio` reports. Problems alert under
`maya.site` and tell you to re-run this build.
