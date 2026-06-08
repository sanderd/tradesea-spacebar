// ─── TradeSea Platform Provider ─────────────────────────────────────
// All TradeSea-specific logic: bundle discovery, service signatures,
// order formatting, and UI integration points.

import { services } from '../state.js';

/** Order enums for TradeSea's backend. */
const TS_ORDER_TYPE = { Limit: 1, Market: 2, Stop: 3, StopLimit: 4 };
const TS_SIDE = { Buy: 1, Sell: -1 };

function createTradeseaProvider() {
  return {
    id: 'tradesea',
    name: 'TradeSea',

    // ── Bundle discovery ──────────────────────────────────────
    findBundleUrl() {
      const entry = performance.getEntriesByType('resource')
        .find(e => e.name.includes('/assets/main-') && e.name.endsWith('.js'));
      return entry ? entry.name : null;
    },

    // ── Service discovery (duck-typing by method signature) ──
    discoverServices(mod) {
      for (const [, val] of Object.entries(mod)) {
        if (!val || typeof val !== 'object') continue;
        try { if (!services.tradingService && typeof val.placeOrder === 'function') services.tradingService = val; } catch (_) {}
        try { if (!services.orderController && typeof val.handlePlaceOrder === 'function') services.orderController = val; } catch (_) {}
        try { if (!services.accountService && typeof val.getCurrentAccount === 'function') services.accountService = val; } catch (_) {}
        try { if (!services.symbolService && typeof val.getCurrentSymbol === 'function' && typeof val.getTickSize === 'function') services.symbolService = val; } catch (_) {}
        try { if (!services.quantityService && typeof val.getQuantity === 'function' && typeof val.setQuantity === 'function') services.quantityService = val; } catch (_) {}
        try { if (!services.positionService && typeof val.getPositions === 'function' && typeof val.getPositionBySymbol === 'function') services.positionService = val; } catch (_) {}
        try { if (!services.instrumentService && typeof val.getInstrumentBySymbol === 'function' && typeof val.getSelectedInstrument === 'function') services.instrumentService = val; } catch (_) {}
      }
      return !!(services.tradingService && services.accountService);
    },

    // ── Order formatting ──────────────────────────────────────
    OrderType: TS_ORDER_TYPE,
    Side: TS_SIDE,
    orderSource: 'ORDER_PAD',
    locale: 'en-US',

    /** Determine limit vs stop based on side + price vs LTP. */
    resolveOrderType(side, price, ltp) {
      if (ltp == null) return side === 'buy' ? TS_ORDER_TYPE.Limit : TS_ORDER_TYPE.Stop;
      if (side === 'buy') return price < ltp ? TS_ORDER_TYPE.Limit : TS_ORDER_TYPE.Stop;
      return price > ltp ? TS_ORDER_TYPE.Limit : TS_ORDER_TYPE.Stop;
    },

    buildOrder(side, orderType, symbol, qty, snappedPrice) {
      const order = {
        symbol,
        side: side === 'buy' ? TS_SIDE.Buy : TS_SIDE.Sell,
        type: orderType,
        qty,
      };
      if (orderType === TS_ORDER_TYPE.Limit) order.limitPrice = snappedPrice;
      if (orderType === TS_ORDER_TYPE.Stop) order.stopPrice = snappedPrice;
      return order;
    },

    async placeOrder(order, accountId) {
      return services.tradingService.placeOrder(order, accountId, this.locale, this.orderSource);
    },

    async editPositionBrackets(positionId, brackets, accountId) {
      return services.tradingService.editPositionBrackets(positionId, brackets, accountId, this.locale, this.orderSource);
    },

    // ── Account helpers ───────────────────────────────────────
    getCurrentAccount() {
      return services.accountService?.getCurrentAccount?.() ?? null;
    },

    getAccountDisplayName(acct) {
      return acct?.propFirmDisplayName || acct?.name || null;
    },

    // ── UI integration ────────────────────────────────────────
    findSettingsAnchor() {
      const sidebarBottom = document.querySelector('aside > div.border-t');
      const logoutBtn = sidebarBottom?.querySelector('#logout-btn, button[aria-label="Logout"]');
      return { parent: sidebarBottom, before: logoutBtn };
    },

    isAccountPage() {
      return window.location.pathname.includes('account-center');
    },

    /** Whether nicknames should be active on this platform. */
    hasNicknameSupport: true,

    // ── Logging prefix ────────────────────────────────────────
    logTag: 'TS-Spacebar',
  };
}

export { createTradeseaProvider };
