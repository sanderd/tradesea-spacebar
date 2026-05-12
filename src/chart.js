// ─── Symbol, Price & TradingView Helpers ────────────────────────────
import { CONFIG } from './config.js';
import { log } from './logging.js';
import { services, S } from './state.js';

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
  //  SYMBOL + PRICE HELPERS
  // ═══════════════════════════════════════════════════════════════════

function getTvApi() {
  try { return S.iframeWin?.tradingViewApi; } catch (e) { return null; }
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

/** Parse freeform text into an array of numbers. Accepts comma/semicolon/space separated, dot decimal. */
function parsePriceLevels(text) {
  if (!text || typeof text !== 'string') return [];
  // Split on comma, semicolon, whitespace
  const tokens = text.split(/[,;\s]+/);
  const levels = [];
  for (const t of tokens) {
    // Strip non-numeric chars except dot and minus
    const cleaned = t.replace(/[^0-9.\-]/g, '');
    if (!cleaned) continue;
    const n = parseFloat(cleaned);
    if (isFinite(n) && n > 0) levels.push(n);
  }
  return levels;
}

/** Get all price level groups matching a specific symbol.
 *  Uses pre-computed _instruments array (built by precomputeInstruments in config.js)
 *  to avoid re-parsing instrument strings on every frame.
 */
function getMatchingPriceLevelsForSymbol(sym) {
  if (!S.userConfig?.priceLevels?.length || !sym) return [];
  const normSym = sym.replace(/.*:/, '').toUpperCase();
  return S.userConfig.priceLevels.filter(group => {
    if (!group.levels?.length) return false;
    // Prefer pre-computed tokens; fall back to parsing if not yet computed
    const instruments = group._instruments
      || (group.instruments || '').split(/[,;\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    return instruments.some(inst => normSym.includes(inst) || inst.includes(normSym));
  });
}

/** Get all price level groups matching the active chart symbol (convenience). */
function getMatchingPriceLevels() {
  return getMatchingPriceLevelsForSymbol(getActiveSymbol());
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

export {
  formatKeyDisplay, setContractSize,
  getTvApi, getActiveChart, getActiveSymbol, getTickSize,
  snapPrice, formatPrice, parsePriceLevels,
  getMatchingPriceLevelsForSymbol, getMatchingPriceLevels,
  getCurrentPrice, getQty,
};
