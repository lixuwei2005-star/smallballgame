// Ported game constants from merge_jellyfish_windows/config.json and main.py.
// The canvas renders in the native 1600x900 design space (scale = 1), so the
// Python X()/Y()/S() helpers collapse to identity and values are used directly.

export const DESIGN_W = 1600;
export const DESIGN_H = 900;

export const TITLE = "暗海探秘";
export const MAX_LEVEL = 11;

// config.json: level_sizes
export const LEVEL_SIZES = {
  1: [30, 30],
  2: [35, 58],
  3: [64, 64],
  4: [78, 78],
  5: [92, 92],
  6: [111, 111],
  7: [150, 121],
  8: [170, 180],
  9: [205, 218],
  10: [235, 235],
  11: [258, 258],
};

// config.json: score_by_level (geometric 2x fallback for the retired scores table)
export const SCORE_BY_LEVEL = {
  2: 2, 3: 4, 4: 8, 5: 16, 6: 32, 7: 64, 8: 128, 9: 256, 10: 512, 11: 1024,
};

export const RANDOM_MIN = 1;
export const RANDOM_MAX = 5;

export const DEFAULT_BEST_SCORE = 4955;

// Fail / over-height judging
export const CHECK_OVER_HEIGHT_TIME = 3.0;
export const IMMEDIATE_OVER_HEIGHT_OFFSET = 120;
export const OFFICIAL_P_AREA_HEIGHT = 580.0;
export const OFFICIAL_BOTTLE_BOUNDING_HEIGHT = 1000.0;
export const OFFICIAL_FAIL_EXTRA_HEIGHT = 20.0;

// Physics
export const GRAVITY = 1280;                 // px/s^2 (SS = 1)
export const OFFICIAL_BOUND_SCALE = 1.0 / 1.1;
export const PHYSICS_DENSITY = 1.0;

// Shell-alpha-driven collision calibration (matches Windows build_collision_sizes):
//   collision = max(visual/1.1, min(visual*0.96, shellAlphaBound))  per axis.
// SHELL_COLLISION_BOUNDS holds the alpha>=4 bounding box (in visual px) of each
// level's shell.png, precomputed by tools/compute_collision_bounds.py so it is
// available at startup (animation shells lazy-load). null = no usable shell
// (e.g. L2 has an empty alpha>=4 bbox) -> fall back to the visual/1.1 base.
export const JELLY_COLLISION_ALPHA = 4;
export const JELLY_COLLISION_MAX_SCALE = 0.96;
export const SHELL_COLLISION_BOUNDS = {
  1: [30, 30], 2: null, 3: [64, 63], 4: [75, 77], 5: [90, 90],
  6: [109, 111], 7: [148, 117], 8: [169, 168], 9: [205, 205],
  10: [231, 231], 11: [258, 258],
};
export const PHYSICS_STEP_RATE_DEFAULT = 60;
export const SEGMENTS_COUNT = 12;

// Animations / timings
export const MERGE_DURATION = 0.2;
export const SPAWN_ANIM_DURATION = 0.2;

// Clamp (claw) — values from config.json
export const CLAMP_OUT_DURATION = 0.5;
export const CLAMP_NEXT_DELAY = 0.5;
export const CLAMP_SPINE_SCALE = 1.25;
export const CLAMP_ANCHOR_Y = -28;           // config.json clamp_anchor_y
export const CLAMP_HELD_Y = 118;             // config.json clamp_held_y
export const CLAMP_PART_ALPHA = 222;
export const CLAMP_PREPARE_SCALE = 1.0;
export const CLAMP_GRIP_GAP_RATIO = 0.92;
export const CLAMP_GRIP_MAX_SHIFT = 60;
export const CLAMP_GRIP_RATIO_BY_LEVEL = { 1: 0.35, 2: 0.45, 3: 0.78, 4: 0.9 };
export const CLAMP_HELD_OFFSET_BY_LEVEL = { 1: 22, 2: 20, 3: 14, 4: 14 };
export const AIM_GUIDE_DELAY = 0.12;
export const AIM_GUIDE_ALPHA = 108;

// Visual tweaks for the elongated level-2 jelly
export const OFFICIAL_VISUAL_OFFSETS = { 2: [1.5, -3.6] };
export const OFFICIAL_VISUAL_SCALES = { 2: 1.03 };

// Inner-body procedural motion (matches INNER_MOTION_BY_LEVEL in main.py)
export const INNER_MOTION_BY_LEVEL = {
  9: { duration_scale: 0.58, scale_amp: 0.045, x_amp: 0.019, y_amp: 0.014, rot_amp: 3.0 },
};

// Bottle geometry (design coords)
export const BOTTLE_LEFT = 512;
export const BOTTLE_RIGHT = 1130;
export const BOTTLE_TOP = 152;
export const BOTTLE_BOTTOM = 858;
export const JELLY_CLIP_BLEED_X = 40.0;

// Audio defaults
export const DEFAULT_MUSIC_VOLUME = 0.55;
export const DEFAULT_SFX_VOLUME = 1.0;

// Identity / leaderboard
export const DEFAULT_NICKNAME = "匿名用户";
export const MAX_NICKNAME_CHARS = 12;
export const FPS_OPTIONS = [60, 120];

// Background tone overlay (48,150,174, alpha 112/255)
export const SEA_TONE = "rgba(48,150,174,0.439)";

// Wave loop fps the Python uses for procedural shimmer reference
export const BG2_LOOP_FPS = 10;
export const WAVE_LOOP_FPS = 9;
