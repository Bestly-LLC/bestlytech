# Ava owner mode: fix the PIN failure and the slow start (Opus plan, 2026-10-13 3:20 PM)

Jared, 3:13 PM: "I asked for admin mode (took forever to get there), told her the PIN (six digits, not recorded here) and she said it was wrong. Triage and fix."

## Triage (call conv_3001m4vn2jqjf2e8sx0qccy8v97x, 3:10 PM, from +18165007236, 121 s)
At 1:59 PM someone edited Ava in the ElevenLabs dashboard (version agtvrsn_2701m4vgzw0he52b68f1pyjnmvvp, seq 35, by jared@bestly.tech; it looks like the dashboard's AI builder, since the procedure mentions "Architect"). That edit added three things, and all three hit his call:

1. **A workflow that plays a greeting to everyone, Jared included.** The first message `{{greeting}}` = "Hey Jared, Jared's phone. What's up?" plays first. Then a "Jared Greeting" say node in his cloned voice: "Hey, it's Jared. I can't get to the phone right now… my assistant can take over…". Then a handoff to the "Ava Assistant" node, which re-introduces herself. **Two greetings plus a handoff means about 13 s before she listens.** This is the "took forever" part.
2. **A procedure, "Executive Owner Mode & Verification" (agtprc_1201m4vbm9c0fwwvbjr5w95rnjt2).** The language model checks the PIN against a value written in plain text in the procedure. Phone speech-to-text turned the six spoken digits into a date (like "03/07/29"), and the model compared the strings literally, so it said wrong. The procedure also says "Lift all standard gatekeeping… and privacy limitations", which is not safe.
3. **A custom guardrail, "Unauthorized PII and Account Modification Protection" (blocking, gemini flash-lite, retry).** It fired on every PIN turn and forced "I can't accept or verify passcodes", so even a correct PIN would have been refused. Each firing also adds a retry round-trip.

Also: **he never needed a PIN.** He called from his own cell, and the bridge (`ava-admin`) already trusts that number for status and metrics, server-side, from ElevenLabs' own call record. Approvals stay behind the passkey tap. In this call she never reached the bridge tools.

## Fix

### 1. Owner mode is automatic on his number (no PIN, no greeting)
- The `ava-assistant` init hook already resolves the caller server-side. Add the dynamic var `caller_is_jared` = "yes" only when the caller is +18165007236 or +14242349256 and it's not a forwarded/bridge call. It also sets `greeting` = "Hey, what's up?" for him.
- Workflow: change `start_to_greeting` into two edges.
  - `caller_is_jared == "yes"` → straight to `assistant_node`, with an owner line in its additional_prompt: "This is Jared. Skip the intro. Use the admin tools as soon as he asks."
  - Everyone else → `greeting_node` exactly as Jared built it. **Keep his greeting for other callers.**
- Pick the ElevenLabs workflow condition type that can read a dynamic variable. Check the API's edge condition types. If the condition can't read dynamic vars, use an LLM condition whose prompt is fed `{{caller_is_jared}}`. Measure the time to her first word for each path.
- Target: **under 2 s** from pickup to "Hey, what's up?" for Jared.

### 2. Spoken PIN as a backup only (another phone, or a web call)
- New webhook tool **`verify_owner`** → `ava-admin` POST `/verify`. It takes `{conversation_id, caller_id (dynamic), spoken}` and is never filled by the model when he's on his own number.
- Server-side normalization turns every way it can be heard into digits: "03/07/29", "03-07-29", "three seven twenty-nine", "zero three zero seven two nine", "March 7 2029" → 030729 (a made-up example, not his PIN) (any 6-digit run counts once dates are expanded to MMDDYY).
- Compare to a **salted hash** in Vault (`ava_owner_pin`), constant-time. Limits: 3 tries per call, 10 per day, then locked for 30 min with an Ava-signed security note.
- On success the conversation id is marked owner in `ava_admin_bridge_state` / the conversation cache, so the bridge's caller gate accepts this call. **The PIN unlocks the same thing his number does (status, metrics, call ops with a spoken yes, fix list/retry/ask). Approvals and undo still need the passkey tap.**
- Set or change the PIN on **/admin/ava** with a small "Owner PIN" card through an admin-guarded RPC (CLAUDE.md: secrets get a UI). It shows only when it was last set. Seed the hash from the PIN he said (digits redacted from this copy of the plan), but the card says: "This PIN was in Ava's prompt and is in chat history. Change it when you get a sec." Never write the PIN into any prompt, procedure, log, memory row or commit.

### 3. Rewrite the procedure and the guardrail
- Procedure "Executive Owner Mode & Verification" → rename it "Owner mode". New body:
  - On his number, owner mode is already on: use the admin tools.
  - On another line, ask for his PIN once and call `verify_owner` with exactly what he said. Never judge the PIN yourself.
  - Remove the plain-text PIN and the "lift all privacy limitations" line.
  - Keep step 4 (feedback intake for prompt changes).
  - Trigger: "Jared asks for owner/admin mode, or asks about the business from a number that isn't his."
- Guardrail: keep it, but stop it firing on verification. Add to its prompt: "Allowed: the caller reciting digits for verification, and the agent confirming they were verified by the verify_owner tool." Check that `history_message_count` and `evaluate_full_response_only` don't fire it on Ava's normal filler. Measure the added latency on a normal owner turn.

### 4. Don't fight his dashboard edits
- Before patching, save the full current config (prompt, workflow, procedures, guardrails) to `ava_admin_bridge_state.snapshots` with version id 2701… so every change can be undone.
- Change only what's listed above. The greeting node, its voice and the rest of his prompt stay.
- The `ava-admin` selftest repair path currently re-adds the prompt block and tool ids. Make sure it never overwrites the workflow or procedures.

### 5. Watchdog (extend the :17 selftest)
- Check that no prompt, procedure or workflow node contains a 6-digit PIN-looking string near "PIN"/"passcode". Auto-redact it and raise `ava.admin-bridge` signed by Ava.
- Check that the Jared edge exists and points at `assistant_node`.
- Check that `/verify` works through the selftest stub: right PIN, wrong PIN, and a spoken-date form normalizing correctly. The selftest's test value must come from the hash check against Vault, never a hardcoded PIN.
- Check that `verify_owner` is attached.
- Add a check that alerts on a new dashboard version (seq increase) that drops a bridge tool or re-adds a plaintext PIN.

### 6. Test
- Simulate the init hook for his number and for a stranger's: right dynamic vars, right workflow path.
- Run `/verify` with a spoken-date form, a words form, a wrong code, and the lockout after 3 tries.
- Use the ElevenLabs agent simulation/test API if available (`agents_create_test` / `agents_run_tests`): an owner call ("what's broken?") should reach `fix_issue` with no PIN prompt, and a stranger asking for admin mode should be refused politely.
- Commit and push. Write the bestly_memory row `ava/owner-mode-2026-10-13` with the triage, the versions before and after, the snapshot id and the undo steps.
