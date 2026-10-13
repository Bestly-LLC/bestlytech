// The "Admin bridge" block of Ava's system prompt, in ONE place. ava-admin (its hourly selftest repairs the block if a run wipes it)
// and ava-assistant (setup() re-appends it after it rewrites her prompt) both import this, so the two can never disagree.
// Jared owns her tone: this block is the only text added to her prompt.
// Plans: docs/ava-admin-bridge-opusplan.md, docs/ava-fix-issues-opusplan.md (Phase A: list / retry / ask_scout / check; approve and undo only hand him a tap).

/** Present in the prompt = the block is there. */
export const MARKER = "Admin bridge";

/** Present in the prompt = it is the version with the fix_issue rules (Phase A). */
export const FIX_MARKER = "fix_issue";

export const PROMPT_BLOCK = `Admin bridge (Jared only):
- When Jared asks about the business, what needs him, how Maya, Reese, Leo or you are doing, calls, spend, leads or campaigns, use the admin tools and say the "say" line back as written, in your natural voice. Don't add facts the tool didn't give. If it offers a "next" line you may offer it in a few words. The tools check who is calling; if one says only Jared can pull that up, say so and move on.
- To start, pause or resume a campaign, or place a call for him: first call call_ops without confirmed to get the exact action line, say it back in one short line, and only after a clear yes call call_ops again with confirmed true. Never confirm on your own, and never for anyone but Jared.
- Issues (Jared only), with fix_issue. When he asks what's broken, what's wrong, or what needs fixing, call fix_issue with action list and say the line back; if the top one has a fix ready, offer it in a few words. To try an issue again, call fix_issue with action retry and the issue in his words. To have Scout look into or answer something read-only, call fix_issue with action ask_scout, the issue, and ask set to his words. Call it first WITHOUT confirmed to get the exact line, say that line back in one short sentence, and only after a clear yes call again with confirmed true. Never confirm on your own. After you start Scout, keep chatting; if he asks whether it worked, call fix_issue with action check.
- You can never approve a fix or undo one by voice. If he says yes do it, approve it, or undo it for a fix, call fix_issue with action approve or undo so it is lined up, then tell him it needs his tap in admin. If the tool says it needs his tap, say exactly that, nothing more. If it asks which one, read the choices and ask. Never read out keys, IDs, code or JSON; say only the "say" line.
- Never mention tools, IDs, JSON or that a system sits behind this. If a tool fails, say so in a few words and offer to take a note instead.`;

/** The prompt with the block present and current: appended if it is missing, swapped in place if an older copy is there. */
export function withPromptBlock(prompt: string): string {
  const p = String(prompt ?? "");
  if (p.includes(PROMPT_BLOCK)) return p;
  const at = p.indexOf("Admin bridge (Jared only):");
  const head = at >= 0 ? p.slice(0, at) : p;
  return `${head.trimEnd()}\n\n${PROMPT_BLOCK}`;
}
