// Bootstrap + main loop. Wires assets, audio, save, game, renderer, DOM UI,
// input and the leaderboard network layer into a single app.

import { Assets } from "./assets.js";
import { AudioManager } from "./audio.js";
import { Save } from "./storage.js";
import { Game } from "./game.js";
import { Renderer } from "./render.js";
import { UI } from "./ui.js";
import { Input } from "./input.js";
import { Clamp } from "./clamp.js";
import { installAssetFont } from "./asset_auth.js";
import { fetchLeaderboard, submitPlayer, startGameSession, finishGameSession } from "./net.js";
import { DEFAULT_NICKNAME, MAX_NICKNAME_CHARS, DESIGN_W, DESIGN_H } from "./constants.js";
import { sanitizeNickname } from "./util.js";

const app = {
  assets: null, audio: null, save: null, game: null, renderer: null, ui: null,
  clamp: null,
  leaderboardTop3: [], leaderboardStatus: "正在加载...",
  leaderboardTop50: [], leaderboardFullStatus: "正在加载...",
  currentGameSession: null,
  localSeedCounter: 0,
  _syncing: false, _top3Loading: false, _top50Loading: false, _startingGame: false,
};

// ---------- responsive stage fit ----------
function fitStage() {
  const stage = document.getElementById("stage");
  const scale = Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H);
  stage.style.transform = `scale(${scale})`;
}

function applyNicknameResult(result) {
  if (!result || typeof result !== "object" || !("nickname" in result)) return result;
  const nickname = sanitizeNickname(result.nickname || "", MAX_NICKNAME_CHARS, DEFAULT_NICKNAME);
  if (nickname && nickname !== app.save.nickname) {
    app.save.nickname = nickname;
    app.save.write();
  }
  if (app.ui) {
    app.ui.el.nickDisplay.textContent = app.save.nickname || DEFAULT_NICKNAME;
    if (app.ui.settingsOpen) app.ui.refreshSettings();
  }
  return { ...result, nickname };
}

// ---------- game sessions ----------
app.createGameSession = async () => {
  const fps = app.save.target_fps === 120 ? 120 : 60;
  try {
    const session = await startGameSession(app.save.player_id, app.save.nickname, fps);
    applyNicknameResult(session);
    if (session && session.game_id && session.seed) {
      return {
        ranked: true,
        game_id: session.game_id,
        seed: String(session.seed),
        fps: session.fps === 120 ? 120 : 60,
      };
    }
  } catch (e) {
    // Network/API unavailable: keep the game playable, but this local-only run
    // cannot enter the verified leaderboard.
  }
  app.localSeedCounter += 1;
  return {
    ranked: false,
    game_id: "",
    seed: `local-${Date.now()}-${app.localSeedCounter}`,
    fps,
  };
};

app.startNewGame = async ({ hideGameOver = true } = {}) => {
  if (app._startingGame) return;
  app._startingGame = true;
  try {
    if (hideGameOver && app.ui) app.ui.hideGameOver();
    const session = await app.createGameSession();
    app.currentGameSession = session;
    app.game = new Game({
      audio: app.audio,
      onFinish,
      seed: session.seed,
      fps: session.fps,
      gameId: session.game_id,
      recordActions: session.ranked,
    });
  } finally {
    app._startingGame = false;
  }
};

// ---------- app methods ----------
app.setMusicVolume = (v, persist) => {
  app.audio.setMusicVolume(v);
  if (persist) { app.save.music_volume = Math.max(0, Math.min(1, v)); app.save.write(); }
};

app.setSfxVolume = (v, persist) => {
  app.audio.setSfxVolume(v);
  if (persist) { app.save.sfx_volume = Math.max(0, Math.min(1, v)); app.save.write(); }
};

app.setTargetFps = (fps) => {
  app.save.target_fps = fps === 120 ? 120 : 60;
  app.save.write();
  const g = app.game;
  if (g && (g.items.length > 0 || g.score > 0)) return;
  if (g) app.startNewGame({ hideGameOver: false });
};

app.confirmNickname = async (name) => {
  const nickname = sanitizeNickname(name, MAX_NICKNAME_CHARS, DEFAULT_NICKNAME);
  app.save.nickname = nickname;
  app.save.nickname_confirmed = true;
  app.save.write();
  if (app.ui) app.ui.el.nickDisplay.textContent = nickname;
  try {
    return applyNicknameResult(await submitPlayer(app.save.player_id, nickname));
  } catch (e) {
    return { ok: false, nickname, moderation_status: "pending" };
  }
};

app.restart = () => {
  app.startNewGame();
};

app.refreshLeaderboardTop3 = async () => {
  if (app._top3Loading) return;
  app._top3Loading = true;
  app.leaderboardStatus = "正在加载...";
  try {
    const rows = await fetchLeaderboard(3);
    app.leaderboardTop3 = rows.slice(0, 3);
    app.leaderboardStatus = rows.length ? "" : "暂无排行";
  } catch (e) {
    app.leaderboardStatus = "网络异常";
  } finally {
    app._top3Loading = false;
  }
};

app.fetchLeaderboardTop50 = async () => {
  if (app._top50Loading) return;
  app._top50Loading = true;
  app.leaderboardFullStatus = "正在加载...";
  app.ui.renderLeaderboardTop50(app.leaderboardTop50, app.leaderboardFullStatus);
  try {
    const rows = await fetchLeaderboard(50);
    app.leaderboardTop50 = rows.slice(0, 50);
    app.leaderboardFullStatus = rows.length ? "" : "暂无排行";
  } catch (e) {
    app.leaderboardFullStatus = "网络异常";
  } finally {
    app._top50Loading = false;
    app.ui.renderLeaderboardTop50(app.leaderboardTop50, app.leaderboardFullStatus);
  }
};

app.syncBestScore = async () => {
  if (app._syncing) return;
  app.ui.updateSyncStatus("完成在线局后自动提交", false);
};

function onFinish(score, level, finalFrame) {
  app.save.recordResult(score, level);
  app.ui.showGameOver(score, level);
  const session = app.currentGameSession;
  if (!session || !session.ranked) {
    app.ui.setSubmitStatus("离线局不入榜");
    return;
  }
  const actions = app.game.actions.slice();
  const scoreEvents = app.game.scoreEvents.slice();
  app.ui.setSubmitStatus("排行榜验证中...");
  finishGameSession(session, app.save.player_id, app.save.nickname, actions, scoreEvents, finalFrame, score, level)
    .then((res) => {
      applyNicknameResult(res);
      const serverScore = res && Number.isFinite(+res.score) ? Math.floor(+res.score) : score;
      app.ui.setSubmitStatus(`已验证 ${serverScore}`);
      app.refreshLeaderboardTop3();
      if (!app.ui.el.rankModal.classList.contains("hidden")) app.fetchLeaderboardTop50();
    })
    .catch(() => app.ui.setSubmitStatus("排行榜验证失败"));
}

// ---------- boot ----------
async function boot() {
  fitStage();
  window.addEventListener("resize", fitStage);
  window.addEventListener("orientationchange", fitStage);

  window.addEventListener("beforeunload", (e) => {
    const g = app.game;
    const inProgress = g && !g.gameOver && (g.score > 0 || g.items.length > 0);
    if (inProgress) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  app.save = new Save();
  app.save.write(); // persist player_id on first launch
  app.audio = new AudioManager();
  app.audio.setMusicVolume(app.save.music_volume);
  app.audio.setSfxVolume(app.save.sfx_volume);

  app.assets = new Assets();
  app.ui = new UI(app);

  await installAssetFont();
  await app.assets.loadCritical((done, total) => app.ui.setLoading(done, total));

  // Audio buffers decode in parallel; playback waits for the unlock gesture.
  app.audio.load(app.assets.manifest.audio).catch(() => {});

  await app.startNewGame({ hideGameOver: false });
  app.renderer = new Renderer(document.getElementById("game"), app);
  app.clamp = new Clamp(app.assets);
  new Input(document.getElementById("game"), app);

  app.ui.hideLoading();

  if (!app.save.nickname_confirmed) app.ui.openNicknameModal(true);

  app.refreshLeaderboardTop3();

  if (!window.GAME_CONFIG || window.GAME_CONFIG.enableJellyAnimation !== false) {
    app.assets.loadJellyAnimations().catch(() => {});
  }

  let last = performance.now();
  function frame(t) {
    const dt = Math.min(1 / 30, (t - last) / 1000);
    last = t;
    if (app.game) app.game.update(dt);
    if (app.renderer) app.renderer.draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

window.app = app;
boot().catch((err) => {
  console.error(err);
  const lt = document.getElementById("loading-text");
  if (lt) lt.textContent = "加载失败: " + (err && err.message ? err.message : err);
});
