// Local save — mirrors the fields written by the Windows client's save.json
// (best_score, best_level, player_id, nickname, nickname_confirmed, target_fps,
// music_volume, sfx_volume) but stored in localStorage.

import {
  DEFAULT_MUSIC_VOLUME, DEFAULT_SFX_VOLUME, DEFAULT_NICKNAME,
  MAX_NICKNAME_CHARS, FPS_OPTIONS,
} from "./constants.js";
import { uuid, sanitizeNickname, clamp } from "./util.js";

const KEY = "MergeJellyfishRebuild.save";

function readRaw() {
  try {
    const txt = localStorage.getItem(KEY);
    if (!txt) return {};
    const obj = JSON.parse(txt);
    return obj && typeof obj === "object" ? obj : {};
  } catch (e) {
    return {};
  }
}

function sanitizeVolume(value, fallback) {
  const v = Number(value);
  if (!Number.isFinite(v)) return fallback;
  return clamp(v, 0, 1);
}

function sanitizeFps(value) {
  const v = parseInt(value, 10);
  return FPS_OPTIONS.includes(v) ? v : 60;
}

export class Save {
  constructor() {
    const raw = readRaw();
    this.best_score = Math.max(0, parseInt(raw.best_score, 10) || 0);
    this.best_level = Math.max(1, parseInt(raw.best_level, 10) || 1);
    this.player_id = String(raw.player_id || uuid());
    this.nickname = sanitizeNickname(raw.nickname || "", MAX_NICKNAME_CHARS, DEFAULT_NICKNAME);
    this.nickname_confirmed = !!raw.nickname_confirmed;
    this.target_fps = sanitizeFps(raw.target_fps != null ? raw.target_fps : 60);
    this.music_volume = sanitizeVolume(raw.music_volume, DEFAULT_MUSIC_VOLUME);
    this.sfx_volume = sanitizeVolume(raw.sfx_volume, DEFAULT_SFX_VOLUME);
  }

  write() {
    const data = {
      best_score: this.best_score,
      best_level: this.best_level,
      player_id: this.player_id,
      nickname: this.nickname,
      nickname_confirmed: this.nickname_confirmed,
      target_fps: this.target_fps,
      music_volume: this.music_volume,
      sfx_volume: this.sfx_volume,
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      /* storage may be unavailable (private mode) — ignore */
    }
  }

  recordResult(score, maxLevel) {
    this.best_score = Math.max(this.best_score, Math.max(0, Math.floor(score)));
    this.best_level = Math.max(this.best_level, Math.max(1, Math.floor(maxLevel)));
    this.write();
  }
}
