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
- DEPLOYED 2026-10-06 (SSM, old files kept as `*.bak-20261006` in /opt/ltx/, ltx-worker restarted). sha256 on the box = repo:
  - make-video.py `8fb9d875130df77221d56414efba956957f5e15f5c079c96ab886668d756e602`
  - ltx-worker.py `703fbb8bf276f65bcbe407d0c56fcabc4f52afc441c738675a3d0541ddc1f56d`
- Gotcha found in the first test: the template's width/height widgets on the subgraph are overridden by the top-level `ResolutionSelector` node (links 792/793; 16:9 at 0.9 MP = 1280x704), so the first deploy (ddc30c95) still rendered landscape. make-video.py now sets that node (aspect 9:16 Portrait Widescreen, megapixels = w*h/1e6, multiple 32). Earlier montage clips were therefore landscape.
- To redeploy: base64 the files into an SSM AWS-RunShellScript command, decode into /opt/ltx/, chmod 755, compare sha256, `systemctl restart ltx-worker`. Touch /opt/ltx/KEEP_AWAKE while working and remove it after.
- Billing: only the first clip queued while the box sleeps carries woke_box (ltx_request and montage_clip_request). Spark never gets AI footage for clients whose montage_brand_policy.ai_footage_ok is false (migration 20261006220000).
- Capacity: starting the g5.2xlarge in us-west-2b can fail with InsufficientInstanceCapacity; retry every minute (it started on the 3rd try on 2026-10-06).
