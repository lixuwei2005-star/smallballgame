// Canvas renderer. Ports the in-scene visuals from main.py: dynamic sea
// background, bottle layers + clipping, jellies (static sprite or shell+inner
// animation), clamp, score bubble, rank top-3 panel, next preview, and the
// jellyfish encyclopedia road. Interactive panels/modals are DOM (see ui.js).

import {
  DESIGN_W, DESIGN_H, LEVEL_SIZES, MAX_LEVEL, SEA_TONE,
  SPAWN_ANIM_DURATION, MERGE_DURATION, CHECK_OVER_HEIGHT_TIME,
  JELLY_CLIP_BLEED_X, IMMEDIATE_OVER_HEIGHT_OFFSET, INNER_MOTION_BY_LEVEL,
  DEFAULT_NICKNAME, AIM_GUIDE_DELAY, AIM_GUIDE_ALPHA,
} from "./constants.js";
import { clamp, lerp, easeSmooth, nowSeconds, scoreBubbleFloatOffset, TAU } from "./util.js";

const CJK = '"pop1w5","Microsoft YaHei UI","Microsoft YaHei","PingFang SC","Source Han Sans SC","Noto Sans CJK SC","DengXian","SimHei",sans-serif';

// Bottle-bottom visual curve (purely cosmetic; the Matter floor stays flat).
// The bottom is a shallow downward arc that dips BOTTLE_CURVE_DROP in the center
// and rises to the walls, with rounded bottom corners (BOTTLE_CURVE_CORNER).
const BOTTLE_CURVE_DROP = 22;
const BOTTLE_CURVE_CORNER = 34;

export class Renderer {
  constructor(canvas, app) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.app = app;
    this.dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    this._resizeBacking();
  }

  _resizeBacking() {
    const c = this.canvas;
    c.width = Math.round(DESIGN_W * this.dpr);
    c.height = Math.round(DESIGN_H * this.dpr);
    c.style.width = DESIGN_W + "px";
    c.style.height = DESIGN_H + "px";
  }

  // ---------- text ----------
  text(t, x, y, opts = {}) {
    const ctx = this.ctx;
    const size = opts.size || 28;
    ctx.save();
    ctx.font = `${opts.bold ? "700 " : ""}${size}px ${CJK}`;
    ctx.textAlign = opts.align || "left";
    ctx.textBaseline = opts.baseline || "alphabetic";
    if ("letterSpacing" in ctx && opts.tracking) ctx.letterSpacing = opts.tracking + "px";
    if (opts.glow) {
      ctx.shadowColor = opts.glow;
      ctx.shadowBlur = opts.glowBlur || 18;
    }
    if (opts.shadow) {
      ctx.fillStyle = opts.shadow;
      ctx.fillText(t, x + (opts.shadowDx || 2), y + (opts.shadowDy || 2));
      ctx.shadowBlur = 0;
    }
    ctx.fillStyle = opts.color || "#ecf8ff";
    ctx.fillText(t, x, y);
    ctx.restore();
  }

  // ---------- generic image blit (matches blit_fx) ----------
  blitFx(img, cx, cy, { scale = 1, alpha = 255, flipX = false, angleDeg = 0, additive = false } = {}) {
    if (!img) return;
    const ctx = this.ctx;
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.save();
    ctx.globalAlpha = clamp(alpha / 255, 0, 1);
    if (additive) ctx.globalCompositeOperation = "lighter";
    ctx.translate(cx, cy);
    if (angleDeg) ctx.rotate((-angleDeg * Math.PI) / 180); // pygame rotozoom is CCW-positive
    if (flipX) ctx.scale(-1, 1);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  // cover-fit an image into the whole stage (scale_to_fill)
  drawCover(img, dw, dh) {
    if (!img) return;
    const s = Math.max(dw / img.width, dh / img.height);
    const w = img.width * s, h = img.height * s;
    this.ctx.drawImage(img, (dw - w) / 2, (dh - h) / 2, w, h);
  }

  // ---------- frame ----------
  draw() {
    const ctx = this.ctx;
    const app = this.app;
    const game = app.game;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, DESIGN_W, DESIGN_H);

    const now = nowSeconds();
    this.drawBackground(now);
    this.drawBottleBack();
    this.drawBottomWaveShimmer(now);

    // split items, draw with clipping
    const items = game.items.slice().sort((a, b) => (a.body.position.y - b.body.position.y) || (a.level - b.level));
    const dropping = [];
    const settled = [];
    for (const it of items) {
      if (it.in_drop || it.tag === "start_drop") dropping.push(it);
      else settled.push(it);
    }
    ctx.save();
    this.clipRect(this.droppingClipRect());
    for (const it of dropping) this.drawItem(it, now);
    ctx.restore();
    ctx.save();
    this.clipRect(this.bottleClipRect());
    for (const it of settled) this.drawItem(it, now);
    ctx.restore();

    this.drawBottleFront(now);
    this.drawAimGuide(now);
    this.drawClamp(now);
    this.drawHud(now);
    ctx.restore();
  }

  clipRect(r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
  }

  droppingClipRect() {
    const g = this.app.game;
    const bleed = JELLY_CLIP_BLEED_X;
    const left = Math.max(0, g.bottleLeft - bleed);
    const right = Math.min(DESIGN_W, g.bottleRight + bleed);
    return { x: left, y: 72, w: right - left, h: g.bottleInnerBottom() - 72 };
  }

  bottleClipRect() {
    const g = this.app.game;
    const top = Math.max(0, Math.min(g.bottleTop, g.failLineY - g.officialHeightToScreen(IMMEDIATE_OVER_HEIGHT_OFFSET)));
    const bleed = JELLY_CLIP_BLEED_X;
    const left = Math.max(0, g.bottleLeft - bleed);
    const right = Math.min(DESIGN_W, g.bottleRight + bleed);
    return { x: left, y: top, w: right - left, h: g.bottleInnerBottom() - top };
  }

  // ---------- background ----------
  drawBackground(now) {
    const a = this.app.assets;
    const ctx = this.ctx;
    if (a.bg.bj) this.drawCover(a.bg.bj, DESIGN_W, DESIGN_H);
    else { ctx.fillStyle = "#0a2b44"; ctx.fillRect(0, 0, DESIGN_W, DESIGN_H); }

    this.drawSwayingForeground(a.bg.official_bg2_foreground, now);
    this.drawCustomFish(now);
    this.drawSideBubbles(now);

    ctx.fillStyle = SEA_TONE;
    ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
  }

  drawSwayingForeground(img, now) {
    if (!img) return;
    const ctx = this.ctx;
    const s = Math.max(DESIGN_W / img.width, DESIGN_H / img.height);
    const iw = img.width * s, ih = img.height * s;
    const ox = (DESIGN_W - iw) / 2, oy = (DESIGN_H - ih) / 2;
    const sliceH = 10;
    for (let y = 0; y < DESIGN_H; y += sliceH) {
      const depth = y / DESIGN_H;
      const strength = 0.7 + 7.0 * Math.pow(depth, 1.65);
      const shift = Math.sin(now * 0.86 + y * 0.025) * strength;
      const h = Math.min(sliceH, DESIGN_H - y);
      // source slice in image space
      const sy = (y - oy) / s;
      const sh = h / s;
      ctx.drawImage(img, 0, sy, img.width, sh, ox + shift, y, iw, h);
    }
  }

  drawSideBubbles(now) {
    const bubble = this.app.assets.bg.side_bubble;
    if (!bubble) return;
    const streams = [
      [210, 910, 620, 0.25, 6.8, 0.0, -9],
      [330, 885, 560, 0.18, 7.4, 2.3, 7],
      [458, 930, 650, 0.13, 6.1, 4.1, -5],
      [1238, 910, 610, 0.22, 7.1, 1.1, 8],
      [1386, 890, 585, 0.16, 6.5, 3.4, -7],
      [1512, 935, 660, 0.12, 7.8, 5.2, 6],
    ];
    for (const [bx, by, travel, baseScale, duration, phase, sway] of streams) {
      const cycle = (((now + phase) % duration) / duration);
      const fade = Math.sin(Math.PI * cycle);
      const alpha = 82 * fade * fade;
      if (alpha <= 1) continue;
      const drift = Math.sin((now + phase) * 0.9) * sway;
      const x = bx + drift;
      const y = by - travel * cycle;
      const scale = baseScale * (0.76 + 0.34 * cycle);
      const angle = Math.sin((now + phase) * 0.55) * 5.0;
      this.blitFx(bubble, x, y, { scale, alpha, angleDeg: angle });
    }
  }

  drawCustomFish(now) {
    const fish = this.app.assets.bg;
    const specs = [
      ["custom_fish_D", -180, 1710, 575, 22.0, 0.78, 0.0, 54, false, -3.5],
      ["custom_fish_J", -150, 1680, 508, 19.5, 0.76, 0.22, 50, false, 4.0],
      ["custom_fish_D", 1715, -180, 650, 25.5, 1.02, 0.38, 44, true, 5.5],
      ["custom_fish_J", 1650, -145, 714, 23.0, 0.60, 0.58, 38, true, -4.0],
      ["custom_fish_D", 1535, -160, 500, 31.0, 0.70, 0.73, 34, true, -7.0],
      ["custom_fish_J", -125, 1590, 630, 27.0, 0.52, 0.86, 32, false, 6.0],
    ];
    for (const [key, sx, ex, by, duration, scale, phase, baseAlpha, flipX, angle] of specs) {
      const img = fish[key];
      if (!img) continue;
      const cycle = ((now / duration) + phase) % 1.0;
      const fade = Math.min(1.0, cycle / 0.14, (1.0 - cycle) / 0.14);
      if (fade <= 0.01) continue;
      const eased = cycle * cycle * (3.0 - 2.0 * cycle);
      const x = sx + (ex - sx) * eased;
      const y = by + Math.sin(now * 0.42 + phase * TAU) * 12.0;
      const alpha = baseAlpha * fade;
      const swim = angle + Math.sin(now * 0.52 + phase * 4.0) * 2.0;
      this.blitFx(img, x, y, { scale, alpha, flipX, angleDeg: swim });
    }
  }

  // ---- curved bottle bottom (visual only; physics floor stays flat) ----
  // y of the bottom curve at horizontal position x: lowest in the center
  // (bottom + curveDrop), rising to the walls (bottom).
  bottleBottomCurveY(x, curveDrop = BOTTLE_CURVE_DROP) {
    const g = this.app.game;
    const center = (g.bottleLeft + g.bottleRight) / 2;
    const halfW = (g.bottleRight - g.bottleLeft) / 2;
    const t = (x - center) / halfW;
    return g.bottleInnerBottom() + curveDrop * (1 - t * t);
  }

  // Builds (does not stroke/fill) a closed path of the bottle interior from `top`
  // down the side walls, around rounded bottom corners, and across the curved
  // bottom. Use it for clipping bottom effects so they follow the arc instead of
  // being cut by a straight rectangle.
  traceBottleBottom(ctx, top, curveDrop = BOTTLE_CURVE_DROP, corner = BOTTLE_CURVE_CORNER) {
    const g = this.app.game;
    const left = g.bottleLeft;
    const right = g.bottleRight;
    const bottom = g.bottleInnerBottom();
    const center = (left + right) / 2;
    const xL = left + corner;
    const xR = right - corner;
    const yL = this.bottleBottomCurveY(xL, curveDrop);
    const yR = this.bottleBottomCurveY(xR, curveDrop);
    const yMid = this.bottleBottomCurveY(center, curveDrop); // = bottom + curveDrop
    // quadratic control so the bottom arc midpoint lands on yMid
    const ctrlY = 2 * yMid - 0.5 * (yL + yR);
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left, bottom - corner);
    ctx.quadraticCurveTo(left, bottom, xL, yL);                  // rounded bottom-left corner
    ctx.quadraticCurveTo(center, ctrlY, xR, yR);                 // downward bottom arc
    ctx.quadraticCurveTo(right, bottom, right, bottom - corner); // rounded bottom-right corner
    ctx.lineTo(right, top);
    ctx.closePath();
  }

  // Procedural replacement for the heavy 24-frame wave loop band. The band now
  // follows the curved bottle bottom (clip + per-x curve offset) instead of a
  // straight rectangle, so the bottom reads as a rounded glass base.
  drawBottomWaveShimmer(now) {
    const g = this.app.game;
    const ctx = this.ctx;
    const left = g.bottleLeft;
    const right = g.bottleRight;
    const bottom = g.bottleInnerBottom();
    const top = bottom - 150;

    ctx.save();
    this.traceBottleBottom(ctx, top);
    ctx.clip();
    ctx.globalCompositeOperation = "lighter";
    // Soft wave lines that follow the bottom curve. Keep them above the glass
    // base so the curved bottom reads from the bottle texture, not a drawn line.
    for (let i = 0; i < 3; i++) {
      const amp = 4 + i * 1.6;
      ctx.beginPath();
      let started = false;
      for (let x = left; x <= right; x += 10) {
        const baseY = this.bottleBottomCurveY(x) - 16 - i * 7;
        const y = baseY + Math.sin(x * 0.03 + now * (1.0 + i * 0.4) + i) * amp;
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(150,220,245,${0.035 - i * 0.008})`;
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }
    // soft upward gradient toward the curved bottom
    const grad = ctx.createLinearGradient(0, top, 0, bottom + BOTTLE_CURVE_DROP);
    grad.addColorStop(0, "rgba(120,210,235,0)");
    grad.addColorStop(1, "rgba(90,180,220,0.16)");
    ctx.fillStyle = grad;
    ctx.fillRect(left, top, right - left, (bottom + BOTTLE_CURVE_DROP) - top);
    ctx.restore();
  }

  bottleVisualRect() {
    const g = this.app.game;
    return { x: g.bottleLeft, y: 56, w: g.bottleRight - g.bottleLeft, h: g.bottleBottom - 56 };
  }

  drawBottleBack() {
    const body = this.app.assets.ui.img_bottle_1;
    if (!body) return;
    const r = this.bottleVisualRect();
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 96 / 255;
    ctx.drawImage(body, r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  drawBottleFront(now) {
    const ui = this.app.assets.ui;
    const g = this.app.game;
    const ctx = this.ctx;
    const body = ui.img_bottle_1;
    const r = this.bottleVisualRect();
    if (body) {
      ctx.save();
      ctx.globalAlpha = 28 / 255;
      ctx.drawImage(body, r.x, r.y, r.w, r.h);
      ctx.restore();
      const lid = ui.img_bottle_1_1;
      if (lid) {
        const tr = { x: r.x + r.w * 40 / 612, y: r.y + r.h * 8 / 836, w: r.w * 516 / 612, h: r.h * 188 / 836 };
        ctx.save(); ctx.globalAlpha = 88 / 255; ctx.drawImage(lid, tr.x, tr.y, tr.w, tr.h); ctx.restore();
      }
      const lip = ui.img_bottle_1_2;
      if (lip) {
        const lr = { x: r.x + r.w * 96 / 612, y: r.y + r.h * 8 / 836, w: r.w * 412 / 612, h: Math.max(1, r.h * 52 / 836) };
        ctx.save(); ctx.globalAlpha = 150 / 255; ctx.drawImage(lip, lr.x, lr.y, lr.w, lr.h); ctx.restore();
      }
    }

    // warn line
    const main = { left: g.bottleLeft, right: g.bottleRight, top: g.bottleTop };
    const progress = clamp(g.failTimer / CHECK_OVER_HEIGHT_TIME, 0, 1);
    if (progress > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(255,80,120,${0.37 * progress})`;
      ctx.fillRect(main.left + 9, g.failLineY - 14, (main.right - main.left) - 18, 28);
      ctx.strokeStyle = `rgba(255,145,170,${clamp((120 + 80 * progress) / 255, 0, 1)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(main.left + 16, g.failLineY);
      ctx.lineTo(main.right - 16, g.failLineY);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---------- jelly visuals ----------
  loopScale(item, now) {
    let spawnT = clamp((now - item.born) / SPAWN_ANIM_DURATION, 0, 1);
    const easedSpawn = spawnT < 0.5 ? 2 * spawnT * spawnT : 1 - Math.pow(-2 * spawnT + 2, 2) / 2;
    const spawnScale = item.spawn_from != null ? 1.0 : 0.3 + 0.7 * easedSpawn;
    const loopSpeed = 1.25 + item.level * 0.085;
    const loopAmp = 0.012 + Math.min(item.level, 8) * 0.0022;
    const loop = 1.0 + Math.sin(now * loopSpeed + item.loop_phase) * loopAmp;
    return spawnScale * loop;
  }

  mergeDrawState(item, now) {
    if (!item.merging || !item.merge_started || !item.merge_from || !item.merge_to) {
      return [item.body.position.x, item.body.position.y, 1.0];
    }
    const t = clamp((now - item.merge_started) / MERGE_DURATION, 0, 1);
    const easedT = Math.pow(t, 4);
    const x = item.merge_from[0] + (item.merge_to[0] - item.merge_from[0]) * easedT;
    const y = item.merge_from[1] + (item.merge_to[1] - item.merge_from[1]) * easedT;
    const scale = 1.0 + (0.3 - 1.0) * t;
    return [x, y, scale];
  }

  innerSpawnState(item, now) {
    if (item.anim_in_until <= 0) return [1.0, 255];
    const start = item.anim_in_until - SPAWN_ANIM_DURATION;
    const t = clamp((now - start) / SPAWN_ANIM_DURATION, 0, 1);
    const eased = easeSmooth(t);
    return [0.85 + 0.15 * eased, Math.floor(80 + 175 * eased)];
  }

  hasAnim(level) { return this.app.assets.hasAnim(level); }

  drawItem(item, now) {
    let [x, y, scale] = this.mergeDrawState(item, now);
    if (!this.hasAnim(item.level) && !item.merging) scale *= this.loopScale(item, now);
    const [innerScale, innerAlpha] = this.innerSpawnState(item, now);
    const [vw, vh] = this.app.game.visualSizeForLevel(item.level);
    const [offX, offY, vScale] = this.app.game.visualAdjustmentForLevel(item.level);
    const angle = item.body.angle;
    if (offX || offY) {
      const ca = Math.cos(angle), sa = Math.sin(angle);
      x += offX * ca - offY * sa;
      y += offX * sa + offY * ca;
    }
    this.drawJellyVisual(item.level, x, y, vw, vh, {
      angle, scale: scale * vScale, alpha: 255,
      phaseTime: now + item.loop_phase, innerScale, innerAlpha,
    });
  }

  // draws a jelly of `level` centered at (x,y) sized to (w,h)*scale
  drawJellyVisual(level, x, y, w, h, opts = {}) {
    const ctx = this.ctx;
    const scale = opts.scale == null ? 1 : opts.scale;
    const drawW = Math.max(8, w * scale);
    const drawH = Math.max(8, h * scale);
    const alpha = opts.alpha == null ? 255 : opts.alpha;
    const angle = opts.angle || 0;
    ctx.save();
    ctx.globalAlpha = clamp(alpha / 255, 0, 1);
    ctx.translate(x, y);
    if (angle) ctx.rotate(angle);
    const anim = this.app.assets.anim[level];
    if (anim) {
      this.drawLayered(anim, level, drawW, drawH, opts);
    } else {
      const sprite = this.app.assets.sprites[level];
      if (sprite) ctx.drawImage(sprite, -drawW / 2, -drawH / 2, drawW, drawH);
    }
    ctx.restore();
  }

  drawLayered(anim, level, drawW, drawH, opts) {
    const ctx = this.ctx;
    const phaseTime = opts.phaseTime == null ? nowSeconds() : opts.phaseTime;
    const innerScale = opts.innerScale == null ? 1 : opts.innerScale;
    const innerAlpha = opts.innerAlpha == null ? 255 : opts.innerAlpha;
    // shell
    ctx.drawImage(anim.shell, -drawW / 2, -drawH / 2, drawW, drawH);
    // inner frame from sheet
    let duration = anim.duration;
    const motion = INNER_MOTION_BY_LEVEL[level];
    let extraScale = 1, offX = 0, offY = 0, rot = 0;
    if (motion) {
      duration = Math.max(0.001, duration * (motion.duration_scale || 1));
      const phase = ((phaseTime % duration) / duration) * TAU;
      extraScale += Math.sin(phase) * (motion.scale_amp || 0);
      offX = drawW * (motion.x_amp || 0) * Math.sin(phase + 0.6);
      offY = drawH * (motion.y_amp || 0) * Math.sin(phase * 1.7 + 1.2);
      rot = ((motion.rot_amp || 0) * Math.sin(phase + 0.35)) * Math.PI / 180;
    }
    const count = anim.count;
    let frameIndex = Math.floor(((((phaseTime % duration) + duration) % duration) / duration) * count) % count;
    if (frameIndex < 0) frameIndex += count;
    const col = frameIndex % anim.cols;
    const row = Math.floor(frameIndex / anim.cols);
    const sx = col * anim.frame_w;
    const sy = row * anim.frame_h;
    const iw = drawW * innerScale * extraScale;
    const ih = drawH * innerScale * extraScale;
    ctx.save();
    ctx.globalAlpha *= clamp(innerAlpha / 255, 0, 1);
    ctx.translate(offX, offY);
    if (rot) ctx.rotate(rot);
    ctx.drawImage(anim.frames, sx, sy, anim.frame_w, anim.frame_h, -iw / 2, -ih / 2, iw, ih);
    ctx.restore();
  }

  // ---------- clamp (fallback claw; spine port lives in clamp.js) ----------
  drawAimGuide(now) {
    const g = this.app.game;
    if (!g.aiming || g.pendingLevel == null) return;
    if (now - g.aimStartedAt < AIM_GUIDE_DELAY) return;

    const level = g.pendingLevel;
    const x = Math.round(g.clampX);
    const [, heldY] = g.heldJellyPos(level, x);
    const [, visualH] = g.visualSizeForLevel(level);
    const startY = Math.round(heldY + visualH * 0.56);
    const endY = Math.round(g.bottleInnerBottom() - 14);
    if (endY <= startY) return;

    const ctx = this.ctx;
    const alpha = Math.max(0, Math.min(1, AIM_GUIDE_ALPHA / 255));
    const core = ctx.createLinearGradient(x, startY, x, endY);
    core.addColorStop(0, `rgba(202,230,225,${alpha * 0.72})`);
    core.addColorStop(1, `rgba(202,230,225,${alpha * 0.56})`);
    const glow = ctx.createLinearGradient(x, startY, x, endY);
    glow.addColorStop(0, `rgba(128,196,214,${alpha * 0.22})`);
    glow.addColorStop(1, `rgba(128,196,214,${alpha * 0.16})`);

    ctx.save();
    this.clipRect(this.droppingClipRect());
    ctx.setLineDash([15, 12]);
    ctx.lineDashOffset = 0;
    ctx.lineCap = "butt";
    ctx.strokeStyle = glow;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
    ctx.stroke();
    ctx.strokeStyle = core;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
    ctx.stroke();
    ctx.restore();
  }

  drawClamp(now) {
    const g = this.app.game;
    if (this.app.clamp && this.app.clamp.draw(this, now)) return;
    // basic fallback
    let level;
    if (g.releaseLevel != null) {
      this.drawClampFallback(g.releaseLevel, false);
      return;
    }
    if (g.pendingLevel == null) { this.drawClampFallback(g.activeClampLimitLevel(), false); return; }
    this.drawClampFallback(g.pendingLevel, true);
  }

  drawClampFallback(level, drawItem) {
    const g = this.app.game;
    const ctx = this.ctx;
    const a = this.app.assets;
    const x = g.clampX;
    // vertical cable
    ctx.save();
    ctx.strokeStyle = "rgba(155,210,225,0.6)";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 62); ctx.stroke();
    ctx.restore();
    const bar = a.clamp[2], block = a.clamp[4], armL = a.clamp[11], armR = a.clamp[9];
    if (bar) this._fit(bar, x, 17, 92, 26);
    if (block) this._fit(block, x, 46, 84, 104);
    if (armL) this._fit(armL, x - 26, 94, 58, 92, -8);
    if (armR) this._fit(armR, x + 28, 94, 58, 92, 8);
    if (drawItem) {
      const [vw, vh] = g.prepareVisualSizeForLevel(level);
      const [, iy] = g.heldJellyPos(level, x);
      this.drawJellyVisual(level, x, iy, vw, vh, { alpha: 235 });
    }
  }

  _fit(img, cx, cy, maxW, maxH, angleDeg = 0) {
    const s = Math.min(maxW / img.width, maxH / img.height);
    this.blitFx(img, cx, cy, { scale: s, angleDeg });
  }

  // ---------- HUD ----------
  drawHud(now) {
    this.drawScore(now);
    this.drawRankPanel();
    this.drawNextAndRoad();
    this.drawSettingsButton();
  }

  drawScore(now) {
    const g = this.app.game;
    const a = this.app.assets;
    if (this.app.portrait) {
      // Compact score cluster on the band's LEFT edge (clear of the claw, which
      // roams x>=512). Best score moves here too (the side rank panel is gone).
      // cx kept >=~490 so the label keeps a safe left margin on 360px-wide phones.
      const cx = 494;
      const bubbleY = 98 + scoreBubbleFloatOffset(now);
      if (a.scoreBubble) this.blitFx(a.scoreBubble, cx, bubbleY, { scale: 0.52, alpha: 232 });
      this.text("我的得分", cx, 42, { size: 24, align: "center", color: "#fcfdff", tracking: 1, shadow: "rgba(9,27,48,0.4)" });
      this.text(String(g.score), cx, bubbleY + 12, { size: 40, bold: true, align: "center", color: "#ffffff", shadow: "rgba(9,24,44,0.4)" });
      const best = Math.max(0, (this.app.save && this.app.save.best_score) || 0);
      this.text("最佳 " + best, cx, 146, { size: 20, align: "center", color: "#e6da82", shadow: "rgba(9,24,44,0.4)" });
      return;
    }
    const cx = 404, cy = 160;
    const bubbleY = cy + scoreBubbleFloatOffset(now);
    if (a.scoreBubble) this.blitFx(a.scoreBubble, cx, bubbleY, { scale: 0.86, alpha: 238 });
    this.text("我的得分", cx, 70, { size: 32, align: "center", color: "#fcfdff", tracking: 1, shadow: "rgba(9,27,48,0.4)" });
    this.text(String(g.score), cx, bubbleY + 18, { size: 56, bold: true, align: "center", color: "#ffffff", shadow: "rgba(9,24,44,0.4)" });
  }

  drawSettingsButton() {
    const ctx = this.ctx;
    const r = this.settingsButtonRect();
    ctx.save();
    ctx.fillStyle = this.app.ui && this.app.ui.settingsOpen ? "rgba(12,40,72,0.67)" : "rgba(8,28,54,0.47)";
    this.roundRect(r.x, r.y, r.w, r.h, 10); ctx.fill();
    ctx.strokeStyle = "rgba(154,222,248,0.46)"; ctx.lineWidth = 1;
    this.roundRect(r.x, r.y, r.w, r.h, 10); ctx.stroke();
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    ctx.fillStyle = "rgba(205,236,250,0.7)";
    for (let i = 0; i < 8; i++) {
      const ang = (i * Math.PI) / 4;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ang) * 18, cy + Math.sin(ang) * 18, 3, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(205,236,250,0.75)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, 18, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 7, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  settingsButtonRect() {
    // Portrait: small icon stacked on the left, under the score cluster. Kept in
    // the left gutter (right edge ~494 < bottleLeft 512) so it clears the bottle.
    if (this.app.portrait) return { x: 434, y: 188, w: 60, h: 56 };
    return { x: 24, y: 22, w: 78, h: 66 };
  }
  rankPanelRect() {
    // Portrait: leaderboard icon below the gear on the left (same left gutter).
    if (this.app.portrait) return { x: 434, y: 258, w: 60, h: 56 };
    return { x: 54, y: 438, w: 426, h: 326 };
  }

  drawRankPanel() {
    const ctx = this.ctx;
    const app = this.app;
    const r = this.rankPanelRect();
    if (app.portrait) {
      // Leaderboard as a small left-side icon (podium), matching the gear's
      // chrome; tap opens the TOP-50 modal (rankPanelRect is the hit area).
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      ctx.save();
      ctx.fillStyle = "rgba(8,28,54,0.47)";
      this.roundRect(r.x, r.y, r.w, r.h, 10); ctx.fill();
      ctx.strokeStyle = "rgba(154,222,248,0.46)"; ctx.lineWidth = 1;
      this.roundRect(r.x, r.y, r.w, r.h, 10); ctx.stroke();
      // three rounded bars on a shared baseline, center tallest (1st place gold)
      const bw = 8, gap = 3, baseY = cy + 12;
      const bars = [
        [cx - bw - gap, 14, "rgba(190,226,246,0.82)"], // 2nd place (left)
        [cx, 22, "rgba(232,218,130,0.95)"],            // 1st place (center)
        [cx + bw + gap, 10, "rgba(190,226,246,0.82)"], // 3rd place (right)
      ];
      for (const [bx, bh, col] of bars) {
        ctx.fillStyle = col;
        this.roundRect(bx - bw / 2, baseY - bh, bw, bh, 2);
        ctx.fill();
      }
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.fillStyle = "rgba(9,28,54,0.48)";
    this.roundRect(r.x, r.y, r.w, r.h, 5); ctx.fill();
    ctx.strokeStyle = "rgba(18,55,84,0.16)"; ctx.lineWidth = 1;
    this.roundRect(r.x, r.y, r.w, r.h, 5); ctx.stroke();
    ctx.strokeStyle = "rgba(150,210,245,0.36)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(r.x + 12, r.y + 64); ctx.lineTo(r.x + r.w - 20, r.y + 64); ctx.stroke();
    ctx.restore();

    this.text("排行榜", r.x + 14, r.y + 44, { size: 32, color: "#c6e6fa", glow: "rgba(45,150,210,0.7)" });
    this.text("全服", r.x + r.w - 92, r.y + 44, { size: 30, color: "#c6e6fa", align: "left" });

    const rows = app.leaderboardTop3 || [];
    const status = app.leaderboardStatus || "";
    if (!rows.length) {
      this.text(status || "暂无排行", r.x + r.w / 2, r.y + 172, { size: 25, align: "center", color: "#cce1f0" });
    }
    rows.slice(0, 3).forEach((row, i) => {
      const top = r.y + 82 + i * 66;
      ctx.save();
      ctx.fillStyle = "rgba(25,58,86,0.32)";
      this.roundRect(r.x + 30, top - 8, r.w - 44, 46, 4); ctx.fill();
      ctx.restore();
      this.drawRankBadge(row.rank || (i + 1), r.x + 58, top + 14, 46);
      this.text(this.ellipsize(row.nickname || DEFAULT_NICKNAME, 9), r.x + 104, top + 18, { size: 25, color: "#cce1f0" });
      this.text(String(row.score || 0), r.x + r.w - 38, top + 18, { size: 25, color: "#d7d480", align: "right" });
    });

    const best = Math.max(0, (app.save && app.save.best_score) || 0);
    const bestY = r.y + 278;
    ctx.save();
    ctx.strokeStyle = "rgba(154,208,232,0.18)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(r.x + 34, bestY - 20); ctx.lineTo(r.x + r.w - 34, bestY - 20); ctx.stroke();
    ctx.restore();
    this.text("我的最佳得分", r.x + 56, bestY + 8, { size: 25, color: "#e6da82" });
    this.text(String(best), r.x + r.w - 44, bestY + 8, { size: 25, color: "#e6da82", align: "right" });
  }

  drawRankBadge(rank, cx, cy, size) {
    const ctx = this.ctx;
    const palette = {
      1: ["#e2b246", "#ffde6e", "#4a3418"],
      2: ["#becad7", "#e8f0f8", "#343c48"],
      3: ["#c5844e", "#eca660", "#3a2a23"],
    };
    const [base, rim, textColor] = palette[rank] || palette[3];
    ctx.save();
    ctx.fillStyle = base;
    ctx.beginPath(); ctx.ellipse(cx, cy, size / 2, size / 2, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = rim; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(cx, cy, size / 2 - 3, size / 2 - 3, 0, 0, TAU); ctx.stroke();
    ctx.restore();
    this.text(String(rank), cx, cy + 8, { size: 22, align: "center", color: textColor });
  }

  drawNextAndRoad() {
    const g = this.app.game;
    if (this.app.portrait) {
      // Top-right "next" preview (mirrors the score on the left); 水母图鉴 cropped.
      const cx = 1100;
      this.text("下一个", cx, 46, { size: 24, align: "center", color: "#fcfdff", tracking: 1, shadow: "rgba(9,27,48,0.4)" });
      if (g.nextLevel) {
        const [nw, nh] = g.visualSizeForLevel(g.nextLevel);
        const ratio = Math.min(1, 54 / Math.max(nw, nh)); // cap preview to ~54px
        this.drawJellyVisual(g.nextLevel, cx, 104, nw * ratio, nh * ratio, { alpha: 245, phaseTime: nowSeconds() });
      }
      return;
    }
    this.text("下一个", 1226, 70, { size: 36, align: "center", color: "#fcfdff", tracking: 2, shadow: "rgba(9,27,48,0.4)" });
    if (g.nextLevel) {
      const [nw, nh] = g.visualSizeForLevel(g.nextLevel);
      this.drawJellyVisual(g.nextLevel, 1236, 158, nw, nh, { alpha: 245, phaseTime: nowSeconds() });
    }
    this.text("水母图鉴", 1458, 70, { size: 36, align: "center", color: "#fcfdff", tracking: 1, shadow: "rgba(9,27,48,0.4)" });

    const nodes = [
      [1, 1450, 132, 34, 236], [2, 1512, 194, 48, 232], [3, 1450, 258, 54, 236],
      [4, 1516, 328, 62, 236], [5, 1440, 398, 68, 238], [6, 1512, 474, 74, 238],
      [7, 1434, 552, 84, 240], [8, 1518, 632, 86, 240], [9, 1420, 708, 92, 242],
      [10, 1518, 774, 98, 242], [11, 1418, 842, 108, 242],
    ];
    const line = this.app.assets.ui.img_line_1;
    const ctx = this.ctx;
    if (line) {
      ctx.save(); ctx.globalAlpha = 112 / 255; ctx.drawImage(line, 1344, 116, 194, 742); ctx.restore();
    }
    ctx.save();
    ctx.strokeStyle = "rgba(162,224,242,0.2)"; ctx.lineWidth = 1;
    ctx.beginPath();
    nodes.forEach(([, px, py], i) => { i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); });
    ctx.stroke();
    ctx.restore();
    for (const [level, px, py, diameter, alpha] of nodes) {
      const [bw, bh] = g.visualSizeForLevel(level);
      const ratio = diameter / Math.max(bw, bh);
      this.drawJellyVisual(level, px, py, bw * ratio, bh * ratio, { alpha, phaseTime: nowSeconds() + level });
    }
  }

  // ---------- helpers ----------
  roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  ellipsize(text, maxChars) {
    const arr = Array.from(text || "");
    if (arr.length <= maxChars) return text;
    return arr.slice(0, maxChars - 1).join("") + "…";
  }
}
