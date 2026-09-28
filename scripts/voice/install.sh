#!/bin/bash
# Bestly Voice install/update on bestly-pi (idempotent). Run as pi with sudo rights: bash install.sh <dir with voice.py etc>
set -e
SRC=${1:-/tmp/r4w7}
sudo mkdir -p /opt/bestly/voice/{models,tts,clips,media} && sudo chown -R pi:pi /opt/bestly/voice
[ -x /opt/bestly/voice/venv/bin/python ] || python3 -m venv /opt/bestly/voice/venv
/opt/bestly/voice/venv/bin/pip -q install onnxruntime numpy scipy requests tqdm scikit-learn piper-tts
/opt/bestly/voice/venv/bin/pip -q install --no-deps openwakeword==0.6.0
/opt/bestly/voice/venv/bin/python -c "from openwakeword.utils import download_models; download_models(model_names=['hey_jarvis_v0.1'])"
cd /opt/bestly/voice/tts && for f in en_US-lessac-medium.onnx en_US-lessac-medium.onnx.json; do
  [ -s $f ] || curl -sSL -o $f "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/$f"; done
grep -q "pcm.scoutmic" /etc/asound.conf 2>/dev/null || sudo sh -c "cat $SRC/asound-scoutmic.conf >> /etc/asound.conf"
install -m 644 $SRC/voice.py /opt/bestly/voice/voice.py
[ -f $SRC/hey_scout.onnx ] && install -m 644 $SRC/hey_scout.onnx /opt/bestly/voice/models/hey_scout.onnx || true
sudo install -m 644 $SRC/bestly-voice.service /etc/systemd/system/bestly-voice.service
sudo systemctl daemon-reload && sudo systemctl enable bestly-voice && sudo systemctl restart bestly-voice
sleep 4 && systemctl is-active bestly-voice
