// DOM overlay controller: settings panel, nickname prompt, full leaderboard
// modal, game-over and loading. Talks to the rest of the app via methods on
// `app` (set up in main.js) so this module stays presentation-focused.

import { DEFAULT_NICKNAME, MAX_NICKNAME_CHARS, FPS_OPTIONS } from "./constants.js";
import { sanitizeNickname } from "./util.js";

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(app) {
    this.app = app;
    this.settingsOpen = false;
    this.nickFirstTime = false;
    this.nickSubmitting = false;

    this.el = {
      loading: $("loading"), loadingFill: $("loading-fill"), loadingText: $("loading-text"),
      settings: $("settings-panel"),
      musicSlider: $("music-slider"), musicPct: $("music-pct"),
      sfxSlider: $("sfx-slider"), sfxPct: $("sfx-pct"),
      fpsSeg: $("fps-seg"),
      nickDisplay: $("nick-display"), nickEditBtn: $("nick-edit-btn"),
      newgameBtn: $("newgame-btn"), syncBtn: $("sync-btn"),
      nickModal: $("nickname-modal"), nickTitle: $("nick-title"), nickInput: $("nick-input"), nickStatus: $("nick-status"), nickConfirm: $("nick-confirm"),
      rankModal: $("leaderboard-modal"), rankClose: $("rank-close"), rankStatus: $("rank-status"),
      rankColA: $("rank-col-a"), rankColB: $("rank-col-b"),
      gameover: $("gameover"), goScore: $("gameover-score"), goLevel: $("gameover-level"),
      goSubmit: $("gameover-submit"), restartBtn: $("restart-btn"),
    };
    this._wire();
  }

  _wire() {
    const e = this.el, app = this.app;

    e.musicSlider.addEventListener("input", () => {
      const v = +e.musicSlider.value / 100;
      app.setMusicVolume(v, false);
      e.musicPct.textContent = e.musicSlider.value + "%";
    });
    e.musicSlider.addEventListener("change", () => app.setMusicVolume(+e.musicSlider.value / 100, true));

    e.sfxSlider.addEventListener("input", () => {
      const v = +e.sfxSlider.value / 100;
      app.setSfxVolume(v, false);
      e.sfxPct.textContent = e.sfxSlider.value + "%";
    });
    e.sfxSlider.addEventListener("change", () => app.setSfxVolume(+e.sfxSlider.value / 100, true));

    e.fpsSeg.querySelectorAll(".seg-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        app.setTargetFps(parseInt(btn.dataset.fps, 10));
        this.refreshSettings();
      });
    });

    e.nickEditBtn.addEventListener("click", () => this.openNicknameModal(false));
    e.newgameBtn.addEventListener("click", () => { app.restart(); this.closeSettings(); });
    e.syncBtn.addEventListener("click", () => app.syncBestScore());

    e.nickConfirm.addEventListener("click", () => this.confirmNickname());
    e.nickInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); this.confirmNickname(); }
      else if (ev.key === "Escape" && !this.nickFirstTime) { this.closeNicknameModal(); }
      else if (ev.key === "Escape" && this.nickFirstTime) { this.confirmNickname(); }
    });

    e.rankClose.addEventListener("click", () => this.closeLeaderboard());
    e.rankModal.addEventListener("pointerdown", (ev) => {
      if (ev.target === e.rankModal) this.closeLeaderboard();
    });

    e.restartBtn.addEventListener("click", () => app.restart());
  }

  // ---------- loading ----------
  setLoading(done, total) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    this.el.loadingFill.style.width = pct + "%";
    this.el.loadingText.textContent = `正在加载资源… ${pct}%`;
  }
  hideLoading() { this.el.loading.classList.add("hidden"); }

  // ---------- settings ----------
  toggleSettings() { this.settingsOpen ? this.closeSettings() : this.openSettings(); }
  openSettings() {
    this.settingsOpen = true;
    this.refreshSettings();
    this.el.settings.classList.remove("hidden");
  }
  closeSettings() {
    this.settingsOpen = false;
    this.el.settings.classList.add("hidden");
  }
  refreshSettings() {
    const s = this.app.save, e = this.el;
    e.musicSlider.value = Math.round(s.music_volume * 100);
    e.musicPct.textContent = e.musicSlider.value + "%";
    e.sfxSlider.value = Math.round(s.sfx_volume * 100);
    e.sfxPct.textContent = e.sfxSlider.value + "%";
    e.fpsSeg.querySelectorAll(".seg-btn").forEach((btn) => {
      btn.classList.toggle("active", parseInt(btn.dataset.fps, 10) === s.target_fps);
    });
    e.nickDisplay.textContent = s.nickname || DEFAULT_NICKNAME;
    this.updateSyncStatus("", false);
  }
  updateSyncStatus(text, busy) {
    const b = this.el.syncBtn;
    b.textContent = busy ? "同步中" : (text || "同步排行");
    b.classList.toggle("busy", !!busy);
  }

  // ---------- nickname ----------
  openNicknameModal(firstTime) {
    this.nickFirstTime = firstTime;
    this.closeSettings();
    this.el.nickTitle.textContent = firstTime ? "输入昵称" : "修改昵称";
    this.el.nickInput.value = firstTime && !this.app.save.nickname_confirmed ? "" : (this.app.save.nickname || "");
    this.setNicknameStatus("", "");
    this.el.nickModal.classList.remove("hidden");
    setTimeout(() => { this.el.nickInput.focus(); this.el.nickInput.select(); }, 30);
  }
  closeNicknameModal() {
    this.el.nickModal.classList.add("hidden");
    this.nickFirstTime = false;
    this.nickSubmitting = false;
    this.el.nickConfirm.disabled = false;
    this.setNicknameStatus("", "");
  }
  setNicknameStatus(text, tone) {
    const s = this.el.nickStatus;
    if (!s) return;
    s.textContent = text || "";
    s.classList.toggle("warn", tone === "warn");
    s.classList.toggle("ok", tone === "ok");
  }
  async confirmNickname() {
    if (this.nickSubmitting) return;
    const name = sanitizeNickname(this.el.nickInput.value, MAX_NICKNAME_CHARS, DEFAULT_NICKNAME);
    this.nickSubmitting = true;
    this.el.nickConfirm.disabled = true;
    this.setNicknameStatus(name === DEFAULT_NICKNAME ? "正在保存..." : "正在审核昵称...", "ok");
    const result = await this.app.confirmNickname(name);
    this.nickSubmitting = false;
    this.el.nickConfirm.disabled = false;
    const finalName = (result && result.nickname) || this.app.save.nickname || DEFAULT_NICKNAME;
    this.el.nickDisplay.textContent = finalName;
    if (result && result.moderation_status === "replaced") {
      this.el.nickInput.value = "";
      this.setNicknameStatus("昵称未通过审核，已使用匿名用户。可以换一个昵称。", "warn");
      return;
    }
    if (result && result.moderation_status === "pending") {
      this.setNicknameStatus("网络异常，昵称已先保存在本地", "warn");
    }
    this.closeNicknameModal();
  }

  // ---------- leaderboard ----------
  openLeaderboard() {
    this.el.rankModal.classList.remove("hidden");
    this.renderLeaderboardTop50(this.app.leaderboardTop50 || [], this.app.leaderboardFullStatus || "正在加载…");
    this.app.fetchLeaderboardTop50();
  }
  closeLeaderboard() { this.el.rankModal.classList.add("hidden"); }

  renderLeaderboardTop50(rows, status) {
    const e = this.el;
    e.rankColA.innerHTML = "";
    e.rankColB.innerHTML = "";
    if (!rows || !rows.length) {
      e.rankStatus.textContent = status || "暂无排行";
      return;
    }
    e.rankStatus.textContent = "";
    const myId = this.app.save.player_id;
    rows.slice(0, 50).forEach((row, idx) => {
      const li = document.createElement("li");
      if (row.player_id && row.player_id === myId) li.classList.add("me");
      li.innerHTML =
        `<span class="rk">${row.rank || idx + 1}</span>` +
        `<span class="nm"></span>` +
        `<span class="sc">${row.score || 0}</span>`;
      li.querySelector(".nm").textContent = row.nickname || DEFAULT_NICKNAME;
      (idx < 25 ? e.rankColA : e.rankColB).appendChild(li);
    });
  }

  // ---------- game over ----------
  showGameOver(score, level) {
    this.el.goScore.textContent = "得分 " + score;
    this.el.goLevel.textContent = "最高等级 " + level;
    this.el.goSubmit.textContent = "";
    this.el.gameover.classList.remove("hidden");
  }
  hideGameOver() { this.el.gameover.classList.add("hidden"); }
  setSubmitStatus(text) { this.el.goSubmit.textContent = text || ""; }

  // ---------- helpers ----------
  anyModalOpen() {
    return !this.el.nickModal.classList.contains("hidden") ||
           !this.el.rankModal.classList.contains("hidden") ||
           !this.el.gameover.classList.contains("hidden");
  }

  onEscape() {
    if (!this.el.nickModal.classList.contains("hidden")) {
      if (!this.nickFirstTime) this.closeNicknameModal();
      return;
    }
    if (!this.el.rankModal.classList.contains("hidden")) { this.closeLeaderboard(); return; }
    if (this.settingsOpen) { this.closeSettings(); return; }
  }
}
