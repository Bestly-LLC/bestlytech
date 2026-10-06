# LTX Box — AI video on the AWS GPU (2026-10-05)

Scout, Spark and any Claude chat make LTX-2.5 clips; cost shows in the chat (estimate, actual, today's total, credit left).

- Box: EC2 `i-0c4af7500e11cf633` "bestly-ltx", g5.2xlarge (A10G 24 GB), us-west-2b. ComfyUI at /opt/ltx/comfy (localhost only, SSM access only).
- `ltx-worker.py` (systemd ltx-worker) claims jobs from edge fn `ltx-box`, runs `make-video.py` (official template video_ltx2_5_t2v), uploads to bucket `ltx-clips`.
- `ltx-idle-stop.sh` stops the box after 3 idle minutes (wakes only for a batch of 3 clips, a 20 min wait, or "now"); 6 h cap.
- `dispatch-lambda.py` = AWS Lambda `bestly-ltx-dispatch` (EventBridge every minute): wakes the box for queued jobs; hourly reports the AWS credit balance.
- DB: migration 20261006050000_ltx_video_queue + 20261006060000_ltx_credits. Watchdogs: cron ltx-watch (box + stuck jobs), ltx-credit-watch (credits).
- Links: bestly.tech/v/<code> (vercel.json rewrite to ltx-box ?v=).

## 2026-10-06: vertical clips for Montage
- `ltx_jobs.width/height` (default 1280x720). Montage orders 704x1280 (LTX wants multiples of 32) via `montage_clip_request`.
- `make-video.py` takes `[width] [height]`; `ltx-worker.py` passes them from the claimed job.
- DEPLOY: copy both to /opt/ltx/ on the box over SSM and `systemctl restart ltx-worker` (needs the AWS connector). Until then the box keeps rendering 1280x720 and Montage center-crops those to vertical.
