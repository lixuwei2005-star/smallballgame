// Pointer + keyboard input. Maps browser coordinates into the 1600x900 design
// space and performs canvas hit-testing for the settings gear and rank panel;
// everything else in the play area starts an aim hold and releases on pointerup.
// DOM overlays (settings panel, modals) capture their own events above the canvas.

export class Input {
  constructor(canvas, app) {
    this.canvas = canvas;
    this.app = app;
    this._bind();
  }

  toDesign(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (1600 / rect.width);
    const y = (clientY - rect.top) * (900 / rect.height);
    return [x, y];
  }

  hit(rect, x, y) {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  }

  _firstGesture() {
    this.app.audio.unlock();
  }

  handlePress(x, y) {
    const app = this.app;
    const r = app.renderer;
    // settings gear
    if (this.hit(r.settingsButtonRect(), x, y)) {
      app.game.cancelAim();
      app.ui.toggleSettings();
      return;
    }
    // close settings if open and clicking elsewhere on the canvas
    if (app.ui.settingsOpen) {
      app.game.cancelAim();
      app.ui.closeSettings();
      return;
    }
    // rank panel -> open full leaderboard
    if (this.hit(r.rankPanelRect(), x, y)) {
      app.game.cancelAim();
      app.ui.openLeaderboard();
      return;
    }
    // otherwise aim; actual drop happens when the pointer is released.
    app.game.startAim(x);
  }

  _bind() {
    const c = this.canvas;

    c.addEventListener("pointermove", (e) => {
      const game = this.app.game;
      const [x, y] = this.toDesign(e.clientX, e.clientY);
      game.input.pointerX = x;
      game.input.pointerActive = true;
    });

    c.addEventListener("pointerdown", (e) => {
      const game = this.app.game;
      this._firstGesture();
      const [x, y] = this.toDesign(e.clientX, e.clientY);
      game.input.pointerX = x;
      game.input.pointerActive = true;
      try { c.setPointerCapture(e.pointerId); } catch (_) {}
      this.handlePress(x, y);
      e.preventDefault();
    });

    c.addEventListener("pointerup", (e) => {
      const game = this.app.game;
      const [x, y] = this.toDesign(e.clientX, e.clientY);
      game.input.pointerX = x;
      game.input.pointerActive = e.pointerType === "mouse";
      game.releaseAim();
      try { c.releasePointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });

    c.addEventListener("pointerleave", () => {
      const game = this.app.game;
      if (!game.aiming) game.input.pointerActive = false;
    });
    c.addEventListener("pointercancel", () => {
      const game = this.app.game;
      game.cancelAim();
      game.input.pointerActive = false;
    });
    c.addEventListener("contextmenu", (e) => e.preventDefault());

    window.addEventListener("keydown", (e) => {
      const el = document.activeElement;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing) return; // let the nickname field handle its own keys
      const game = this.app.game;
      this._firstGesture();
      switch (e.key) {
        case "ArrowLeft": case "a": case "A": game.input.left = true; break;
        case "ArrowRight": case "d": case "D": game.input.right = true; break;
        case " ": case "Enter":
          if (!this.app.ui.anyModalOpen()) { game.drop(); e.preventDefault(); }
          break;
        case "r": case "R": this.app.restart(); break;
        case "F6": this.app.ui.toggleSettings(); e.preventDefault(); break;
        case "Escape": this.app.ui.onEscape(); break;
        default: break;
      }
    });

    window.addEventListener("keyup", (e) => {
      const game = this.app.game;
      switch (e.key) {
        case "ArrowLeft": case "a": case "A": game.input.left = false; break;
        case "ArrowRight": case "d": case "D": game.input.right = false; break;
        default: break;
      }
    });
  }
}
