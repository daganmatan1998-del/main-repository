#!/usr/bin/env bash
# Downloads every image in assets/js/media.js into assets/media/ and points the
# manifest at the local copies, so the store no longer depends on the CDN.
# Run from the vante/ folder:  bash tools/download-assets.sh
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p assets/media
CDN=$(sed -n 's/.*var CDN = "\(https:[^"]*\)".*/\1/p' assets/js/media.js)
[ -n "$CDN" ] || { echo "Manifest already points to local files."; exit 0; }
grep -o 'src("[0-9a-f-]*")' assets/js/media.js | sed 's/src("\(.*\)")/\1/' | while read -r id; do
  f="assets/media/$id.webp"
  [ -s "$f" ] || { echo "↓ $id"; curl -fsSL "$CDN$id.webp" -o "$f"; }
done
sed -i.bak "s#var CDN = \"$CDN\"#var CDN = \"assets/media/\"#" assets/js/media.js && rm -f assets/js/media.js.bak
# Static pages reference the hero and share image by full URL too.
grep -rl "$CDN" --include=*.html . | while read -r html; do sed -i.bak "s#$CDN#assets/media/#g" "$html" && rm -f "$html.bak"; done
echo "Done: $(ls assets/media | wc -l) images in assets/media/"
