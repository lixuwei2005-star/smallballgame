"""Asset pipeline for the web rebuild of 暗海探秘 (MergeJellyfish).

Reads the official/unpacked assets from the Windows rebuild and produces a lean,
web-friendly asset set under merge_jellyfish_web/assets:

  - static jelly sprites: alpha-trimmed (matches pygame trim_alpha) -> sprites/
  - animated jellies: per-level inner-body frame sheet + shell  -> jelly_anim/
  - ui / clamp / particles / background single images           -> copied
  - font (.ttc)                                                  -> copied
  - only the audio actually referenced by sound_map aliases      -> audio/
  - manifest.json describing everything for the JS loader

Heavy full-screen frame loops (official_bg2_loop 60x1600x900, official_wave_loop
24x1600x900 ~= 13MB) are intentionally NOT shipped; the web client reproduces
that motion procedurally (sway / bubbles / fish / wave shimmer), matching what
main.py already does procedurally.

Run:  python tools/build_assets.py
"""
from __future__ import annotations

import json
import math
import shutil
from pathlib import Path

from PIL import Image

WEB_ROOT = Path(__file__).resolve().parent.parent
SRC = WEB_ROOT.parent / "merge_jellyfish_windows" / "assets"
OUT = WEB_ROOT / "assets"

MAX_LEVEL = 11
ANIM_COLS = 10
ANIM_ROWS = 6  # 10x6 = 60 frames exactly


def ensure(p: Path) -> Path:
    p.mkdir(parents=True, exist_ok=True)
    return p


def trim_alpha(im: Image.Image, min_alpha: int = 1) -> Image.Image:
    im = im.convert("RGBA")
    alpha = im.split()[-1]
    bbox = alpha.point(lambda a: 255 if a >= min_alpha else 0).getbbox()
    if bbox is None:
        return im
    return im.crop(bbox)


def copy_file(src: Path, dst: Path) -> None:
    ensure(dst.parent)
    shutil.copy2(src, dst)


def build_static_sprites(manifest: dict) -> None:
    out_dir = ensure(OUT / "sprites")
    sprites = {}
    for level in range(1, MAX_LEVEL + 1):
        src = SRC / "sprites" / f"jelly_level_{level}.png"
        if not src.exists():
            continue
        im = trim_alpha(Image.open(src))
        dst = out_dir / f"jelly_level_{level}.png"
        im.save(dst)
        sprites[str(level)] = f"sprites/jelly_level_{level}.png"
    manifest["sprites"] = sprites


def build_anim_sheets(manifest: dict) -> None:
    out_dir = ensure(OUT / "jelly_anim")
    layer_manifest = {}
    raw = SRC / "jelly_layers" / "manifest.json"
    meta_by_level = {}
    if raw.exists():
        for item in json.loads(raw.read_text(encoding="utf-8")):
            lvl = int(item.get("level", 0))
            if lvl:
                meta_by_level[lvl] = item
    for level in range(1, MAX_LEVEL + 1):
        layer_dir = SRC / "jelly_layers" / f"level_{level}"
        shell_path = layer_dir / "shell.png"
        frame_paths = sorted(layer_dir.glob("frame_*.png")) if layer_dir.exists() else []
        if not shell_path.exists() or not frame_paths:
            continue
        shell = Image.open(shell_path).convert("RGBA")
        shell.save(out_dir / f"level_{level}_shell.png")
        frames = [Image.open(p).convert("RGBA") for p in frame_paths]
        fw, fh = frames[0].size
        count = len(frames)
        cols = ANIM_COLS
        rows = math.ceil(count / cols)
        sheet = Image.new("RGBA", (cols * fw, rows * fh), (0, 0, 0, 0))
        for idx, fr in enumerate(frames):
            if fr.size != (fw, fh):
                fr = fr.resize((fw, fh), Image.LANCZOS)
            cx = (idx % cols) * fw
            cy = (idx // cols) * fh
            sheet.paste(fr, (cx, cy))
        sheet.save(out_dir / f"level_{level}_frames.png")
        meta = meta_by_level.get(level, {})
        fps = float(meta.get("fps", 30) or 30)
        duration = float(meta.get("duration") or (count / max(1, fps)))
        layer_manifest[str(level)] = {
            "shell": f"jelly_anim/level_{level}_shell.png",
            "frames": f"jelly_anim/level_{level}_frames.png",
            "frame_w": fw,
            "frame_h": fh,
            "cols": cols,
            "rows": rows,
            "count": count,
            "duration": max(0.001, duration),
        }
    manifest["jelly_anim"] = layer_manifest


def build_ui(manifest: dict) -> None:
    out_dir = ensure(OUT / "ui")
    names = ["img_bottle_1", "img_bottle_1_1", "img_bottle_1_2", "img_line_1", "img_go", "jiemian2_15"]
    ui = {}
    for name in names:
        src = SRC / "ui" / f"{name}.png"
        if src.exists():
            copy_file(src, out_dir / f"{name}.png")
            ui[name] = f"ui/{name}.png"
    manifest["ui"] = ui


def build_clamp(manifest: dict) -> None:
    out_dir = ensure(OUT / "clamp")
    clamp = {}
    for idx in range(1, 13):
        src = SRC / "clamp" / f"jiazi_{idx}.png"
        if src.exists():
            copy_file(src, out_dir / f"jiazi_{idx}.png")
            clamp[str(idx)] = f"clamp/jiazi_{idx}.png"
    spine = SRC / "clamp" / "clamp_spine.json"
    if spine.exists():
        copy_file(spine, out_dir / "clamp_spine.json")
        manifest["clamp_spine"] = "clamp/clamp_spine.json"
    manifest["clamp"] = clamp


def build_particles(manifest: dict) -> None:
    out_dir = ensure(OUT / "particles")
    particles = []
    for src in sorted((SRC / "particles").glob("paopao1_*.png"))[:20]:
        copy_file(src, out_dir / src.name)
        particles.append(f"particles/{src.name}")
    qipao = SRC / "particles" / "qipao.png"
    if qipao.exists():
        copy_file(qipao, out_dir / "qipao.png")
        manifest["score_bubble"] = "particles/qipao.png"
    manifest["particles"] = particles


def build_background(manifest: dict) -> None:
    out_dir = ensure(OUT / "background")
    bg = {}
    for name in ["bj", "official_bg2_foreground", "side_bubble", "custom_fish_D", "custom_fish_J"]:
        src = SRC / "background" / f"{name}.png"
        if src.exists():
            copy_file(src, out_dir / f"{name}.png")
            bg[name] = f"background/{name}.png"
    elements = SRC / "background" / "official_bg2_elements.json"
    if elements.exists():
        copy_file(elements, out_dir / "official_bg2_elements.json")
        bg["elements"] = "background/official_bg2_elements.json"
    manifest["background"] = bg


def build_font(manifest: dict) -> None:
    out_dir = ensure(OUT / "fonts")
    src = SRC / "fonts" / "pop1w5.TTC"
    if src.exists():
        copy_file(src, out_dir / "pop1w5.ttc")
        manifest["font"] = "fonts/pop1w5.ttc"


def build_audio(manifest: dict) -> None:
    out_dir = ensure(OUT / "audio")
    sound_map = json.loads((SRC / "audio" / "sound_map.json").read_text(encoding="utf-8"))
    needed = set()
    for fname in sound_map.get("aliases", {}).values():
        needed.add(fname)
    audio = {"bgm": None, "aliases": {}}
    for alias, fname in sound_map.get("aliases", {}).items():
        src = SRC / "audio" / fname
        if src.exists():
            copy_file(src, out_dir / fname)
            audio["aliases"][alias] = f"audio/{fname}"
    bgm = SRC / "audio" / "official_minigame_205264034.mp3"
    if bgm.exists():
        copy_file(bgm, out_dir / bgm.name)
        audio["bgm"] = f"audio/{bgm.name}"
    manifest["audio"] = audio


def main() -> None:
    ensure(OUT)
    manifest: dict = {"generated_by": "tools/build_assets.py"}
    build_static_sprites(manifest)
    build_anim_sheets(manifest)
    build_ui(manifest)
    build_clamp(manifest)
    build_particles(manifest)
    build_background(manifest)
    build_font(manifest)
    build_audio(manifest)
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    # report
    total = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    print(f"Assets written to {OUT}")
    print(f"Total size: {total / 1024 / 1024:.1f} MB")


if __name__ == "__main__":
    main()
