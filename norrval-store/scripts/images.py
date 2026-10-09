#!/usr/bin/env python3
"""Turn assets/source/<slot>.png into a responsive AVIF/WebP/JPEG set.

Writes assets/img/<slot>-<width>.<ext> plus assets/img/manifest.json, which the
build reads to decide which slots have real images. Never crops or stretches:
every output keeps the source's exact aspect ratio.

Requires Pillow >= 11.3 (AVIF support): pip install pillow
"""
import json
import pathlib
import sys

from PIL import Image, features

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "source"
OUT = ROOT / "assets" / "img"
WIDTHS = [480, 768, 1080, 1440, 2000]

if not features.check("avif"):
    sys.exit("Pillow was built without AVIF support; upgrade Pillow (>= 11.3).")

OUT.mkdir(parents=True, exist_ok=True)
manifest = {}
for src in sorted(SRC.glob("*.png")) + sorted(SRC.glob("*.jpg")) + sorted(SRC.glob("*.webp")):
    slot = src.stem
    im = Image.open(src).convert("RGB")
    w, h = im.size
    widths = [x for x in WIDTHS if x < w] + [min(w, WIDTHS[-1])]
    widths = sorted(set(widths))
    for tw in widths:
        th = round(h * tw / w)
        r = im.resize((tw, th), Image.LANCZOS) if tw != w else im
        r.save(OUT / f"{slot}-{tw}.avif", quality=72, speed=6)
        r.save(OUT / f"{slot}-{tw}.webp", quality=90, method=6)
        r.save(OUT / f"{slot}-{tw}.jpg", quality=90, optimize=True, progressive=True)
    manifest[slot] = {"w": w, "h": h, "widths": widths}
    print(f"{slot}: {w}x{h} -> {widths}")

(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(f"{len(manifest)} slots written to {OUT.relative_to(ROOT)}")
