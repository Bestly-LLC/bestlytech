"""Render one Montage job through OpenMontage's own VideoCompose tool (atelier mode) and print its result as JSON.

Runs inside OpenMontage's venv:  /mnt/ssd/apps/openmontage/.venv/bin/python om_render.py <job_dir> <brand>
Our composition is copied into remotion-composer/projects/bestly-<brand>/ (untracked, git-excluded), so the pinned
OpenMontage checkout is never edited. OpenMontage runs the render and its post-render review (ffprobe, frame
sampling, audio levels); we read that review back.
"""
import json
import os
import shutil
import sys
from pathlib import Path

OM = Path("/mnt/ssd/apps/openmontage")
COMPS = Path("/opt/bestly/montage/comp")
sys.path.insert(0, str(OM))
os.chdir(OM)

from tools.video.video_compose import VideoCompose  # noqa: E402

BROWSER = "/usr/bin/chromium"   # the Pi's Chromium; Remotion's own headless shell is not needed


class PiCompose(VideoCompose):
    """Same tool, plus the Pi's browser on every Remotion render command."""

    def run_command(self, cmd, *, timeout=None, cwd=None):
        cmd = list(cmd)
        if len(cmd) > 2 and cmd[0] == "npx" and cmd[1] == "remotion" and not any(c.startswith("--browser-executable") for c in cmd):
            cmd.append(f"--browser-executable={BROWSER}")
            cmd.append("--log=warn")
        return super().run_command(cmd, timeout=timeout, cwd=cwd)


def main():
    job_dir, brand = Path(sys.argv[1]), sys.argv[2]
    comp = json.loads((job_dir / "comp.json").read_text())
    dst = OM / "remotion-composer" / "projects" / f"bestly-{brand}"
    if dst.exists():
        shutil.rmtree(dst)
    src = COMPS / (comp.get("comp_dir") or brand)      # a brand may share a composition folder (comp_dir "brand")
    shutil.copytree(src, dst)
    exclude = OM / ".git" / "info" / "exclude"
    line = "remotion-composer/projects/bestly-*\n"
    if line not in (exclude.read_text() if exclude.exists() else ""):
        with exclude.open("a") as f:
            f.write(line)

    edit = {
        "composition_mode": "atelier",
        "render_runtime": "remotion",
        "bespoke": {
            "entry": str(dst / "index.tsx"),
            "composition_id": comp["composition_id"],
            "props_path": str(job_dir / "props.json"),
            "public_dir": str(job_dir / "public"),
            "art_direction": (src / "ART_DIRECTION.md").read_text() if (src / "ART_DIRECTION.md").exists() else None,
            "crf": 20,
            "concurrency": 3,
        },
    }
    res = PiCompose().execute({
        "operation": "render",
        "edit_decisions": edit,
        "output_path": str(job_dir / "out.mp4"),
        "script_text": comp.get("script_text"),
    })
    data = res.data if isinstance(res.data, dict) else {}
    fr = data.get("final_review") or {}
    print(json.dumps({
        "success": bool(res.success),
        "error": res.error,
        "output": data.get("output"),
        "review_status": fr.get("status"),
        "issues": fr.get("issues_found") or [],
    }, default=str))


if __name__ == "__main__":
    main()
