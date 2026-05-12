// ─── Shared Mutable State ───────────────────────────────────────────
// All cross-module mutable state lives here as properties of the `S`
// object.  Modules import S and read/write S.xxx so mutations are
// visible everywhere.  Module-local state (e.g. canvas caches) stays
// as `let` inside its own module.

export const services = {
  tradingService: null,
  orderController: null,
  accountService: null,
  symbolService: null,
  quantityService: null,
  positionService: null,
  instrumentService: null,
};

export const S = {
  spaceHeld: false,
  mouseY: null,
  mousePrice: null,
  lastIframeMouseX: null,
  lastIframeMouseY: null,
  canvas: null,
  ctx: null,
  rafId: null,
  iframeEl: null,
  iframeDoc: null,
  iframeWin: null,
  cleanupFns: [],
  userConfig: null,
  settingsOverlay: null,
  settingsBtn: null,
  pendingOrder: null,
};
