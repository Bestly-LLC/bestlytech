# BlackHole loopback for Minutes call recording

Goal: Minutes captures both sides of a call (you + remote participants), not
just your mic. AirPods Max → Minutes mic-only path is what bit us during the
Eli call. BlackHole is a free virtual audio device that lets us route system
audio into a Multi-Output device that also includes your real speakers — so
you hear everything normally AND Minutes records both directions.

## One-time install (5 min)

```sh
# 2-channel BlackHole — no kernel extensions, signed.
brew install blackhole-2ch
```

If `brew install` errors with a kext-permission prompt, allow it in System
Settings → Privacy & Security → bottom of page → "Allow software from
Existstential Audio". Reboot if requested.

## Audio MIDI Setup — wire two devices (one-time, 3 min)

Open `/Applications/Utilities/Audio MIDI Setup.app`.

### Device 1 — "BH + Speakers" (Multi-Output)

This is what you'll use as your **system output** during recordings. It plays
audio to both your real speakers/headphones AND copies it into BlackHole so
Minutes can hear it.

1. Click `+` (bottom-left) → **Create Multi-Output Device**
2. Rename it: `BH + Speakers`
3. Check both boxes:
   - Your real output (e.g. `MacBook Pro Speakers` or `AirPods Pro`)
   - `BlackHole 2ch`
4. Set the **Master Device** to your real output (so volume keys still work)
5. Check **Drift Correction** on `BlackHole 2ch` (prevents echo)

### Device 2 — "BH + Mic" (Aggregate)

This is what Minutes will record from. It mixes your mic input AND BlackHole
(which is now carrying remote-call audio).

1. Click `+` → **Create Aggregate Device**
2. Rename it: `BH + Mic`
3. Check both boxes:
   - Your real mic (e.g. `MacBook Pro Microphone` or `OBSBOT Tiny 2 Lite`)
   - `BlackHole 2ch`
4. Set **Clock Source** to your mic

## Use it during a call

Before the call:

1. **System output** → set to `BH + Speakers` (in menu bar audio icon, or
   System Settings → Sound → Output)
2. **Minutes** → set input device to `BH + Mic`. The Minutes recorder
   artifact's start toast should now say "Recording started (BH + Mic)".

During the call: everything sounds normal. After: Minutes has both sides.

After the call: switch system output back to your normal device (just your
speakers/AirPods, not the multi-output) so you stop double-tapping output for
non-call audio.

## One-shot toggle script

Save this as `~/bin/minutes-mode.sh` and `chmod +x` it. Calls
`SwitchAudioSource` (`brew install switchaudio-osx`) to flip both directions.

```sh
#!/bin/bash
# Usage:
#   minutes-mode.sh on    → flip output to BH+Speakers, input to BH+Mic
#   minutes-mode.sh off   → restore (edit the vars below for your normal devices)

NORMAL_OUTPUT="${NORMAL_OUTPUT:-AirPods Pro}"
NORMAL_INPUT="${NORMAL_INPUT:-AirPods Pro}"

case "$1" in
  on)
    SwitchAudioSource -t output -s "BH + Speakers"
    SwitchAudioSource -t input  -s "BH + Mic"
    echo "🎙️  Minutes mode ON — output=BH+Speakers, input=BH+Mic"
    ;;
  off)
    SwitchAudioSource -t output -s "$NORMAL_OUTPUT"
    SwitchAudioSource -t input  -s "$NORMAL_INPUT"
    echo "🎧 Minutes mode OFF — restored to $NORMAL_OUTPUT / $NORMAL_INPUT"
    ;;
  *)
    echo "usage: minutes-mode.sh {on|off}"
    exit 2
    ;;
esac
```

Bind to a Raycast hotkey or a Stream Deck button if you record often.

## Verification

After setup, test with a 30-second recording:

1. Open the Minutes recorder artifact
2. Set system output to `BH + Speakers`
3. Click Start (intent: "call", Minutes input device should auto-pick `BH + Mic`)
4. Play any video on YouTube for 10s, then talk into the mic for 10s
5. Stop, wait for processing, open the resulting transcript

The transcript should show **both** the YouTube audio AND your voice. If it
only shows your voice, the input device wasn't on `BH + Mic` — re-check
Minutes' input setting or the system input.

## Why not just allow_degraded?

The Minutes `start_recording` tool has an `allow_degraded` flag that lets a
mic-only capture proceed even when no system-audio route is configured. Useful
in a pinch but you lose the remote side of the call — which is most of the
content.
