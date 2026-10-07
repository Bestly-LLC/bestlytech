#!/bin/bash
# Bestly Sky: manual-signing build + install to Jared's paired iPhone (2026-10-06).
# Uses the IOS_DEVELOPMENT cert in keychain sky-build and the two dev profiles "Bestly Sky Dev" / "Bestly Sky Widgets Dev"
# (created by ~/.bestly/sky/devcert.py + profiles.py). Nothing here prints a secret; the keychain password stays in ~/.bestly/sky/kc.pw.
# Usage: scripts/build-install-manual.sh [sim]   (sim = only build for the Simulator, no signing)
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/bin:$PATH"
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
DEVICE="${SKY_DEVICE:-00008140-001869602EFB001C}"      # Jared's iPhone 16 Pro Max
KC="$HOME/Library/Keychains/sky-build.keychain-db"
IDENTITY="iPhone Developer: Created via API (GXS3838L2U)"

mkdir -p BestlySky/Generated
printf 'enum SkyKey { static let value = "%s" }\n' "$(cat "$HOME/.bestly/sky/app_key")" > BestlySky/Generated/SkyKey.swift

# manual-signing copy of the spec (project.yml itself stays on Automatic for people with Xcode accounts)
python3 - <<'EOF'
import re
s = open("project.yml").read()
s = s.replace("CODE_SIGN_STYLE: Automatic", "CODE_SIGN_STYLE: Manual\n    CODE_SIGN_IDENTITY: 1571FEA7895B29A394F090296ABE5E539F5DA489")
s = s.replace("        PRODUCT_BUNDLE_IDENTIFIER: tech.bestly.sky.widgets", "        PRODUCT_BUNDLE_IDENTIFIER: tech.bestly.sky.widgets\n        PROVISIONING_PROFILE_SPECIFIER: \"Bestly Sky Widgets Dev\"")
s = re.sub(r"(        PRODUCT_BUNDLE_IDENTIFIER: tech\.bestly\.sky\n)", r"\1        PROVISIONING_PROFILE_SPECIFIER: 'Bestly Sky Dev'\n", s, count=1)
open("project.manual.yml", "w").write(s)
EOF
xcodegen generate --quiet --spec project.manual.yml

security unlock-keychain -p "$(cat "$HOME/.bestly/sky/kc.pw")" "$KC"
security set-keychain-settings -lut 21600 "$KC"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$(cat "$HOME/.bestly/sky/kc.pw")" "$KC" >/dev/null 2>&1 || true

echo "### BUILD START $(date)"
xcodebuild -project BestlySky.xcodeproj -scheme BestlySky -configuration Debug \
  -destination "id=$DEVICE" -derivedDataPath build \
  CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY=1571FEA7895B29A394F090296ABE5E539F5DA489 OTHER_CODE_SIGN_FLAGS="--keychain $KC" build 2>&1 | grep -E "error|warning: Provision|BUILD|Signing" | head -40
echo "### BUILD DONE $(date)"

APP="build/Build/Products/Debug-iphoneos/BestlySky.app"
xcrun devicectl device install app --device "$DEVICE" "$APP"
echo "### INSTALLED $(date)"
xcrun devicectl device process launch --device "$DEVICE" tech.bestly.sky || echo "### LAUNCH SKIPPED (phone locked?)"
echo "### DONE $(date)"
