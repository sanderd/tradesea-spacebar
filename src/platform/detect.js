// ─── Platform Detection ─────────────────────────────────────────────
// Determines which trading platform is hosting the script.

const PLATFORMS = {
  TRADESEA: 'tradesea',
  PROJECTX: 'projectx',
};

/**
 * Detect the current platform from the page hostname.
 * @returns {'tradesea'|'projectx'|null}
 */
function detectPlatform() {
  const host = window.location.hostname;
  if (host.includes('tradesea.ai')) return PLATFORMS.TRADESEA;
  if (host.includes('topstepx.com')) return PLATFORMS.PROJECTX;
  return null;
}

export { PLATFORMS, detectPlatform };
