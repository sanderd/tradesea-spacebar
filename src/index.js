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
import { initProvider } from './platform/provider.js';
import { checkPlatformVersion } from './version.js';

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
  // 0. Detect platform and initialize provider
  const provider = initProvider();
  if (!provider) {
    err('Unknown platform — script disabled');
    return;
  }
  S.provider = provider;
  log(`Platform: ${provider.name}`);

  // 1. Nickname observer (only on platforms that need it)
  if (provider.hasNicknameSupport) {
    startNicknameObserver();
  }

  // On account-center pages (TradeSea), only nickname feature is needed
  if (provider.isAccountPage()) {
    log('Account page — nickname-only mode');
    return;
  }

  // 2. Discover services
  //    TradeSea: import Vite bundle → scan ES module exports
  //    PX:       walk React fiber tree → find context providers
  //    PX may show an environment picker before bootstrapping,
  //    so we retry until the fiber tree is populated.
  let bundleUrl;
  let retries = 0;
  while (!bundleUrl && retries < CONFIG.INIT_MAX_RETRIES) {
    bundleUrl = provider.findBundleUrl();
    if (!bundleUrl) { await new Promise(r => setTimeout(r, CONFIG.INIT_POLL_MS)); retries++; }
  }
  if (!bundleUrl) { err('Bundle not found'); return; }

  let mod;
  try { mod = await import(bundleUrl); }
  catch (e) { err('Import failed:', e.message); return; }

  // Retry discovery — fiber tree may not be ready yet (e.g. PX environment picker).
  // When accountCtx is found but orderCtx isn't, we're on the environment selector screen —
  // keep waiting indefinitely (user hasn't clicked LAUNCH SIM/LIVE yet).
  retries = 0;
  let discoveryOk = false;
  let envPickerLogged = false;
  while (!discoveryOk) {
    try { discoveryOk = await provider.discoverServices(mod, { silent: true }); }
    catch (_) {}

    if (discoveryOk) break;

    // Detect environment picker: accountService set but tradingService missing
    const waitingForEnvPick = !!services.accountService && !services.tradingService;
    if (waitingForEnvPick) {
      if (!envPickerLogged) {
        log('Waiting for environment selection (LAUNCH SIM / LAUNCH LIVE)...');
        envPickerLogged = true;
      }
      // Longer interval while waiting for user action
      await new Promise(r => setTimeout(r, 2000));
      retries++;
      continue;
    }

    // Normal retry (app not yet bootstrapped)
    if (retries >= CONFIG.INIT_MAX_RETRIES) break;
    await new Promise(r => setTimeout(r, CONFIG.INIT_POLL_MS));
    retries++;
  }

  if (!discoveryOk) {
    // One final loud attempt for diagnostic logging
    try { await provider.discoverServices(mod); } catch (_) {}
  }

  if (!services.tradingService || !services.accountService) {
    err('Required services not found (after', retries, 'retries)');
    return;
  }

  if (retries > 0) log(`Service discovery completed after ${retries} retries`);

  log('Services:',
    'Trading:', !!services.tradingService,
    'Account:', !!services.accountService,
    'Symbol:', !!services.symbolService,
    'Quantity:', !!services.quantityService,
    'Position:', !!services.positionService,
    'Instrument:', !!services.instrumentService,
    'Controller:', !!services.orderController
  );

  // Version compatibility check (PX only — TradeSea has no version indicator)
  checkPlatformVersion();

  // 3. Wait for TradingView iframe
  try {
    const { iframe, doc, win } = await waitForIframe();
    S.iframeEl = iframe;
    S.iframeDoc = doc;
    S.iframeWin = win;
    log('Iframe ready');
  } catch (e) { err(e.message); return; }

  // 4. Load config & create settings UI
  S.userConfig = loadConfig();
  createSettingsUI();

  // 5. Attach event listeners
  attachEventListeners();

  // 6. Create canvas overlay + start draw loop (always on, for price levels)
  ensureCanvas();
  S.rafId = requestAnimationFrame(draw);

  // 7. Expose API
  window.tsSpacebar = {
    get active() { return S.spaceHeld; },
    get price() { return S.mousePrice; },
    get ltp() { return getCurrentPrice(); },
    get symbol() { return getActiveSymbol(); },
    get qty() { return getQty(); },
    set qty(n) { services.orderController?.setQuantity(n); },
    get tickSize() { return getTickSize(); },
    get ready() { return !!(services.tradingService && services.accountService && S.iframeDoc); },
    get platform() { return provider.id; },
    destroy() { teardown(); delete window.tsSpacebar; log('Destroyed'); },
    // Debug: scan all bundle exports (useful for discovering service signatures)
    probeExports: provider.probeExports ? () => provider.probeExports() : undefined,
  };

  const acct = provider.getCurrentAccount();
  log('✅ Ready!');
  log('  Platform:', provider.name);
  log('  Account:', provider.getAccountDisplayName(acct));
  log('  Tick size:', getTickSize());
  log('  Hold SPACEBAR over chart, then:');
  log('    Left-click  → BUY  (limit below market, stop above)');
  log('    Right-click → SELL (limit above market, stop below)');

  // 8. Start iframe watchdog (handles account switching)
  startIframeWatchdog();
}

// ═══════════════════════════════════════════════════════════════════
//  TEARDOWN — resets all state so init() can safely re-run
// ═══════════════════════════════════════════════════════════════════
function teardown() {
  stopIframeWatchdog();
  if (S.provider?.hasNicknameSupport) stopNicknameObserver();
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
    // Small delay to let the framework re-bootstrap
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
