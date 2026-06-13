// ─── Platform Provider Registry ─────────────────────────────────────
// Central registry for platform-specific providers.
// Each provider adapts the script to a specific trading platform.

import { PLATFORMS, detectPlatform } from './detect.js';
import { createTradeseaProvider } from './tradesea.js';
import { createPxProvider } from './px.js';

const _providers = {
  [PLATFORMS.TRADESEA]: createTradeseaProvider,
  [PLATFORMS.PX]: createPxProvider,
};

/** Active provider instance (set once during init). */
let _active = null;

/**
 * Initialize the platform provider for the current page.
 * @returns {object|null} The provider, or null if platform is unsupported.
 */
function initProvider() {
  const id = detectPlatform();
  if (!id || !_providers[id]) return null;
  _active = _providers[id]();
  return _active;
}

/** Get the active provider (null before initProvider). */
function getProvider() {
  return _active;
}

export { initProvider, getProvider };
