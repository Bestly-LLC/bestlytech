#!/bin/zsh
# Installs the Skill Inbox "Add to Claude" installer on THIS Mac (owner: Radar). Safe to run twice.
# Usage: install_mac.sh <host-name> <supabase-url> <publishable-key>      e.g. install_mac.sh macbook-air https://xxxx.supabase.co sb_publishable_...
# Creates ~/.bestly/skill_inbox_mac.json, a 0600 token file (prints only its SHA-256 so it can be registered; never the token),
# and the launchd agent tech.bestly.skill-inbox-claude (every 15 minutes). Does not touch ~/.claude/skills.
set -e
HOST="$1"; URL="$2"; KEY="$3"
[ -n "$HOST" ] && [ -n "$URL" ] && [ -n "$KEY" ] || { echo "usage: install_mac.sh host url publishable-key"; exit 2; }
B="$HOME/.bestly"; mkdir -p "$B" "$HOME/Library/LaunchAgents"
SRC="$(cd "$(dirname "$0")" && pwd)/skill_inbox_claude_install.py"
[ "$SRC" = "$B/skill_inbox_claude_install.py" ] || cp "$SRC" "$B/skill_inbox_claude_install.py"
chmod 700 "$B/skill_inbox_claude_install.py"
printf '{"host": "%s", "url": "%s", "apikey": "%s"}\n' "$HOST" "$URL" "$KEY" > "$B/skill_inbox_mac.json"
if [ ! -s "$B/skill_inbox_mac_token" ]; then (umask 077; /usr/bin/python3 -c 'import secrets;print(secrets.token_hex(32))' > "$B/skill_inbox_mac_token"); fi
chmod 600 "$B/skill_inbox_mac_token"
echo "token sha256 (register this in db_watchdog_tokens): $(tr -d "\n" < "$B/skill_inbox_mac_token" | shasum -a 256 | cut -d' ' -f1 | tr -d '\n')"
P="$HOME/Library/LaunchAgents/tech.bestly.skill-inbox-claude.plist"
cat > "$P" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>tech.bestly.skill-inbox-claude</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>$B/skill_inbox_claude_install.py</string>
  </array>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$B/skill-inbox-claude.log</string>
  <key>StandardErrorPath</key><string>$B/skill-inbox-claude.log</string>
</dict>
</plist>
PL
UIDN=$(id -u)
launchctl bootout "gui/$UIDN/tech.bestly.skill-inbox-claude" 2>/dev/null || true
echo "launchd agent written. Load it with: launchctl bootstrap gui/$UIDN $P   (the caller does this after the token is registered)"
