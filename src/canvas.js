// ─── Canvas Overlay & Draw Loop ─────────────────────────────────────
import { DEFAULT_CONFIG } from './config.js';
import { log, err } from './logging.js';
import { services, S } from './state.js';
import {
  getTvApi, getActiveChart, getActiveSymbol, getTickSize,
  formatPrice, getCurrentPrice, getQty,
  getMatchingPriceLevelsForSymbol,
} from './chart.js';

// Module-local caches (not shared state — reset via resetCanvasCaches)
let _overlayRectsCache = []; // Cached menu/dialog rects (refreshed every ~500ms)
let _overlayRectsTick = 0;   // Frame counter for throttling overlay rect scanning

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
  if (!S.iframeDoc) return null;
  try {
    const container = S.iframeDoc.querySelector('.chart-container.active')
      || S.iframeDoc.querySelector('.chart-container');
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
  if (!S.iframeEl) return null;
  return S.iframeEl.getBoundingClientRect();
}

// ═══════════════════════════════════════════════════════════════════
//  4. CANVAS OVERLAY — Lives in the MAIN document, over the iframe
// ═══════════════════════════════════════════════════════════════════

function ensureCanvas() {
  if (S.canvas && S.canvas.parentNode) return true;
  try {
    S.canvas = document.createElement('canvas');
    S.canvas.id = 'ts-spacebar-overlay';
    S.canvas.style.cssText = `
      position: fixed;
      top: 0; left: 0;
      width: 100vw; height: 100vh;
      pointer-events: none;
      z-index: 10;
    `;
    document.body.appendChild(S.canvas);
    S.ctx = S.canvas.getContext('2d');
    resizeCanvas();
    log('Canvas created (main document)');
    return true;
  } catch (e) {
    err('Canvas creation failed:', e.message);
    return false;
  }
}

function resizeCanvas() {
  if (!S.canvas) return;
  const dpr = window.devicePixelRatio || 1;
  S.canvas.width = window.innerWidth * dpr;
  S.canvas.height = window.innerHeight * dpr;
  S.canvas.style.width = window.innerWidth + 'px';
  S.canvas.style.height = window.innerHeight + 'px';
  if (S.ctx) S.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  _paneRectsCache = null; // Invalidate — pane positions changed
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
    border-radius: 16px; padding: 28px 32px; min-width: 480px; max-width: 560px;
    box-shadow: 0 24px 80px rgba(0,0,0,0.6), 0 0 60px rgba(255,0,255,0.08);
    font-family: Inter, system-ui, -apple-system, sans-serif; color: #d8d8e4;
  }
  #ts-sb-panel h2 {
    margin: 0; font-size: 15px; color: #ff00ff; font-weight: 600;
    letter-spacing: 0.3px;
  }
  .ts-sb-titlebar {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 16px;
  }
  .ts-sb-titlebar-left {
    display: flex; align-items: center; gap: 8px;
  }
  .ts-sb-titlebar-right {
    display: flex; align-items: center; gap: 6px;
  }
  .ts-sb-io-btn {
    padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1);
    background: rgba(40,40,55,0.8); color: #888; cursor: pointer;
    font-size: 11px; font-family: inherit; transition: all .15s;
    display: flex; align-items: center; gap: 4px;
  }
  .ts-sb-io-btn:hover { border-color: rgba(255,0,255,0.3); color: #ccc; background: rgba(255,0,255,0.06); }
  .ts-sb-tabs {
    display: flex; gap: 2px; margin-bottom: 18px;
    background: rgba(30,30,42,0.6); border-radius: 10px; padding: 3px;
  }
  .ts-sb-tab {
    flex: 1; padding: 8px 14px; border-radius: 8px; border: none;
    background: transparent; color: #666; cursor: pointer;
    font-size: 12px; font-weight: 500; font-family: inherit;
    transition: all .2s ease; text-align: center;
  }
  .ts-sb-tab:hover { color: #aaa; background: rgba(255,255,255,0.03); }
  .ts-sb-tab.active {
    background: rgba(255,0,255,0.12); color: #ff00ff;
    box-shadow: 0 2px 8px rgba(255,0,255,0.1);
  }
  .ts-sb-tab-content { display: none; }
  .ts-sb-tab-content.active { display: block; }
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
  .ts-sb-pl-group {
    background: rgba(30,30,42,0.8); border: 1px solid rgba(255,255,255,0.06);
    border-radius: 10px; padding: 12px 14px; margin-bottom: 10px;
    position: relative;
  }
  .ts-sb-pl-group .ts-sb-pl-remove {
    position: absolute; top: 8px; right: 8px;
    width: 22px; height: 22px; border-radius: 6px; border: none;
    background: transparent; color: #555; cursor: pointer;
    font-size: 12px; display: flex; align-items: center; justify-content: center;
    transition: all .15s;
  }
  .ts-sb-pl-group .ts-sb-pl-remove:hover { background: rgba(255,80,80,0.15); color: #ff5555; }
  .ts-sb-pl-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .ts-sb-pl-row:last-child { margin-bottom: 0; }
  .ts-sb-pl-label-text { font-size: 11px; color: #666; width: 70px; flex-shrink: 0; }
  .ts-sb-pl-input {
    flex: 1; padding: 5px 8px; border-radius: 6px;
    background: rgba(40,40,55,0.9); border: 1px solid rgba(255,255,255,0.08);
    color: #e0e0ec; font-size: 12px; font-family: inherit; outline: none;
    transition: border-color .15s;
  }
  .ts-sb-pl-input:focus { border-color: rgba(255,0,255,0.4); }
  .ts-sb-pl-input::placeholder { color: #444; }
  .ts-sb-pl-select {
    padding: 5px 8px; border-radius: 6px;
    background: rgba(40,40,55,0.9); border: 1px solid rgba(255,255,255,0.08);
    color: #e0e0ec; font-size: 12px; font-family: inherit; outline: none;
    transition: border-color .15s; cursor: pointer;
  }
  .ts-sb-pl-select:focus { border-color: rgba(255,0,255,0.4); }
  .ts-sb-pl-select option { background: #1a1a2e; color: #e0e0ec; }
  .ts-sb-pl-width {
    width: 50px; padding: 5px 6px; border-radius: 6px;
    background: rgba(40,40,55,0.9); border: 1px solid rgba(255,255,255,0.08);
    color: #e0e0ec; font-size: 12px; font-family: monospace; outline: none;
    text-align: center; -moz-appearance: textfield;
  }
  .ts-sb-pl-width::-webkit-inner-spin-button,
  .ts-sb-pl-width::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .ts-sb-pl-width:focus { border-color: rgba(255,0,255,0.4); }
  .ts-sb-pl-color-wrap {
    display: flex; align-items: center; gap: 8px;
  }
  .ts-sb-pl-swatch {
    width: 28px; height: 28px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.12);
    cursor: pointer; flex-shrink: 0;
  }
  .ts-sb-pl-color-input {
    width: 90px; padding: 5px 8px; border-radius: 6px;
    background: rgba(40,40,55,0.9); border: 1px solid rgba(255,255,255,0.08);
    color: #e0e0ec; font-size: 11px; font-family: monospace; outline: none;
  }
  .ts-sb-pl-alpha {
    width: 50px; padding: 5px 6px; border-radius: 6px;
    background: rgba(40,40,55,0.9); border: 1px solid rgba(255,255,255,0.08);
    color: #e0e0ec; font-size: 11px; font-family: monospace; outline: none;
    text-align: center;
  }
  .ts-sb-pl-add {
    width: 100%; padding: 8px; border-radius: 8px; border: 1px dashed rgba(255,0,255,0.2);
    background: transparent; color: #666; cursor: pointer;
    font-size: 12px; font-family: inherit; transition: all .15s;
    margin-top: 4px;
  }
  .ts-sb-pl-add:hover { border-color: rgba(255,0,255,0.4); color: #ff00ff; background: rgba(255,0,255,0.04); }
  #ts-sb-panel { max-height: 85vh; overflow-y: auto; }
`;

function createSettingsUI() {
  const style = document.createElement('style');
  style.id = 'ts-sb-style';
  style.textContent = SETTINGS_CSS;
  document.head.appendChild(style);

  S.settingsBtn = document.createElement('button');
  S.settingsBtn.id = 'ts-sb-btn';
  S.settingsBtn.innerHTML = '🚀';
  S.settingsBtn.title = 'Spacebar Trading Settings';
  S.settingsBtn.addEventListener('click', openSettings);

  // Insert into the sidebar DOM between Account Center and Logout
  const sidebarBottom = document.querySelector('aside > div.border-t');
  const logoutBtn = sidebarBottom?.querySelector('#logout-btn, button[aria-label="Logout"]');
  if (sidebarBottom && logoutBtn) {
    sidebarBottom.insertBefore(S.settingsBtn, logoutBtn);
  } else if (sidebarBottom) {
    sidebarBottom.appendChild(S.settingsBtn);
  } else {
    // Fallback: fixed position if sidebar not found
    S.settingsBtn.style.cssText = 'position:fixed;bottom:80px;left:12px;width:36px;height:36px;z-index:999998;';
    document.body.appendChild(S.settingsBtn);
  }
  log('Settings button created');
}

function destroySettingsUI() {
  closeSettings();
  if (S.settingsBtn && S.settingsBtn.parentNode) S.settingsBtn.parentNode.removeChild(S.settingsBtn);
  S.settingsBtn = null;
  const style = document.getElementById('ts-sb-style');
  if (style) style.remove();
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function rgbaToHexAlpha(rgba) {
  const m = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!m) return { hex: '#ff00ff', alpha: 0.8 };
  const hex = '#' + [m[1], m[2], m[3]].map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
  return { hex, alpha: parseFloat(m[4] ?? '1') };
}

function buildPriceLevelGroupHTML(group, idx) {
  const { hex, alpha } = rgbaToHexAlpha(group.color || 'rgba(255,0,255,0.8)');
  const levelsStr = (group.levels || []).join(', ');
  const ls = group.lineStyle || 'dashed';
  const lw = group.lineWidth || 1;
  const showLabels = group.showLabels !== false;
  const showPrice = group.showPrice !== false;
  const fontSize = group.fontSize || 10;
  return `
    <div class="ts-sb-pl-group" data-plidx="${idx}">
      <button class="ts-sb-pl-remove" data-plidx="${idx}" title="Remove group">\u2715</button>
      <div class="ts-sb-pl-row">
        <span class="ts-sb-pl-label-text">Instruments</span>
        <input class="ts-sb-pl-input" data-plfield="instruments" value="${group.instruments || ''}" placeholder="NQ, MNQ">
      </div>
      <div class="ts-sb-pl-row">
        <span class="ts-sb-pl-label-text">Label</span>
        <input class="ts-sb-pl-input" data-plfield="label" value="${group.label || ''}" placeholder="e.g. Key Level">
      </div>
      <div class="ts-sb-pl-row">
        <span class="ts-sb-pl-label-text">Levels</span>
        <input class="ts-sb-pl-input" data-plfield="levels" value="${levelsStr}" placeholder="21000.50, 21100, 21200">
      </div>
      <div class="ts-sb-pl-row">
        <span class="ts-sb-pl-label-text">Color</span>
        <div class="ts-sb-pl-color-wrap">
          <input type="color" class="ts-sb-pl-swatch" data-plfield="hex" value="${hex}">
          <input class="ts-sb-pl-color-input" data-plfield="hextext" value="${hex}">
          <span style="font-size:10px;color:#555">\u03B1</span>
          <input class="ts-sb-pl-alpha" data-plfield="alpha" value="${alpha}" placeholder="0.8">
        </div>
      </div>
      <div class="ts-sb-pl-row">
        <span class="ts-sb-pl-label-text">Line Style</span>
        <select class="ts-sb-pl-select" data-plfield="lineStyle">
          <option value="solid"${ls === 'solid' ? ' selected' : ''}>Solid</option>
          <option value="dashed"${ls === 'dashed' ? ' selected' : ''}>Dashed</option>
          <option value="dotted"${ls === 'dotted' ? ' selected' : ''}>Dotted</option>
          <option value="dash-dot"${ls === 'dash-dot' ? ' selected' : ''}>Dash-Dot</option>
        </select>
        <span class="ts-sb-pl-label-text" style="width:auto;margin-left:8px">Width</span>
        <input type="number" class="ts-sb-pl-width" data-plfield="lineWidth" value="${lw}" min="1" max="10">
        <span style="font-size:10px;color:#555">px</span>
      </div>
      <div class="ts-sb-pl-row">
        <span class="ts-sb-pl-label-text">Display</span>
        <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;color:#aaa">
          <input type="checkbox" data-plfield="showLabels" ${showLabels ? 'checked' : ''}
                 style="accent-color:#ff00ff;width:14px;height:14px;cursor:pointer">
          Labels
        </label>
        <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;color:#aaa;margin-left:10px">
          <input type="checkbox" data-plfield="showPrice" ${showPrice ? 'checked' : ''}
                 style="accent-color:#ff00ff;width:14px;height:14px;cursor:pointer">
          Price
        </label>
        <span class="ts-sb-pl-label-text" style="width:auto;margin-left:10px">Font</span>
        <input type="number" class="ts-sb-pl-width" data-plfield="fontSize" value="${fontSize}" min="6" max="24">
        <span style="font-size:10px;color:#555">px</span>
      </div>
    </div>`;
}

function openSettings() {
  if (S.settingsOverlay) return;
  const cfg = loadConfig();

  // Extract version from userscript header (GM_info available with some managers)
  const scriptVersion = (typeof GM_info !== 'undefined' && GM_info?.script?.version) || 'unknown';

  S.settingsOverlay = document.createElement('div');
  S.settingsOverlay.id = 'ts-sb-backdrop';

  // ── Hotkeys tab content ──
  let hotkeyRows = '';
  for (let i = 0; i < 5; i++) {
    const s = cfg.contractSlots[i] || { qty: i + 1, hotkey: null };
    hotkeyRows += `
      <div class="ts-sb-row">
        <span class="slot-label">Slot ${i + 1}</span>
        <input type="number" class="ts-sb-qty" data-slot="${i}" value="${s.qty}" min="1" max="999">
        <span class="ts-sb-lots">lots</span>
        <input type="text" class="ts-sb-hk" data-slot="${i}" data-code="${s.hotkey || ''}"
               value="${formatKeyDisplay(s.hotkey)}" placeholder="Click \u2192 press key" readonly>
        <button class="ts-sb-clear" data-slot="${i}" title="Clear hotkey">\u2715</button>
      </div>`;
  }

  const hotkeyTab = `
    <div class="ts-sb-section-label">Contract Sizes</div>
    <div class="ts-sb-subtitle">Press hotkey to switch size instantly</div>
    ${hotkeyRows}
    <div class="ts-sb-section-label" style="margin-top:18px">Actions</div>
    <div class="ts-sb-row">
      <span class="slot-label" style="width:auto;min-width:80px">Break-even</span>
      <input type="text" class="ts-sb-hk" id="ts-sb-be-hk" data-code="${cfg.breakevenHotkey || ''}"
             value="${formatKeyDisplay(cfg.breakevenHotkey)}" placeholder="Click \u2192 press key" readonly>
      <button class="ts-sb-clear" id="ts-sb-be-clear" title="Clear hotkey">\u2715</button>
      <span class="ts-sb-lots">Move SL to avg entry</span>
    </div>
    <div class="ts-sb-section-label" style="margin-top:18px">Options</div>
    <div class="ts-sb-row" style="margin-top:8px">
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:12px;color:#aaa">
        <input type="checkbox" id="ts-sb-global-hk" ${cfg.hotkeyWithoutSpacebar ? 'checked' : ''}
               style="accent-color:#ff00ff;width:16px;height:16px;cursor:pointer">
        Lot-size hotkeys work without holding spacebar
      </label>
    </div>`;

  // ── Price Levels tab content ──
  const priceLevelsTab = `
    <div class="ts-sb-subtitle">Draw horizontal lines on the chart for matching instruments</div>
    <div id="ts-sb-pl-container">${(cfg.priceLevels || []).map((g, i) => buildPriceLevelGroupHTML(g, i)).join('')}</div>
    <button class="ts-sb-pl-add" id="ts-sb-pl-add">+ Add Price Level Group</button>`;

  // ── Settings tab content (crosshair customization) ──
  const ch = cfg.crosshair || DEFAULT_CONFIG.crosshair;
  const chLineHex = ch.lineColor || '#ff00ff';
  const chLs = ch.lineStyle || 'dashed';
  const settingsTab = `
    <div class="ts-sb-section-label">Crosshair Visibility</div>
    <div class="ts-sb-pl-row" style="gap:16px;margin-top:8px">
      <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;color:#aaa">
        <input type="checkbox" id="ts-sb-ch-buysell" ${ch.showBuySell !== false ? 'checked' : ''}
               style="accent-color:#ff00ff;width:14px;height:14px;cursor:pointer">
        Show Buy / Sell
      </label>
      <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;color:#aaa">
        <input type="checkbox" id="ts-sb-ch-price" ${ch.showPrice !== false ? 'checked' : ''}
               style="accent-color:#ff00ff;width:14px;height:14px;cursor:pointer">
        Show Price
      </label>
      <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;color:#aaa">
        <input type="checkbox" id="ts-sb-ch-lotsize" ${ch.showLotSize !== false ? 'checked' : ''}
               style="accent-color:#ff00ff;width:14px;height:14px;cursor:pointer">
        Show Lot Size
      </label>
    </div>

    <div class="ts-sb-section-label" style="margin-top:14px">Crosshair Line</div>
    <div class="ts-sb-pl-row" style="margin-top:8px">
      <span class="ts-sb-pl-label-text">Color</span>
      <input type="color" class="ts-sb-pl-swatch" id="ts-sb-ch-linecolor" value="${chLineHex}">
      <span class="ts-sb-pl-label-text" style="width:auto;margin-left:8px">Style</span>
      <select class="ts-sb-pl-select" id="ts-sb-ch-linestyle">
        <option value="solid"${chLs === 'solid' ? ' selected' : ''}>Solid</option>
        <option value="dashed"${chLs === 'dashed' ? ' selected' : ''}>Dashed</option>
        <option value="dotted"${chLs === 'dotted' ? ' selected' : ''}>Dotted</option>
        <option value="dash-dot"${chLs === 'dash-dot' ? ' selected' : ''}>Dash-Dot</option>
      </select>
      <span class="ts-sb-pl-label-text" style="width:auto;margin-left:8px">Width</span>
      <input type="number" class="ts-sb-pl-width" id="ts-sb-ch-linewidth" value="${ch.lineWidth || 1.5}" min="0.5" max="10" step="0.5">
      <span style="font-size:10px;color:#555">px</span>
    </div>

    <div class="ts-sb-section-label" style="margin-top:14px">Font Sizes</div>
    <div class="ts-sb-pl-row" style="margin-top:8px">
      <span class="ts-sb-pl-label-text">Buy / Sell</span>
      <input type="number" class="ts-sb-pl-width" id="ts-sb-ch-fs-buysell" value="${ch.fontSizeBuySell || 11}" min="6" max="24">
      <span style="font-size:10px;color:#555">px</span>
      <span class="ts-sb-pl-label-text" style="width:auto;margin-left:12px">Lot Size</span>
      <input type="number" class="ts-sb-pl-width" id="ts-sb-ch-fs-lotsize" value="${ch.fontSizeLotSize || 11}" min="6" max="24">
      <span style="font-size:10px;color:#555">px</span>
    </div>

    <div class="ts-sb-section-label" style="margin-top:14px">Label Colors</div>
    <div class="ts-sb-pl-row" style="margin-top:8px">
      <span class="ts-sb-pl-label-text">Buy</span>
      <span style="font-size:10px;color:#555">bg</span>
      <input type="color" class="ts-sb-pl-swatch" id="ts-sb-ch-buybg" value="${ch.buyBg || '#00d4aa'}">
      <span style="font-size:10px;color:#555">fg</span>
      <input type="color" class="ts-sb-pl-swatch" id="ts-sb-ch-buyfg" value="${ch.buyFg || '#000000'}">
    </div>
    <div class="ts-sb-pl-row">
      <span class="ts-sb-pl-label-text">Sell</span>
      <span style="font-size:10px;color:#555">bg</span>
      <input type="color" class="ts-sb-pl-swatch" id="ts-sb-ch-sellbg" value="${ch.sellBg || '#ff6b9d'}">
      <span style="font-size:10px;color:#555">fg</span>
      <input type="color" class="ts-sb-pl-swatch" id="ts-sb-ch-sellfg" value="${ch.sellFg || '#000000'}">
    </div>
    <div class="ts-sb-pl-row">
      <span class="ts-sb-pl-label-text">Lot Size</span>
      <span style="font-size:10px;color:#555">bg</span>
      <input type="color" class="ts-sb-pl-swatch" id="ts-sb-ch-lotbg" value="${rgbaToHexAlpha(ch.lotBg || 'rgba(60,60,70,1)').hex}">
      <span style="font-size:10px;color:#555">fg</span>
      <input type="color" class="ts-sb-pl-swatch" id="ts-sb-ch-lotfg" value="${ch.lotFg || '#ffffff'}">
    </div>

    <div class="ts-sb-section-label" style="margin-top:20px">Account Nicknames</div>
    <div class="ts-sb-subtitle">Custom display names for trading accounts</div>
    <div style="margin-top:8px">
      <button class="ts-sb-io-btn" id="ts-sb-clear-nicknames" style="background:rgba(255,80,80,0.15);color:#ff5050;border-color:rgba(255,80,80,0.3)" title="Remove all account nicknames">✕ Clear All Account Names</button>
      <span id="ts-sb-nick-count" style="font-size:10px;color:#555;margin-left:8px"></span>
    </div>`;

  S.settingsOverlay.innerHTML = `
    <div id="ts-sb-panel">
      <div class="ts-sb-titlebar">
        <div class="ts-sb-titlebar-left">
          <h2>\u2699\uFE0F Spacebar Trading</h2>
          <span style="font-size:10px;color:#555;margin-left:4px">v${scriptVersion}</span>
        </div>
        <div class="ts-sb-titlebar-right">
          <button class="ts-sb-io-btn" id="ts-sb-import" title="Import configuration from file">\u2B07 Import</button>
          <button class="ts-sb-io-btn" id="ts-sb-export" title="Export configuration to file">\u2B06 Export</button>
          <button class="ts-sb-close" id="ts-sb-close">\u2715</button>
        </div>
      </div>
      <div class="ts-sb-tabs">
        <button class="ts-sb-tab active" data-tab="hotkeys">Hotkeys</button>
        <button class="ts-sb-tab" data-tab="settings">Settings</button>
        <button class="ts-sb-tab" data-tab="pricelevels">Price Levels</button>
      </div>
      <div class="ts-sb-tab-content active" data-tab-content="hotkeys">${hotkeyTab}</div>
      <div class="ts-sb-tab-content" data-tab-content="settings">${settingsTab}</div>
      <div class="ts-sb-tab-content" data-tab-content="pricelevels">${priceLevelsTab}</div>
      <div class="ts-sb-actions">
        <button class="ts-sb-btn-cancel" id="ts-sb-cancel">Cancel</button>
        <button class="ts-sb-btn-save" id="ts-sb-save">Save</button>
      </div>
    </div>`;

  document.body.appendChild(S.settingsOverlay);

  // ── Tab switching ──
  S.settingsOverlay.querySelectorAll('.ts-sb-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      S.settingsOverlay.querySelectorAll('.ts-sb-tab').forEach(t => t.classList.remove('active'));
      S.settingsOverlay.querySelectorAll('.ts-sb-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      S.settingsOverlay.querySelector(`[data-tab-content="${tab.dataset.tab}"]`)?.classList.add('active');
    });
  });

  // ── Close handlers ──
  S.settingsOverlay.querySelector('#ts-sb-close').addEventListener('click', closeSettings);
  S.settingsOverlay.querySelector('#ts-sb-cancel').addEventListener('click', closeSettings);
  S.settingsOverlay.addEventListener('click', (e) => { if (e.target === S.settingsOverlay) closeSettings(); });

  // ── Export handler ──
  S.settingsOverlay.querySelector('#ts-sb-export')?.addEventListener('click', () => {
    const data = JSON.stringify(loadConfig(), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ts-spacebar-config.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    log('Config exported');
  });

  // ── Import handler ──
  S.settingsOverlay.querySelector('#ts-sb-import')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const imported = JSON.parse(reader.result);
          const migrated = applyMigrations(imported);
          saveConfig(migrated);
          S.userConfig = migrated;
          closeSettings();
          openSettings(); // Re-open with imported data
          log('Config imported');
        } catch (e) {
          err('Config import failed:', e.message);
          alert('Invalid config file: ' + e.message);
        }
      };
      reader.readAsText(file);
    });
    input.click();
  });

  // ── Save handler ──
  S.settingsOverlay.querySelector('#ts-sb-save').addEventListener('click', () => {
    const newCfg = structuredClone(DEFAULT_CONFIG);
    newCfg.hotkeyWithoutSpacebar = S.settingsOverlay.querySelector('#ts-sb-global-hk')?.checked ?? true;
    newCfg.breakevenHotkey = S.settingsOverlay.querySelector('#ts-sb-be-hk')?.dataset?.code || null;
    S.settingsOverlay.querySelectorAll('.ts-sb-qty').forEach(inp => {
      const i = parseInt(inp.dataset.slot);
      newCfg.contractSlots[i].qty = Math.max(1, parseInt(inp.value) || 1);
    });
    S.settingsOverlay.querySelectorAll('.ts-sb-hk:not(#ts-sb-be-hk)').forEach(inp => {
      const i = parseInt(inp.dataset.slot);
      newCfg.contractSlots[i].hotkey = inp.dataset.code || null;
    });
    // Collect price level groups
    newCfg.priceLevels = [];
    S.settingsOverlay.querySelectorAll('.ts-sb-pl-group').forEach(grp => {
      const instruments = grp.querySelector('[data-plfield="instruments"]')?.value?.trim() || '';
      const label = grp.querySelector('[data-plfield="label"]')?.value?.trim() || '';
      const levelsRaw = grp.querySelector('[data-plfield="levels"]')?.value || '';
      const hex = grp.querySelector('[data-plfield="hex"]')?.value || '#ff00ff';
      const alpha = parseFloat(grp.querySelector('[data-plfield="alpha"]')?.value) || 0.8;
      const lineStyle = grp.querySelector('[data-plfield="lineStyle"]')?.value || 'dashed';
      const lineWidth = Math.max(1, Math.min(10, parseInt(grp.querySelector('[data-plfield="lineWidth"]')?.value) || 1));
      const showLabels = grp.querySelector('[data-plfield="showLabels"]')?.checked !== false;
      const showPrice = grp.querySelector('[data-plfield="showPrice"]')?.checked !== false;
      const fontSize = Math.max(6, Math.min(24, parseInt(grp.querySelector('[data-plfield="fontSize"]')?.value) || 10));
      const levels = parsePriceLevels(levelsRaw);
      if (instruments && levels.length > 0) {
        newCfg.priceLevels.push({ id: Date.now() + Math.random(), instruments, label, levels, color: hexToRgba(hex, alpha), lineStyle, lineWidth, showLabels, showPrice, fontSize });
      }
    });
    // Collect crosshair settings
    const q = (id) => S.settingsOverlay.querySelector(id);
    newCfg.crosshair = {
      showBuySell: q('#ts-sb-ch-buysell')?.checked !== false,
      showPrice: q('#ts-sb-ch-price')?.checked !== false,
      showLotSize: q('#ts-sb-ch-lotsize')?.checked !== false,
      lineColor: q('#ts-sb-ch-linecolor')?.value || '#ff00ff',
      lineStyle: q('#ts-sb-ch-linestyle')?.value || 'dashed',
      lineWidth: parseFloat(q('#ts-sb-ch-linewidth')?.value) || 1.5,
      fontSizeBuySell: Math.max(6, Math.min(24, parseInt(q('#ts-sb-ch-fs-buysell')?.value) || 11)),
      fontSizeLotSize: Math.max(6, Math.min(24, parseInt(q('#ts-sb-ch-fs-lotsize')?.value) || 11)),
      buyBg: q('#ts-sb-ch-buybg')?.value || '#00d4aa',
      buyFg: q('#ts-sb-ch-buyfg')?.value || '#000000',
      sellBg: q('#ts-sb-ch-sellbg')?.value || '#ff6b9d',
      sellFg: q('#ts-sb-ch-sellfg')?.value || '#000000',
      lotBg: q('#ts-sb-ch-lotbg')?.value || '#3c3c46',
      lotFg: q('#ts-sb-ch-lotfg')?.value || '#ffffff',
    };
    // Preserve account nicknames (managed separately via setNickname)
    newCfg.accountNicknames = S.userConfig?.accountNicknames || {};
    saveConfig(newCfg);
    S.userConfig = newCfg;
    closeSettings();
  });

  // Hotkey recording on focus + keydown
  S.settingsOverlay.querySelectorAll('.ts-sb-hk').forEach(inp => {
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

  // Clear hotkey buttons (contract slots)
  S.settingsOverlay.querySelectorAll('.ts-sb-clear[data-slot]').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = S.settingsOverlay.querySelector(`.ts-sb-hk[data-slot="${btn.dataset.slot}"]`);
      if (inp) { inp.value = ''; inp.dataset.code = ''; }
    });
  });

  // Clear break-even hotkey
  S.settingsOverlay.querySelector('#ts-sb-be-clear')?.addEventListener('click', () => {
    const inp = S.settingsOverlay.querySelector('#ts-sb-be-hk');
    if (inp) { inp.value = ''; inp.dataset.code = ''; }
  });

  // Clear all nicknames button
  const nickCount = Object.keys(getNicknameMap()).length;
  const nickCountEl = S.settingsOverlay.querySelector('#ts-sb-nick-count');
  if (nickCountEl) nickCountEl.textContent = nickCount > 0 ? `${nickCount} nickname${nickCount !== 1 ? 's' : ''} configured` : 'No nicknames configured';
  S.settingsOverlay.querySelector('#ts-sb-clear-nicknames')?.addEventListener('click', () => {
    const count = Object.keys(getNicknameMap()).length;
    if (count === 0) { alert('No nicknames to clear.'); return; }
    if (!confirm(`Clear all ${count} account nickname${count !== 1 ? 's' : ''}?`)) return;
    clearAllNicknames();
    if (nickCountEl) nickCountEl.textContent = 'No nicknames configured';
    log('All nicknames cleared from settings');
  });

  // Price level: add group (copies rendering settings from previous group)
  S.settingsOverlay.querySelector('#ts-sb-pl-add')?.addEventListener('click', () => {
    const container = S.settingsOverlay.querySelector('#ts-sb-pl-container');
    const existing = container.querySelectorAll('.ts-sb-pl-group');
    const idx = existing.length;
    // Copy rendering settings from last group if one exists
    let defaults = { instruments: '', label: '', levels: [], color: 'rgba(255,0,255,0.8)', lineStyle: 'dashed', lineWidth: 1, showLabels: true, showPrice: true, fontSize: 10 };
    if (existing.length > 0) {
      const last = existing[existing.length - 1];
      const hex = last.querySelector('[data-plfield="hex"]')?.value || '#ff00ff';
      const alpha = parseFloat(last.querySelector('[data-plfield="alpha"]')?.value) || 0.8;
      defaults.color = hexToRgba(hex, alpha);
      defaults.lineStyle = last.querySelector('[data-plfield="lineStyle"]')?.value || 'dashed';
      defaults.lineWidth = parseInt(last.querySelector('[data-plfield="lineWidth"]')?.value) || 1;
      defaults.showLabels = last.querySelector('[data-plfield="showLabels"]')?.checked !== false;
      defaults.showPrice = last.querySelector('[data-plfield="showPrice"]')?.checked !== false;
      defaults.fontSize = parseInt(last.querySelector('[data-plfield="fontSize"]')?.value) || 10;
    }
    const div = document.createElement('div');
    div.innerHTML = buildPriceLevelGroupHTML(defaults, idx);
    const grp = div.firstElementChild;
    container.appendChild(grp);
    wireUpPriceLevelGroup(grp);
  });

  // Wire up existing price level groups
  S.settingsOverlay.querySelectorAll('.ts-sb-pl-group').forEach(grp => wireUpPriceLevelGroup(grp));
}

function wireUpPriceLevelGroup(grp) {
  // Remove button
  grp.querySelector('.ts-sb-pl-remove')?.addEventListener('click', () => grp.remove());
  // Sync color picker ↔ hex text
  const swatch = grp.querySelector('[data-plfield="hex"]');
  const hexText = grp.querySelector('[data-plfield="hextext"]');
  swatch?.addEventListener('input', () => { if (hexText) hexText.value = swatch.value; });
  hexText?.addEventListener('change', () => {
    if (/^#[0-9a-fA-F]{6}$/.test(hexText.value) && swatch) swatch.value = hexText.value;
  });
}

function closeSettings() {
  if (S.settingsOverlay && S.settingsOverlay.parentNode) {
    S.settingsOverlay.parentNode.removeChild(S.settingsOverlay);
  }
  S.settingsOverlay = null;
}

// ═══════════════════════════════════════════════════════════════════
//  5. DRAW LOOP
// ═══════════════════════════════════════════════════════════════════

// ── Helper: collect ALL chart panes (every symbol, cached ~500ms) ───
let _allPanesCache = null;
const _ALL_PANES_CACHE_TTL = 500;

function getAllChartPanes() {
  const now = performance.now();
  if (_allPanesCache && (now - _allPanesCache.ts) < _ALL_PANES_CACHE_TTL) {
    return _allPanesCache.panes;
  }
  const panes = _getAllChartPanesUncached();
  _allPanesCache = { panes, ts: now };
  return panes;
}

function _getAllChartPanesUncached() {
  const results = [];
  if (!S.iframeWin || !S.iframeDoc) return results;

  const api = getTvApi();
  if (!api) return results;

  const count = api.chartsCount?.() || 1;
  const containers = S.iframeDoc.querySelectorAll('.chart-container');

  // Normal path: container count matches chart count — use direct index mapping
  if (containers.length >= count) {
    for (let i = 0; i < count; i++) {
      _pushPaneEntry(results, api.chart(i), containers[i]);
    }
    return results;
  }

  // Fullscreen path: fewer containers than charts (hidden panels).
  // Match each visible container to its API chart via symbol comparison.
  const charts = [];
  for (let i = 0; i < count; i++) {
    try {
      const chart = api.chart(i);
      if (chart) charts.push(chart);
    } catch (_) { /* skip */ }
  }

  for (const container of containers) {
    if (container.offsetWidth < 2 || container.offsetHeight < 2) continue;
    const wrapper = container.querySelector('.chart-gui-wrapper');
    const canvasEl = wrapper?.querySelector('canvas') || container.querySelector('canvas');
    if (!canvasEl) continue;

    // Try to match this container to a chart by finding its symbol
    // In fullscreen, the active chart owns the single visible container
    let matchedChart = null;
    const activeChart = api.activeChart?.();
    if (activeChart && charts.includes(activeChart)) {
      matchedChart = activeChart;
    } else if (charts.length === 1) {
      matchedChart = charts[0];
    }

    if (matchedChart) {
      const sym = matchedChart.symbol?.() || matchedChart.symbolExt?.()?.ticker || '';
      if (!sym) continue;
      const chartPanes = matchedChart.getPanes();
      const scale = chartPanes?.[0]?.getMainSourcePriceScale?.()
        || chartPanes?.[0]?.getRightPriceScale?.()
        || chartPanes?.[0]?.getLeftPriceScale?.();
      results.push({
        symbol: sym,
        paneRect: canvasEl.getBoundingClientRect(),
        scale,
      });
    }
  }
  return results;
}

/** Shared helper to push a single pane entry from a chart + container pair. */
function _pushPaneEntry(results, chart, container) {
  try {
    if (!chart || !container) return;
    const sym = chart.symbol?.() || chart.symbolExt?.()?.ticker || '';
    if (!sym) return;
    const wrapper = container.querySelector('.chart-gui-wrapper');
    const canvasEl = wrapper?.querySelector('canvas') || container.querySelector('canvas');
    if (!canvasEl) return;
    const chartPanes = chart.getPanes();
    const scale = chartPanes?.[0]?.getMainSourcePriceScale?.()
      || chartPanes?.[0]?.getRightPriceScale?.()
      || chartPanes?.[0]?.getLeftPriceScale?.();
    results.push({
      symbol: sym,
      paneRect: canvasEl.getBoundingClientRect(),
      scale,
    });
  } catch (_) { /* skip broken chart */ }
}

/**
 * Scale coefficient cache — avoids calling coordinateToPrice() twice per
 * price level per pane per frame. Keyed by scale object (WeakMap for GC).
 * Each entry stores the sampled coefficients AND a price→Y Map that remains
 * valid as long as the scale's linear mapping hasn't changed (no zoom/scroll).
 */
const _scaleCoeffCache = new WeakMap();
const _COEFF_Y1 = 50, _COEFF_Y2 = 300;

function _getScaleCoeffs(scale) {
  let p1, p2;
  try {
    p1 = scale.coordinateToPrice(_COEFF_Y1);
    p2 = scale.coordinateToPrice(_COEFF_Y2);
  } catch (e) { return null; }
  if (p1 == null || p2 == null || !isFinite(p1) || !isFinite(p2)) return null;
  if (Math.abs(p2 - p1) < 1e-10) return null;

  const prev = _scaleCoeffCache.get(scale);
  if (prev && prev.p1 === p1 && prev.p2 === p2) {
    return prev; // scale unchanged — reuse cached price→Y map
  }

  // Scale changed (zoom/scroll) — build fresh cache entry
  const entry = {
    p1, p2,
    slope: (_COEFF_Y2 - _COEFF_Y1) / (p2 - p1),
    yCache: new Map(),  // price → pane-local Y
  };
  _scaleCoeffCache.set(scale, entry);
  return entry;
}

/** Convert a price to pane-local Y for a given scale (cached per scale). */
function priceToYForScale(price, scale) {
  const c = _getScaleCoeffs(scale);
  if (!c) return null;

  const cached = c.yCache.get(price);
  if (cached !== undefined) return cached;

  const y = _COEFF_Y1 + (price - c.p1) * c.slope;
  const result = isFinite(y) ? y : null;
  c.yCache.set(price, result);
  return result;
}

/**
 * Collect bounding rects (in main-document coords) of any open
 * TradingView menus, dialogs, or popups inside the iframe.
 * Returns an empty array when nothing is open (common case).
 * Uses a single combined selector for one DOM traversal.
 */
const _OVERLAY_SELECTOR = [
  '[class*="menuWrap"]', '[class*="contextMenu"]',
  '[class*="context-menu"]',
  '[data-name="menu"]', '[class*="dialog"]',
  '[class*="popup"]',  '[class*="Modal"]',
  '[class*="backdrop"]',
  '[role="dialog"]',   '[role="menu"]',
  '[role="listbox"]',
].join(',');

function getTvOverlayRects(iframeRect) {
  if (!S.iframeDoc) return [];
  const rects = [];
  try {
    const els = S.iframeDoc.querySelectorAll(_OVERLAY_SELECTOR);
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue; // skip invisible
      rects.push({
        x: iframeRect.left + r.left,
        y: iframeRect.top + r.top,
        w: r.width,
        h: r.height,
      });
    }
  } catch (_) { }
  return rects;
}

/** Convert a lineStyle name to a canvas dash pattern array. */
function lineStyleToDash(style, width) {
  const w = width || 1;
  switch (style) {
    case 'solid':    return [];
    case 'dotted':   return [w, w * 2];
    case 'dash-dot': return [w * 6, w * 2, w, w * 2];
    case 'dashed':
    default:         return [w * 4, w * 3];
  }
}

/** Draw configured price levels on ALL chart panes (not just active). */
function drawPriceLevels(iframeRect) {
  if (!S.userConfig?.priceLevels?.length) return;

  const allPanes = getAllChartPanes();
  if (allPanes.length === 0) return;

  for (const { symbol: paneSym, paneRect, scale } of allPanes) {
    if (!scale) continue;
    const groups = getMatchingPriceLevelsForSymbol(paneSym);
    if (groups.length === 0) continue;

    const clipTop = iframeRect.top + paneRect.top;
    const clipBottom = clipTop + paneRect.height;
    const clipLeft = iframeRect.left + paneRect.left;
    const clipRight = clipLeft + paneRect.width;

    S.ctx.save();
    S.ctx.beginPath();
    S.ctx.rect(clipLeft, clipTop, clipRight - clipLeft, clipBottom - clipTop);
    S.ctx.clip();

    for (const group of groups) {
      const color = group.color || 'rgba(255,0,255,0.8)';
      let lineColor = color;
      let labelBg = color;
      const groupLineWidth = group.lineWidth || 1;
      const groupDash = lineStyleToDash(group.lineStyle, groupLineWidth);
      const showLabels = group.showLabels !== false;
      const showPrice = group.showPrice !== false;
      const fontSize = group.fontSize || 10;
      const levelFont = `bold ${fontSize}px Inter, system-ui, -apple-system, sans-serif`;
      const labelH = fontSize + 8;
      const halfH = labelH / 2;

      for (const price of group.levels) {
        const paneY = priceToYForScale(price, scale);
        if (paneY == null) continue;
        const drawY = iframeRect.top + paneRect.top + paneY;
        if (drawY < clipTop || drawY > clipBottom) continue;

        // ── Horizontal line (style + width from config) ──
        S.ctx.beginPath();
        S.ctx.strokeStyle = lineColor;
        S.ctx.lineWidth = groupLineWidth;
        S.ctx.setLineDash(groupDash);
        S.ctx.moveTo(clipLeft, drawY);
        S.ctx.lineTo(clipRight, drawY);
        S.ctx.stroke();
        S.ctx.setLineDash([]);

        // ── Right-aligned label tag (conditional) ──
        if (showLabels || showPrice) {
          S.ctx.font = levelFont;
          const parts = [];
          if (showLabels && group.label) parts.push(group.label);
          if (showPrice) parts.push(String(price));
          const labelText = parts.join('  ');
          if (labelText) {
            const textW = S.ctx.measureText(labelText).width + 12;
            const tagX = clipRight - textW - 4;

            S.ctx.fillStyle = labelBg;
            S.ctx.globalAlpha = 0.85;
            S.ctx.fillRect(tagX, drawY - halfH, textW, labelH);
            S.ctx.globalAlpha = 1;

            S.ctx.fillStyle = '#ffffff';
            S.ctx.textBaseline = 'middle';
            S.ctx.fillText(labelText, tagX + 6, drawY);
          }
        }
      }
    }
    S.ctx.restore();
  }
}

// ── Dirty-checking for price levels (skip redraw when scale unchanged) ─
let _priceLevelFingerprint = '';

/**
 * Build a fingerprint string from current pane positions and scale
 * coefficients. When this matches the previous frame AND no crosshair
 * is active, we can skip clearing and redrawing entirely.
 */
function _buildPriceLevelFingerprint(allPanes) {
  let fp = '';
  for (const { paneRect, scale } of allPanes) {
    const c = _scaleCoeffCache.get(scale);
    fp += `${paneRect.top|0},${paneRect.left|0},${paneRect.width|0},${paneRect.height|0},`;
    fp += c ? `${c.p1},${c.p2};` : '?;';
  }
  return fp;
}

function draw() {
  S.rafId = requestAnimationFrame(draw);
  if (!S.ctx || document.hidden) return;

  const iframeRect = getIframeRect();
  const hasPriceLevels = S.userConfig?.priceLevels?.length > 0;
  const crosshairActive = S.spaceHeld && S.mousePrice != null;

  // If only price levels are drawn (no crosshair), check if anything changed
  if (hasPriceLevels && !crosshairActive && iframeRect) {
    // Always keep overlay scanning on schedule (must run even when skipping draw)
    if (++_overlayRectsTick >= 30) {
      _overlayRectsTick = 0;
      _overlayRectsCache = getTvOverlayRects(iframeRect);
    }

    const allPanes = getAllChartPanes();
    // Probe scales to populate coefficient cache (needed for fingerprint)
    for (const { scale } of allPanes) {
      if (scale) _getScaleCoeffs(scale);
    }
    // Include overlay positions in fingerprint so menu reposition triggers redraw
    let overlayFp = 'o';
    for (const r of _overlayRectsCache) {
      overlayFp += `${r.x|0},${r.y|0},${r.w|0},${r.h|0};`;
    }
    const fp = _buildPriceLevelFingerprint(allPanes) + overlayFp;
    if (fp === _priceLevelFingerprint && fp !== '') {
      return; // nothing changed — skip clear + redraw
    }
    _priceLevelFingerprint = fp;
  } else if (crosshairActive) {
    _priceLevelFingerprint = ''; // crosshair active — always redraw
  }

  // Clear canvas
  S.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  // Always draw price levels (even without spacebar)
  if (iframeRect && hasPriceLevels) {
    // Overlay rects already refreshed above in the dirty-check path;
    // refresh here too for the crosshair-active path
    if (crosshairActive) {
      if (++_overlayRectsTick >= 30) {
        _overlayRectsTick = 0;
        _overlayRectsCache = getTvOverlayRects(iframeRect);
      }
    }
    // Mask out any open TradingView menus/dialogs so lines don't cover them
    if (_overlayRectsCache.length > 0) {
      S.ctx.save();
      S.ctx.beginPath();
      S.ctx.rect(0, 0, S.canvas.width, S.canvas.height);
      const pad = 4;
      for (const r of _overlayRectsCache) {
        S.ctx.rect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2);
      }
      S.ctx.clip('evenodd');
      drawPriceLevels(iframeRect);
      S.ctx.restore();
    } else {
      drawPriceLevels(iframeRect);
    }
  }

  // Spacebar crosshair — only when active
  if (!crosshairActive) return;
  if (!iframeRect) return;

  const tickSize = getTickSize();
  if (!tickSize) return;

  const ltp = getCurrentPrice();
  const qty = getQty();
  const priceStr = formatPrice(S.mousePrice, tickSize);
  const sym = getActiveSymbol();

  // Determine order types based on price vs current market
  let buyType, sellType;
  if (ltp != null) {
    buyType = S.mousePrice < ltp ? 'LIMIT' : 'STOP';
    sellType = S.mousePrice > ltp ? 'LIMIT' : 'STOP';
  } else {
    buyType = 'LIMIT';
    sellType = 'STOP';
  }

  // Get chart panes matching the active symbol (filter from unified cache)
  const normSym = sym.replace(/.*:/, '');
  const panes = getAllChartPanes().filter(p =>
    p.symbol.replace(/.*:/, '') === normSym
  );
  if (panes.length === 0) return;

  S.ctx.save();

  for (const { paneRect, scale } of panes) {
    if (!scale) continue;

    const paneY = priceToYForScale(S.mousePrice, scale);
    if (paneY == null) continue;

    // Map to main-doc coordinates
    const drawY = iframeRect.top + paneRect.top + paneY;
    const clipTop = iframeRect.top + paneRect.top;
    const clipBottom = iframeRect.top + paneRect.top + paneRect.height;
    const clipLeft = iframeRect.left + paneRect.left;
    const clipRight = iframeRect.left + paneRect.left + paneRect.width;

    if (drawY < clipTop || drawY > clipBottom) continue;

    // Clip to this pane
    S.ctx.save();
    S.ctx.beginPath();
    S.ctx.rect(clipLeft, clipTop, clipRight - clipLeft, clipBottom - clipTop);
    S.ctx.clip();

    // ── Crosshair horizontal line ────────────────────────────
    const chCfg = S.userConfig?.crosshair || DEFAULT_CONFIG.crosshair;
    const chDash = lineStyleToDash(chCfg.lineStyle, chCfg.lineWidth);
    S.ctx.beginPath();
    S.ctx.strokeStyle = chCfg.lineColor;
    S.ctx.lineWidth = chCfg.lineWidth;
    S.ctx.setLineDash(chDash);
    S.ctx.moveTo(clipLeft, drawY);
    S.ctx.lineTo(clipRight, drawY);
    S.ctx.stroke();
    S.ctx.setLineDash([]);

    // ── Labels (positioned along the line) ──────────────────
    const bsFontSize = chCfg.fontSizeBuySell || 11;
    const lotFontSize = chCfg.fontSizeLotSize || 11;
    const bsFont = `bold ${bsFontSize}px Inter, system-ui, -apple-system, sans-serif`;
    const lotFont = `bold ${lotFontSize}px Inter, system-ui, -apple-system, sans-serif`;
    const bsLabelH = bsFontSize + 9;
    const lotLabelH = lotFontSize + 9;
    S.ctx.textBaseline = 'middle';

    let nextX = clipLeft + 8;

    if (chCfg.showBuySell !== false) {
      S.ctx.font = bsFont;
      const bsHalfH = bsLabelH / 2;
      const buyText = chCfg.showPrice !== false ? `BUY ${buyType} ${priceStr}` : `BUY ${buyType}`;
      const buyW = S.ctx.measureText(buyText).width + 16;
      S.ctx.fillStyle = chCfg.buyBg;
      S.ctx.fillRect(nextX, drawY - bsHalfH, buyW, bsLabelH);
      S.ctx.fillStyle = chCfg.buyFg;
      S.ctx.fillText(buyText, nextX + 8, drawY);

      const sellText = chCfg.showPrice !== false ? `SELL ${sellType} ${priceStr}` : `SELL ${sellType}`;
      const sellW = S.ctx.measureText(sellText).width + 16;
      const sellX = nextX + buyW + 6;
      S.ctx.fillStyle = chCfg.sellBg;
      S.ctx.fillRect(sellX, drawY - bsHalfH, sellW, bsLabelH);
      S.ctx.fillStyle = chCfg.sellFg;
      S.ctx.fillText(sellText, sellX + 8, drawY);

      nextX = sellX + sellW + 6;
    }

    if (chCfg.showLotSize !== false) {
      S.ctx.font = lotFont;
      const lotHalfH = lotLabelH / 2;
      const qtyText = `${qty} lot${qty !== 1 ? 's' : ''}`;
      const qtyW = S.ctx.measureText(qtyText).width + 12;
      S.ctx.fillStyle = chCfg.lotBg;
      S.ctx.fillRect(nextX, drawY - lotHalfH, qtyW, lotLabelH);
      S.ctx.fillStyle = chCfg.lotFg;
      S.ctx.globalAlpha = 0.7;
      S.ctx.fillText(qtyText, nextX + 6, drawY);
      S.ctx.globalAlpha = 1;
    }

    // ── Current price marker (yellow dashed) ────────────────
    if (ltp != null) {
      const ltpPaneY = priceToYForScale(ltp, scale);

      if (ltpPaneY != null) {
        const ltpDrawY = iframeRect.top + paneRect.top + ltpPaneY;
        if (ltpDrawY >= clipTop && ltpDrawY <= clipBottom) {
          S.ctx.beginPath();
          S.ctx.strokeStyle = 'rgba(255,255,0,0.4)';
          S.ctx.lineWidth = 1;
          S.ctx.setLineDash([2, 4]);
          S.ctx.moveTo(clipLeft, ltpDrawY);
          S.ctx.lineTo(clipRight, ltpDrawY);
          S.ctx.stroke();
          S.ctx.setLineDash([]);
        }
      }
    }

    S.ctx.restore();
  }

  S.ctx.restore();
}

/** Reset module-local caches — called from teardown in index.js */
function resetCanvasCaches() {
  _overlayRectsCache = []; _overlayRectsTick = 0;
  _allPanesCache = null;
  _priceLevelFingerprint = '';
}

export {
  getPaneCanvasRect, getIframeRect,
  ensureCanvas, resizeCanvas,
  coordToPrice, priceToCoord, getPriceScale,
  draw, lineStyleToDash,
  resetCanvasCaches,
};
