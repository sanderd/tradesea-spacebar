// ─── Event Handlers ─────────────────────────────────────────────────
import { log } from './logging.js';
import { S } from './state.js';
import { getTickSize, snapPrice, setContractSize } from './chart.js';
import { getPaneCanvasRect, coordToPrice, ensureCanvas } from './canvas.js';
import { moveStopToBreakeven, placeOrderAtPrice } from './orders.js';

//  7. EVENT HANDLERS
// ═══════════════════════════════════════════════════════════════════

/** Compute S.mousePrice from cached iframe mouse position */
function resolveMousePrice() {
  if (S.lastIframeMouseX == null || S.lastIframeMouseY == null) return;

  const paneRect = getPaneCanvasRect();
  if (!paneRect) return;

  if (S.lastIframeMouseX < paneRect.left || S.lastIframeMouseX > paneRect.left + paneRect.width ||
    S.lastIframeMouseY < paneRect.top || S.lastIframeMouseY > paneRect.top + paneRect.height) {
    S.mousePrice = null;
    return;
  }

  const localY = S.lastIframeMouseY - paneRect.top;
  const rawPrice = coordToPrice(localY);
  if (rawPrice == null) { S.mousePrice = null; return; }

  const tickSize = getTickSize();
  S.mousePrice = tickSize ? snapPrice(rawPrice, tickSize) : rawPrice;
  S.mouseY = localY;
}

function onKeyDown(e) {
  if (S.settingsOverlay) return; // Don't intercept while settings open

  if (e.code === 'Space' && !e.repeat) {
    e.preventDefault();
    e.stopPropagation();
    S.spaceHeld = true;
    ensureCanvas();
    resolveMousePrice();
    log('Quick-order mode ON');
    return;
  }

  // Skip hotkey processing if a text field is focused
  const tag = (e.target?.tagName || '').toLowerCase();
  const editable = tag === 'input' || tag === 'textarea' || tag === 'select'
    || e.target?.isContentEditable;
  if (editable) return;

  // Break-even hotkey — always active (no spacebar required)
  if (S.userConfig?.breakevenHotkey && e.code === S.userConfig.breakevenHotkey) {
    e.preventDefault();
    e.stopPropagation();
    moveStopToBreakeven();
    return;
  }

  // Contract-size hotkeys — only during spacebar, unless hotkeyWithoutSpacebar is on
  if (S.userConfig && (S.spaceHeld || S.userConfig.hotkeyWithoutSpacebar)) {
    const slot = S.userConfig.contractSlots.find(s => s.hotkey === e.code);
    if (slot) {
      e.preventDefault();
      e.stopPropagation();
      setContractSize(slot.qty);
    }
  }
}

function onKeyUp(e) {
  if (e.code === 'Space') {
    e.preventDefault();
    e.stopPropagation();
    S.spaceHeld = false;
    S.mousePrice = null;
    S.mouseY = null;
    S.pendingOrder = null;  // Cancel any pending order
    log('Quick-order mode OFF');
  }
}

/**
 * Mouse events from the IFRAME — clientX/Y are iframe-relative.
 * Always track position; resolve price only when S.spaceHeld.
 */
function onIframeMouseMove(e) {
  // Always track, so spacebar-press can resolve price instantly
  S.lastIframeMouseX = e.clientX;
  S.lastIframeMouseY = e.clientY;

  if (!S.spaceHeld) return;
  resolveMousePrice();
}

function onIframeMouseDown(e) {
  if (!S.spaceHeld || S.mousePrice == null) return;

  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  // Capture intent — order fires on mouseup if spacebar still held
  if (e.button === 0) {
    S.pendingOrder = { side: 'buy', price: S.mousePrice };
  } else if (e.button === 2) {
    S.pendingOrder = { side: 'sell', price: S.mousePrice };
  }
}

function onIframeMouseUp(e) {
  if (!S.pendingOrder) return;

  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  if (S.spaceHeld) {
    placeOrderAtPrice(S.pendingOrder.side, S.pendingOrder.price);
  } else {
    log('Order cancelled — spacebar released before mouse');
  }
  S.pendingOrder = null;
}

function onContextMenu(e) {
  if (S.spaceHeld) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    return false;
  }
}

export {
  resolveMousePrice, onKeyDown, onKeyUp,
  onIframeMouseMove, onIframeMouseDown, onIframeMouseUp, onContextMenu,
};
