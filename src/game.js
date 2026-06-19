// Core game state machine, ported from merge_jellyfish_windows/main.py.
// Rendering and DOM UI live in render.js / ui.js; this module owns gameplay
// state, physics integration, merging, scoring and fail logic.

import {
  LEVEL_SIZES, SCORE_BY_LEVEL, MAX_LEVEL, RANDOM_MIN, RANDOM_MAX,
  BOTTLE_LEFT, BOTTLE_RIGHT, BOTTLE_TOP, BOTTLE_BOTTOM,
  OFFICIAL_P_AREA_HEIGHT, OFFICIAL_BOTTLE_BOUNDING_HEIGHT, OFFICIAL_FAIL_EXTRA_HEIGHT,
  IMMEDIATE_OVER_HEIGHT_OFFSET, CHECK_OVER_HEIGHT_TIME,
  MERGE_DURATION, SPAWN_ANIM_DURATION,
  CLAMP_OUT_DURATION, CLAMP_NEXT_DELAY, CLAMP_HELD_Y, CLAMP_HELD_OFFSET_BY_LEVEL,
  OFFICIAL_VISUAL_OFFSETS, OFFICIAL_VISUAL_SCALES, CLAMP_PREPARE_SCALE,
} from "./constants.js";
import { clamp, nowSeconds, SeededRng, TAU } from "./util.js";
import { Physics, physicsSizeForLevel, isCircleLevel } from "./physics.js";

const M = globalThis.Matter || (globalThis.window && globalThis.window.Matter);

export class Game {
  constructor(env = {}) {
    this.audio = env.audio || { play() {}, buffers: {} };
    if (!this.audio.buffers) this.audio.buffers = {};
    this.onFinish = env.onFinish || (() => {});
    this.seed = env.seed || String(Date.now());
    this.rng = new SeededRng(this.seed);
    this.physics = new Physics({ rng: () => this.rand() });

    // bottle geometry (design coords)
    this.bottleLeft = BOTTLE_LEFT;
    this.bottleRight = BOTTLE_RIGHT;
    this.bottleTop = BOTTLE_TOP;
    this.bottleBottom = BOTTLE_BOTTOM;
    this.failLineY = this.officialFailLineY();

    this.clampX = (this.bottleLeft + this.bottleRight) / 2;
    this.input = { pointerX: null, pointerActive: false, left: false, right: false };
    this.aiming = false;
    this.aimStartedAt = 0;

    this.targetFps = env.fps === 120 ? 120 : 60;
    this.physicsAccumulator = 0;
    this.simFrame = 0;
    this.simTime = 0;
    this.recordActions = env.recordActions !== false;
    this.actions = [];
    this.scoreEvents = [];
    this.itemSeq = 0;
    this.eventSeq = 0;
    this.rankedGameId = env.gameId || null;

    this.reset();
  }

  rand() { return this.rng.next(); }
  randInt(lo, hi) { return this.rng.int(lo, hi); }

  // ---- geometry ----
  bottleInnerBottom() { return this.bottleBottom - 10; }
  officialPAreaScale() { return (this.bottleInnerBottom() - this.bottleTop) / OFFICIAL_P_AREA_HEIGHT; }
  officialHeightToScreen(h) { return h * this.officialPAreaScale(); }
  officialFailLineY() { return this.bottleTop - this.officialHeightToScreen(OFFICIAL_FAIL_EXTRA_HEIGHT); }

  physicsSizeForLevel(level) { return physicsSizeForLevel(level); }
  visualSizeForLevel(level) { const [w, h] = LEVEL_SIZES[level]; return [w, h]; }
  prepareVisualSizeForLevel(level) {
    const [w, h] = this.visualSizeForLevel(level);
    return [w * CLAMP_PREPARE_SCALE, h * CLAMP_PREPARE_SCALE];
  }
  visualAdjustmentForLevel(level) {
    const off = OFFICIAL_VISUAL_OFFSETS[level] || [0, 0];
    return [off[0], off[1], OFFICIAL_VISUAL_SCALES[level] || 1.0];
  }
  isCircleLevel(level) { return isCircleLevel(level); }

  radiusForLevel(level) {
    const [w, h] = this.physicsSizeForLevel(level);
    return Math.max(w, h) / 2;
  }

  heldJellyPos(level, x) {
    const px = x == null ? this.clampX : x;
    return [px, CLAMP_HELD_Y + (CLAMP_HELD_OFFSET_BY_LEVEL[level] || 0)];
  }

  activeClampLimitLevel() {
    return this.pendingLevel || this.releaseLevel || this.nextLevel || RANDOM_MIN;
  }

  setTargetFps(fps) {
    this.targetFps = fps;
    this.physics.setFps(fps);
  }

  // ---- lifecycle ----
  reset() {
    this.rng = new SeededRng(this.seed);
    this.physics.rng = () => this.rand();
    this.physics.setFps(this.targetFps);
    const innerBottom = this.bottleInnerBottom();
    let maxRadius = 0;
    for (const lvl of Object.keys(LEVEL_SIZES)) {
      const [w, h] = this.physicsSizeForLevel(+lvl);
      maxRadius = Math.max(maxRadius, Math.max(w, h) / 2);
    }
    const guard = maxRadius + 80;
    const geom = {
      left: this.bottleLeft,
      right: this.bottleRight,
      floorY: innerBottom - 4,
      topY: innerBottom - this.officialHeightToScreen(OFFICIAL_BOTTLE_BOUNDING_HEIGHT),
      guard,
      bottomGuardY: innerBottom + guard,
    };
    this.physics.reset(geom);
    this.physics.onCollision((bA, bB) => this._dispatchCollision(bA, bB));

    this.items = [];
    this.mergeAnimations = [];
    this.score = 0;
    this.maxLevel = 1;
    this.failTimer = 0;
    this.warnActive = false;
    this.gameOver = false;
    this.curDropCount = 0;
    this.pendingLevel = null;
    this.nextLevel = null;
    this.releaseLevel = null;
    this.releaseStarted = 0;
    this.prepareNextAt = null;
    this.physicsAccumulator = 0;
    this.simFrame = 0;
    this.simTime = 0;
    this.actions = [];
    this.scoreEvents = [];
    this.itemSeq = 0;
    this.eventSeq = 0;
    this.cancelAim();
    this.prepareNextJellyfish();
  }

  // ---- generation ----
  randomLevel() { return this.randInt(RANDOM_MIN, RANDOM_MAX); }

  genNextJellyfishLevel() {
    if (this.nextLevel != null) {
      this.pendingLevel = this.nextLevel;
      this.nextLevel = null;
    } else {
      this.pendingLevel = this.randomLevel();
    }
    if (this.nextLevel == null) this.nextLevel = this.randomLevel();
  }

  prepareNextJellyfish() { this.genNextJellyfishLevel(); }

  canStartAim() {
    return !this.gameOver
      && this.releaseLevel == null
      && this.prepareNextAt == null
      && this.pendingLevel != null;
  }

  isDropStartInsideBottle(x) {
    return x >= this.bottleLeft && x <= this.bottleRight;
  }

  startAim(x) {
    if (!this.canStartAim() || !this.isDropStartInsideBottle(x)) return;
    const [width] = this.physicsSizeForLevel(this.activeClampLimitLevel());
    this.clampX = clamp(x, this.bottleLeft + width / 2 + 8, this.bottleRight - width / 2 - 8);
    this.input.pointerX = this.clampX;
    this.input.pointerActive = true;
    this.aiming = true;
    this.aimStartedAt = nowSeconds();
  }

  cancelAim() {
    this.aiming = false;
    this.aimStartedAt = 0;
  }

  releaseAim() {
    if (!this.aiming) return;
    this.cancelAim();
    this.drop();
  }

  // ---- items ----
  addItem(level, x, y, { wake = false, animIn = false } = {}) {
    const [width, height] = this.physicsSizeForLevel(level);
    const radius = Math.max(width, height) / 2;
    const body = this.physics.addJelly(level, x, y, { wake });
    const now = nowSeconds();
    const id = ++this.itemSeq;
    const jelly = {
      id, level, body, radius, width, height, born: now,
      in_drop: wake, has_contact: false, merging: false,
      merge_started: null, merge_from: null, merge_to: null,
      loop_phase: this.rand() * TAU,
      spawn_from: null,
      tag: wake ? "start_drop" : "none",
      anim_in_until: animIn ? now + SPAWN_ANIM_DURATION : 0,
      show_rate: animIn ? 0.2 : 1.0,
      floor_tip_done: false, floor_tip_direction: 0, floor_tip_frames: 0,
    };
    body.jellyRef = jelly;
    if (animIn) this.physics.scaleBody(body, 0.2); // collider grows over SPAWN_ANIM_DURATION
    this.items.push(jelly);
    this.maxLevel = Math.max(this.maxLevel, level);
    return jelly;
  }

  removeItem(jelly) {
    const idx = this.items.indexOf(jelly);
    if (idx >= 0) this.items.splice(idx, 1);
    this.physics.remove(jelly.body);
  }

  // ---- drop ----
  drop() {
    if (this.gameOver) return false;
    if (this.releaseLevel != null || this.prepareNextAt != null) return false;
    if (this.pendingLevel == null) this.prepareNextJellyfish();
    if (this.pendingLevel == null) return false;
    const level = this.pendingLevel;
    const [width] = this.physicsSizeForLevel(level);
    const x = Math.round(clamp(this.clampX, this.bottleLeft + width / 2 + 8, this.bottleRight - width / 2 - 8) * 1000) / 1000;
    const now = nowSeconds();
    const [, dropY] = this.heldJellyPos(level, x);
    const item = this.addItem(level, x, dropY, { wake: true, animIn: false });
    item.spawn_from = this.heldJellyPos(level, x);
    this.releaseLevel = level;
    this.releaseStarted = now;
    this.prepareNextAt = now + CLAMP_NEXT_DELAY;
    this.pendingLevel = null;
    this.cancelAim();
    if (this.recordActions) {
      this.actions.push({
        event_seq: ++this.eventSeq,
        seq: this.curDropCount + 1,
        frame: this.simFrame,
        item_id: item.id,
        level,
        x,
      });
    }
    this.curDropCount += 1;
    this.audio.play("drop");
    return true;
  }

  // ---- collision dispatch ----
  _dispatchCollision(bA, bB) {
    const ja = bA.jellyRef;
    const jb = bB.jellyRef;
    if (ja && jb) {
      this.onJellyContact(ja, jb);
    } else if (ja && bB.label === "wall") {
      this.onJellyBottle(ja);
    } else if (jb && bA.label === "wall") {
      this.onJellyBottle(jb);
    }
  }

  markContact(item) {
    if (!item) return;
    item.has_contact = true;
    item.in_drop = false;
    if (item.tag === "start_drop") item.tag = "contact";
  }

  onJellyContact(a, b) {
    if (a === b) return;
    const hasAllContact = !(a.in_drop || b.in_drop);
    this.markContact(a);
    this.markContact(b);
    if (!this.queueMerge(a, b) && !hasAllContact) this.audio.play("contact");
  }

  onJellyBottle(item) {
    const hasAllContact = !item.in_drop;
    this.markContact(item);
    if (!hasAllContact) this.audio.play("contact");
  }

  // ---- merging ----
  canMerge(a, b) {
    if (this.gameOver || !a || !b) return false;
    if (this.items.indexOf(a) < 0 || this.items.indexOf(b) < 0) return false;
    if (a.merging || b.merging) return false;
    if (a.level !== b.level || a.level >= MAX_LEVEL) return false;
    const now = nowSeconds();
    if (now < a.anim_in_until || now < b.anim_in_until) return false;
    if (!LEVEL_SIZES[a.level + 1]) return false;
    if (a.body.isStatic || b.body.isStatic) return false;
    return true;
  }

  mergeTargetPos(a, b) {
    const ay = a.body.position.y, by = b.body.position.y;
    const ax = a.body.position.x, bx = b.body.position.x;
    if (Math.abs(ay - by) > 20) {
      const lower = ay > by ? a : b;
      return [lower.body.position.x, lower.body.position.y];
    }
    return [(ax + bx) / 2, (ay + by) / 2];
  }

  queueMerge(a, b) {
    if (!this.canMerge(a, b)) return false;
    const now = nowSeconds();
    const toPos = this.mergeTargetPos(a, b);
    a.merging = b.merging = true;
    for (const item of [a, b]) {
      item.merge_started = now;
      item.merge_from = [item.body.position.x, item.body.position.y];
      item.merge_to = toPos;
      M.Body.setVelocity(item.body, { x: 0, y: 0 });
      M.Body.setAngularVelocity(item.body, 0);
      this.physics.setSensor(item.body, true);
    }
    this.mergeAnimations.push([a, b, toPos]);
    return true;
  }

  mergeItems(a, b, toPos, queued = false) {
    if (!queued && !this.canMerge(a, b)) return;
    const level = a.level + 1;
    if (!toPos) toPos = this.mergeTargetPos(a, b);
    const [x, y] = toPos;
    this.removeItem(a);
    this.removeItem(b);
    const merged = this.addItem(level, x, y, { animIn: true });
    M.Body.setVelocity(merged.body, { x: 0, y: 0 });
    M.Body.setAngularVelocity(merged.body, 0);
    const scoreDelta = SCORE_BY_LEVEL[level] || 0;
    this.score += scoreDelta;
    this.maxLevel = Math.max(this.maxLevel, level);
    if (this.recordActions) {
      this.scoreEvents.push({
        event_seq: ++this.eventSeq,
        seq: this.scoreEvents.length + 1,
        frame: this.simFrame,
        a: a.id,
        b: b.id,
        from_level: a.level,
        to_level: level,
        new_id: merged.id,
        score_delta: scoreDelta,
      });
    }
    const alias = this.audio.buffers[`merge_${level}`] ? `merge_${level}` : "merge_10";
    this.audio.play(alias);
  }

  updateMergeAnimations() {
    if (!this.mergeAnimations.length) return;
    const now = nowSeconds();
    const pending = [];
    for (const tuple of this.mergeAnimations) {
      const [a, b, toPos] = tuple;
      if (this.items.indexOf(a) < 0 || this.items.indexOf(b) < 0) continue;
      if (a.level !== b.level || a.level >= MAX_LEVEL) continue;
      const start = a.merge_started || now;
      if (now - start >= MERGE_DURATION) {
        // Resolve one completed merge per call (Python returns here; the now-dead
        // tuple references removed items and is skipped/self-cleaned next full pass).
        this.mergeItems(a, b, toPos, true);
        return;
      }
      pending.push(tuple);
    }
    this.mergeAnimations = pending;
  }

  // ---- spawn-in collider grow (mirrors update_anim_in_fixtures) ----
  updateAnimInFixtures() {
    const now = nowSeconds();
    for (const item of this.items) {
      if (item.anim_in_until <= 0) continue;
      const start = item.anim_in_until - SPAWN_ANIM_DURATION;
      const done = now >= item.anim_in_until;
      let rate = done ? 1.0 : clamp((now - start) / SPAWN_ANIM_DURATION, 0.2, 1.0);
      if (item.show_rate == null) item.show_rate = 1.0;
      if (Math.abs(rate - item.show_rate) > 1e-4) {
        this.physics.scaleBody(item.body, rate / item.show_rate);
        item.show_rate = rate;
      }
      if (done) item.anim_in_until = 0;
    }
  }

  // ---- level-2 floor tip (elongated jelly can stand up on the floor) ----
  updateFloorTips() {
    for (const item of this.items) this.maybeTipLevel2OnFloor(item);
  }

  maybeTipLevel2OnFloor(item) {
    if (item.level !== 2 || item.floor_tip_done || item.merging || item.in_drop) return;
    const floorY = this.bottleInnerBottom() - 4;
    const body = item.body;
    if (body.position.y < floorY - Math.max(item.width, item.height) * 0.72) return;
    const verticalSpeed = Math.abs(body.velocity.y * this.targetFps);
    if (verticalSpeed > 260 && item.floor_tip_direction === 0) return;

    const lean = Math.abs(Math.sin(body.angle));
    if (item.floor_tip_direction === 0 && (verticalSpeed > 120 || lean > 0.35)) return;
    if (item.floor_tip_direction === 0) {
      const angleHint = Math.sin(body.angle);
      const angularHint = this.physics.getAngularVelocityRadPerSec(body);
      if (Math.abs(angleHint) > 0.08) item.floor_tip_direction = Math.sign(angleHint);
      else if (Math.abs(angularHint) > 0.05) item.floor_tip_direction = Math.sign(angularHint);
      else item.floor_tip_direction = body.position.x > (this.bottleLeft + this.bottleRight) * 0.5 ? -1 : 1;
      item.floor_tip_frames = 0;
    }

    const direction = item.floor_tip_direction || 1;
    item.floor_tip_frames += 1;
    const maxNudgeFrames = Math.max(1, Math.round(this.targetFps * 0.55));
    const maxObserveFrames = Math.max(1, Math.round(this.targetFps * 1.2));
    if (lean >= 0.88 || item.floor_tip_frames > maxObserveFrames) {
      item.floor_tip_done = true;
      return;
    }
    if (item.floor_tip_frames <= maxNudgeFrames && lean < 0.78) {
      const curAngularVelocity = this.physics.getAngularVelocityRadPerSec(body);
      const targetAngularVelocity = direction * (1.2 + (1 - lean) * 0.65);
      if (Math.abs(curAngularVelocity) < Math.abs(targetAngularVelocity)) {
        this.physics.setAngularVelocityRadPerSec(body, targetAngularVelocity);
      }
    }

    const minCenterY = floorY - item.width * 0.5 - 1;
    if (body.position.y > minCenterY) M.Body.setPosition(body, { x: body.position.x, y: minCenterY });
  }

  // ---- fail logic ----
  isItemOverHeight(item, offsetHeight = 0) {
    if (item.in_drop || item.merging) return false;
    const top = item.body.position.y - (item.width + item.height) / 4;
    const judgeY = this.failLineY - this.officialHeightToScreen(offsetHeight);
    return top < judgeY;
  }

  checkCanGameFinished(offsetHeight = 0) {
    return this.items.some((it) => this.isItemOverHeight(it, offsetHeight));
  }

  updateFail(dt) {
    if (this.gameOver) return;
    if (this.checkCanGameFinished(IMMEDIATE_OVER_HEIGHT_OFFSET)) { this.finish(); return; }
    if (this.checkCanGameFinished()) {
      if (!this.warnActive) { this.audio.play("warn"); this.warnActive = true; }
      this.failTimer += dt;
      if (this.failTimer >= CHECK_OVER_HEIGHT_TIME) this.finish();
    } else {
      this.failTimer = 0;
      this.warnActive = false;
    }
  }

  finish() {
    this.gameOver = true;
    this.audio.play("over");
    this.onFinish(Math.floor(this.score), Math.floor(this.maxLevel), this.simFrame);
  }

  // ---- per-frame update ----
  update(dt) {
    if (this.gameOver) return;
    const now = nowSeconds();
    if (this.pendingLevel == null && this.prepareNextAt != null && now >= this.prepareNextAt) {
      this.prepareNextAt = null;
      this.releaseLevel = null;
      this.prepareNextJellyfish();
    } else if (this.releaseLevel != null && now - this.releaseStarted > CLAMP_OUT_DURATION) {
      this.releaseLevel = null;
    }

    // clamp control
    const speed = 520;
    if (this.input.left) this.clampX -= speed * dt;
    if (this.input.right) this.clampX += speed * dt;
    if (this.input.pointerActive && this.input.pointerX != null) this.clampX = this.input.pointerX;
    const [pendingW] = this.physicsSizeForLevel(this.activeClampLimitLevel());
    this.clampX = clamp(this.clampX, this.bottleLeft + pendingW / 2 + 8, this.bottleRight - pendingW / 2 - 8);

    // grow freshly-merged colliders (once per frame, like update_anim_in_fixtures)
    this.updateAnimInFixtures();

    // fixed-step physics
    const step = 1 / this.targetFps;
    this.physicsAccumulator = Math.min(this.physicsAccumulator + dt, step * 4);
    while (this.physicsAccumulator >= step) {
      this.updateFloorTips();
      this.physics.step();
      this.physicsAccumulator -= step;
      this.simFrame += 1;
      this.simTime = this.simFrame / this.targetFps;
    }
    this.updateMergeAnimations();
    this.updateMergeAnimations();
    this.updateFail(dt);
  }

}
