// ─── PX Platform Provider ───────────────────────────────────────────
// Service discovery via React fiber tree traversal.
// Instead of duck-typing ES module exports (TradeSea/Svelte approach),
// we walk the React component tree to find Context Providers whose
// values expose the trading functions we need.
//
// Key contexts discovered (by shape, not by depth — depths vary):
//   • Order context     — has placeOrderWithSymbol, cancelOrder, closePosition
//   • Account context   — has activeTradingAccount, setActiveTradingAccount
//   • Contract context  — has getContractByContractId, getContractByProductId
//   • DOM data context  — has lastPrice, tick, orderAmount, updateOrderAmount
//   • WebSocket context — has subscribeDom, subscribeOrders, subscribePositions

import { log, warn, err } from '../logging.js';
import { services } from '../state.js';

// ─── Fiber walking utilities ────────────────────────────────────────

/** Get the React container fiber root from #root. */
function _getFiberRoot() {
  const rootEl = document.getElementById('root');
  if (!rootEl) return null;
  const key = Object.keys(rootEl).find(k => k.startsWith('__reactContainer$'));
  return key ? rootEl[key] : null;
}

/**
 * Walk the React fiber tree, calling `visitor(fiber)` on each node.
 * Stops early if visitor returns `true` (found everything).
 */
function _walkFiber(fiber, visitor, depth = 0) {
  if (!fiber || depth > 250) return;
  if (visitor(fiber, depth)) return; // early-exit
  _walkFiber(fiber.child, visitor, depth + 1);
  _walkFiber(fiber.sibling, visitor, depth);
}

/** Check if a fiber node is a React Context Provider. */
function _isProvider(fiber) {
  const t = fiber.type;
  if (!t) return false;
  // React 18: context providers have $$typeof = Symbol(react.provider)
  const sym = t.$$typeof;
  return sym && sym.toString?.().includes('provider');
}

// ─── Context shape matchers (duck-typing on context values) ─────────

const CONTEXT_MATCHERS = {
  orderCtx: (v) =>
    typeof v.placeOrderWithSymbol === 'function' &&
    typeof v.cancelOrder === 'function',

  accountCtx: (v) =>
    v.activeTradingAccount !== undefined &&
    typeof v.setActiveTradingAccount === 'function',

  contractCtx: (v) =>
    typeof v.getContractByContractId === 'function' &&
    typeof v.getContractByProductId === 'function',

  domDataCtx: (v) =>
    v.tick !== undefined &&
    v.lastPrice !== undefined &&
    typeof v.updateOrderAmount === 'function',

  wsCtx: (v) =>
    typeof v.subscribeDom === 'function' &&
    typeof v.subscribeOrders === 'function',
};

// ─── Provider factory ───────────────────────────────────────────────

function createPxProvider() {
  return {
    id: 'px',
    name: 'PX',

    // ── Bundle discovery ──────────────────────────────────────
    findBundleUrl() {
      const entry = performance.getEntriesByType('resource')
        .find(e => e.name.includes('/static/main-') && e.name.endsWith('.js'));
      return entry ? entry.name : null;
    },

    // ── Service discovery via React fiber tree ────────────────
    discoverServices(_mod, { silent = false } = {}) {
      const root = _getFiberRoot();
      if (!root) { if (!silent) warn('React fiber root not found'); return false; }

      const found = {};
      const fibers = {};
      _walkFiber(root, (fiber) => {
        if (!_isProvider(fiber)) return false;
        const val = fiber.memoizedProps?.value;
        if (!val || typeof val !== 'object') return false;

        for (const [name, matcher] of Object.entries(CONTEXT_MATCHERS)) {
          if (!found[name]) {
            try {
              if (matcher(val)) {
                found[name] = val;
                fibers[name] = fiber;  // Store fiber ref for live reads
                if (!silent) log(`Fiber: ${name} found`);
              }
            } catch (_) {}
          }
        }
        // Early exit if we found everything
        return Object.keys(found).length === Object.keys(CONTEXT_MATCHERS).length;
      });

      // Keep raw contexts + fiber refs for live access.
      // React context values are immutable — when state changes (e.g. orderAmount),
      // React creates a NEW value object. Reading from the fiber's memoizedProps
      // always gives the latest committed value.
      this._ctx = found;
      this._fibers = fibers;

      // Map to the shared services shape used by chart.js / orders.js.
      // Adapters use _readCtx() to get LIVE values from fiber refs.
      const self = this;
      services.tradingService = found.orderCtx || null;
      services.accountService = found.accountCtx || null;
      services.positionService = found.orderCtx || null;

      // symbolService adapter: chart.js expects getCurrentSymbol(), getTickSize(), getCurrentPrice()
      services.symbolService = {
        getCurrentSymbol() {
          const dom = self._readCtx('domDataCtx');
          return dom?.contract?.productId || null;
        },
        getTickSize() {
          const dom = self._readCtx('domDataCtx');
          return dom?.tick || dom?.contract?.tickSize || null;
        },
        getCurrentPrice() {
          return self._readCtx('domDataCtx')?.lastPrice || null;
        },
        _getContract() { return self._readCtx('domDataCtx')?.contract; },
      };

      // quantityService adapter: chart.js expects getQuantity(), setQuantity(n)
      services.quantityService = {
        getQuantity() { return self._readCtx('domDataCtx')?.orderAmount || 1; },
        setQuantity(n) { self._readCtx('domDataCtx')?.updateOrderAmount?.(n); },
      };

      return !!(found.orderCtx && found.accountCtx);
    },

    /**
     * Read the LIVE context value from a stored fiber reference.
     * React's dual-tree architecture means our fiber may become the "alternate"
     * after a commit — check both the fiber and its alternate to find the
     * current value.
     */
    _readCtx(name) {
      const fiber = this._fibers?.[name];
      if (!fiber) return this._ctx?.[name] || null;
      // Prefer the fiber's own props; fall back to alternate (post-commit swap)
      const val = fiber.memoizedProps?.value;
      const alt = fiber.alternate?.memoizedProps?.value;
      // Return whichever has a value — React keeps the "current" tree's
      // memoizedProps up to date after commit
      return val || alt || this._ctx?.[name] || null;
    },

    /** Re-read live context values from the fiber tree. */
    _refreshContexts() {
      const root = _getFiberRoot();
      if (!root) return;
      const found = {};
      const fibers = {};
      _walkFiber(root, (fiber) => {
        if (!_isProvider(fiber)) return false;
        const val = fiber.memoizedProps?.value;
        if (!val || typeof val !== 'object') return false;
        for (const [name, matcher] of Object.entries(CONTEXT_MATCHERS)) {
          if (!found[name]) {
            try { if (matcher(val)) { found[name] = val; fibers[name] = fiber; } }
            catch (_) {}
          }
        }
        return Object.keys(found).length === Object.keys(CONTEXT_MATCHERS).length;
      });
      this._ctx = found;
      this._fibers = fibers;
      // Update direct service refs
      if (found.orderCtx) {
        services.tradingService = found.orderCtx;
        services.positionService = found.orderCtx;
      }
      if (found.accountCtx) services.accountService = found.accountCtx;
    },

    // ── Order formatting ──────────────────────────────────────
    // Enum values match the PX internal enums.
    // Confusing naming in their codebase:
    //   ye.type      = order type (rt.Limit=1, rt.Stop=4)
    //   ye.orderType = side       (mr.Buy=0,   mr.Sell=1)
    OrderType: { Limit: 1, Market: 2, Stop: 4, StopLimit: 5, TrailingStop: 6 },
    Side:      { Buy: 0, Sell: 1 },
    orderSource: 'WEB',
    locale: 'en-US',

    resolveOrderType(side, price, ltp) {
      if (ltp == null) return side === 'buy' ? 1 : 4;
      if (side === 'buy') return price < ltp ? 1 : 4;
      return price > ltp ? 1 : 4;
    },

    buildOrder(side, orderType, symbol, qty, snappedPrice) {
      // Build the object shape that placeOrderWithSymbol expects.
      const order = {
        symbol,            // productId, e.g. 'F.US.MNQ'
        amount: qty,
        type: orderType,   // 1=Limit, 4=Stop (confusingly named 'type')
        orderType: side === 'buy' ? 0 : 1,  // 0=Buy, 1=Sell (confusingly named 'orderType')
      };
      if (orderType === 1) order.limitPrice = snappedPrice;
      if (orderType === 4) order.stopPrice = snappedPrice;
      return order;
    },

    async placeOrder(order, _accountId) {
      this._refreshContexts();
      const ctx = this._readCtx('orderCtx');
      if (!ctx?.placeOrderWithSymbol) { err('orderCtx.placeOrderWithSymbol not found'); return null; }

      // Enrich with contractId and productId from the DOM data context.
      // Always override symbol — getActiveSymbol() may return a TV chart name
      // like "MNQU26" but placeOrderWithSymbol needs the productId "F.US.MNQ".
      const domCtx = this._readCtx('domDataCtx');
      if (domCtx?.contract) {
        order.contractId = domCtx.contract.contractId;
        order.symbol = domCtx.contract.productId;
      }

      // placeOrderWithSymbol takes a single object arg:
      // { contractId, symbol, amount, type, orderType, limitPrice?, stopPrice? }
      return ctx.placeOrderWithSymbol(order);
    },

    async editPositionBrackets(positionId, brackets, _accountId) {
      this._refreshContexts();
      const ctx = this._readCtx('orderCtx');
      if (!ctx) { warn('editPositionBrackets: orderCtx not found'); return null; }
      // Use editOrder or editSltpSetting if available
      if (typeof ctx.editOrder === 'function') {
        return ctx.editOrder(positionId, brackets);
      }
      warn('editPositionBrackets not supported on PX via fiber');
      return null;
    },

    // ── Account helpers ───────────────────────────────────────
    getCurrentAccount() {
      this._refreshContexts();
      const ctx = this._readCtx('accountCtx');
      if (!ctx) return null;
      const acct = ctx.activeTradingAccount;
      // Normalize to the shape that the rest of the codebase expects
      if (typeof acct === 'string') return { id: acct, name: acct };
      return acct;
    },

    getAccountDisplayName(acct) {
      if (!acct) return null;
      if (typeof acct === 'string') return acct;
      return acct.name || acct.displayName || acct.accountId || null;
    },

    // ── UI integration ────────────────────────────────────────
    findSettingsAnchor() {
      // PX uses MUI — sidebar is a MuiStack with icon buttons
      // Try to find the sidebar navigation stack
      const sidebar = document.querySelector('.MuiStack-root[class*="css-1lzh2bj"]')
        || document.querySelector('nav')
        || document.querySelector('[class*="sidebar"]');

      if (sidebar) {
        // Find the last icon button group or the settings area
        const buttons = sidebar.querySelectorAll('button, a, [role="button"]');
        const logoutBtn = Array.from(buttons).find(b =>
          b.textContent?.toLowerCase()?.includes('log out') ||
          b.getAttribute('aria-label')?.toLowerCase()?.includes('log out')
        );
        return { parent: sidebar, before: logoutBtn || null };
      }
      return { parent: null, before: null };
    },

    isAccountPage() {
      return false; // PX doesn't have a separate account page
    },

    /** PX has native account naming — skip nickname feature. */
    hasNicknameSupport: false,

    /** PX has native breakeven — skip our implementation. */
    hasBreakevenSupport: false,

    logTag: 'PX-Spacebar',

    // ── Debug utilities ───────────────────────────────────────
    async probeExports() {
      log('PROBE: Scanning React fiber tree for contexts...');
      this._refreshContexts();
      for (const [name, val] of Object.entries(this._ctx || {})) {
        if (!val) continue;
        const fns = Object.keys(val).filter(k => typeof val[k] === 'function');
        const data = Object.keys(val).filter(k => typeof val[k] !== 'function');
        log(`PROBE: ${name}`, { functions: fns, dataKeys: data });
      }
    },
  };
}

export { createPxProvider };
