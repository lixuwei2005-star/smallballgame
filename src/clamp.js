// Spine-based clamp (claw) renderer. Ports clamp_spine_parts / world transforms
// / attachment centering / per-level "in" pose + grip tightening from main.py.
// Falls back (returns false) if the spine data is unusable.

import {
  MAX_LEVEL, CLAMP_SPINE_SCALE, CLAMP_ANCHOR_Y, CLAMP_PART_ALPHA,
  CLAMP_GRIP_RATIO_BY_LEVEL, CLAMP_GRIP_GAP_RATIO, CLAMP_GRIP_MAX_SHIFT,
} from "./constants.js";
import { clamp, lerp, easeSmooth } from "./util.js";

const SCALE = CLAMP_SPINE_SCALE; // SS = 1

export class Clamp {
  constructor(assets) {
    this.assets = assets;
    this.spine = assets.clampSpine || null;
    this.usable = !!(this.spine && this.spine.bones && this.spine.bones.length && assets.clamp[4]);
  }

  // ---- timeline sampling (the "in" anims are single-frame at t=0) ----
  _timelineValue(frames, elapsed, key, def = 0) {
    if (!frames || !frames.length) return def;
    if (elapsed <= (frames[0].time || 0)) return Number(frames[0][key] != null ? frames[0][key] : def);
    for (let i = 0; i < frames.length - 1; i++) {
      const cur = frames[i], nxt = frames[i + 1];
      const t0 = cur.time || 0, t1 = nxt.time || t0;
      if (elapsed > t1) continue;
      const span = Math.max(0.0001, t1 - t0);
      let t = clamp((elapsed - t0) / span, 0, 1);
      const curve = cur.curve || {};
      if (curve.type === "stepped") t = 0;
      else if (curve.type === "bezier") t = easeSmooth(t);
      return lerp(Number(cur[key] != null ? cur[key] : def), Number(nxt[key] != null ? nxt[key] : def), t);
    }
    return Number(frames[frames.length - 1][key] != null ? frames[frames.length - 1][key] : def);
  }

  _applyAnimation(pose, name, elapsed = 0) {
    const anim = (this.spine.animations || {})[name];
    if (!anim) return;
    const bones = this.spine.bones;
    for (const ba of anim.bones || []) {
      const bi = ba.bone_index | 0;
      if (bi < 0 || bi >= pose.length) continue;
      const base = bones[bi];
      const target = pose[bi];
      for (const tl of ba.timelines || []) {
        const type = tl.type | 0;
        const frames = tl.frames || [];
        if (type === 0) {
          const a = this._timelineValue(frames, elapsed, "angle", 0);
          target.rotation = Number(base.rotation || 0) + a;
        } else if (type === 1) {
          const x = this._timelineValue(frames, elapsed, "x", 0);
          const y = this._timelineValue(frames, elapsed, "y", 0);
          target.x = Number(base.x || 0) + x;
          target.y = Number(base.y || 0) + y;
        } else if (type === 2) {
          const sx = this._timelineValue(frames, elapsed, "x", 0);
          const sy = this._timelineValue(frames, elapsed, "y", 0);
          target.scale_x = Number(base.scale_x || 1) + sx;
          target.scale_y = Number(base.scale_y || 1) + sy;
        }
      }
    }
  }

  _worldTransforms(pose) {
    const world = [];
    const bones = this.spine.bones;
    for (let i = 0; i < bones.length; i++) {
      const it = pose[i];
      const rot = (it.rotation || 0) * Math.PI / 180;
      const sx = it.scale_x == null ? 1 : it.scale_x;
      const sy = it.scale_y == null ? 1 : it.scale_y;
      const a = Math.cos(rot) * sx;
      const b = Math.sin(rot) * sx;
      const c = -Math.sin(rot) * sy;
      const d = Math.cos(rot) * sy;
      const x = it.x || 0, y = it.y || 0;
      const parent = bones[i].parent;
      if (parent == null) { world.push([a, b, c, d, x, y]); continue; }
      const [pa, pb, pc, pd, px, py] = world[parent | 0];
      world.push([
        pa * a + pc * b,
        pb * a + pd * b,
        pa * c + pc * d,
        pb * c + pd * d,
        pa * x + pc * y + px,
        pb * x + pd * y + py,
      ]);
    }
    return world;
  }

  _attachmentMap() {
    const map = {};
    for (const att of this.spine.attachments || []) map[att.slot_index | 0] = att;
    return map;
  }

  _attachmentCenter(world, partName) {
    const slots = this.spine.slots || [];
    const map = this._attachmentMap();
    for (let si = 0; si < slots.length; si++) {
      const att = map[si];
      if (!att || (att.path || att.name) !== partName) continue;
      const [a, b, c, d, x, y] = world[slots[si].bone | 0];
      const ax = att.x || 0, ay = att.y || 0;
      return [a * ax + c * ay + x, b * ax + d * ay + y];
    }
    return null;
  }

  _buildParts(level, game) {
    const bones = this.spine.bones;
    const pose = bones.map((b) => ({
      x: Number(b.x || 0), y: Number(b.y || 0), rotation: Number(b.rotation || 0),
      scale_x: Number(b.scale_x == null ? 1 : b.scale_x), scale_y: Number(b.scale_y == null ? 1 : b.scale_y),
    }));
    const lvl = clamp(Math.round(level), 1, MAX_LEVEL);
    this._applyAnimation(pose, "in" + lvl, 0);
    const world = this._worldTransforms(pose);
    const refCenter = this._attachmentCenter(world, "jiazi_4");
    if (!refCenter) return null;

    const map = this._attachmentMap();
    const slots = this.spine.slots || [];
    const parts = [];
    for (let si = 0; si < slots.length; si++) {
      const att = map[si];
      if (!att) continue;
      const part = att.path || att.name;
      if (!part || part === "jiazi_1") continue;
      let idx;
      try { idx = parseInt(String(part).split("_").pop(), 10); } catch (e) { continue; }
      if (!this.assets.clamp[idx]) continue;
      const [a, b, c, d, x, y] = world[slots[si].bone | 0];
      const ax = att.x || 0, ay = att.y || 0;
      const cx = a * ax + c * ay + x;
      const cy = b * ax + d * ay + y;
      const rotation = Math.atan2(b, a) * 180 / Math.PI + Number(att.rotation || 0);
      parts.push({
        index: idx,
        x: game.clampX + (cx - refCenter[0]) * SCALE,
        y: CLAMP_ANCHOR_Y + (refCenter[1] - cy) * SCALE,
        w: Math.max(1, Math.round(Number(att.width || 1) * SCALE)),
        h: Math.max(1, Math.round(Number(att.height || 1) * SCALE)),
        angle: -rotation,
        alpha: CLAMP_PART_ALPHA,
      });
    }
    this._tightenGrip(parts, level, game);
    return parts;
  }

  _tightenGrip(parts, level, game) {
    if (level >= 5) return;
    const left = parts.find((p) => p.index === 11);
    const right = parts.find((p) => p.index === 9);
    if (!left || !right) return;
    const [vw] = game.prepareVisualSizeForLevel(level);
    const innerGap = (right.x - right.w * 0.5) - (left.x + left.w * 0.5);
    const targetRatio = CLAMP_GRIP_RATIO_BY_LEVEL[level] || CLAMP_GRIP_GAP_RATIO;
    const targetGap = vw * targetRatio;
    if (innerGap <= targetGap) return;
    const shift = Math.min((innerGap - targetGap) * 0.5, CLAMP_GRIP_MAX_SHIFT);
    for (const p of parts) {
      if (p.index === 10 || p.index === 11) p.x += shift;
      else if (p.index === 8 || p.index === 9) p.x -= shift;
      else if (p.index === 5) p.x += shift * 0.35;
      else if (p.index === 7) p.x -= shift * 0.35;
    }
  }

  _drawSpine(renderer, level) {
    const game = renderer.app.game;
    const parts = this._buildParts(level, game);
    if (!parts) return false;
    const ctx = renderer.ctx;
    const maxAlpha = parts.reduce((m, p) => Math.max(m, p.alpha), 0) || 255;
    // vertical cable
    ctx.save();
    ctx.strokeStyle = `rgba(155,210,225,${clamp((120 * maxAlpha / 255) / 255, 0, 1)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(game.clampX, 0);
    ctx.lineTo(game.clampX, 44);
    ctx.stroke();
    ctx.restore();
    for (const p of parts) {
      const img = this.assets.clamp[p.index];
      if (!img || p.alpha <= 1) continue;
      ctx.save();
      ctx.globalAlpha = clamp(p.alpha / 255, 0, 1);
      ctx.translate(p.x, p.y);
      if (Math.abs(p.angle) > 0.01) ctx.rotate(-p.angle * Math.PI / 180); // pygame rotate is CCW-positive
      ctx.drawImage(img, -p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    return true;
  }

  draw(renderer, now) {
    if (!this.usable) return false;
    const g = renderer.app.game;
    if (g.releaseLevel != null) {
      return this._drawSpine(renderer, g.releaseLevel);
    }
    if (g.pendingLevel == null) {
      return this._drawSpine(renderer, g.activeClampLimitLevel());
    }
    const lvl = g.pendingLevel;
    const [vw, vh] = g.prepareVisualSizeForLevel(lvl);
    const [ix, iy] = g.heldJellyPos(lvl, g.clampX);
    renderer.drawJellyVisual(lvl, ix, iy, vw, vh, { alpha: 235, phaseTime: now });
    if (this._drawSpine(renderer, lvl)) return true;
    renderer.drawClampFallback(lvl, false);
    return true;
  }
}
