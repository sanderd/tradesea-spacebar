# Architecture

## Overview

TradeSea Spacebar Trading is a Tampermonkey userscript built from ES modules and bundled into a single IIFE via [Rollup](https://rollupjs.org/).

Source lives in `src/`, the build output goes to `dist/tradesea-spacebar.user.js` (gitignored).

## Module Map

```
src/
├── header.js       Tampermonkey ==UserScript== header (template, not code)
├── index.js        Entry point — init, teardown, iframe watchdog
├── state.js        Shared mutable state object `S` and `services`
├── config.js       Constants, DEFAULT_CONFIG, schema migrations, load/save
├── logging.js      Coloured console logging helpers
├── chart.js        TradingView API wrappers (symbol, price, tick size, qty)
├── canvas.js       Overlay canvas, draw loop, coordinate↔price conversion
├── events.js       Keyboard + iframe mouse event handlers
├── orders.js       Order placement and break-even logic
├── settings.js     Settings UI, import/export, CSS
└── nicknames.js    Account nickname overlay system
```

### Dependency flow

```
index.js
  ├─ state.js
  ├─ config.js ←→ logging.js
  ├─ chart.js → state.js
  ├─ canvas.js → chart.js, state.js, config.js
  ├─ events.js → canvas.js, chart.js, orders.js, state.js
  ├─ orders.js → chart.js, state.js
  ├─ settings.js → config.js, state.js, canvas.js
  └─ nicknames.js → config.js, logging.js, state.js
```

## Build System

### Tooling

| Tool | Purpose |
|------|---------|
| [Rollup](https://rollupjs.org/) | Bundles ES modules into a Tampermonkey-compatible IIFE |
| [@rollup/plugin-replace](https://github.com/rollup/plugins/tree/master/packages/replace) | Injects `__VERSION__` at build time |
| Git tags | Version source of truth — `vMAJOR.MINOR` tag + commit count = patch |

### Versioning

Version is derived **automatically from git**, not from a file:

```
git describe --tags --match "v*" --long
→ v2.7-5-gabcdef
→ version = 2.7.5
```

- `MAJOR.MINOR` comes from the latest `v*` tag (e.g. `v2.7`)
- `PATCH` is the number of commits since that tag
- No version-bump commits needed — just tag when you want to increment major/minor

### Build commands

```powershell
npm run build           # Production build
.\build.ps1             # Same, via PowerShell wrapper
.\build.ps1 -Dev        # Dev build with timestamp suffix
```

### CI/CD (GitHub Actions)

Push a `v*` tag to trigger `.github/workflows/release.yml`:

1. Checks out with full history
2. Runs `npm ci` + `npx rollup -c`
3. Creates a GitHub Release with `dist/tradesea-spacebar.user.js` as an artifact

## Shared State Pattern

All cross-module mutable state lives on a single object `S` (defined in `state.js`). This avoids the closure-variable scoping issues that come from splitting a monolithic IIFE into modules.

```js
// state.js
export const S = {
  spaceHeld: false,
  mousePrice: null,
  canvas: null,
  ctx: null,
  iframeWin: null,
  // ... etc
};
```

Modules import `S` and read/write properties directly: `S.spaceHeld = true`.

**Why not individual exports?** Rollup bundles everything into a single IIFE scope. Re-exported `let` bindings work, but the `S` object pattern is simpler to reason about and mirrors how the original monolithic script worked (bare `let` variables in a single closure).

## Gotchas & Lessons Learned

### 1. Missing imports cause silent failures

Rollup treats unimported identifiers as global references. In an IIFE bundle, there are no globals, so the call throws `ReferenceError`. If the call is inside a `try/catch` (common for TradingView API access), the error is silently swallowed and the function returns `null`.

**Symptom:** Feature silently stops working; no console errors.

**Example:** `getActiveChart()` was used in `canvas.js` but not imported from `chart.js`. Rollup renamed the chart.js export to `getActiveChart$1`, leaving the canvas.js call as `getActiveChart` (undefined).

**Prevention:** After building, scan for Rollup's `$1`/`$2` suffixed names — these indicate naming conflicts caused by missing imports:

```powershell
Select-String -Path dist/tradesea-spacebar.user.js -Pattern "\$\d+\b"
```

If any results appear, trace the base name back to its source module and add the missing import.

### 2. State variable rewrites in string literals

The original extraction tool (`scripts/extract-modules.mjs`, now removed) used regex to convert bare variable names to `S.xxx` properties. This incorrectly rewrote string literals:

```js
// Original:
document.createElement('canvas')
// Wrongly became:
document.createElement('S.canvas')
```

**Prevention:** This is no longer a concern since `src/` is now the source of truth and the extraction tool has been removed. If a similar bulk-rename is ever needed, exclude matches inside quoted strings.

### 3. Module-local caches need explicit teardown

Variables like `_overlayRectsCache` and `_paneRectsCache` are module-local (not on `S`). During iframe re-initialization (account switching), these must be explicitly reset.

**Pattern:** Each module that has local caches exports a `resetXxxCaches()` function, called from `teardown()` in `index.js`:

```js
// canvas.js
export function resetCanvasCaches() {
  _overlayRectsCache = [];
  _paneRectsCache = null;
}

// index.js (teardown)
import { resetCanvasCaches } from './canvas.js';
resetCanvasCaches();
```

### 4. Cleanup closures must capture the right reference

When attaching event listeners to `S.iframeWin`, the cleanup closure reads `S.iframeWin` at cleanup time. If teardown nulls `S.iframeWin` before running cleanup functions, `removeEventListener` calls fail silently. Run cleanup functions **before** nulling state.

### 5. canvas.js contains residual dead code

`canvas.js` currently contains a copy of the settings UI code (from the original extraction). Rollup tree-shakes it since it's not exported, so it doesn't appear in the bundle. It can be safely removed from `canvas.js` in a future cleanup pass.
