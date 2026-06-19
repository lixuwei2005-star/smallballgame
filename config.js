// Public runtime configuration for the 暗海探秘 web client.
// IMPORTANT: never put database credentials or secrets here — this file ships to
// the browser. Only public, non-sensitive settings belong here.
window.GAME_CONFIG = {
  // Leaderboard API base URL.
  // The static site is hosted on shuimu.apodfg.com while the API lives on
  // smallballgame.apodfg.com (cross-origin -> the API must send CORS headers).
  // If you place a same-origin reverse proxy in front of the static site that
  // forwards /api to the backend, set this to "/api" to avoid CORS entirely.
  apiBase: "https://smallballgame.apodfg.com",

  // Network timeout for leaderboard requests (ms).
  leaderboardTimeoutMs: 5000,
  scoreSubmitTimeoutMs: 180000,

  // Load the 60-frame inner-body jellyfish animations (~18MB, lazy-loaded after
  // the game is already playable with static sprites). Set false to skip.
  enableJellyAnimation: true,
};
