# AMD Developer Cloud as a second LTX render box (plan, nothing started, 2026-10-06)

Status: **plan + install script only.** No AMD credit is active, no account was created, no GPU was started, no key exists.
Track C of `docs/montage-opusplan.md`. Files here: `install-rocm-ltx.sh` (run on the droplet). Everything else is a design.

## What the credits are (sources checked 2026-10-06; the pages disagree, confirm the number when Jared activates)
| Credit | Amount | Expires | Source |
|---|---|---|---|
| AMD Developer Cloud | **$100** (about 50 GPU-hours) | **30 days after activation** | [AMD member perks](https://developer.amd.com/member-perks/), [AMD how-to-claim](https://amd.com/en/developer/resources/technical-articles/2026/how-to-claim-amd-cloud-credits.html), [AMD vLLM article](https://www.amd.com/en/developer/resources/technical-articles/2026/openclaw-with-vllm-running-for-free-on-amd-developer-cloud-.html) ("$100 ... approximately 50 hours") |
| Fireworks AI | **$100** (member perks page) or **$50** (AMD claim article, [Fireworks/AMD page](https://fireworks.ai/partners/amd)) | 90 days from issue | same |
| (older guide, 2025) | 25 GPU-hours, 10 days | | [Getting started](https://www.amd.com/en/developer/resources/technical-articles/2025/how-to-get-started-on-the-amd-developer-cloud-.html) |

How a member claims: developer.amd.com > Member Perks > "Request Cloud Credits", pick the credit, wait 2-3 business days for the activation email.
Hourly price: **$1.99/h** for 1x MI300X ([Phoronix](https://phoronix.com/review/amd-developer-cloud)); DigitalOcean's pricing page now says **$2.59/h** ([docs](https://docs.digitalocean.com/products/amd/details/pricing/)).
So $100 is roughly 39 to 50 GPU-hours, inside a 30-day window. It is a burst budget, not a standing second box.

## Which instance
`gpu-mi300x1-192gb` (1x MI300X, 192 GB, 20 vCPU, 240 GiB RAM, 720 GB boot disk, 5 TB scratch that is not persistent) ([features](https://docs.digitalocean.com/products/amd/details/features/)).
One GPU is plenty; do not pick the 8x (`gpu-mi300x8-1536gb`, 8x the price). Image: **Quick Start with ROCm** (Docker) or "Bare OS" Ubuntu 24.04 ([guide](https://www.amd.com/en/developer/resources/technical-articles/2025/how-to-get-started-on-the-amd-developer-cloud-.html)).
The platform is DigitalOcean's (devcloud.amd.com redirects there): SSH as `root@<ip>`, API `https://api.digitalocean.com/v2/droplets` with a personal access token, `doctl` works per [DO docs](https://docs.digitalocean.com/products/amd/how-to/create/). Not confirmed: whether AMD-credit accounts may use API tokens (the limits page is silent).

## What is and is not confirmed about LTX-2.5 on ROCm
Confirmed from sources:
- ComfyUI on ROCm officially supports MI300X (also MI325X/MI355X), ROCm 7.2.0/7.1.0, Ubuntu 24.04, Python 3.12, via the Docker image `rocm/comfyui:comfyui-0.18.2.amd0_rocm7.2.0_ubuntu24.04` ([AMD docs](https://rocm.docs.amd.com/projects/comfyui/en/docs-26.04/install/comfyui-install.html)). AMD's own video examples on Instinct use Wan 2.2 ([blog](https://rocm.blogs.amd.com/software-tools-optimization/comfyui-on-amd/README.html), [notebook](https://rocm.docs.amd.com/projects/ai-developer-hub/en/latest/notebooks/inference/t2v_comfyui_api_mode_instinct.html)).
- LTX-2.3 has run under ROCm on a Radeon RX 7900 XTX; model loading stalled until ComfyUI's smart-memory features were disabled (`--disable-dynamic-vram --disable-pinned-memory --disable-async-offload --disable-smart-memory`, `PYTORCH_HIP_ALLOC_CONF=expandable_segments:True,garbage_collection_threshold:0.75`), about 20x slower ([ComfyUI issue 13730](https://github.com/Comfy-Org/ComfyUI/issues/13730)). That is a 24 GB consumer card; a 192 GB MI300X should not need the flags, but nobody confirmed it. `COMFY_ARGS` in the script is the knob.
- The `video_ltx2_5_t2v` template (read from the `comfyui-workflow-templates-json` 0.1.103 wheel) uses only comfy-core nodes (no custom nodes) and needs ComfyUI core >= 0.30.0, which is newer than the 0.18.2 in AMD's image, so the script clones current ComfyUI and installs its requirements without touching the image's ROCm torch.
- Its four model files come from `Lightricks/LTX-2.5` and `Comfy-Org/gemma-4` on Hugging Face: `ltx-2.5-22b-distilled-transformer-comfy-int8-convrot`, `gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot`, `gemma4_e2b_it_int8_convrot`, video VAE, audio VAE, x2 latent upscaler. The script reads this list from the template at install time.

**Not confirmed anywhere (the real risk):** that LTX-2.5 itself, in particular its **int8 "convrot" weights**, runs on ROCm/MI300X. Int8 kernels are the likeliest place for a CUDA-only path. No source says LTX-2.5 works or fails on Instinct. The install script's `--smoke` run is the test; if it fails on an int8 op, ask Lightricks/Comfy-Org for a bf16/fp8 variant of the same files or do not use this box for video (it still serves Fireworks-style text work fine). Also unverified: the AMD image's Python/pip entry points and whether `playwright` runs on the droplet image.

**Model download needs a Hugging Face token.** `Lightricks/LTX-2.5` is gated (license accepted on Jared's HF account `fungus-amungus`, ~40 GB of files). The AWS box reads its token from AWS Parameter Store `/bestly/ltx/hf_token`, unreachable from a DigitalOcean droplet, and a Vault-to-box hand-off was refused by the safety check earlier, so it must not be rebuilt. The script reads an optional `/etc/bestly/hf-token`. Getting the token there without asking Jared for anything is an open question (see report): the least-effort options are copying the 5 model files from the AWS box (`/opt/ltx/dl/ltx-2.5`) through a bucket Claude controls, or Jared saving one more Vault secret `hf_token`.

## Second box on the SAME queue
Today: edge fn `supabase/functions/ltx-box` takes header `x-ltx-key`, `ltx_key_ok()` compares its sha256 to the one `ltx_box.key_hash`; `ltx_box` is a single row (`id boolean primary key`), `ltx_claim()` takes the oldest queued job with `for update skip locked`, `ltx_finish()` prices it from that one row's `rate_usd_hr`, heartbeat comes from `ltx_report` (counts box-on minutes into `ltx_usage`). `ltx-worker.py` on the AMD box can be used unchanged: it only needs `/etc/bestly/ltx-box.key`.
Because claiming is already skip-locked, two boxes can pull from one queue safely. What is missing is identity and cost per box. Minimal change (**NOT applied**; a future migration, name e.g. `ltx_boxes`):

```sql
create table public.ltx_boxes (
  id text primary key,                         -- 'aws' | 'amd'
  provider text not null,                      -- 'aws' | 'amd-devcloud'
  key_hash text not null,                      -- sha256 of that box's x-ltx-key
  rate_usd_hr numeric(6,3) not null,           -- 1.212 for g5.2xlarge, 1.99 (or 2.59) for MI300X
  enabled boolean not null default true,
  last_heartbeat_at timestamptz
);
alter table public.ltx_jobs add column box_id text references public.ltx_boxes(id);  -- who claimed it
-- seed 'aws' from ltx_box (key_hash, rate_usd_hr); keep the ltx_box row for AWS-only columns (instance_id, credits_expire_at, batch_*).
-- ltx_key_ok(p_key) -> returns the box id (or null) instead of boolean; edge fn passes it on:
--   ltx_claim(p_box text)  sets ltx_jobs.box_id = p_box
--   ltx_finish(...)        prices with ltx_boxes.rate_usd_hr of j.box_id (falls back to ltx_box when null)
-- ltx_quote / ltx_today: awake = any enabled box heartbeat < 2 min; per-box spend rows in ltx_usage (add box_id to its key).
```
Edge fn change: replace the boolean `ltx_key_ok` check by `const { data: boxId } = await db.rpc("ltx_key_ok", ...)`, then `ltx_claim({ p_box: boxId })` and `ltx_finish` (pass the box id). The AWS dispatcher Lambda and `ltx_waiting` stay as they are; the AMD box is woken by the Pi controller below, not by the Lambda. Add `amd` to the `ltx-watch` card so a droplet that is up and never checks in alerts (box-never-checked-in alert already exists for AWS).
Key for the AMD box: generated on the droplet (`openssl rand -hex 32 > /etc/bestly/ltx-box.key`), only the sha256 is inserted into `ltx_boxes`; nobody ever sees the key.

## Start/stop discipline (the AWS pattern does NOT carry over)
- **A powered-off GPU Droplet is still billed. Only destroying it stops the meter** ([guide](https://www.amd.com/en/developer/resources/technical-articles/2025/how-to-get-started-on-the-amd-developer-cloud-.html)). So `ltx-idle-stop.sh` (`shutdown -h now`) is wrong here.
- Rule: a droplet exists only while jobs are waiting or rendering; destroyed after 3 idle minutes (same rule as AWS), hard cap 2 h per droplet.
- Owner: a small Pi cron (free, local; the Pi owns it per the token-saving rule), not Claude and not the droplet. It reads `ltx_waiting`, creates the droplet (`POST /v2/droplets`, size `gpu-mi300x1-192gb`, the ROCm image, the SSH key, user-data = install script) and later `DELETE /v2/droplets/<id>`. Token = Vault `amd_devcloud_token` read via `pi_secret` (needs the same allowlist line as `fireworks_api_key`). It would get a team card on `/admin/team` the day it ships.
- Cold start cost: the droplet's boot disk dies with it and the scratch disk is non-persistent, so each cold start re-installs and re-downloads the models (tens of GB over a 10 Gbps link; install time unmeasured). TODO(verify): whether snapshots exist for AMD-credit accounts; if so, snapshot once after a good `--smoke` and create from the snapshot. Otherwise treat this box as one-off bursts (batch of clips, destroy), not on-demand.
- Dead-man switch: if the Pi is down, a droplet keeps billing. The cron must refuse to create a droplet unless it can also reach the API to destroy; `ltx-watch` pings if a droplet is older than 2 h.

## Credit balance check
- The credit lives on the AMD Developer Cloud account; it is shown "at the top of the Create a GPU Droplet page" and expires 30 days after activation. TODO(verify): a balance API. DigitalOcean has `GET /v2/customers/my/balance`; whether it reports the AMD credit is unknown.
- Until verified, estimate: `credit_left = 100 - sum(box-on minutes on the amd box) / 60 * rate_usd_hr` from `ltx_usage` once it is per box, and put the activation date + 30 days in `credits_expire_at` for `ltx-credit-watch` (it already warns before the AWS credit expires).
- Hard stop in the Pi cron: no droplet when the estimate is under 10% of the credit or the window has under a day left.

## Run order when Jared activates (Claude does steps 2+)
1. Jared: activate the AMD Developer Cloud credit, make an API token, save it in Supabase Vault as `amd_devcloud_token`.
2. Claude: apply the `ltx_boxes` migration, create one droplet by hand (or via the token), `scp -r tools/ltx-box root@<ip>:/root/ && bash /root/ltx-box/amd/install-rocm-ltx.sh --smoke`, look at the clip.
3. If the clip is good: generate the box key on the droplet, register its hash, start the worker, build the Pi controller + team card + watchdog. If not: destroy the droplet the same hour and record in `bestly_memory` house/ai/amd-credits what failed.
