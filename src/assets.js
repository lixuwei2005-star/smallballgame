// Asset loader. Reads assets/manifest.json, loads the "critical" image set
// needed to start playing, then lazy-loads the heavier jelly animation sheets.

import { assetUrl, preloadAssetSignatures } from "./asset_auth.js";

async function loadImage(url) {
  const signedUrl = await assetUrl(url);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("img load failed: " + url));
    img.src = signedUrl;
  });
}

async function loadJSON(url) {
  const res = await fetch(await assetUrl(url), { cache: "force-cache" });
  if (!res.ok) throw new Error("json load failed: " + url);
  return res.json();
}

export class Assets {
  constructor() {
    this.manifest = null;
    this.sprites = {};        // level -> Image (static, trimmed)
    this.ui = {};             // name -> Image
    this.clamp = {};          // index -> Image
    this.clampSpine = null;   // parsed spine json
    this.particles = [];      // Image[]
    this.scoreBubble = null;  // Image
    this.bg = {};             // name -> Image
    this.bgElements = [];     // background plant element metadata
    this.anim = {};           // level -> {shell:Image, frames:Image, frame_w, frame_h, cols, rows, count, duration}
    this.animMeta = {};       // level -> manifest meta (without images), used before images load
  }

  async loadCritical(onProgress) {
    this.manifest = await loadJSON("manifest.json");
    const m = this.manifest;
    const tasks = [];
    const track = [];
    const push = (p, set) => {
      track.push(p.then((v) => { set(v); done++; report(); }).catch(() => { done++; report(); }));
      tasks.push(p);
    };
    let done = 0;
    let total = 0;
    const report = () => { if (onProgress) onProgress(done, total); };

    // sprites
    await preloadAssetSignatures([
      ...Object.values(m.sprites || {}),
      ...Object.values(m.ui || {}),
      ...Object.values(m.clamp || {}),
      ...(m.particles || []),
      m.score_bubble,
      ...Object.entries(m.background || {})
        .filter(([name]) => name !== "elements")
        .map(([, val]) => val),
      m.clamp_spine,
      m.background && m.background.elements,
    ].filter(Boolean));

    for (const [lvl, url] of Object.entries(m.sprites || {})) {
      push(loadImage(url), (img) => { this.sprites[+lvl] = img; });
    }
    // ui
    for (const [name, url] of Object.entries(m.ui || {})) {
      push(loadImage(url), (img) => { this.ui[name] = img; });
    }
    // clamp parts
    for (const [idx, url] of Object.entries(m.clamp || {})) {
      push(loadImage(url), (img) => { this.clamp[+idx] = img; });
    }
    // particles
    (m.particles || []).forEach((url, i) => {
      push(loadImage(url), (img) => { this.particles[i] = img; });
    });
    if (m.score_bubble) push(loadImage(m.score_bubble), (img) => { this.scoreBubble = img; });
    // background images
    for (const [name, val] of Object.entries(m.background || {})) {
      if (name === "elements") continue;
      push(loadImage(val), (img) => { this.bg[name] = img; });
    }

    total = tasks.length;
    report();
    await Promise.all(track);

    // spine + bg element metadata (non-blocking-ish JSON)
    try { if (m.clamp_spine) this.clampSpine = await loadJSON(m.clamp_spine); } catch (e) { /* ignore */ }
    try {
      if (m.background && m.background.elements) this.bgElements = await loadJSON(m.background.elements);
    } catch (e) { /* ignore */ }

    // record anim meta (sizes) up-front; images load lazily
    for (const [lvl, meta] of Object.entries(m.jelly_anim || {})) {
      this.animMeta[+lvl] = meta;
    }
  }

  // Lazily load the 60-frame inner-body animation sheets. Resolves when done;
  // the game stays playable with static sprites while these load.
  async loadJellyAnimations() {
    const m = this.manifest;
    if (!m || !m.jelly_anim) return;
    await preloadAssetSignatures(Object.values(m.jelly_anim).flatMap((meta) => [meta.shell, meta.frames]));
    const jobs = Object.entries(m.jelly_anim).map(async ([lvl, meta]) => {
      try {
        const [shell, frames] = await Promise.all([
          loadImage(meta.shell),
          loadImage(meta.frames),
        ]);
        this.anim[+lvl] = { ...meta, shell, frames };
      } catch (e) {
        /* keep static sprite for this level */
      }
    });
    await Promise.all(jobs);
  }

  hasAnim(level) {
    return !!this.anim[level];
  }
}
