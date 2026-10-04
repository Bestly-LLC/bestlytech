#!/bin/sh
# Install the Centering YOU card kit on the Pi. Her fonts and pattern art come from Studio storage (never from git).
set -e
R=${1:-main}
K=/opt/bestly/cy-kit
S=https://rcqfqhguwpmaarseifqg.supabase.co/storage/v1/object/public/review
sudo -n mkdir -p $K/fonts $K/art && sudo -n chown -R pi:pi $K
curl -fsS https://raw.githubusercontent.com/Bestly-LLC/bestlytech/$R/social/scripts/card-kit/centering-you/card.html -o $K/card.html
curl -fsS $S/brand/centering-you/fonts/LeagueGothic-Regular.54b176f16f.ttf -o $K/fonts/LeagueGothic-Regular.ttf
curl -fsS $S/brand/centering-you/fonts/ClearSans-Regular.bb811af889.ttf -o $K/fonts/ClearSans-Regular.ttf
curl -fsS $S/brand/centering-you/fonts/ClearSans-Medium.93677acbad.ttf -o $K/fonts/ClearSans-Medium.ttf
curl -fsS $S/brand/centering-you/fonts/ClearSans-Bold.e95b1274e5.ttf -o $K/fonts/ClearSans-Bold.ttf
curl -fsS $S/brand/centering-you/patterns/pat-a.9c9fe80aa9.png -o $K/art/pat-a.png
curl -fsS $S/brand/centering-you/patterns/pat-b.0602f51199.png -o $K/art/pat-b.png
# The deck photo, cut from the approved closing slide of "The 3am feeling has a name" (tile v12, slide 7).
curl -fsS $S/carousel/the-3am-feeling-has-a-name--tile/v12/07.png -o /tmp/cy-close.png
python3 -c "from PIL import Image; Image.open('/tmp/cy-close.png').convert('RGB').crop((112,102,518,462)).save('$K/art/deck-shot.png')"
ls -la $K $K/fonts $K/art
