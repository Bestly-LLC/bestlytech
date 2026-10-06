#!/bin/sh
# Fetch the real brand files Montage's InventoryProof and Cookie Yeti videos use into /opt/bestly/montage-kit.
# Same public files social-render's card renderer loads (storage bucket social-media/assets). Bestly Cloud uses
# /opt/bestly/social-kit directly and HOKU uses /opt/bestly/hoku-kit, so nothing to fetch for them.
set -e
B=https://rcqfqhguwpmaarseifqg.supabase.co/storage/v1/object/public/social-media/assets
K=/opt/bestly/montage-kit
get() { mkdir -p "$(dirname "$K/$2")"; curl -fsS -o "$K/$2" "$B/$1"; }
for w in 500 600 700 800; do
  get fonts/InterTight-$w.ttf cookie-yeti/fonts/InterTight-$w.ttf
  get fonts/Manrope-$w.ttf inventoryproof/fonts/Manrope-$w.ttf
done
get brand/cookieyeti-icon.png cookie-yeti/art/cookieyeti-icon.png
get proofy/proofy-cheering-arms-up.png inventoryproof/art/proofy-cheering-arms-up.png
find "$K" -type f | sort
