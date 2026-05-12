// ─── Entry Point ────────────────────────────────────────────────────
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

function findMainBundleUrl() {
  const entry = performance.getEntriesByType('resource')
    .find(e => e.name.includes('/assets/main-') && e.name.endsWith('.js'));
  return entry ? entry.name : null;
}

async function discoverServices(mod) {
  for (const [, val] of Object.entries(mod)) {
    if (!val || typeof val !== 'object') continue;
    try { if (!services.tradingService && typeof val.placeOrder === 'function') services.tradingService = val; } catch (e) { }
    try { if (!services.orderController && typeof val.handlePlaceOrder === 'function') services.orderController = val; } catch (e) { }
    try { if (!services.accountService && typeof val.getCurrentAccount === 'function') services.accountService = val; } catch (e) { }
    try { if (!services.symbolService && typeof val.getCurrentSymbol === 'function' && typeof val.getTickSize === 'function') services.symbolService = val; } catch (e) { }
    try { if (!services.quantityService && typeof val.getQuantity === 'function' && typeof val.setQuantity === 'function') services.quantityService = val; } catch (e) { }
    try { if (!services.positionService && typeof val.getPositions === 'function' && typeof val.getPositionBySymbol === 'function') services.positionService = val; } catch (e) { }
    try { if (!services.instrumentService && typeof val.getInstrumentBySymbol === 'function' && typeof val.getSelectedInstrument === 'function') services.instrumentService = val; } catch (e) { }
  }
  return !!(services.tradingService && services.accountService);
}

function attachEventListeners() {
  // Main window — spacebar (works even when iframe has focus because capture phase)
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('resize', resizeCanvas);
  S.cleanupFns.push(() => {
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('resize', resizeCanvas);
  });

  // Iframe — mouse events + keyboard backup + context menu suppression
  if (S.iframeWin) {
    S.iframeWin.addEventListener('keydown', onKeyDown, true);
    S.iframeWin.addEventListener('keyup', onKeyUp, true);
    S.iframeWin.addEventListener('mousemove', onIframeMouseMove, true);
    S.iframeWin.addEventListener('mousedown', onIframeMouseDown, true);
    S.iframeWin.addEventListener('mouseup', onIframeMouseUp, true);
    S.iframeWin.addEventListener('contextmenu', onContextMenu, true);

    S.cleanupFns.push(() => {
      S.iframeWin.removeEventListener('keydown', onKeyDown, true);
      S.iframeWin.removeEventListener('keyup', onKeyUp, true);
      S.iframeWin.removeEventListener('mousemove', onIframeMouseMove, true);
      S.iframeWin.removeEventListener('mousedown', onIframeMouseDown, true);
      S.iframeWin.removeEventListener('mouseup', onIframeMouseUp, true);
      S.iframeWin.removeEventListener('contextmenu', onContextMenu, true);
    });
  }
}

function waitForIframe() {
  return new Promise((resolve, reject) => {
    let retries = 0;
    const check = () => {
      retries++;
      const iframe = document.querySelector('iframe');
      if (iframe) {
        try {
          const doc = iframe.contentDocument || iframe.contentWindow.document;
          const win = iframe.contentWindow;
          if (doc && win && win.tradingViewApi) {
            resolve({ iframe, doc, win });
            return;
          }
        } catch (e) { /* cross-origin, keep trying */ }
      }
      if (retries >= CONFIG.INIT_MAX_RETRIES) {
        reject(new Error('TradingView iframe not accessible'));
        return;
      }
      setTimeout(check, CONFIG.INIT_POLL_MS);
    };
    check();
  });
}

async function init() {
  log('Initializing v2...');

  // 0. Always start nickname observer (works on both /trade and /account-center)
  startNicknameObserver();

  // On /account-center pages, only the nickname feature is needed
  if (window.location.pathname.includes('account-center')) {
    log('Account center page — nickname-only mode');
    return;
  }

  // 1. Discover TradeSea services from main bundle
  let bundleUrl;
  let retries = 0;
  while (!bundleUrl && retries < CONFIG.INIT_MAX_RETRIES) {
    bundleUrl = findMainBundleUrl();
    if (!bundleUrl) { await new Promise(r => setTimeout(r, CONFIG.INIT_POLL_MS)); retries++; }
  }
  if (!bundleUrl) { err('Bundle not found'); return; }

  try {
    const mod = await import(bundleUrl);
    await discoverServices(mod);
  } catch (e) { err('Import failed:', e.message); return; }

  if (!services.tradingService || !services.accountService) {
    err('Required services not found');
    return;
  }

  log('Services:',
    'Trading:', !!services.tradingService,
    'Account:', !!services.accountService,
    'Symbol:', !!services.symbolService,
    'Quantity:', !!services.quantityService,
    'Position:', !!services.positionService,
    'Instrument:', !!services.instrumentService,
    'Controller:', !!services.orderController
  );

  // 2. Wait for TradingView iframe
  try {
    const { iframe, doc, win } = await waitForIframe();
    S.iframeEl = iframe;
    S.iframeDoc = doc;
    S.iframeWin = win;
    log('Iframe ready');
  } catch (e) { err(e.message); return; }

  // 3. Load config & create settings UI
  S.userConfig = loadConfig();
  createSettingsUI();

  // 4. Attach event listeners
  attachEventListeners();

  // 5. Create canvas overlay + start draw loop (always on, for price levels)
  ensureCanvas();
  S.rafId = requestAnimationFrame(draw);

  // 6. Expose API
  window.tsSpacebar = {
    get active() { return S.spaceHeld; },
    get price() { return S.mousePrice; },
    get ltp() { return getCurrentPrice(); },
    get symbol() { return getActiveSymbol(); },
    get qty() { return getQty(); },
    set qty(n) { services.orderController?.setQuantity(n); },
    get tickSize() { return getTickSize(); },
    get ready() { return !!(services.tradingService && services.accountService && S.iframeDoc); },
    destroy() { teardown(); delete window.tsSpacebar; log('Destroyed'); },
  };

  const acct = services.accountService.getCurrentAccount();
  log('✅ Ready!');
  log('  Account:', acct?.propFirmDisplayName || acct?.name);
  log('  Tick size:', getTickSize());
  log('  Hold SPACEBAR over chart, then:');
  log('    Left-click  → BUY  (limit below market, stop above)');
  log('    Right-click → SELL (limit above market, stop below)');

  // 7. Start iframe watchdog (handles FundedSeat account switching)
  startIframeWatchdog();
}

// ═══════════════════════════════════════════════════════════════════
//  TEARDOWN — resets all state so init() can safely re-run
// ═══════════════════════════════════════════════════════════════════
function teardown() {
  stopIframeWatchdog();
  stopNicknameObserver();
  S.cleanupFns.forEach(fn => { try { fn(); } catch (_) {} });
  S.cleanupFns = [];
  if (S.rafId) { cancelAnimationFrame(S.rafId); S.rafId = null; }
  if (S.canvas && S.canvas.parentNode) S.canvas.parentNode.removeChild(S.canvas);
  S.canvas = null; S.ctx = null;
  destroySettingsUI();
  S.spaceHeld = false;
  S.pendingOrder = null;
  S.mouseY = null; S.mousePrice = null;
  S.lastIframeMouseX = null; S.lastIframeMouseY = null;
  S.iframeEl = null; S.iframeDoc = null; S.iframeWin = null;
  resetCanvasCaches();
  for (const key of Object.keys(services)) services[key] = null;
}

// ═══════════════════════════════════════════════════════════════════
//  IFRAME WATCHDOG — detects account switches / iframe replacement
// ═══════════════════════════════════════════════════════════════════
let _watchdogTimer = null;
let _reinitializing = false;
const WATCHDOG_INTERVAL_MS = 2000;

function startIframeWatchdog() {
  stopIframeWatchdog();
  _watchdogTimer = setInterval(checkIframeHealth, WATCHDOG_INTERVAL_MS);
}

function stopIframeWatchdog() {
  if (_watchdogTimer) { clearInterval(_watchdogTimer); _watchdogTimer = null; }
}

function checkIframeHealth() {
  if (_reinitializing) return;

  // Check 1: is the cached iframe still in the DOM?
  const stillAttached = S.iframeEl && S.iframeEl.isConnected;

  // Check 2: does the iframe's contentWindow still match what we captured?
  let windowChanged = false;
  if (stillAttached) {
    try {
      windowChanged = S.iframeEl.contentWindow !== S.iframeWin;
    } catch (_) {
      windowChanged = true; // cross-origin = definitely changed
    }
  }

  // Check 3: did a new iframe appear that we don't have a reference to?
  const currentIframe = document.querySelector('iframe');
  const iframeSwapped = currentIframe && currentIframe !== S.iframeEl;

  if (!stillAttached || windowChanged || iframeSwapped) {
    warn('Iframe changed (account switch detected) — reinitializing...');
    reinitialize();
  }
}

async function reinitialize() {
  if (_reinitializing) return;
  _reinitializing = true;

  try {
    teardown();
    // Small delay to let Angular re-bootstrap
    await new Promise(r => setTimeout(r, 1500));
    await init();
  } catch (e) {
    err('Reinit failed:', e.message);
  } finally {
    _reinitializing = false;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════════
init();
