// ─── Order Placement & Break-Even ───────────────────────────────────
import { CONFIG, OrderType, Side } from './config.js';
import { log, warn, err } from './logging.js';
import { services } from './state.js';
import {
  getActiveSymbol, getTickSize, snapPrice, formatPrice,
  getCurrentPrice, getQty,
} from './chart.js';

/**
 * Move the active position's stop loss to the average entry price (break-even).
 * Replicates the TradeSea context-menu "Stop Loss at B/E" action.
 */
async function moveStopToBreakeven() {
  if (!services.tradingService || !services.positionService || !services.instrumentService || !services.accountService) {
    err('Break-even: required services not ready');
    return;
  }
  const sym = getActiveSymbol();
  if (!sym) { err('Break-even: no active symbol'); return; }

  let pos;
  try {
    pos = services.positionService.getPositionBySymbol?.(sym)
      || services.positionService.getPositions?.()?.find(p => p.symbol === sym);
  } catch (e) { /* */ }
  if (!pos) { warn('Break-even: no open position for', sym); return; }

  let instr;
  try { instr = services.instrumentService.getInstrumentBySymbol?.(pos.symbol); } catch (e) { /* */ }
  const minTick = instr?.minTick || getTickSize() || 0.01;

  // Round avgPrice to nearest tick on the safe side
  const isLong = pos.side === 1;
  const bePrice = isLong
    ? Math.ceil(pos.avgPrice / minTick) * minTick   // round UP for longs
    : Math.floor(pos.avgPrice / minTick) * minTick;  // round DOWN for shorts

  const acct = services.accountService.getCurrentAccount();
  if (!acct) { err('Break-even: no account'); return; }

  const shortSym = sym.replace(/^[^:]+:/, '');
  log(`Break-even: ${shortSym} SL → ${bePrice} (avg ${pos.avgPrice})`);

  try {
    await services.tradingService.editPositionBrackets(
      pos.id, { stopLoss: bePrice }, acct.id, CONFIG.DEFAULT_LOCALE, CONFIG.ORDER_SOURCE
    );
    log('✅ Break-even SL set');
  } catch (e) {
    err('Break-even failed:', e.message);
  }
}

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

export { moveStopToBreakeven, placeOrderAtPrice };
