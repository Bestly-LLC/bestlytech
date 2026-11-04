# Ask the wall (Wave 3c)
Siri / app question -> Supabase wall_questions -> local answerer on the Mac mini -> answer_text + answer_card.
- ask_answerer.py: launchd tech.bestly.ask-wall (KeepAlive). Model: qwen3:8b via Homebrew Ollama (launchd sh.brew.ollama). Test: python3 ask_answerer.py try "what plane is that"
- ask_watch.py: launchd tech.bestly.ask-wall-watch (60 s). Restarts answerer/Ollama, beats wall_ask_beat_t (digest-only).
- ask_card_proto.js: wall card PREVIEW only (not in wall.html until Jared approves).
- Install: copy .py to ~/.bestly/ask/, plists to ~/Library/LaunchAgents, launchctl bootstrap gui/$(id -u) <plist>. Token file ~/.bestly/ask_wall_token (hash in db_watchdog_tokens label ask-wall).
- Undo: launchctl bootout both labels, delete plists; drop table wall_questions and wall_ask* functions; delete agent wall-ask.
