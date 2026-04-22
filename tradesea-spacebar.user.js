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
      line:       '#ff00ff',
      buyBg:      '#00d4aa',
      sellBg:     '#ff6b9d',
      labelText:  '#000000',
    },
    LABEL_HEIGHT: 20,
    LABEL_FONT: 'bold 11px Inter, system-ui, -apple-system, sans-serif',
    DEBUG: true,
  };

  // ─── Enums ──────────────────────────────────────────────────────────
  const OrderType = { Limit: 1, Market: 2, Stop: 3, StopLimit: 4 };
  const Side      = { Buy: 1, Sell: -1 };

  // ─── Logging ────────────────────────────────────────────────────────
  const PREFIX = '%c[TS-Spacebar]';
  const STYLE  = 'color:#ff00ff;font-weight:bold';
  const log  = (...a) => CONFIG.DEBUG && console.log(PREFIX, STYLE, ...a);
  const warn = (...a) => console.warn(PREFIX, 'color:#FFA500;font-weight:bold', ...a);
  const err  = (...a) => console.error(PREFIX, 'color:#FF4444;font-weight:bold', ...a);

  // ─── State ──────────────────────────────────────────────────────────
  const services = {
    tradingService:   null,
    orderController:  null,
    accountService:   null,
    symbolService:    null,
    quantityService:  null,  // getQuantity() / setQuantity(n)
  };

  let spaceHeld       = false;
  let mouseY          = null;   // Y coordinate relative to pane canvas (iframe-local)
  let mousePrice      = null;   // Snapped price at mouseY
  let lastIframeMouseX = null;  // Last known mouse clientX inside iframe (always tracked)
  let lastIframeMouseY = null;  // Last known mouse clientY inside iframe (always tracked)
  let canvas          = null;   // Overlay canvas (in MAIN document, over iframe)
  let ctx             = null;
  let rafId           = null;
  let iframeEl    = null;
  let iframeDoc   = null;
  let iframeWin   = null;
  let cleanupFns  = [];

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
    canvas.width  = window.innerWidth  * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width  = window.innerWidth  + 'px';
    canvas.style.height = window.innerHeight + 'px';
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
        const normSym  = sym.replace(/.*:/, '');
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

    const ltp      = getCurrentPrice();
    const qty      = getQty();
    const priceStr = formatPrice(mousePrice, tickSize);
    const sym      = getActiveSymbol();

    // Determine order types based on price vs current market
    let buyType, sellType;
    if (ltp != null) {
      buyType  = mousePrice < ltp ? 'LIMIT' : 'STOP';
      sellType = mousePrice > ltp ? 'LIMIT' : 'STOP';
    } else {
      buyType  = 'LIMIT';
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
      const clipTop    = iframeRect.top + paneRect.top;
      const clipBottom = iframeRect.top + paneRect.top + paneRect.height;
      const clipLeft   = iframeRect.left + paneRect.left;
      const clipRight  = iframeRect.left + paneRect.left + paneRect.width;

      if (drawY < clipTop || drawY > clipBottom) continue;

      // Clip to this pane
      ctx.save();
      ctx.beginPath();
      ctx.rect(clipLeft, clipTop, clipRight - clipLeft, clipBottom - clipTop);
      ctx.clip();

      // ── Magenta horizontal line ─────────────────────────────
      ctx.beginPath();
      ctx.strokeStyle = CONFIG.COLORS.line;
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([6, 3]);
      ctx.moveTo(clipLeft, drawY);
      ctx.lineTo(clipRight, drawY);
      ctx.stroke();
      ctx.setLineDash([]);

      // ── Labels (centered on line, drawn on top) ────────────
      ctx.font = CONFIG.LABEL_FONT;
      const halfH = CONFIG.LABEL_HEIGHT / 2;

      const buyText = `BUY ${buyType} ${priceStr}`;
      const buyW    = ctx.measureText(buyText).width + 16;
      const labelX  = clipLeft + 8;

      ctx.fillStyle = CONFIG.COLORS.buyBg;
      ctx.fillRect(labelX, drawY - halfH, buyW, CONFIG.LABEL_HEIGHT);
      ctx.fillStyle = CONFIG.COLORS.labelText;
      ctx.textBaseline = 'middle';
      ctx.fillText(buyText, labelX + 8, drawY);

      const sellText = `SELL ${sellType} ${priceStr}`;
      const sellW    = ctx.measureText(sellText).width + 16;
      const sellX    = labelX + buyW + 6;

      ctx.fillStyle = CONFIG.COLORS.sellBg;
      ctx.fillRect(sellX, drawY - halfH, sellW, CONFIG.LABEL_HEIGHT);
      ctx.fillStyle = CONFIG.COLORS.labelText;
      ctx.fillText(sellText, sellX + 8, drawY);

      // ── Lot size indicator ──────────────────────────────────
      const qtyText = `${qty} lot${qty !== 1 ? 's' : ''}`;
      const qtyW    = ctx.measureText(qtyText).width + 12;
      const qtyX    = sellX + sellW + 6;
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

    const ltp      = getCurrentPrice();
    const qty      = getQty();
    const tickSize = getTickSize();
    const snapped  = tickSize ? snapPrice(price, tickSize) : price;

    // Determine order type
    let orderType;
    if (side === 'buy') {
      orderType = (ltp != null && snapped < ltp) ? OrderType.Limit : OrderType.Stop;
    } else {
      orderType = (ltp != null && snapped > ltp) ? OrderType.Limit : OrderType.Stop;
    }

    const order = {
      symbol: sym,
      side:   side === 'buy' ? Side.Buy : Side.Sell,
      type:   orderType,
      qty,
    };

    if (orderType === OrderType.Limit) order.limitPrice = snapped;
    if (orderType === OrderType.Stop)  order.stopPrice  = snapped;

    const typeName = orderType === OrderType.Limit ? 'LIMIT' : 'STOP';
    const shortSym = sym.replace('CME-Delayed:', '');
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
        lastIframeMouseY < paneRect.top  || lastIframeMouseY > paneRect.top + paneRect.height) {
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
    if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      e.stopPropagation();
      spaceHeld = true;
      ensureCanvas();
      resolveMousePrice();  // Immediately show line at current mouse position
      log('Quick-order mode ON');
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
      try { if (!services.tradingService   && typeof val.placeOrder === 'function')       services.tradingService   = val; } catch (e) {}
      try { if (!services.orderController  && typeof val.handlePlaceOrder === 'function')  services.orderController  = val; } catch (e) {}
      try { if (!services.accountService   && typeof val.getCurrentAccount === 'function') services.accountService   = val; } catch (e) {}
      try { if (!services.symbolService    && typeof val.getCurrentSymbol === 'function' && typeof val.getTickSize === 'function') services.symbolService = val; } catch (e) {}
      try { if (!services.quantityService  && typeof val.getQuantity === 'function' && typeof val.setQuantity === 'function') services.quantityService = val; } catch (e) {}
    }
    return !!(services.tradingService && services.accountService);
  }

  function attachEventListeners() {
    // Main window — spacebar (works even when iframe has focus because capture phase)
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup',   onKeyUp,   true);
    window.addEventListener('resize',  resizeCanvas);
    cleanupFns.push(() => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup',   onKeyUp,   true);
      window.removeEventListener('resize',  resizeCanvas);
    });

    // Iframe — mouse events + keyboard backup + context menu suppression
    if (iframeWin) {
      iframeWin.addEventListener('keydown',     onKeyDown,          true);
      iframeWin.addEventListener('keyup',        onKeyUp,            true);
      iframeWin.addEventListener('mousemove',    onIframeMouseMove,  true);
      iframeWin.addEventListener('mousedown',    onIframeMouseDown,  true);
      iframeWin.addEventListener('contextmenu',  onContextMenu,      true);

      cleanupFns.push(() => {
        iframeWin.removeEventListener('keydown',     onKeyDown,          true);
        iframeWin.removeEventListener('keyup',        onKeyUp,            true);
        iframeWin.removeEventListener('mousemove',    onIframeMouseMove,  true);
        iframeWin.removeEventListener('mousedown',    onIframeMouseDown,  true);
        iframeWin.removeEventListener('contextmenu',  onContextMenu,      true);
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
      'Symbol:',  !!services.symbolService,
      'Quantity:', !!services.quantityService,
      'Controller:', !!services.orderController
    );

    // 2. Wait for TradingView iframe
    try {
      const { iframe, doc, win } = await waitForIframe();
      iframeEl  = iframe;
      iframeDoc = doc;
      iframeWin = win;
      log('Iframe ready');
    } catch (e) { err(e.message); return; }

    // 3. Attach event listeners
    attachEventListeners();

    // 5. Start draw loop
    rafId = requestAnimationFrame(draw);

    // 6. Expose API
    window.tsSpacebar = {
      get active()  { return spaceHeld; },
      get price()   { return mousePrice; },
      get ltp()     { return getCurrentPrice(); },
      get symbol()  { return getActiveSymbol(); },
      get qty()     { return getQty(); },
      set qty(n)    { services.orderController?.setQuantity(n); },
      get tickSize() { return getTickSize(); },
      get ready()   { return !!(services.tradingService && services.accountService && iframeDoc); },
      destroy() {
        cleanupFns.forEach(fn => fn());
        cleanupFns = [];
        if (rafId) cancelAnimationFrame(rafId);
        if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
        canvas = null; ctx = null;
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
