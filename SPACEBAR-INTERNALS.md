# TradeSea Spacebar Trading — Internals

Technical reference for how `tradesea-spacebar.user.js` hooks into TradeSea's runtime.

---

## 1. Service Discovery

TradeSea is a Svelte-based SPA. Its main bundle (`/assets/main-*.js`) is a Vite-built ES module that **re-exports** all internal singletons as named exports. Because the bundle uses ES module format, we can `import()` it at runtime and iterate over every export to find the services we need.

### How it works

```
1. Find bundle URL via Performance API
   performance.getEntriesByType('resource')
     .find(e => e.name.includes('/assets/main-') && e.name.endsWith('.js'))

2. Dynamic import
   const mod = await import(bundleUrl)

3. Iterate all exports, match by method signature
   for (const [key, val] of Object.entries(mod)) { ... }
```

The minified export keys change on every build (e.g. `$`, `a7`, `Fs`), so we **never reference keys directly**. Instead, we identify each service by the unique combination of methods it exposes — a "duck typing" approach.

### Discovery signatures

| Service | Matched by | Typical minified key |
|---------|-----------|---------------------|
| `tradingService` | `typeof val.placeOrder === 'function'` | `Fs` |
| `orderController` | `typeof val.handlePlaceOrder === 'function'` | `$` |
| `accountService` | `typeof val.getCurrentAccount === 'function'` | `vd` |
| `symbolService` | `getCurrentSymbol` **AND** `getTickSize` both present | `$` |
| `quantityService` | `getQuantity` **AND** `setQuantity` both present | `a7` |

> **Note:** `symbolService` and `orderController` may resolve to the **same object** — TradeSea bundles DOM/order-book management and symbol tracking into one controller. The dual-check (`getCurrentSymbol` + `getTickSize`) prevents false positives from other exports that may have one but not the other.

---

## 2. TradeSea Internal Services

### 2.1 `tradingService` — Order execution

The backend-facing service that sends orders to TradeSea's API.

| Method | Signature | Purpose |
|--------|-----------|---------|
| `placeOrder(order, accountId, locale, source)` | `async` → `{ orderId }` | Submit a new order |
| `modifyOrder(...)` | `async` | Modify existing order |
| `cancelOrder(...)` | `async` | Cancel an order |

**Order object shape:**
```js
{
  symbol:     'CME-Delayed:MES',  // Full qualified symbol
  side:       1,                   // 1 = Buy, -1 = Sell
  type:       1,                   // 1=Limit, 2=Market, 3=Stop, 4=StopLimit
  qty:        1,
  limitPrice: 7135.50,            // Present when type = Limit
  stopPrice:  7140.25,            // Present when type = Stop
}
```

**`placeOrder` call signature:**
```js
await tradingService.placeOrder(order, accountId, 'en-US', 'ORDER_PAD')
```

- `accountId` — obtained from `accountService.getCurrentAccount().id`
- `locale` — `'en-US'`
- `source` — `'ORDER_PAD'` (mimics the sidebar order pad; discovered by intercepting XHR payloads from manual order placement)

### 2.2 `accountService` — Account context

| Method | Returns |
|--------|---------|
| `getCurrentAccount()` | `{ id, name, propFirmDisplayName, ... }` |
| `getAccounts()` | Array of all linked accounts |

### 2.3 `symbolService` — Market data + instrument metadata

This is the DOM/order-book controller. It manages the active symbol's market data feed, tick size, and order book.

| Method | Returns | Notes |
|--------|---------|-------|
| `getCurrentSymbol()` | `'CME-Delayed:MES'` | Active chart's full symbol |
| `getCurrentPrice()` | `7138.50` or `null` | **Live last-traded price** from the market data feed |
| `getTickSize()` | `0.25` | Minimum price increment for the instrument |
| `getBook()` | `{ ... }` | Current order book / DOM |
| `getBidAskPrice(index)` | Price at depth level | Bid/ask by index |
| `formatPrice(price)` | Formatted string | Exchange-correct price formatting |
| `setSymbol(sym)` | — | Switch active symbol |

> `getCurrentPrice()` is the primary price source for determining limit vs. stop order types. It returns the same value displayed in the sidebar's order tab — no polling or DOM scraping needed.

### 2.4 `quantityService` — Lot size

Separate from the order controller. Tracks the value of the quantity spinner in the order pad UI.

| Method | Returns | Notes |
|--------|---------|-------|
| `getQuantity()` | `1`, `5`, etc. | Current lot size as set in UI |
| `setQuantity(n)` | — | Programmatically change lot size |

---

## 3. TradingView Embedded Widget API

TradeSea embeds TradingView as an `<iframe>`. The widget exposes a JS API on `iframe.contentWindow.tradingViewApi`.

### 3.1 Access path

```js
const iframe = document.querySelector('iframe');
const api = iframe.contentWindow.tradingViewApi;
```

### 3.2 Methods used

| Method | Purpose |
|--------|---------|
| `api.activeChart()` | Get the currently focused chart instance |
| `api.chartsCount()` | Total number of chart views (for multi-chart layouts) |
| `api.chart(index)` | Get chart instance by index |

### 3.3 Chart instance methods

| Method | Purpose |
|--------|---------|
| `chart.symbol()` | Symbol ticker for this chart |
| `chart.symbolExt()` | Extended symbol info (`{ ticker, full_name, ... }`) |
| `chart.getPanes()` | Array of panes (price pane, volume pane, etc.) |
| `chart.exportData({...})` | Export OHLCV candle data (used in earlier versions for price; now replaced by `symbolService.getCurrentPrice()`) |

### 3.4 Pane / Price Scale

```js
const panes = chart.getPanes();
const scale = panes[0].getMainSourcePriceScale()
           || panes[0].getRightPriceScale()
           || panes[0].getLeftPriceScale();
```

| Method | Purpose |
|--------|---------|
| `scale.coordinateToPrice(y)` | Convert Y pixel coordinate → price value |

> **`priceToCoordinate()` does NOT exist** in TradeSea's embedded build. We derive it via linear interpolation: sample `coordinateToPrice()` at two Y positions, then solve for the target price's Y.

```js
const y1 = 50, y2 = 300;
const p1 = scale.coordinateToPrice(y1);
const p2 = scale.coordinateToPrice(y2);
const targetY = y1 + (targetPrice - p1) * (y2 - y1) / (p2 - p1);
```

---

## 4. Canvas Overlay Architecture

The overlay canvas lives in the **main document** (not inside the iframe) to avoid cross-origin restrictions.

```
┌─ Main Document ─────────────────────────┐
│                                         │
│  ┌─ <iframe> (TradingView) ───────┐     │
│  │   .chart-container [0]         │     │
│  │   .chart-container [1]         │     │
│  │   ...                          │     │
│  └────────────────────────────────┘     │
│                                         │
│  ┌─ <canvas#ts-spacebar-overlay> ─┐     │  ← position:fixed; z-index:999999
│  │   pointer-events: none         │     │     covers entire viewport
│  │   renders lines + labels       │     │
│  └────────────────────────────────┘     │
│                                         │
└─────────────────────────────────────────┘
```

### Coordinate mapping (iframe → main doc)

```js
// iframeRect = iframe element's bounding rect in main doc
// paneRect   = chart canvas's bounding rect in iframe coords
// paneY      = price-derived Y via linear interpolation

drawY = iframeRect.top + paneRect.top + paneY
```

### Multi-chart rendering

For each chart pane showing the same symbol:
1. `api.chartsCount()` → iterate all charts
2. `chart(i).symbol()` → compare to active symbol (normalized, exchange prefix stripped)
3. Get each matching chart's container `.chart-container[i]` → find its canvas → `getBoundingClientRect()`
4. Use that chart's own `scale.coordinateToPrice()` for interpolation (each chart may be zoomed differently)

---

## 5. Enum Values (Reverse-Engineered)

Discovered by intercepting XHR request payloads during manual order placement.

```js
const OrderType = { Limit: 1, Market: 2, Stop: 3, StopLimit: 4 };
const Side      = { Buy: 1, Sell: -1 };
```

The `ORDER_SOURCE` value `'ORDER_PAD'` was captured from the same XHR intercept — it identifies the originator of the order within TradeSea's backend.

---

## 6. Discovery Process — How We Found All This

### Phase 1: XHR Interception (initial approach)
- Patched `XMLHttpRequest.prototype.open` to log all outgoing requests
- Placed a manual order via the UI and captured the request payload
- Extracted: endpoint URL structure, enum values (`side`, `type`), account token format, `ORDER_PAD` source string

### Phase 2: Svelte Module Re-Import
- Used `performance.getEntriesByType('resource')` to find the main JS bundle URL
- `import(bundleUrl)` to get all module exports
- Iterated exports, calling zero-arg methods and checking return types
- Identified services by their method signatures (duck typing)

### Phase 3: Exhaustive Export Scanning
- For every export object, enumerated all `getOwnPropertyNames`
- Called every zero-arg function and logged return values
- Subscribed to every Svelte store (objects with `.subscribe()`) and logged their values
- Searched for keywords: `quote`, `feed`, `market`, `price`, `quantity`, `lot`, `size`

### Phase 4: TradingView Widget API Probing
- Accessed `iframe.contentWindow.tradingViewApi`
- Tested documented TradingView Charting Library methods
- Discovered that `subscribeCrosshairMove`, `crosshairPosition`, and `priceToCoordinate` are **not available** in TradeSea's build
- Found that `coordinateToPrice` works, `exportData` works, `getPanes` works
- Developed the linear interpolation workaround for missing `priceToCoordinate`

### What didn't work
| Approach | Why it failed |
|----------|--------------|
| `chart.crosshairPosition()` | Not exposed in TradeSea's TradingView build |
| `subscribeCrosshairMove()` | Not exposed |
| `priceToCoordinate(price)` | Not exposed |
| Canvas inside iframe | Cross-origin security blocks injection |
| React Fiber traversal for lot size | TradeSea uses Svelte, not React |
| DOM scraping for price | Fragile, slow, breaks on UI changes |
