// ─── Platform Detection ─────────────────────────────────────────────
// Determines which trading platform is hosting the script.

const PLATFORMS = {
  TRADESEA: 'tradesea',
  PX: 'px',
};

/**
 * Detect the current platform from the page hostname.
 * @returns {'tradesea'|'px'|null}
 */
function detectPlatform() {
  const host = window.location.hostname;
  if (host.includes('tradesea.ai')) return PLATFORMS.TRADESEA;
  if (host.includes('topstepx.com')) return PLATFORMS.PX;
  return null;
}

export { PLATFORMS, detectPlatform };
