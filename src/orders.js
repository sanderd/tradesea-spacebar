// ─── Order Placement & Break-Even ───────────────────────────────────
import { log, warn, err } from './logging.js';
import { services, S } from './state.js';
import {
  getActiveSymbol, getTickSize, snapPrice, formatPrice,
  getCurrentPrice, getQty,
} from './chart.js';

/**
 * Move the active position's stop loss to the average entry price (break-even).
 */
async function moveStopToBreakeven() {
  const provider = S.provider;
  if (!provider) { err('No platform provider'); return; }
  if (!services.tradingService || !services.positionService || !services.accountService) {
    err('Break-even: required services not ready');
    return;
  }
  // instrumentService is optional — only TradeSea has it
  const needsInstrument = !!services.instrumentService;

  const sym = getActiveSymbol();
  if (!sym) { err('Break-even: no active symbol'); return; }

  let pos;
  try {
    pos = services.positionService.getPositionBySymbol?.(sym)
      || services.positionService.getPositions?.()?.find(p => p.symbol === sym);
  } catch (e) { /* */ }
  if (!pos) { warn('Break-even: no open position for', sym); return; }

  let minTick = getTickSize() || 0.01;
  if (needsInstrument) {
    try {
      const instr = services.instrumentService.getInstrumentBySymbol?.(pos.symbol);
      if (instr?.minTick) minTick = instr.minTick;
    } catch (e) { /* */ }
  }

  // Round avgPrice to nearest tick on the safe side
  const isLong = pos.side === 1 || pos.side === 0; // TradeSea Buy=1, ProjectX Buy=0
  const bePrice = isLong
    ? Math.ceil(pos.avgPrice / minTick) * minTick   // round UP for longs
    : Math.floor(pos.avgPrice / minTick) * minTick;  // round DOWN for shorts

  const acct = provider.getCurrentAccount();
  if (!acct) { err('Break-even: no account'); return; }

  const shortSym = sym.replace(/^[^:]+:/, '');
  log(`Break-even: ${shortSym} SL → ${bePrice} (avg ${pos.avgPrice})`);

  try {
    await provider.editPositionBrackets(pos.id, { stopLoss: bePrice }, acct.id);
    log('✅ Break-even SL set');
  } catch (e) {
    err('Break-even failed:', e.message);
  }
}

//  ORDER PLACEMENT
// ═══════════════════════════════════════════════════════════════════

async function placeOrderAtPrice(side, price) {
  const provider = S.provider;
  if (!provider) { err('No platform provider'); return; }
  if (!services.tradingService || !services.accountService) {
    err('Services not ready');
    return;
  }

  const acct = provider.getCurrentAccount();
  if (!acct) { err('No account'); return; }

  const sym = getActiveSymbol();
  if (!sym) { err('No active symbol'); return; }

  const ltp = getCurrentPrice();
  const qty = getQty();
  const tickSize = getTickSize();
  const snapped = tickSize ? snapPrice(price, tickSize) : price;

  // Determine order type via provider (handles different enum values per platform)
  const orderType = provider.resolveOrderType(side, snapped, ltp);
  const order = provider.buildOrder(side, orderType, sym, qty, snapped);

  const OT = provider.OrderType;
  const typeName = orderType === OT.Limit ? 'LIMIT' : 'STOP';
  const shortSym = sym.replace(/^[^:]+:/, '');
  log(`${side.toUpperCase()} ${typeName} ${qty}x ${shortSym} @ ${formatPrice(snapped, tickSize || 0.01)} (LTP: ${ltp})`);

  try {
    const result = await provider.placeOrder(order, acct.id);
    log('✅', result?.orderId?.substring?.(0, 8) || 'OK');
  } catch (e) {
    err('Order failed:', e.message);
  }
}

export { moveStopToBreakeven, placeOrderAtPrice };
