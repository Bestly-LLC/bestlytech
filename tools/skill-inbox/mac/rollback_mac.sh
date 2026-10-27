#!/bin/zsh
# Removes the Skill Inbox Add to Claude installer from THIS Mac. Leaves every skill already installed in ~/.claude/skills.
UIDN=$(id -u)
launchctl bootout "gui/$UIDN/tech.bestly.skill-inbox-claude" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/tech.bestly.skill-inbox-claude.plist" "$HOME/.bestly/skill_inbox_claude_install.py" "$HOME/.bestly/skill_inbox_mac.json" "$HOME/.bestly/skill_inbox_mac_token" "$HOME/.bestly/skill_inbox_mac_state.json"
echo "removed the installer. Installed skills were left in place."
