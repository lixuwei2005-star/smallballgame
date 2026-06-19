// Physics wrapper around Matter.js, tuned to reproduce the pymunk feel of the
// Windows rebuild (gravity 1280 px/s^2, near-zero restitution, friction 0.3-0.4,
// only a small frictionAir for stack stability). Jellies are circles, except the
// elongated levels 2 and 7 which use a 12-gon ellipse like the official p_area
// fixtures. Merged jellies spawn with a tiny collider that grows over
// SPAWN_ANIM_DURATION (see scaleBody) to avoid overlap "pop", mirroring pymunk's
// unsafe_set_radius / unsafe_set_vertices spawn-in.

import {
  GRAVITY, LEVEL_SIZES, OFFICIAL_BOUND_SCALE, SEGMENTS_COUNT,
  SHELL_COLLISION_BOUNDS, JELLY_COLLISION_MAX_SCALE,
} from "./constants.js";
import { TAU } from "./util.js";

const M = globalThis.Matter || (globalThis.window && globalThis.window.Matter);

// Matter applies accel = gravity.y * gravity.scale (px per ms^2). With the
// default scale 0.001, gravity.y = 1280 / 1e6 / 0.001 = 1.28 => 1280 px/s^2.
const GRAVITY_SCALE = 0.001;

// Matter's setVelocity / setAngularVelocity are expressed in units of "per
// _baseDelta" (1/60 s), independent of the actual step size. To map pymunk's
// px/s and rad/s onto Matter we multiply by SEC = baseDelta in seconds = 1/60.
// MEASURED in-engine: setVelocity(1) => 60 px/s, and setVelocity(20*SEC) => 20
// px/s at BOTH 60 and 120 fps. Using a FIXED 1/60 here (not 1/targetFps) keeps
// the launch nudge and spin identical across frame rates — the previous code
// used 1/targetFps which halved them at 120 fps.
const SEC = 1 / 60;

// pymunk Segment walls carry a 2px radius, so their inner collision surface sits
// 2px inside the segment line. We inset Matter's (thick, anti-tunnel) wall faces
// by the same amount so the playable boundary matches the Windows build exactly.
const WALL_RADIUS = 2;

// Jelly material, matched to pymunk (elasticity 0, friction 0.3, mass ~ area via
// uniform density). space.damping is 1.0 in pymunk (NO global damping); Matter
// has no global-damping knob and we cannot enable sleeping (gated re-merges need
// collisionActive every frame), so frictionAir is kept as small as possible
// while still settling residual stack jitter. frictionStatic is kept modest so
// jellies do not "stick" when nearly stationary (pymunk has no static-friction
// boost).
const BODY_OPTS = {
  restitution: 0.0,
  friction: 0.3,
  frictionStatic: 0.35,
  frictionAir: 0.001,
  density: 0.001,
  slop: 0.04,
};

export function isCircleLevel(level) {
  const [w, h] = LEVEL_SIZES[level];
  return Math.abs(w / h - 1) < 0.1;
}

// Collision bounding size, calibrated to the shell's alpha>=4 boundary (matches
// Windows build_collision_sizes): per axis, max(visual/1.1, min(visual*0.96,
// shellAlphaBound)). The 0.96 cap excludes the faint outer glow so jellies don't
// look overlapped; the visual/1.1 floor keeps them from looking gappy. Levels
// with no usable shell bound (e.g. L2) keep the visual/1.1 base.
export function physicsSizeForLevel(level) {
  const [w, h] = LEVEL_SIZES[level];
  let cw = w * OFFICIAL_BOUND_SCALE;
  let ch = h * OFFICIAL_BOUND_SCALE;
  const bound = SHELL_COLLISION_BOUNDS[level];
  if (bound) {
    const maxScale = Math.max(OFFICIAL_BOUND_SCALE, JELLY_COLLISION_MAX_SCALE); // 0.96
    cw = Math.max(cw, Math.min(w * maxScale, bound[0]));
    ch = Math.max(ch, Math.min(h * maxScale, bound[1]));
  }
  return [cw, ch];
}

function ellipseVerts(w, h) {
  const verts = [];
  for (let i = 0; i < SEGMENTS_COUNT; i++) {
    const a = (i * TAU) / SEGMENTS_COUNT;
    verts.push({ x: Math.cos(a) * w * 0.5, y: Math.sin(a) * h * 0.5 });
  }
  return verts;
}

export class Physics {
  constructor({ rng = Math.random } = {}) {
    this.engine = null;
    this.world = null;
    this.fps = 60;
    this._collisionCb = null;
    this.rng = rng;
  }

  setFps(fps) {
    this.fps = fps;
  }

  fixedDeltaMs() {
    return 1000 / this.fps;
  }

  reset(geom) {
    this.engine = M.Engine.create();
    this.world = this.engine.world;
    this.engine.gravity.scale = GRAVITY_SCALE;
    this.engine.gravity.y = (GRAVITY / 1e6) / GRAVITY_SCALE; // = 1.28
    this.engine.gravity.x = 0;
    // More position-correction iterations => stabler tall stacks.
    this.engine.positionIterations = 12;
    this.engine.velocityIterations = 10;
    this.engine.constraintIterations = 4;
    this._addWalls(geom);

    M.Events.on(this.engine, "collisionStart", (ev) => this._handlePairs(ev));
    M.Events.on(this.engine, "collisionActive", (ev) => this._handlePairs(ev));
  }

  _handlePairs(ev) {
    if (!this._collisionCb) return;
    for (const pair of ev.pairs) {
      this._collisionCb(pair.bodyA, pair.bodyB);
    }
  }

  onCollision(cb) {
    this._collisionCb = cb;
  }

  _addWalls(geom) {
    const { left, right, floorY, topY, guard } = geom;
    const TH = 80; // thick body for anti-tunneling; only the inner FACE collides
    const R = WALL_RADIUS; // match the pymunk segment-radius inset
    const innerLeft = left + R;    // a circle edge can reach exactly here
    const innerRight = right - R;
    const innerFloor = floorY - R;
    const innerTop = topY + R;
    const height = (geom.bottomGuardY - innerTop) + TH;
    const cy = (innerTop + geom.bottomGuardY) / 2;
    const walls = [
      // left wall — inner (right) face at innerLeft
      M.Bodies.rectangle(innerLeft - TH / 2, cy, TH, height, { isStatic: true }),
      // right wall — inner (left) face at innerRight
      M.Bodies.rectangle(innerRight + TH / 2, cy, TH, height, { isStatic: true }),
      // floor — top face at innerFloor
      M.Bodies.rectangle((left + right) / 2, innerFloor + TH / 2, right - left + guard * 2 + TH, TH, { isStatic: true }),
      // ceiling far above (matches pymunk top wall) — bottom face at innerTop
      M.Bodies.rectangle((left + right) / 2, innerTop - TH / 2, right - left + TH, TH, { isStatic: true }),
    ];
    for (const w of walls) {
      w.friction = 0.3;
      w.restitution = 0;
      w.label = "wall";
    }
    M.World.add(this.world, walls);
  }

  // ---- unit-correct velocity helpers ----
  // Matter velocities are "per baseDelta" (1/60 s); these accept/return px/s and
  // rad/s so the rest of the code can mirror pymunk's units directly.
  setVelocityPxPerSec(body, vx, vy) {
    M.Body.setVelocity(body, { x: vx * SEC, y: vy * SEC });
  }
  setAngularVelocityRadPerSec(body, w) {
    M.Body.setAngularVelocity(body, w * SEC);
  }
  getAngularVelocityRadPerSec(body) {
    return M.Body.getAngularVelocity(body) / SEC;
  }

  addJelly(level, x, y, { wake = false } = {}) {
    const [pw, ph] = physicsSizeForLevel(level);
    let body;
    if (isCircleLevel(level)) {
      body = M.Bodies.circle(x, y, Math.max(pw, ph) / 2, { ...BODY_OPTS });
    } else {
      const verts = ellipseVerts(pw, ph);
      body = M.Bodies.fromVertices(x, y, [verts], { ...BODY_OPTS }, true);
      // fromVertices recenters to centroid; force exact spawn position
      M.Body.setPosition(body, { x, y });
    }
    body.label = "jelly";
    if (wake) {
      // pymunk: body.velocity = (0, 20) px/s  (gentle launch nudge)
      this.setVelocityPxPerSec(body, 0, 20);
    }
    // pymunk: angular_velocity = randint(-10,10) * 0.05 * (width/100)^2  (rad/s)
    const rawW = LEVEL_SIZES[level][0];
    const spin = (Math.floor(this.rng() * 21) - 10) * 0.05 * Math.pow(rawW / 100, 2);
    this.setAngularVelocityRadPerSec(body, spin);
    M.World.add(this.world, body);
    return body;
  }

  setSensor(body, on) {
    body.isSensor = on;
    if (body.parts) {
      for (const p of body.parts) p.isSensor = on;
    }
  }

  // Cumulative scale of a body's collider about its own center. Used to grow a
  // freshly-spawned merged body from ~0.2 up to full size (the Matter analogue
  // of pymunk's unsafe_set_radius / unsafe_set_vertices). Body.scale also
  // recomputes mass/inertia from the new area, matching reset_item_mass_data.
  scaleBody(body, factor) {
    if (!(factor > 0) || Math.abs(factor - 1) < 1e-6) return;
    M.Body.scale(body, factor, factor);
  }

  remove(body) {
    M.World.remove(this.world, body);
  }

  step() {
    M.Engine.update(this.engine, this.fixedDeltaMs());
  }
}
