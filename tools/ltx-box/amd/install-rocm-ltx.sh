#!/usr/bin/env bash
# install-rocm-ltx.sh -- turn a fresh AMD Developer Cloud MI300X GPU Droplet into a second LTX-2.5 render box.
# Written 2026-10-06 (Track C, docs/montage-opusplan.md). NOT RUN YET: no AMD credits are active, nothing was started.
#
# Run ON the droplet, as root:   bash install-rocm-ltx.sh [--smoke]
# Needs this repo's tools/ltx-box/ (ltx-worker.py, make-video.py) next to this folder: scp -r tools/ltx-box root@<ip>:/root/
#
# Everything marked TODO(verify) is something no source confirmed for ROCm / MI300X. Do not trust it until the
# --smoke run has produced a clip and Claude has looked at it.
#
# Design: AMD's own ROCm ComfyUI Docker image (the documented, supported route for MI300X) holds ROCm PyTorch + ComfyUI.
# The host keeps only what the unchanged worker needs: python venv + playwright (make-video.py drives the ComfyUI
# frontend in headless Chromium), the template JSON, and ltx-worker.py. Same paths as the AWS box (/opt/ltx/...),
# so ltx-worker.py and make-video.py run unmodified.
set -euo pipefail

SMOKE=0; [ "${1:-}" = "--smoke" ] && SMOKE=1
LTX=/opt/ltx
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${LTX_SRC:-$HERE/..}"                       # folder holding ltx-worker.py + make-video.py
# AMD's documented image for MI300X/MI325X/MI355X, ROCm 7.2.0, Ubuntu 24.04 (rocm.docs.amd.com/projects/comfyui, docs-26.04)
IMAGE="${COMFY_IMAGE:-rocm/comfyui:comfyui-0.18.2.amd0_rocm7.2.0_ubuntu24.04}"
TEMPLATE_NAME=video_ltx2_5_t2v.json
COMFY_ARGS="${COMFY_ARGS:-}"                     # e.g. "--disable-smart-memory" (see README: only needed if loading stalls)

say() { printf '\n== %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run as root"
[ -f "$SRC/ltx-worker.py" ] && [ -f "$SRC/make-video.py" ] || die "ltx-worker.py / make-video.py not found in $SRC (set LTX_SRC)"

say "0. preflight (GPU visible, docker present)"
[ -e /dev/kfd ] && [ -e /dev/dri ] || die "/dev/kfd or /dev/dri missing: this is not a GPU droplet with the ROCm driver"
if command -v amd-smi >/dev/null; then amd-smi list || true; elif command -v rocm-smi >/dev/null; then rocm-smi || true; fi
if ! command -v docker >/dev/null; then
  # TODO(verify): the AMD "Quick Start" images are said to ship Docker; on a bare Ubuntu image this installs it.
  apt-get update -y && apt-get install -y docker.io
fi
systemctl enable --now docker

say "1. folders"
mkdir -p "$LTX/comfy" "$LTX/build" /etc/bestly

say "2. host python venv (playwright + the workflow template JSON for make-video.py)"
apt-get install -y python3-venv python3-pip git curl jq
python3 -m venv "$LTX/venv"
"$LTX/venv/bin/pip" install -q --upgrade pip
# comfyui_workflow_templates_json carries video_ltx2_5_t2v.json (comfy-core nodes only, needs ComfyUI core >= 0.30.0)
"$LTX/venv/bin/pip" install -q playwright comfyui-workflow-templates-json
"$LTX/venv/bin/playwright" install --with-deps chromium
TPL="$(find "$LTX/venv" -name "$TEMPLATE_NAME" | head -1)"
[ -n "$TPL" ] || die "$TEMPLATE_NAME not found in the installed template package"
# make-video.py hardcodes this path (python3.12 = Ubuntu 24.04). Fail loudly if the venv python differs.
EXPECT="$LTX/venv/lib/python3.12/site-packages/comfyui_workflow_templates_json/templates/$TEMPLATE_NAME"
[ "$TPL" = "$EXPECT" ] || die "template is at $TPL but make-video.py expects $EXPECT (edit TPL in make-video.py or use python3.12)"

say "3. ComfyUI source (the image ships 0.18.2; the LTX-2.5 template needs core >= 0.30.0)"
if [ ! -d "$LTX/comfy/.git" ]; then git clone https://github.com/Comfy-Org/ComfyUI.git "$LTX/comfy"; else git -C "$LTX/comfy" pull --ff-only; fi

say "4. derived image: AMD ROCm image + current ComfyUI requirements, WITHOUT touching its ROCm torch"
grep -viE '^(torch|torchvision|torchaudio)([=<>~! ]|$)' "$LTX/comfy/requirements.txt" > "$LTX/build/requirements.rocm.txt"
cat > "$LTX/build/Dockerfile" <<DOCKER
FROM $IMAGE
COPY requirements.rocm.txt /tmp/requirements.rocm.txt
# TODO(verify): the image's python/pip entry points. AMD docs launch with "python \$COMFYUI_PATH/main.py".
RUN python -m pip install -r /tmp/requirements.rocm.txt
DOCKER
docker pull "$IMAGE"
docker build -t bestly-comfy-rocm "$LTX/build"
echo "torch/HIP check (must print a HIP version and True):"
docker run --rm --device=/dev/kfd --device=/dev/dri --group-add video --ipc=host bestly-comfy-rocm \
  python -c "import torch; print(torch.__version__, torch.version.hip, torch.cuda.is_available(), torch.cuda.get_device_name(0))"

say "5. models: read the list from the template itself (names, folders, URLs), download what is missing"
# Lightricks/LTX-2.5 is GATED (license already accepted on Jared's HF account, bestly_memory house/ai/ltx-video-aws). The AWS box
# reads its HF token from AWS Parameter Store /bestly/ltx/hf_token, which this droplet cannot reach, and a Vault -> box
# hand-off was refused earlier (do not rebuild it). So this box needs its own read token written by hand: see README.
HF_TOKEN_FILE=/etc/bestly/hf-token
"$LTX/venv/bin/python" - "$TPL" "$LTX/comfy/models" "$HF_TOKEN_FILE" <<'PY'
import json, os, sys, urllib.request
tpl, root, tokfile = sys.argv[1:4]
found = {}
def walk(o):
    if isinstance(o, dict):
        if "url" in o and "directory" in o and o.get("name"):
            found[(o["directory"], o["name"])] = o["url"]
        for v in o.values(): walk(v)
    elif isinstance(o, list):
        for v in o: walk(v)
walk(json.load(open(tpl)))
tok = open(tokfile).read().strip() if os.path.exists(tokfile) else ""
for (d, name), url in sorted(found.items()):
    dest = os.path.join(root, d, name)
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        print("have", d, name); continue
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    print("downloading", d, name, flush=True)
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + tok} if tok else {})
    try:
        with urllib.request.urlopen(req, timeout=120) as r, open(dest + ".part", "wb") as f:
            while True:
                b = r.read(1 << 24)
                if not b: break
                f.write(b)
        os.rename(dest + ".part", dest)
    except Exception as e:
        sys.exit(f"download failed for {name}: {e} (gated repo? put an HF read token in {tokfile})")
print("models ok:", len(found))
PY

say "6. ComfyUI container as a service (host port bound to localhost only; the droplet has a public IP)"
cat > /etc/systemd/system/comfyui-rocm.service <<UNIT
[Unit]
Description=ComfyUI on ROCm (Docker)
After=docker.service
Requires=docker.service
[Service]
ExecStartPre=-/usr/bin/docker rm -f comfyui-rocm
ExecStart=/usr/bin/docker run --rm --name comfyui-rocm --device=/dev/kfd --device=/dev/dri --group-add video \\
  --cap-add=SYS_PTRACE --security-opt seccomp=unconfined --ipc=host --shm-size=16g \\
  -p 127.0.0.1:8188:8188 -v $LTX/comfy:$LTX/comfy -w $LTX/comfy \\
  bestly-comfy-rocm python $LTX/comfy/main.py --listen 0.0.0.0 --port 8188 $COMFY_ARGS
ExecStop=/usr/bin/docker stop comfyui-rocm
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now comfyui-rocm
for i in $(seq 1 60); do curl -fsS -m 5 http://127.0.0.1:8188/system_stats >/dev/null 2>&1 && break; sleep 5; done
curl -fsS -m 5 http://127.0.0.1:8188/system_stats | jq '.devices' || die "ComfyUI did not come up (docker logs comfyui-rocm)"

say "7. worker (same ltx-worker.py + make-video.py as the AWS box)"
install -m 755 "$SRC/ltx-worker.py" "$LTX/ltx-worker.py"
install -m 755 "$SRC/make-video.py" "$LTX/make-video.py"
# AWS unit runs as User=ubuntu; this droplet logs in as root. It will not start until this box has its OWN key file.
cat > /etc/systemd/system/ltx-worker.service <<UNIT
[Unit]
Description=LTX video job worker (Bestly, AMD box)
After=network-online.target comfyui-rocm.service
ConditionPathExists=/etc/bestly/ltx-box.key
[Service]
ExecStart=$LTX/ltx-worker.py
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable ltx-worker.service
if [ -f /etc/bestly/ltx-box.key ]; then systemctl restart ltx-worker.service; else
  echo "worker NOT started: /etc/bestly/ltx-box.key is missing (per-box key; needs the ltx_boxes schema, see README)."; fi

say "8. idle stop"
echo "NOTE: ltx-idle-stop.sh does NOT apply here. On AMD Developer Cloud a powered-off GPU Droplet is still billed;"
echo "      only destroying it stops the meter. The Pi controller destroys it (see README 'Start/stop discipline')."

if [ "$SMOKE" = 1 ]; then
  say "9. smoke test: one 2 s 704x1280 clip straight through ComfyUI (spends GPU minutes on the credits)"
  # TODO(verify): this is the first time LTX-2.5 (int8-convrot weights) meets ROCm. It may fail on an int8 kernel.
  time "$LTX/make-video.py" "A slow pan across a sunlit kitchen counter, shallow depth of field" video/amd_smoke 2 704 1280 | tail -5
  ls -la "$LTX/comfy/output/video/" | tail -3
fi
say "done"
