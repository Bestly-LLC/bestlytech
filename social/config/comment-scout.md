# Comment Scout — daily draft-only Reddit replies

## What this does
Every day at ~12:15 PM Pacific, finds 5–10 high-intent Reddit threads in the target subs where a Bestly Cloud reply genuinely helps, drafts a unique value-first response for each, and outputs a dated markdown file for Jared to review + post manually. **NEVER auto-posts** — that's a hard rule (see SAFETY.md).

## Run order (every run)
1. **Load** `secrets/.env`. If `REDDIT_CLIENT_ID` / `REDDIT_USERNAME` missing → still runs in draft-mode (uses public Reddit search-page URLs, no authenticated API).
2. **Search** the target subs (r/selfhosted, r/homelab, r/devops, r/smallbusiness, r/sysadmin, r/nextcloud, r/msp) for recent threads (last 24-72 hours) matching keyword clusters:
   - "self host", "self-hosted", "self hosting"
   - "nextcloud", "syncthing", "seafile"
   - "google workspace alternative", "dropbox alternative", "off the cloud"
   - "vendor lock-in", "SaaS bills", "per seat pricing"
   - "MSP recommendation", "small business IT", "office backup"
   - "homelab", "proxmox", "unraid"  (with intent to move beyond hobby)
3. **Rank** by intent — questions ("how do I…" "recommend…" "what's the best…") beat statements; recent + growing comment count beats stale.
4. **Draft a UNIQUE reply for each** — enforce all 7 SAFETY.md drafting rules. ~1 in 3 replies is pure-help with NO Bestly mention (goodwill + spam-flag dodging).
5. **Output** to `comment-scout/YYYY-MM-DD.md` — a markdown table:
   | # | Sub | Post title | Link | Intent | Draft reply | Include mention? |
6. **Pick the best-first opportunity** — highest intent + longest shelf life + best-fit sub — and call it out at the top of the file.
7. **Notify** owner with one-line summary + link to the file.

## Reddit URL gotcha (carried from the Cookie Yeti playbook)
WebSearch/crawlers are frequently blocked on reddit.com. If the engine can't fetch live thread URLs, it falls back to **search-page URLs** the owner can click through:
- `https://www.reddit.com/r/selfhosted/search/?q=nextcloud+alternative&sort=new&restrict_sr=1`
- `https://www.reddit.com/r/smallbusiness/search/?q=google+workspace+per+seat&sort=new&restrict_sr=1`

Never fabricate a Reddit post URL. If the tooling can't fetch a real one, output the search-page link with a note: "pick the live thread from this search."

## Draft reply format
Each drafted reply must:
1. Open with genuine help (2-3 lines) — no Bestly mention in the first sentence.
2. Optionally mention Bestly Cloud (only in ~2/3 of replies), disclosed as founder ("I built…").
3. Never link to bestly.tech in the reply body — only if the OP asks in a follow-up.
4. Be under 500 chars ideally.
5. Match the sub's tone — r/sysadmin: dry + technical; r/smallbusiness: warm + jargon-free; r/homelab: enthusiast + specific specs.
6. Include ONE specific detail that proves you actually read the post.

## Cadence enforcement
- Draft up to 10/day, but recommend the owner post only 5–8/day, spaced 30-90 min apart.
- Never queue drafts for the same OP twice in one week.
- Track posted-count in `comment-scout/_posted.jsonl` (owner marks) to stay under 15/day cap.

## Weekly self-improvement (later)
A separate weekly loop can measure which drafted replies actually got posted and what karma/response they got, then feed that back into the drafting heuristics. Not v1 — v1 is the daily draft-and-handoff loop.
