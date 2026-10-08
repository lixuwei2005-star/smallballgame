// Audio manager (WebAudio). BGM loops through a dedicated music gain node; SFX
// play through an sfx gain node. Browsers block audio until a user gesture, so
// the context is resumed on the first interaction and BGM (re)starts then.
//
// Sound aliases mirror assets/audio sound_map.json:
//   drop, warn, warn_loop, over, start, contact, merge_2..merge_10

import { assetUrl, preloadAssetSignatures } from "./asset_auth.js";

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.buffers = {};       // alias -> AudioBuffer
    this.bgmBuffer = null;
    this.bgmSource = null;
    this.musicVolume = 0.55;
    this.sfxVolume = 1.0;
    this.unlocked = false;
    this._manifestAudio = null;
    this._warnLoopSource = null;
  }

  _ensureCtx() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.musicGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicVolume;
    this.sfxGain.gain.value = this.sfxVolume;
    this.musicGain.connect(this.ctx.destination);
    this.sfxGain.connect(this.ctx.destination);
  }

  async load(manifestAudio) {
    this._manifestAudio = manifestAudio || {};
    this._ensureCtx();
    if (!this.ctx) return;
    const primaryAliases = this._manifestAudio.aliases || {};
    const fallbackAliases = this._manifestAudio.fallbackAliases || {};
    const canPlayOgg = (() => {
      if (typeof document === "undefined") return false;
      const audio = document.createElement("audio");
      return !!(audio.canPlayType && audio.canPlayType('audio/ogg; codecs="vorbis"').replace(/^no$/, ""));
    })();
    const aliasCandidates = {};
    for (const [alias, url] of Object.entries(primaryAliases)) {
      const fallbackUrl = fallbackAliases[alias];
      const candidates = canPlayOgg ? [url, fallbackUrl] : [fallbackUrl, url];
      aliasCandidates[alias] = candidates.filter(Boolean);
    }
    await preloadAssetSignatures([
      ...Object.values(aliasCandidates).flat(),
      this._manifestAudio.bgm,
    ].filter(Boolean));
    const decode = async (url) => {
      const res = await fetch(await assetUrl(url), { cache: "force-cache" });
      const buf = await res.arrayBuffer();
      return await this.ctx.decodeAudioData(buf);
    };
    const decodeFirst = async (urls) => {
      let lastError = null;
      for (const url of urls) {
        try {
          return await decode(url);
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError || new Error("audio decode failed");
    };
    const jobs = [];
    for (const [alias, urls] of Object.entries(aliasCandidates)) {
      jobs.push(decodeFirst(urls).then((b) => { this.buffers[alias] = b; }).catch(() => {}));
    }
    if (this._manifestAudio.bgm) {
      jobs.push(decode(this._manifestAudio.bgm).then((b) => {
        this.bgmBuffer = b;
        // The first gesture can arrive before the BGM has finished decoding.
        // In that case unlock() cannot start it, so retry as soon as the buffer
        // becomes available.
        if (this.unlocked) this.startBgm();
      }).catch(() => {}));
    }
    await Promise.all(jobs);
  }

  setMusicVolume(v) {
    this.musicVolume = Math.max(0, Math.min(1, v));
    if (this.musicGain) this.musicGain.gain.value = this.musicVolume;
  }

  setSfxVolume(v) {
    this.sfxVolume = Math.max(0, Math.min(1, v));
    if (this.sfxGain) this.sfxGain.gain.value = this.sfxVolume;
  }

  // Call on first user gesture.
  unlock() {
    this._ensureCtx();
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") this.ctx.resume();
    this.unlocked = true;
    // Retrying is harmless (startBgm is idempotent) and lets a later gesture
    // recover if an earlier resume/start attempt was too early.
    this.startBgm();
  }

  startBgm() {
    if (!this.ctx || !this.bgmBuffer) return;
    if (this.bgmSource) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.bgmBuffer;
    src.loop = true;
    src.connect(this.musicGain);
    src.start(0);
    this.bgmSource = src;
  }

  play(alias) {
    if (!this.ctx) return;
    const buf = this.buffers[alias];
    if (!buf) return;
    if (this.ctx.state === "suspended") this.ctx.resume();
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.sfxGain);
    src.start(0);
    return src;
  }
}
