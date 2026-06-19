// Static asset helpers. The Cloudflare-hosted build serves assets directly.

const ASSET_BASE = "assets/";

function normalizePath(path) {
  let out = String(path || "").replace(/^\/+/, "");
  if (out.startsWith("assets/")) out = out.slice("assets/".length);
  return out;
}

export async function preloadAssetSignatures() {
  // Kept as a no-op so existing loaders do not need special Cloudflare branches.
}

export async function assetUrl(path) {
  return ASSET_BASE + normalizePath(path);
}

export async function installAssetFont() {
  if (document.getElementById("asset-font-pop1w5")) return;
  const fontUrl = await assetUrl("fonts/pop1w5.ttc");
  const style = document.createElement("style");
  style.id = "asset-font-pop1w5";
  style.textContent = `
    @font-face {
      font-family: "pop1w5";
      src: url("${fontUrl}") format("collection"), url("${fontUrl}");
      font-display: swap;
    }
  `;
  document.head.appendChild(style);
}
