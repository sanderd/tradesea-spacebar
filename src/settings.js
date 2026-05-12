// ─── Settings UI ────────────────────────────────────────────────────
import { DEFAULT_CONFIG, loadConfig, saveConfig, applyMigrations } from './config.js';
import { log, err } from './logging.js';
import { S } from './state.js';
import { formatKeyDisplay, parsePriceLevels } from './chart.js';
import { getNicknameMap, clearAllNicknames } from './nicknames.js';

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

export { createSettingsUI, destroySettingsUI, openSettings, closeSettings };
