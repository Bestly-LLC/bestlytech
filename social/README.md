# Bestly Cloud — Social Growth Engine

Cloned from the Cookie Yeti social growth playbook (mempalace wing `social-growth-playbook`), adapted for B2B.

## Structure
```
social/
  config/
    PRODUCT.md         What Bestly Cloud is, pricing, voice, things NOT to claim
    TARGETING.md       Channels, themes, subs, hashtags
    SAFETY.md          Non-negotiable rules (never auto-post comments; pre-post health gate)
    CREDENTIALS.md     LinkedIn + Reddit setup walkthrough
    content-engine.md  Daily LinkedIn (+ occasional Reddit draft) auto-publish design
    comment-scout.md   Daily draft-only Reddit reply design
  kit/
    videos/            Pre-rendered MP4 clips of the 3D device animation (build via scripts/render-3d-clips.js — TODO)
    staging/YYYY-MM-DD/  Built posts + run reports
    thumbnails/        Static hero images as video fallback
  comment-scout/
    YYYY-MM-DD.md      Daily draft replies (human posts them)
    _posted.jsonl      Owner-marked log of what was actually posted
  secrets/
    .env.template      Copy to .env and fill in
    .env               Real tokens (git-ignored)
  scripts/             (TODO) Node.js + Python scripts the scheduled tasks invoke
```

## Scheduled tasks
- `bestly-cloud-daily-post` — cron `0 8 * * *` — Content Engine
- `bestly-cloud-comment-scout` — cron `15 12 * * *` — Draft-only Reddit replies

Both are created but will STAGE-ONLY until:
1. Credentials are in `secrets/.env` (see CREDENTIALS.md)
2. cloud.bestly.tech returns HTTP 200 (currently 530 — Pi awaiting new SSD)

## Getting live (owner checklist)
1. Recover Bestly Cloud: install the new Samsung 990 EVO Plus + rebuild docker stacks so cloud.bestly.tech goes 200.
2. Set up LinkedIn Developer App + get access token (see CREDENTIALS.md).
3. Create dedicated Reddit account for Bestly Cloud (do NOT reuse Cookie Yeti's).
4. Copy `secrets/.env.template` → `secrets/.env` and fill in the values.
5. Screenshot https://bestly.tech/cloud hero → save as `kit/thumbnails/hero.png` (1200x1200 crop) as immediate fallback.
6. Optional (v2): build the 3D video kit via `scripts/render-3d-clips.js`.
7. Click "Run now" on each scheduled task to pre-approve tool permissions.

## Emergency
If a post goes out that shouldn't have (bad claim, live link to dead cloud), pull it via the LinkedIn API immediately. See SAFETY.md.
