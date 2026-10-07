# Scout vision, multiple windows, Spam Desk (opusplan, 2026-10-06)

Jared, 6:52 PM: "Give Scout real vision (see images like Claude does, not convert them to text), let me upload
videos, open multiple Scout windows, and put a Spam button on Replies ready that reports spam to Apple and every
other party, records it, and if we can collect damages like DoNotPay, do that."

## Decisions (Jared, 7:00 PM)
| Question | Answer |
|---|---|
| Spam tap does | Report to every abuse address + move to Junk + block the sender + teach the drafter |
| Auto-catch | Yes: clear phishing is reported on its own and listed in the 7 PM recap; unsure mail gets a "Spam?" card instead of a reply draft |
| Damages | Claim file; Scout drafts, nothing is sent without his yes |
| Multiple windows | Desktop only (phone stays one chat) |

## What exists today (mapped)
- Attachments: `ScoutAttach.tsx` uploads to bucket `scout-files`, then `scout-file` turns images/PDFs into TEXT
  with paid Haiku. Scout's models only ever see text. Videos are refused.
- Paid Scout = Anthropic Messages API in `admin-chat` `ask()`; free Scout = `_shared/free-llm.ts` (text only).
- Replies ready = `scout_daily` rows kind `draft`, built by `scout-daily` `drafts()` at 6 AM; `source_key = 'mail:<bestly_mail.id>'`.
  No spam or phishing detection beyond a NOISE regex.
- Mail: `bestly_mail` (bodies + almost-empty headers, no raw source). Mac mini Apple Mail has the accounts.
  `scripts/meetingrec/agent.py` runs on the Mac mini and pulls its own code from `main` every 10 minutes (SYNC list).

## Part A: real vision (Scout sees, not reads a transcript)
1. Paid Scout gets the real pixels. The `[File: …]` block keeps the transcript (history, free AI) and also carries
   `scout-files` path(s). When admin-chat builds the Claude messages, the files in the latest user turns become
   `image` / `document` (PDF) content blocks fetched from storage. Older turns keep only the text (token cost).
2. Videos: the browser samples frames (one every few seconds, max 12, 1280 px JPEG) and uploads them to `scout-files`;
   the message says `[Video: name, 0:42, frames at …]`. Claude sees the frames as images in order.
3. Free Scout gets eyes too: a `look` tool that sends the image(s) + a specific question to a free vision model
   (Groq vision model picked from Groq's live model list; paid Haiku only as last fallback). It can look again with a
   new question, so it is real looking, not one fixed transcript.
4. Upload transcripts move to the free vision model first (token-saving rule), Haiku as fallback.

## Part B: multiple Scout windows (desktop)
Scout becomes ScoutHost + ScoutWindow. "New window" in the header opens another floating window (own conversation,
own position, offset), each closable; the list survives a reload. Global hooks (Cmd+J, ?scout=open, askScout events,
the launcher badge) belong to the first window. Phone: unchanged single sheet.

## Part C: Spam Desk (new AI employee, reports to Ares)
- Tables: `spam_reports` (one per reported email: mailbox, message id, sender, verdict, how caught tap/auto, targets,
  status queued/fetching/sent/failed/undone, timestamps), `mail_blocklist` (sender address or domain), `spam_report_targets`
  (who gets what: phishing aggregators, the mailbox provider, impersonated brands, verified addresses only),
  `spam_claims` (damages file).
- Spam button on each Replies ready card (with Undo): draft dismissed, report queued, sender blocked.
- Mac mini worker (`scripts/meetingrec/mailspam.py`, synced by agent.py): finds the message in Apple Mail by message id,
  takes its full source (.eml), marks it junk (moves it to Junk and trains Apple Mail's filter), uploads the source.
  The edge function then sends the report email(s) from jared@bestly.tech with the original attached, to:
  iCloud mailbox: abuse@icloud.com + reportphishing@apple.com; every phishing email: APWG; the impersonated brand's
  phishing address; the abuse contact of the sending network and the sender domain's registrar (RDAP lookups).
- Auto-catch: hourly, new inbox mail is checked by the free AI; clear phishing from a sender he never wrote to is
  reported on its own (recap line), unsure mail becomes a "Spam?" card. Blocked senders never get drafts again.
- Damages: commercial spam from an identifiable US business (not scams) opens a claim: evidence, count of emails,
  California's per-email damages for misleading commercial email, a drafted demand letter. Sending needs his yes.
  Scout is not a lawyer and says so in the claim.
- Watchdog: worker heartbeat, stuck queue, and "Mail needs your OK" (macOS Automation permission) raise Scout incidents;
  team card via `team_onboard`.

## Guardrails
Never report a sender Jared has emailed or a protected sender automatically. Never send a demand letter without his yes.
Reports are rate limited and deduped per message. Every send is logged.
