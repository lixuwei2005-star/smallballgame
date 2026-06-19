"""Precompute per-level jelly collision bounds from the shell alpha boundary,
matching the Windows build's build_collision_sizes() exactly.

Windows (merge_jellyfish_windows/main.py):
    JELLY_COLLISION_ALPHA = 4
    JELLY_COLLISION_MAX_SCALE = 0.96
    rect = shell.get_bounding_rect(min_alpha=4)   # alpha>=4 bbox, in shell px
    collision_w = max(w/1.1, min(w*0.96, rect.width))
    collision_h = max(h/1.1, min(h*0.96, rect.height))

The web client can't read these pixels at startup (animation shells lazy-load),
so this script bakes the alpha>=4 bbox (in shell pixels) into a table that
src/constants.js consumes; physics.js then applies the SAME max/min/cap formula.

Run:  python tools/compute_collision_bounds.py
Outputs a JS snippet for SHELL_COLLISION_BOUNDS (paste into src/constants.js).
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

WEB = Path(__file__).resolve().parent.parent
ANIM = WEB / "assets" / "jelly_anim"

LEVEL_SIZES = {
    1: (30, 30), 2: (35, 58), 3: (64, 64), 4: (78, 78), 5: (92, 92),
    6: (111, 111), 7: (150, 121), 8: (170, 180), 9: (205, 218),
    10: (235, 235), 11: (258, 258),
}
JELLY_COLLISION_ALPHA = 4
OFFICIAL_BOUND_SCALE = 1.0 / 1.1
JELLY_COLLISION_MAX_SCALE = 0.96


def alpha_bbox(im: Image.Image, min_alpha: int):
    alpha = im.convert("RGBA").split()[-1]
    mask = alpha.point(lambda v: 255 if v >= min_alpha else 0)
    return mask.getbbox()  # (l, t, r, b) or None


def main() -> None:
    table = {}
    print("level | shell px | alpha>=4 bbox px | base(w/1.1) | cap(0.96) | collision")
    for level, (w, h) in LEVEL_SIZES.items():
        shell_path = ANIM / f"level_{level}_shell.png"
        base_w, base_h = w * OFFICIAL_BOUND_SCALE, h * OFFICIAL_BOUND_SCALE
        cap_w, cap_h = w * JELLY_COLLISION_MAX_SCALE, h * JELLY_COLLISION_MAX_SCALE
        if not shell_path.exists():
            table[str(level)] = None
            print(f"{level:>5} | (missing) -> keep base {base_w:.1f}x{base_h:.1f}")
            continue
        im = Image.open(shell_path)
        sw, sh = im.size
        bbox = alpha_bbox(im, JELLY_COLLISION_ALPHA)
        if not bbox:
            table[str(level)] = None
            print(f"{level:>5} | {sw}x{sh} | (empty bbox) -> keep base")
            continue
        bw, bh = bbox[2] - bbox[0], bbox[3] - bbox[1]
        # Windows compares rect.width (shell px) to w*0.96 (LEVEL_SIZES px); the
        # shell is authored at LEVEL_SIZES, so verify and keep raw px to match.
        if (sw, sh) != (w, h):
            bw = bw * (w / sw)
            bh = bh * (h / sh)
        col_w = max(base_w, min(cap_w, float(bw)))
        col_h = max(base_h, min(cap_h, float(bh)))
        table[str(level)] = [round(float(bw), 2), round(float(bh), 2)]
        print(f"{level:>5} | {sw}x{sh} | {bw:.1f}x{bh:.1f} | {base_w:.1f}x{base_h:.1f} | "
              f"{cap_w:.1f}x{cap_h:.1f} | {col_w:.1f}x{col_h:.1f}")

    print("\n// --- paste into src/constants.js ---")
    print("export const SHELL_COLLISION_BOUNDS = {")
    for level in LEVEL_SIZES:
        v = table[str(level)]
        print(f"  {level}: {('[' + str(v[0]) + ', ' + str(v[1]) + ']') if v else 'null'},")
    print("};")


if __name__ == "__main__":
    main()
