// ==UserScript==
// @name         TradeSea Spacebar Trading
// @version      2.0.0
// @description  Hold spacebar to enter quick-order mode. Left-click = Buy, Right-click = Sell. Price & type auto-resolve from mouse position.
// @match        https://app.tradesea.ai/trade*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ─── Configuration ──────────────────────────────────────────────────
  const CONFIG = {
    INIT_POLL_MS: 500,
    INIT_MAX_RETRIES: 60,
    DEFAULT_QTY: 1,
    DEFAULT_LOCALE: 'en-US',
    ORDER_SOURCE: 'ORDER_PAD',
    COLORS: {
      line: '#ff00ff',
      buyBg: '#00d4aa',
      sellBg: '#ff6b9d',
      labelText: '#000000',
    },
    LABEL_HEIGHT: 20,
    LABEL_FONT: 'bold 11px Inter, system-ui, -apple-system, sans-serif',
    DEBUG: true,
  };

  // ─── Enums ──────────────────────────────────────────────────────────
  const OrderType = { Limit: 1, Market: 2, Stop: 3, StopLimit: 4 };
  const Side = { Buy: 1, Sell: -1 };

  // ─── Logging ────────────────────────────────────────────────────────
  const PREFIX = '%c[TS-Spacebar]';
  const STYLE = 'color:#ff00ff;font-weight:bold';
  const log = (...a) => CONFIG.DEBUG && console.log(PREFIX, STYLE, ...a);
  const warn = (...a) => console.warn(PREFIX, 'color:#FFA500;font-weight:bold', ...a);
  const err = (...a) => console.error(PREFIX, 'color:#FF4444;font-weight:bold', ...a);

  // ─── State ──────────────────────────────────────────────────────────
  const services = {
    tradingService: null,
    orderController: null,
    accountService: null,
    symbolService: null,
    quantityService: null,  // getQuantity() / setQuantity(n)
  };

  let spaceHeld = false;
  let mouseY = null;   // Y coordinate relative to pane canvas (iframe-local)
  let mousePrice = null;   // Snapped price at mouseY
  let lastIframeMouseX = null;  // Last known mouse clientX inside iframe (always tracked)
  let lastIframeMouseY = null;  // Last known mouse clientY inside iframe (always tracked)
  let canvas = null;   // Overlay canvas (in MAIN document, over iframe)
  let ctx = null;
  let rafId = null;
  let iframeEl = null;
  let iframeDoc = null;
  let iframeWin = null;
  let cleanupFns = [];
  let userConfig = null;      // Loaded from localStorage
  let settingsOverlay = null; // Settings modal element
  let settingsBtn = null;     // Sidebar gear button

  // ─── Persisted Configuration ───────────────────────────────────────
  const STORAGE_KEY = 'ts-spacebar-config';
  const CONFIG_VERSION = 2;

  const DEFAULT_CONFIG = {
    version: 2,
    hotkeyWithoutSpacebar: true,
    contractSlots: [
      { qty: 1, hotkey: null },
      { qty: 2, hotkey: null },
      { qty: 3, hotkey: null },
      { qty: 4, hotkey: null },
      { qty: 5, hotkey: null },
    ],
  };

  // Each entry: { fromVersion, toVersion, migrate(cfg) → cfg }
  const MIGRATIONS = [
    { fromVersion: 1, toVersion: 2, migrate: (cfg) => {
      cfg.version = 2;
      cfg.hotkeyWithoutSpacebar = true;
      return cfg;
    }},
  ];

  function applyMigrations(cfg) {
    if (!cfg.version) cfg.version = 0;
    let changed = false;
    for (const m of MIGRATIONS) {
      if (cfg.version === m.fromVersion) {
        cfg = m.migrate(cfg);
        changed = true;
      }
    }
    if (cfg.version < CONFIG_VERSION) {
      warn(`Config v${cfg.version} cannot migrate to v${CONFIG_VERSION}, resetting`);
      return structuredClone(DEFAULT_CONFIG);
    }
    if (changed) saveConfig(cfg);
    return cfg;
  }

  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(DEFAULT_CONFIG);
      return applyMigrations(JSON.parse(raw));
    } catch (e) {
      warn('Config load failed, using defaults:', e.message);
      return structuredClone(DEFAULT_CONFIG);
    }
  }

  function saveConfig(cfg) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
      log('Config saved');
    } catch (e) { err('Config save failed:', e.message); }
  }

  function formatKeyDisplay(code) {
    if (!code) return '';
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
    if (code === 'Backquote') return '`';
    if (code === 'Minus') return '-';
    if (code === 'Equal') return '=';
    if (code === 'BracketLeft') return '[';
    if (code === 'BracketRight') return ']';
    if (code === 'Semicolon') return ';';
    if (code === 'Quote') return "'";
    if (code === 'Comma') return ',';
    if (code === 'Period') return '.';
    if (code === 'Slash') return '/';
    return code;
  }

  function setContractSize(qty) {
    if (services.quantityService) {
      try { services.quantityService.setQuantity(qty); } catch (e) { /* */ }
    }
    log(`Contract size → ${qty}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  1. SYMBOL + PRICE HELPERS
  // ═══════════════════════════════════════════════════════════════════

  function getTvApi() {
    try { return iframeWin?.tradingViewApi; } catch (e) { return null; }
  }

  function getActiveChart() {
    return getTvApi()?.activeChart() ?? null;
  }

  function getActiveSymbol() {
    if (services.symbolService) {
      try {
        const sym = services.symbolService.getCurrentSymbol();
        if (sym) return sym;
      } catch (e) { /* fall through */ }
    }
    try {
      const info = getActiveChart()?.symbolExt?.();
      if (info?.ticker) return info.ticker;
    } catch (e) { /* fall through */ }
    return null;
  }

  function getTickSize() {
    if (!services.symbolService) return null;
    try {
      const ts = services.symbolService.getTickSize();
      return (ts != null && ts > 0) ? Number(ts) : null;
    } catch (e) { return null; }
  }

  function snapPrice(price, tickSize) {
    return Math.round(price / tickSize) * tickSize;
  }

  function formatPrice(price, tickSize) {
    const str = tickSize.toString();
    const decIdx = str.indexOf('.');
    const decimals = decIdx === -1 ? 0 : str.length - decIdx - 1;
    return price.toFixed(decimals);
  }

  function getCurrentPrice() {
    // Direct from TradeSea's symbol service — tracks the active chart's live feed
    if (services.symbolService) {
      try {
        const p = services.symbolService.getCurrentPrice();
        if (p != null && p > 0) return Number(p);
      } catch (e) { /* fall through */ }
    }
    return null;
  }

  function getQty() {
    // quantityService is the dedicated lot-size tracker (separate from orderController)
    if (services.quantityService) {
      try {
        const q = services.quantityService.getQuantity();
        if (q != null && q > 0) return Number(q);
      } catch (e) { /* fall through */ }
    }
    return CONFIG.DEFAULT_QTY;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  2. COORDINATE ↔ PRICE CONVERSION
  //
  //  TradingView's embedded widget exposes coordinateToPrice() on the
  //  pane's price scale, but NOT priceToCoordinate().
  //  We derive priceToCoord via linear interpolation from two samples.
  // ═══════════════════════════════════════════════════════════════════

  function getPriceScale() {
    try {
      const chart = getActiveChart();
      if (!chart) return null;
      const panes = chart.getPanes();
      if (!panes || panes.length === 0) return null;
      return panes[0].getMainSourcePriceScale?.()
        || panes[0].getRightPriceScale?.()
        || panes[0].getLeftPriceScale?.()
        || null;
    } catch (e) { return null; }
  }

  function coordToPrice(y) {
    try {
      const scale = getPriceScale();
      if (!scale) return null;
      const price = scale.coordinateToPrice(y);
      return (price != null && isFinite(price)) ? Number(price) : null;
    } catch (e) { return null; }
  }

  /**
   * Convert price → pane-local Y coordinate.
   * Since priceToCoordinate() doesn't exist, we sample two Y positions,
   * get their prices, and linear-interpolate.
   */
  function priceToCoord(price) {
    const scale = getPriceScale();
    if (!scale) return null;

    // Sample at two Y positions within the pane
    const y1 = 50, y2 = 300;
    let p1, p2;
    try {
      p1 = scale.coordinateToPrice(y1);
      p2 = scale.coordinateToPrice(y2);
    } catch (e) { return null; }

    if (p1 == null || p2 == null || !isFinite(p1) || !isFinite(p2)) return null;
    if (Math.abs(p2 - p1) < 1e-10) return null; // degenerate

    // Linear interpolation:  y = y1 + (price - p1) * (y2 - y1) / (p2 - p1)
    const y = y1 + (price - p1) * (y2 - y1) / (p2 - p1);
    return isFinite(y) ? y : null;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  3. CHART PANE RECT (iframe-relative, for coordinateToPrice)
  //     + IFRAME RECT (main-doc-relative, for canvas drawing)
  // ═══════════════════════════════════════════════════════════════════

  /** Bounding rect of the main price pane canvas, relative to the iframe viewport. */
  function getPaneCanvasRect() {
    if (!iframeDoc) return null;
    try {
      const container = iframeDoc.querySelector('.chart-container.active')
        || iframeDoc.querySelector('.chart-container');
      if (!container) return null;
      const wrapper = container.querySelector('.chart-gui-wrapper');
      if (wrapper) {
        const c = wrapper.querySelector('canvas');
        if (c) return c.getBoundingClientRect();
      }
      const c = container.querySelector('canvas');
      return c ? c.getBoundingClientRect() : container.getBoundingClientRect();
    } catch (e) { return null; }
  }

  /** Returns the iframe element's bounding rect in the main document. */
  function getIframeRect() {
    if (!iframeEl) return null;
    return iframeEl.getBoundingClientRect();
  }

  // ═══════════════════════════════════════════════════════════════════
  //  4. CANVAS OVERLAY — Lives in the MAIN document, over the iframe
  // ═══════════════════════════════════════════════════════════════════

  function ensureCanvas() {
    if (canvas && canvas.parentNode) return true;
    try {
      canvas = document.createElement('canvas');
      canvas.id = 'ts-spacebar-overlay';
      canvas.style.cssText = `
        position: fixed;
        top: 0; left: 0;
        width: 100vw; height: 100vh;
        pointer-events: none;
        z-index: 999999;
      `;
      document.body.appendChild(canvas);
      ctx = canvas.getContext('2d');
      resizeCanvas();
      log('Canvas created (main document)');
      return true;
    } catch (e) {
      err('Canvas creation failed:', e.message);
      return false;
    }
  }

  function resizeCanvas() {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  4b. SETTINGS UI
  // ═══════════════════════════════════════════════════════════════════

  const SETTINGS_CSS = `
    #ts-sb-btn {
      width: 100%; height: 40px; border-radius: 8px;
      background: transparent; border: 1px solid transparent;
      color: #ff00ff; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; transition: all .2s ease;
      margin-bottom: 8px;
    }
    #ts-sb-btn:hover {
      background: rgba(255,0,255,0.1); border-color: rgba(255,0,255,0.3);
    }
    #ts-sb-backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.55); backdrop-filter: blur(6px);
      z-index: 1000000; display: flex; align-items: center; justify-content: center;
    }
    #ts-sb-panel {
      background: rgba(18,18,28,0.97); border: 1px solid rgba(255,0,255,0.2);
      border-radius: 16px; padding: 28px 32px; min-width: 440px;
      box-shadow: 0 24px 80px rgba(0,0,0,0.6), 0 0 60px rgba(255,0,255,0.08);
      font-family: Inter, system-ui, -apple-system, sans-serif; color: #d8d8e4;
    }
    #ts-sb-panel h2 {
      margin: 0 0 4px 0; font-size: 15px; color: #ff00ff; font-weight: 600;
      letter-spacing: 0.3px;
    }
    .ts-sb-subtitle {
      font-size: 11px; color: #666; margin-bottom: 18px;
    }
    .ts-sb-section-label {
      font-size: 11px; color: #888; text-transform: uppercase;
      letter-spacing: 1.2px; margin-bottom: 10px;
    }
    .ts-sb-row {
      display: flex; align-items: center; gap: 10px; margin-bottom: 8px;
    }
    .ts-sb-row span.slot-label {
      width: 44px; font-size: 12px; color: #666; flex-shrink: 0;
    }
    .ts-sb-qty {
      width: 60px; padding: 6px 8px; border-radius: 8px;
      background: rgba(40,40,55,0.9); border: 1px solid rgba(255,255,255,0.08);
      color: #e0e0ec; font-size: 13px; text-align: center;
      font-family: inherit; outline: none; transition: border-color .15s;
      -moz-appearance: textfield;
    }
    .ts-sb-qty::-webkit-inner-spin-button,
    .ts-sb-qty::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
    .ts-sb-qty:focus { border-color: rgba(255,0,255,0.4); }
    .ts-sb-hk {
      width: 120px; padding: 6px 10px; border-radius: 8px;
      background: rgba(40,40,55,0.9); border: 1px solid rgba(255,255,255,0.08);
      color: #c8c8d8; font-size: 12px; text-align: center;
      font-family: inherit; outline: none; cursor: pointer;
      transition: border-color .15s, background .15s;
    }
    .ts-sb-hk:focus {
      border-color: rgba(255,0,255,0.5); background: rgba(255,0,255,0.06);
    }
    .ts-sb-hk::placeholder { color: #555; }
    .ts-sb-clear {
      width: 24px; height: 24px; border-radius: 6px; border: none;
      background: transparent; color: #555; cursor: pointer;
      font-size: 13px; display: flex; align-items: center; justify-content: center;
      transition: all .15s;
    }
    .ts-sb-clear:hover { background: rgba(255,80,80,0.15); color: #ff5555; }
    .ts-sb-lots { font-size: 11px; color: #555; flex-shrink: 0; }
    .ts-sb-actions {
      display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px;
      padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.05);
    }
    .ts-sb-btn-cancel, .ts-sb-btn-save {
      padding: 7px 20px; border-radius: 8px; border: none;
      font-size: 12px; font-weight: 600; cursor: pointer;
      font-family: inherit; transition: all .15s;
    }
    .ts-sb-btn-cancel {
      background: rgba(50,50,60,0.8); color: #999;
    }
    .ts-sb-btn-cancel:hover { background: rgba(60,60,70,0.9); color: #bbb; }
    .ts-sb-btn-save {
      background: rgba(255,0,255,0.15); color: #ff00ff;
      border: 1px solid rgba(255,0,255,0.3);
    }
    .ts-sb-btn-save:hover {
      background: rgba(255,0,255,0.25); border-color: rgba(255,0,255,0.5);
    }
    .ts-sb-close {
      background: none; border: none; color: #666; font-size: 18px;
      cursor: pointer; padding: 4px 8px; border-radius: 6px;
      transition: all .15s; line-height: 1;
    }
    .ts-sb-close:hover { color: #ff5555; background: rgba(255,80,80,0.1); }
  `;

  function createSettingsUI() {
    const style = document.createElement('style');
    style.id = 'ts-sb-style';
    style.textContent = SETTINGS_CSS;
    document.head.appendChild(style);

    settingsBtn = document.createElement('button');
    settingsBtn.id = 'ts-sb-btn';
    settingsBtn.innerHTML = '🚀';
    settingsBtn.title = 'Spacebar Trading Settings';
    settingsBtn.addEventListener('click', openSettings);

    // Insert into the sidebar DOM between Account Center and Logout
    const sidebarBottom = document.querySelector('aside > div.border-t');
    const logoutBtn = sidebarBottom?.querySelector('#logout-btn, button[aria-label="Logout"]');
    if (sidebarBottom && logoutBtn) {
      sidebarBottom.insertBefore(settingsBtn, logoutBtn);
    } else if (sidebarBottom) {
      sidebarBottom.appendChild(settingsBtn);
    } else {
      // Fallback: fixed position if sidebar not found
      settingsBtn.style.cssText = 'position:fixed;bottom:80px;left:12px;width:36px;height:36px;z-index:999998;';
      document.body.appendChild(settingsBtn);
    }
    log('Settings button created');
  }

  function destroySettingsUI() {
    closeSettings();
    if (settingsBtn && settingsBtn.parentNode) settingsBtn.parentNode.removeChild(settingsBtn);
    settingsBtn = null;
    const style = document.getElementById('ts-sb-style');
    if (style) style.remove();
  }

  function openSettings() {
    if (settingsOverlay) return;
    const cfg = loadConfig();

    settingsOverlay = document.createElement('div');
    settingsOverlay.id = 'ts-sb-backdrop';

    let rows = '';
    for (let i = 0; i < 5; i++) {
      const s = cfg.contractSlots[i] || { qty: i + 1, hotkey: null };
      rows += `
        <div class="ts-sb-row">
          <span class="slot-label">Slot ${i + 1}</span>
          <input type="number" class="ts-sb-qty" data-slot="${i}" value="${s.qty}" min="1" max="999">
          <span class="ts-sb-lots">lots</span>
          <input type="text" class="ts-sb-hk" data-slot="${i}" data-code="${s.hotkey || ''}"
                 value="${formatKeyDisplay(s.hotkey)}" placeholder="Click \u2192 press key" readonly>
          <button class="ts-sb-clear" data-slot="${i}" title="Clear hotkey">\u2715</button>
        </div>`;
    }

    settingsOverlay.innerHTML = `
      <div id="ts-sb-panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2>\u2699\uFE0F Spacebar Trading Settings</h2>
          <button class="ts-sb-close" id="ts-sb-close">\u2715</button>
        </div>
        <div class="ts-sb-section-label">Contract Sizes</div>
        <div class="ts-sb-subtitle">Press hotkey to switch size instantly</div>
        ${rows}
        <div class="ts-sb-row" style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.05)">
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:12px;color:#aaa">
            <input type="checkbox" id="ts-sb-global-hk" ${cfg.hotkeyWithoutSpacebar ? 'checked' : ''}
                   style="accent-color:#ff00ff;width:16px;height:16px;cursor:pointer">
            Hotkeys work without holding spacebar
          </label>
        </div>
        <div class="ts-sb-actions">
          <button class="ts-sb-btn-cancel" id="ts-sb-cancel">Cancel</button>
          <button class="ts-sb-btn-save" id="ts-sb-save">Save</button>
        </div>
      </div>`;

    document.body.appendChild(settingsOverlay);

    // Close handlers
    settingsOverlay.querySelector('#ts-sb-close').addEventListener('click', closeSettings);
    settingsOverlay.querySelector('#ts-sb-cancel').addEventListener('click', closeSettings);
    settingsOverlay.addEventListener('click', (e) => { if (e.target === settingsOverlay) closeSettings(); });

    // Save handler
    settingsOverlay.querySelector('#ts-sb-save').addEventListener('click', () => {
      const newCfg = structuredClone(DEFAULT_CONFIG);
      newCfg.hotkeyWithoutSpacebar = settingsOverlay.querySelector('#ts-sb-global-hk')?.checked ?? true;
      settingsOverlay.querySelectorAll('.ts-sb-qty').forEach(inp => {
        const i = parseInt(inp.dataset.slot);
        newCfg.contractSlots[i].qty = Math.max(1, parseInt(inp.value) || 1);
      });
      settingsOverlay.querySelectorAll('.ts-sb-hk').forEach(inp => {
        const i = parseInt(inp.dataset.slot);
        newCfg.contractSlots[i].hotkey = inp.dataset.code || null;
      });
      saveConfig(newCfg);
      userConfig = newCfg;
      closeSettings();
    });

    // Hotkey recording on focus + keydown
    settingsOverlay.querySelectorAll('.ts-sb-hk').forEach(inp => {
      inp.addEventListener('keydown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.code === 'Escape') { inp.blur(); return; }
        if (e.code === 'Backspace' || e.code === 'Delete') {
          inp.value = ''; inp.dataset.code = ''; return;
        }
        if (e.code === 'Space') return; // Reserved
        inp.value = formatKeyDisplay(e.code);
        inp.dataset.code = e.code;
      });
    });

    // Clear hotkey buttons
    settingsOverlay.querySelectorAll('.ts-sb-clear').forEach(btn => {
      btn.addEventListener('click', () => {
        const inp = settingsOverlay.querySelector(`.ts-sb-hk[data-slot="${btn.dataset.slot}"]`);
        if (inp) { inp.value = ''; inp.dataset.code = ''; }
      });
    });
  }

  function closeSettings() {
    if (settingsOverlay && settingsOverlay.parentNode) {
      settingsOverlay.parentNode.removeChild(settingsOverlay);
    }
    settingsOverlay = null;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  5. DRAW LOOP
  // ═══════════════════════════════════════════════════════════════════

  // ── Helper: collect all chart pane rects for a given symbol ─────
  function getAllPaneRectsForSymbol(activeSymbol) {
    const results = [];
    if (!iframeWin || !iframeDoc) return results;

    const api = getTvApi();
    if (!api) return results;

    const count = api.chartsCount?.() || 1;
    const containers = iframeDoc.querySelectorAll('.chart-container');

    for (let i = 0; i < count; i++) {
      try {
        const chart = api.chart(i);
        if (!chart) continue;
        const sym = chart.symbol?.() || chart.symbolExt?.()?.ticker || '';
        // Normalize: strip exchange prefixes for comparison
        const normSym = sym.replace(/.*:/, '');
        const normActive = (activeSymbol || '').replace(/.*:/, '');
        if (normSym !== normActive) continue;

        // Get this chart's pane canvas rect (iframe-relative)
        const container = containers[i];
        if (!container) continue;
        const wrapper = container.querySelector('.chart-gui-wrapper');
        const canvasEl = wrapper?.querySelector('canvas') || container.querySelector('canvas');
        if (!canvasEl) continue;

        // Build a priceScale for this specific chart
        const panes = chart.getPanes();
        const scale = panes?.[0]?.getMainSourcePriceScale?.()
          || panes?.[0]?.getRightPriceScale?.()
          || panes?.[0]?.getLeftPriceScale?.();

        results.push({
          paneRect: canvasEl.getBoundingClientRect(),
          scale,
        });
      } catch (e) { /* skip broken chart */ }
    }
    return results;
  }

  function draw() {
    rafId = requestAnimationFrame(draw);

    if (!ctx || !spaceHeld || mousePrice == null) {
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const iframeRect = getIframeRect();
    if (!iframeRect) return;

    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    const tickSize = getTickSize();
    if (!tickSize) return;

    const ltp = getCurrentPrice();
    const qty = getQty();
    const priceStr = formatPrice(mousePrice, tickSize);
    const sym = getActiveSymbol();

    // Determine order types based on price vs current market
    let buyType, sellType;
    if (ltp != null) {
      buyType = mousePrice < ltp ? 'LIMIT' : 'STOP';
      sellType = mousePrice > ltp ? 'LIMIT' : 'STOP';
    } else {
      buyType = 'LIMIT';
      sellType = 'STOP';
    }

    // Get ALL chart panes showing the same symbol
    const panes = getAllPaneRectsForSymbol(sym);
    if (panes.length === 0) return;

    ctx.save();

    for (const { paneRect, scale } of panes) {
      if (!scale) continue;

      // Convert mousePrice to pane-local Y via linear interpolation
      let paneY;
      try {
        const y1 = 50, y2 = 300;
        const p1 = scale.coordinateToPrice(y1);
        const p2 = scale.coordinateToPrice(y2);
        if (p1 == null || p2 == null || !isFinite(p1) || !isFinite(p2)) continue;
        if (Math.abs(p2 - p1) < 1e-10) continue;
        paneY = y1 + (mousePrice - p1) * (y2 - y1) / (p2 - p1);
        if (!isFinite(paneY)) continue;
      } catch (e) { continue; }

      // Map to main-doc coordinates
      const drawY = iframeRect.top + paneRect.top + paneY;
      const clipTop = iframeRect.top + paneRect.top;
      const clipBottom = iframeRect.top + paneRect.top + paneRect.height;
      const clipLeft = iframeRect.left + paneRect.left;
      const clipRight = iframeRect.left + paneRect.left + paneRect.width;

      if (drawY < clipTop || drawY > clipBottom) continue;

      // Clip to this pane
      ctx.save();
      ctx.beginPath();
      ctx.rect(clipLeft, clipTop, clipRight - clipLeft, clipBottom - clipTop);
      ctx.clip();

      // ── Magenta horizontal line ─────────────────────────────
      ctx.beginPath();
      ctx.strokeStyle = CONFIG.COLORS.line;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 3]);
      ctx.moveTo(clipLeft, drawY);
      ctx.lineTo(clipRight, drawY);
      ctx.stroke();
      ctx.setLineDash([]);

      // ── Labels (centered on line, drawn on top) ────────────
      ctx.font = CONFIG.LABEL_FONT;
      const halfH = CONFIG.LABEL_HEIGHT / 2;

      const buyText = `BUY ${buyType} ${priceStr}`;
      const buyW = ctx.measureText(buyText).width + 16;
      const labelX = clipLeft + 8;

      ctx.fillStyle = CONFIG.COLORS.buyBg;
      ctx.fillRect(labelX, drawY - halfH, buyW, CONFIG.LABEL_HEIGHT);
      ctx.fillStyle = CONFIG.COLORS.labelText;
      ctx.textBaseline = 'middle';
      ctx.fillText(buyText, labelX + 8, drawY);

      const sellText = `SELL ${sellType} ${priceStr}`;
      const sellW = ctx.measureText(sellText).width + 16;
      const sellX = labelX + buyW + 6;

      ctx.fillStyle = CONFIG.COLORS.sellBg;
      ctx.fillRect(sellX, drawY - halfH, sellW, CONFIG.LABEL_HEIGHT);
      ctx.fillStyle = CONFIG.COLORS.labelText;
      ctx.fillText(sellText, sellX + 8, drawY);

      // ── Lot size indicator ──────────────────────────────────
      const qtyText = `${qty} lot${qty !== 1 ? 's' : ''}`;
      const qtyW = ctx.measureText(qtyText).width + 12;
      const qtyX = sellX + sellW + 6;
      ctx.fillStyle = 'rgba(60,60,70,1)';
      ctx.fillRect(qtyX, drawY - halfH, qtyW, CONFIG.LABEL_HEIGHT);
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.7;
      ctx.fillText(qtyText, qtyX + 6, drawY);
      ctx.globalAlpha = 1;

      // ── Current price marker (yellow dashed) ────────────────
      if (ltp != null) {
        let ltpPaneY;
        try {
          const y1 = 50, y2 = 300;
          const p1 = scale.coordinateToPrice(y1);
          const p2 = scale.coordinateToPrice(y2);
          ltpPaneY = y1 + (ltp - p1) * (y2 - y1) / (p2 - p1);
        } catch (e) { ltpPaneY = null; }

        if (ltpPaneY != null && isFinite(ltpPaneY)) {
          const ltpDrawY = iframeRect.top + paneRect.top + ltpPaneY;
          if (ltpDrawY >= clipTop && ltpDrawY <= clipBottom) {
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255,255,0,0.4)';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 4]);
            ctx.moveTo(clipLeft, ltpDrawY);
            ctx.lineTo(clipRight, ltpDrawY);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      }

      ctx.restore();
    }

    ctx.restore();
  }

  // ═══════════════════════════════════════════════════════════════════
  //  6. ORDER PLACEMENT
  // ═══════════════════════════════════════════════════════════════════

  async function placeOrderAtPrice(side, price) {
    if (!services.tradingService || !services.accountService) {
      err('Services not ready');
      return;
    }

    const acct = services.accountService.getCurrentAccount();
    if (!acct) { err('No account'); return; }

    const sym = getActiveSymbol();
    if (!sym) { err('No active symbol'); return; }

    const ltp = getCurrentPrice();
    const qty = getQty();
    const tickSize = getTickSize();
    const snapped = tickSize ? snapPrice(price, tickSize) : price;

    // Determine order type
    let orderType;
    if (side === 'buy') {
      orderType = (ltp != null && snapped < ltp) ? OrderType.Limit : OrderType.Stop;
    } else {
      orderType = (ltp != null && snapped > ltp) ? OrderType.Limit : OrderType.Stop;
    }

    const order = {
      symbol: sym,
      side: side === 'buy' ? Side.Buy : Side.Sell,
      type: orderType,
      qty,
    };

    if (orderType === OrderType.Limit) order.limitPrice = snapped;
    if (orderType === OrderType.Stop) order.stopPrice = snapped;

    const typeName = orderType === OrderType.Limit ? 'LIMIT' : 'STOP';
    const shortSym = sym.replace(/^[^:]+:/, '');
    log(`${side.toUpperCase()} ${typeName} ${qty}x ${shortSym} @ ${formatPrice(snapped, tickSize || 0.01)} (LTP: ${ltp})`);

    try {
      const result = await services.tradingService.placeOrder(
        order, acct.id, CONFIG.DEFAULT_LOCALE, CONFIG.ORDER_SOURCE
      );
      log('✅', result?.orderId?.substring(0, 8) + '...');
    } catch (e) {
      err('Order failed:', e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  7. EVENT HANDLERS
  // ═══════════════════════════════════════════════════════════════════

  /** Compute mousePrice from cached iframe mouse position */
  function resolveMousePrice() {
    if (lastIframeMouseX == null || lastIframeMouseY == null) return;

    const paneRect = getPaneCanvasRect();
    if (!paneRect) return;

    if (lastIframeMouseX < paneRect.left || lastIframeMouseX > paneRect.left + paneRect.width ||
      lastIframeMouseY < paneRect.top || lastIframeMouseY > paneRect.top + paneRect.height) {
      mousePrice = null;
      return;
    }

    const localY = lastIframeMouseY - paneRect.top;
    const rawPrice = coordToPrice(localY);
    if (rawPrice == null) { mousePrice = null; return; }

    const tickSize = getTickSize();
    mousePrice = tickSize ? snapPrice(rawPrice, tickSize) : rawPrice;
    mouseY = localY;
  }

  function onKeyDown(e) {
    if (settingsOverlay) return; // Don't intercept while settings open

    if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      e.stopPropagation();
      spaceHeld = true;
      ensureCanvas();
      resolveMousePrice();
      log('Quick-order mode ON');
      return;
    }

    // Contract-size hotkeys (during spacebar, or globally if enabled)
    if (userConfig && (spaceHeld || userConfig.hotkeyWithoutSpacebar)) {
      // Skip if a text input / textarea / contenteditable is focused
      const tag = (e.target?.tagName || '').toLowerCase();
      const editable = tag === 'input' || tag === 'textarea' || tag === 'select'
        || e.target?.isContentEditable;
      if (!editable) {
        const slot = userConfig.contractSlots.find(s => s.hotkey === e.code);
        if (slot) {
          e.preventDefault();
          e.stopPropagation();
          setContractSize(slot.qty);
        }
      }
    }
  }

  function onKeyUp(e) {
    if (e.code === 'Space') {
      e.preventDefault();
      e.stopPropagation();
      spaceHeld = false;
      mousePrice = null;
      mouseY = null;
      log('Quick-order mode OFF');
    }
  }

  /**
   * Mouse events from the IFRAME — clientX/Y are iframe-relative.
   * Always track position; resolve price only when spaceHeld.
   */
  function onIframeMouseMove(e) {
    // Always track, so spacebar-press can resolve price instantly
    lastIframeMouseX = e.clientX;
    lastIframeMouseY = e.clientY;

    if (!spaceHeld) return;
    resolveMousePrice();
  }

  function onIframeMouseDown(e) {
    if (!spaceHeld || mousePrice == null) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (e.button === 0) {
      placeOrderAtPrice('buy', mousePrice);
    } else if (e.button === 2) {
      placeOrderAtPrice('sell', mousePrice);
    }
  }

  function onContextMenu(e) {
    if (spaceHeld) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return false;
    }
  }

  // (Current price is read directly from symbolService.getCurrentPrice() — no polling needed)

  // ═══════════════════════════════════════════════════════════════════
  //  9. INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════

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
    }
    return !!(services.tradingService && services.accountService);
  }

  function attachEventListeners() {
    // Main window — spacebar (works even when iframe has focus because capture phase)
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('resize', resizeCanvas);
    cleanupFns.push(() => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('resize', resizeCanvas);
    });

    // Iframe — mouse events + keyboard backup + context menu suppression
    if (iframeWin) {
      iframeWin.addEventListener('keydown', onKeyDown, true);
      iframeWin.addEventListener('keyup', onKeyUp, true);
      iframeWin.addEventListener('mousemove', onIframeMouseMove, true);
      iframeWin.addEventListener('mousedown', onIframeMouseDown, true);
      iframeWin.addEventListener('contextmenu', onContextMenu, true);

      cleanupFns.push(() => {
        iframeWin.removeEventListener('keydown', onKeyDown, true);
        iframeWin.removeEventListener('keyup', onKeyUp, true);
        iframeWin.removeEventListener('mousemove', onIframeMouseMove, true);
        iframeWin.removeEventListener('mousedown', onIframeMouseDown, true);
        iframeWin.removeEventListener('contextmenu', onContextMenu, true);
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
      'Controller:', !!services.orderController
    );

    // 2. Wait for TradingView iframe
    try {
      const { iframe, doc, win } = await waitForIframe();
      iframeEl = iframe;
      iframeDoc = doc;
      iframeWin = win;
      log('Iframe ready');
    } catch (e) { err(e.message); return; }

    // 3. Load config & create settings UI
    userConfig = loadConfig();
    createSettingsUI();

    // 4. Attach event listeners
    attachEventListeners();

    // 5. Start draw loop
    rafId = requestAnimationFrame(draw);

    // 6. Expose API
    window.tsSpacebar = {
      get active() { return spaceHeld; },
      get price() { return mousePrice; },
      get ltp() { return getCurrentPrice(); },
      get symbol() { return getActiveSymbol(); },
      get qty() { return getQty(); },
      set qty(n) { services.orderController?.setQuantity(n); },
      get tickSize() { return getTickSize(); },
      get ready() { return !!(services.tradingService && services.accountService && iframeDoc); },
      destroy() {
        cleanupFns.forEach(fn => fn());
        cleanupFns = [];
        if (rafId) cancelAnimationFrame(rafId);
        if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
        canvas = null; ctx = null;
        destroySettingsUI();
        spaceHeld = false;
        delete window.tsSpacebar;
        log('Destroyed');
      },
    };

    const acct = services.accountService.getCurrentAccount();
    log('✅ Ready!');
    log('  Account:', acct?.propFirmDisplayName || acct?.name);
    log('  Tick size:', getTickSize());
    log('  Hold SPACEBAR over chart, then:');
    log('    Left-click  → BUY  (limit below market, stop above)');
    log('    Right-click → SELL (limit above market, stop below)');
  }

  // ═══════════════════════════════════════════════════════════════════
  //  BOOT
  // ═══════════════════════════════════════════════════════════════════
  init();

})();
