// ─── Configuration & Persistence ────────────────────────────────────
// Constants, default config, schema migrations, load/save.
import { log, warn, err } from './logging.js';

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


const STORAGE_KEY = 'ts-spacebar-config';
const CONFIG_VERSION = 8;

const DEFAULT_CONFIG = {
  version: 8,
  hotkeyWithoutSpacebar: true,
  breakevenHotkey: null,
  contractSlots: [
    { qty: 1, hotkey: null },
    { qty: 2, hotkey: null },
    { qty: 3, hotkey: null },
    { qty: 4, hotkey: null },
    { qty: 5, hotkey: null },
  ],
  priceLevels: [],
  // Each entry: { id, label, instruments, levels, color, lineStyle, lineWidth, showLabels, showPrice, fontSize }
  // instruments: 'NQ,MNQ'  levels: [21000.50, 21100]
  // color: 'rgba(255,0,255,0.8)'  lineStyle: 'dashed'  lineWidth: 1
  // showLabels: true  showPrice: true  fontSize: 10
  crosshair: {
    showBuySell: true,
    showPrice: true,
    showLotSize: true,
    lineColor: '#ff00ff',
    lineStyle: 'dashed',
    lineWidth: 1.5,
    fontSizeBuySell: 11,
    fontSizeLotSize: 11,
    buyBg: '#00d4aa',
    buyFg: '#000000',
    sellBg: '#ff6b9d',
    sellFg: '#000000',
    lotBg: 'rgba(60,60,70,1)',
    lotFg: '#ffffff',
  },
  accountNicknames: {},  // { "Broker:AccountName": "Nickname", ... }
};

// Each entry: { fromVersion, toVersion, migrate(cfg) → cfg }
const MIGRATIONS = [
  {
    fromVersion: 1, toVersion: 2, migrate: (cfg) => {
      cfg.version = 2;
      cfg.hotkeyWithoutSpacebar = true;
      return cfg;
    }
  },
  {
    fromVersion: 2, toVersion: 3, migrate: (cfg) => {
      cfg.version = 3;
      cfg.breakevenHotkey = null;
      return cfg;
    }
  },
  {
    fromVersion: 3, toVersion: 4, migrate: (cfg) => {
      cfg.version = 4;
      cfg.priceLevels = cfg.priceLevels || [];
      return cfg;
    }
  },
  {
    fromVersion: 4, toVersion: 5, migrate: (cfg) => {
      cfg.version = 5;
      for (const g of (cfg.priceLevels || [])) {
        if (!g.lineStyle) g.lineStyle = 'dashed';
        if (!g.lineWidth) g.lineWidth = 1;
      }
      return cfg;
    }
  },
  {
    fromVersion: 5, toVersion: 6, migrate: (cfg) => {
      cfg.version = 6;
      for (const g of (cfg.priceLevels || [])) {
        if (g.showLabels === undefined) g.showLabels = true;
        if (g.showPrice === undefined) g.showPrice = true;
        if (!g.fontSize) g.fontSize = 10;
      }
      return cfg;
    }
  },
  {
    fromVersion: 6, toVersion: 7, migrate: (cfg) => {
      cfg.version = 7;
      if (!cfg.crosshair) {
        cfg.crosshair = structuredClone(DEFAULT_CONFIG.crosshair);
      }
      return cfg;
    }
  },
  {
    fromVersion: 7, toVersion: 8, migrate: (cfg) => {
      cfg.version = 8;
      // Migrate nicknames from standalone localStorage to config
      try {
        const raw = localStorage.getItem('ts-account-nicknames');
        cfg.accountNicknames = raw ? JSON.parse(raw) : {};
        localStorage.removeItem('ts-account-nicknames');
      } catch (_) {
        cfg.accountNicknames = {};
      }
      return cfg;
    }
  },
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

export {
  CONFIG, OrderType, Side,
  STORAGE_KEY, CONFIG_VERSION, DEFAULT_CONFIG, MIGRATIONS,
  applyMigrations, loadConfig, saveConfig,
};
