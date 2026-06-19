// Small helpers ported from main.py utility functions.

export const TAU = Math.PI * 2;

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// pygame ease_smooth: smoothstep
export function easeSmooth(t) {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

// monotonic seconds, matches Python time.time() usage as a relative clock
export function nowSeconds() {
  return performance.now() / 1000;
}

// inclusive integer in [lo, hi], like random.randint
export function randInt(lo, hi) {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

export function randRange(lo, hi) {
  return lo + Math.random() * (hi - lo);
}

export class SeededRng {
  constructor(seed) {
    const text = String(seed == null ? "" : seed);
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    if (!h) h = 0x9e3779b9;
    this.state = h >>> 0;
  }

  next() {
    let x = this.state >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return (this.state >>> 0) / 4294967296;
  }

  int(lo, hi) {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
}

export function uuid() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  // RFC4122-ish fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function sanitizeNickname(value, maxChars, fallback) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return fallback;
  return Array.from(text).slice(0, maxChars).join("");
}

// Triangular bubble float used by the score bubble (matches main.py period 2.667s)
export function scoreBubbleFloatOffset(now) {
  const duration = 2.6666667461395264;
  const half = duration / 2;
  const phase = ((now % duration) + duration) % duration;
  let t;
  if (phase <= half) t = phase / half;
  else t = 1 - (phase - half) / half;
  const eased = 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
  return 4.9 * 1.4 * eased;
}
