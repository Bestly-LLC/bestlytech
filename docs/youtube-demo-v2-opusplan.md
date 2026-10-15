# Opusplan: YouTube verification demo v2 (portal first, in order)

Written 2026-10-15 (Opus) for a Sonnet agent. Owner: Spark. Supersedes the video section of
`docs/youtube-verification-kit.md`.

Jared, 2026-10-15: "doesn't it need to show the dashboard for client portals?" Yes. The v1 agent clip showed the
portal with YouTube already **Connected** before the connect step. Commit 55bd5b5e then cut the portal out entirely.
Both are wrong.

Google's reviewer must see the real user journey, in order:

> the app and its privacy policy → where the client uses YouTube in the portal (not connected) → connect →
> Google consent screen with both scopes → connected → the scopes in use (a video posted, private)

## Final video order (three clips, one file)
| Clip | Who | Shows |
|---|---|---|
| A | agent (Playwright, 1280x720, captions like v1) | 1. Title card. 2. bestly.tech home + footer Privacy link. 3. /privacy-policy YouTube section. 4. **Client portal dashboard (home)** for the sandbox client. 5. A video post the client approved (portal "All posts" or the post page), caption "Posts go out only after the client approves them". 6. Settings → Your accounts → **YouTube tile showing Connect (not connected)**. 7. Tap Connect → Bestly connect page. End there (before "Continue to Google"). |
| B | Jared (QuickTime, his Mac) | Continue to Google → account chooser → **consent screen** (hold on the URL bar with client_id, app name, both scopes) → Allow → Bestly "Connected" page → studio.youtube.com → Content → the private test video. |
| C | agent | Back in the same sandbox portal: the YouTube tile now **Connected** with his channel name and "Nothing goes out until you approve a post". Closing card: "Uploads use youtube.upload only for approved posts; channel name via youtube.readonly." |

## Setup (agent, before recording A)
- **Sandbox client.** Use one that is NOT connected to YouTube: `bestly-test`, or `demo-two` if bestly-test has a
  YouTube social_accounts row. Never use Centering YOU.
  - Turn YouTube on for it: `youtube_offered` = true on its brand (same mechanism the v1 agent used on
    `zz-connect-test`; read bestly_memory `studio/youtube-verification-kit-2026-10-15` and kit section 9).
  - Make sure the portal has a token.
- **Approved video post.** It must have one, visible in the portal. Use an existing sandbox video item or create one
  from a Bestly house video already in storage (e.g. the media of BC05). Mark it approved the normal way. Do not
  touch real clients.
- **Connect link.** Mint one connect link for that sandbox client:
  `social_connect_mint(<client id>, 'Jared', 'youtube')`. This link is for Jared's clip B.
  - Do not open it yourself. A link works once.
  - Record clip A's connect page from the same link only if the page view doesn't consume it. Check `used_at`
    stays null after loading the connect page. If it does get consumed, mint a second link for B.
- **The private test video already exists:** https://www.youtube.com/shorts/YmV7hadogPg (BC05, uploaded 2026-10-15
  by the `test` action). B only shows it; no new upload is needed.

## Steps
1. **Network check.** Before anything else, check that this session can reach `www.bestly.tech`,
   `studio.bestly.tech` and `rcqfqhguwpmaarseifqg.supabase.co` (curl + Playwright). If they are refused, stop and
   report it; do not mock pages.
2. **Setup** (above).
3. **Record clip A.** Extend `tools/youtube-verification/record-bestly-part.cjs` (Chromium at /opt/pw-browsers; never
   run playwright install). Captions in the v1 style.
   - No URL bar with tokens.
   - No secrets.
   - No other client's names.
   - Dismiss the "Skip the link next time? / Face ID" popup before filming.
4. **Hand off clip B.** Give Jared one message: the link, and steps 1-8 at most for clip B.
   Wait for him to say he connected; poll `social_accounts` for a youtube row on the sandbox client.
5. **Record clip C** once connected.
6. **Stitch.** Build `public/youtube-verification/bestly-part-a.mp4` and `bestly-part-c.mp4`, and update the one-paste
   Mac command in the kit to stitch A + his newest Screen Recording + C (ffmpeg concat, 1920x1080, as v1). Test the
   command here with a synthetic middle clip.
   - Keep the old `bestly-part.mp4` for now. Remove it in a later commit once the new command is confirmed working.
7. **Update the kit** (section 5) and the bestly_memory key `studio/youtube-verification-kit-2026-10-15-v2`.
8. **Undo list.** Note how to undo: `youtube_offered` and the token on the sandbox, plus the test channel connection.
   Do not undo until Jared has submitted.

Commits end with:
```
Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012XxH5nqNCsavvpmvG2Vf7T
```

## Out of scope
- Flipping `studio_yt_live`.
- Real client data.
- Any Google login by the agent.
