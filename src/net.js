// Leaderboard API client. Mirrors the Python client's payload shapes so the same
// backend (smallballgame.apodfg.com) serves both the Windows and web clients:
//   GET  /api/leaderboard?limit=3|50  -> { rows: [{rank,nickname,score,best_level,updated_at}] }
//   POST /api/player                  -> { player_id, nickname }
//   POST /api/game/start              -> { player_id, nickname, fps }
//   POST /api/game/finish             -> { game_id, player_id, nickname, actions, score_events, final_frame, client_score, client_best_level }

import { DEFAULT_NICKNAME, MAX_NICKNAME_CHARS } from "./constants.js";
import { sanitizeNickname } from "./util.js";

function cfg() {
  return window.GAME_CONFIG || {};
}

function apiBase() {
  return String(cfg().apiBase || "https://smallballgame.apodfg.com").replace(/\/$/, "");
}

async function apiRequest(method, path, payload, timeoutMs) {
  const url = apiBase() + path;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs || cfg().leaderboardTimeoutMs || 5000);
  try {
    const opts = {
      method,
      headers: { Accept: "application/json" },
      signal: controller.signal,
    };
    if (payload !== undefined && payload !== null) {
      opts.headers["Content-Type"] = "application/json; charset=utf-8";
      opts.body = JSON.stringify(payload);
    }
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error("http " + res.status);
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeRankRows(rows) {
  const out = [];
  if (!Array.isArray(rows)) return out;
  rows.forEach((row, idx) => {
    if (!row || typeof row !== "object") return;
    const score = Math.max(0, parseInt(row.score, 10) || 0);
    const best_level = Math.max(1, parseInt(row.best_level, 10) || 1);
    let rank = parseInt(row.rank, 10);
    if (!Number.isFinite(rank)) rank = idx + 1;
    out.push({
      rank: Math.max(1, rank),
      nickname: sanitizeNickname(row.nickname || "", MAX_NICKNAME_CHARS, DEFAULT_NICKNAME),
      score,
      best_level,
      updated_at: String(row.updated_at || ""),
      player_id: row.player_id ? String(row.player_id) : "",
    });
  });
  return out;
}

export async function fetchLeaderboard(limit) {
  const lim = limit > 3 ? 50 : 3;
  const data = await apiRequest("GET", `/api/leaderboard?limit=${lim}`);
  return normalizeRankRows((data && data.rows) || []);
}

export async function submitPlayer(player_id, nickname) {
  return apiRequest("POST", "/api/player", { player_id, nickname });
}

export async function startGameSession(player_id, nickname, fps) {
  return apiRequest("POST", "/api/game/start", {
    player_id,
    nickname,
    fps: fps === 120 ? 120 : 60,
  });
}

export async function finishGameSession(session, player_id, nickname, actions, score_events, final_frame, client_score, client_best_level) {
  return apiRequest("POST", "/api/game/finish", {
    game_id: session && session.game_id,
    player_id,
    nickname,
    actions: Array.isArray(actions) ? actions : [],
    score_events: Array.isArray(score_events) ? score_events : [],
    final_frame: Math.max(0, Math.floor(final_frame || 0)),
    client_score: Math.max(0, Math.floor(client_score || 0)),
    client_best_level: Math.max(1, Math.floor(client_best_level || 1)),
  }, cfg().scoreSubmitTimeoutMs || 180000);
}
