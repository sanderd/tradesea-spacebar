/**
 * Extract modules from the monolithic tradesea-spacebar.user.js
 * and convert them to proper ES modules with imports/exports.
 *
 * Run once: node scripts/extract-modules.mjs
 */
import { readFileSync, writeFileSync } from 'fs';

const src = readFileSync('tradesea-spacebar.user.js', 'utf8');
const lines = src.split(/\r?\n/);

function slice(start, end) {
  // Extract lines and strip the 2-space IIFE indent from the original
  return lines.slice(start - 1, end)
    .map(l => l.startsWith('  ') ? l.slice(2) : l)
    .join('\n');
}

function write(file, content) {
  writeFileSync(`src/${file}`, content, 'utf8');
  const n = content.split('\n').length;
  console.log(`  src/${file} — ${n} lines`);
}

// ── State variable rewriting ────────────────────────────────────────
// These variables in the original code are bare `let` identifiers that
// become properties of the shared `S` object in the modular version.
const STATE_VARS = [
  'spaceHeld', 'mouseY', 'mousePrice',
  'lastIframeMouseX', 'lastIframeMouseY',
  'canvas', 'ctx', 'rafId',
  'iframeEl', 'iframeDoc', 'iframeWin',
  'cleanupFns', 'userConfig',
  'settingsOverlay', 'settingsBtn',
  'pendingOrder',
];

/**
 * Replace bare state variable references with S.xxx in extracted code.
 * Uses word boundaries to avoid mangling substrings
 * (e.g. `resizeCanvas` won't become `resizeS.canvas`).
 */
function rewriteState(code) {
  for (const v of STATE_VARS) {
    // Match the variable name when it's:
    //   - preceded by a non-word char (or start of line)
    //   - NOT preceded by a dot (member access like `.canvas`)
    //   - NOT preceded by `S.` (already rewritten)
    //   - followed by a non-word char (or end of line)
    // This regex avoids matching inside longer identifiers like resizeCanvas.
    const re = new RegExp(`(?<![.\\w])\\b${v}\\b`, 'g');
    code = code.replace(re, `S.${v}`);
  }

  // Post-process: revert false positives inside string literals.
  // e.g. querySelector('S.canvas') → querySelector('canvas')
  //      createElement('S.canvas') → createElement('canvas')
  for (const v of STATE_VARS) {
    // Single quotes
    code = code.replace(new RegExp(`'([^']*?)S\\.${v}([^']*?)'`, 'g'), `'$1${v}$2'`);
    // Double quotes
    code = code.replace(new RegExp(`"([^"]*?)S\\.${v}([^"]*?)"`, 'g'), `"$1${v}$2"`);
  }

  return code;
}

console.log('Extracting modules from tradesea-spacebar.user.js...\n');

// ─── header.js ──────────────────────────────────────────────────────
// Already created manually, skip

write('config.js', `// ─── Configuration & Persistence ────────────────────────────────────
// Constants, default config, schema migrations, load/save.
import { log, warn, err } from './logging.js';

${slice(14, 35)}

${slice(76, 216)}

export {
  CONFIG, OrderType, Side,
  STORAGE_KEY, CONFIG_VERSION, DEFAULT_CONFIG, MIGRATIONS,
  applyMigrations, loadConfig, saveConfig,
};
`);

// ─── logging.js ─────────────────────────────────────────────────────
// Self-contained — no imports (avoids circular dep with config.js).
// The DEBUG flag is kept local since it mirrors CONFIG.DEBUG.
write('logging.js', `const PREFIX = '%c[TS-Spacebar]';
const STYLE = 'color:#ff00ff;font-weight:bold';
const DEBUG = true;
const log = (...a) => DEBUG && console.log(PREFIX, STYLE, ...a);
const warn = (...a) => console.warn(PREFIX, 'color:#FFA500;font-weight:bold', ...a);
const err = (...a) => console.error(PREFIX, 'color:#FF4444;font-weight:bold', ...a);

export { log, warn, err };
`);

// ─── state.js ───────────────────────────────────────────────────────
write('state.js', `// ─── Shared Mutable State ───────────────────────────────────────────
// All cross-module mutable state lives here as properties of the \`S\`
// object.  Modules import S and read/write S.xxx so mutations are
// visible everywhere.  Module-local state (e.g. canvas caches) stays
// as \`let\` inside its own module.

export const services = {
  tradingService: null,
  orderController: null,
  accountService: null,
  symbolService: null,
  quantityService: null,
  positionService: null,
  instrumentService: null,
};

export const S = {
  spaceHeld: false,
  mouseY: null,
  mousePrice: null,
  lastIframeMouseX: null,
  lastIframeMouseY: null,
  canvas: null,
  ctx: null,
  rafId: null,
  iframeEl: null,
  iframeDoc: null,
  iframeWin: null,
  cleanupFns: [],
  userConfig: null,
  settingsOverlay: null,
  settingsBtn: null,
  pendingOrder: null,
};
`);

// ─── chart.js ───────────────────────────────────────────────────────
write('chart.js', `// ─── Symbol, Price & TradingView Helpers ────────────────────────────
import { CONFIG } from './config.js';
import { log } from './logging.js';
import { services, S } from './state.js';

${rewriteState(slice(757, 780))}

  // ═══════════════════════════════════════════════════════════════════
  //  SYMBOL + PRICE HELPERS
  // ═══════════════════════════════════════════════════════════════════

${rewriteState(slice(831, 924))}

export {
  formatKeyDisplay, setContractSize,
  getTvApi, getActiveChart, getActiveSymbol, getTickSize,
  snapPrice, formatPrice, parsePriceLevels,
  getMatchingPriceLevelsForSymbol, getMatchingPriceLevels,
  getCurrentPrice, getQty,
};
`);

// ─── nicknames.js ───────────────────────────────────────────────────
write('nicknames.js', `// ─── Account Nickname System ────────────────────────────────────────
import { log, warn } from './logging.js';
import { S } from './state.js';
import { saveConfig } from './config.js';

${rewriteState(slice(218, 755))}

export {
  getNicknameMap, getNickname, setNickname, clearAllNicknames,
  forceRefreshNicknames, detectActiveBroker,
  applyNicknames, startNicknameObserver, stopNicknameObserver,
};
`);

// ─── canvas.js ──────────────────────────────────────────────────────
write('canvas.js', `// ─── Canvas Overlay & Draw Loop ─────────────────────────────────────
import { DEFAULT_CONFIG } from './config.js';
import { log, err } from './logging.js';
import { services, S } from './state.js';
import {
  getTvApi, getActiveChart, getActiveSymbol, getTickSize,
  formatPrice, getCurrentPrice, getQty,
  getMatchingPriceLevelsForSymbol,
} from './chart.js';

// Module-local caches (not shared state — reset via resetCanvasCaches)
${slice(70, 73)}

${rewriteState(slice(926, 2136))}

/** Reset module-local caches — called from teardown in index.js */
function resetCanvasCaches() {
  _overlayRectsCache = []; _overlayRectsTick = 0;
  _paneRectsCache = null;
  _allPanesCache = null;
}

export {
  getPaneCanvasRect, getIframeRect,
  ensureCanvas, resizeCanvas,
  coordToPrice, priceToCoord, getPriceScale,
  draw, lineStyleToDash,
  resetCanvasCaches,
};
`);

// ─── settings.js ────────────────────────────────────────────────────
write('settings.js', `// ─── Settings UI ────────────────────────────────────────────────────
import { DEFAULT_CONFIG, loadConfig, saveConfig, applyMigrations } from './config.js';
import { log, err } from './logging.js';
import { S } from './state.js';
import { formatKeyDisplay, parsePriceLevels } from './chart.js';
import { getNicknameMap, clearAllNicknames } from './nicknames.js';

${rewriteState(slice(1048, 1722))}

export { createSettingsUI, destroySettingsUI, openSettings, closeSettings };
`);

// ─── orders.js ──────────────────────────────────────────────────────
write('orders.js', `// ─── Order Placement & Break-Even ───────────────────────────────────
import { CONFIG, OrderType, Side } from './config.js';
import { log, warn, err } from './logging.js';
import { services } from './state.js';
import {
  getActiveSymbol, getTickSize, snapPrice, formatPrice,
  getCurrentPrice, getQty,
} from './chart.js';

${rewriteState(slice(782, 825))}

${rewriteState(slice(2139, 2189))}

export { moveStopToBreakeven, placeOrderAtPrice };
`);

// ─── events.js ──────────────────────────────────────────────────────
write('events.js', `// ─── Event Handlers ─────────────────────────────────────────────────
import { log } from './logging.js';
import { S } from './state.js';
import { getTickSize, snapPrice, setContractSize } from './chart.js';
import { getPaneCanvasRect, coordToPrice, ensureCanvas } from './canvas.js';
import { moveStopToBreakeven, placeOrderAtPrice } from './orders.js';

${rewriteState(slice(2192, 2317))}

export {
  resolveMousePrice, onKeyDown, onKeyUp,
  onIframeMouseMove, onIframeMouseDown, onIframeMouseUp, onContextMenu,
};
`);

// ─── index.js (entry point) ─────────────────────────────────────────
write('index.js', `// ─── Entry Point ────────────────────────────────────────────────────
// Rollup bundles this into a single IIFE for Tampermonkey.
import { CONFIG } from './config.js';
import { log, warn, err } from './logging.js';
import { services, S } from './state.js';
import { loadConfig } from './config.js';
import { startNicknameObserver, stopNicknameObserver } from './nicknames.js';
import { getActiveSymbol, getTickSize, getCurrentPrice, getQty } from './chart.js';
import { ensureCanvas, resizeCanvas, draw, resetCanvasCaches } from './canvas.js';
import { createSettingsUI, destroySettingsUI } from './settings.js';
import {
  onKeyDown, onKeyUp,
  onIframeMouseMove, onIframeMouseDown, onIframeMouseUp, onContextMenu,
} from './events.js';

${rewriteState(slice(2325, 2572))}
`);

console.log('\nDone! Run "npm run build" to verify.');
