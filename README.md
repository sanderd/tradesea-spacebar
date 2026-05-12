# TradeSea Spacebar Trading

A Tampermonkey userscript that adds keyboard-driven order placement to TradeSea. Hold spacebar, point at a price on the chart, and click to place orders instantly.

---

- [🧩 Features](#-features)
- [🎬 Demo video](#-demo-video)
- [📦 Installation](#-installation)
- [⚠️ Important Notes](#%EF%B8%8F-important-notes)
- [🔧 Development](#-development)
- [🔒 Security](#-security)
- [📄 Disclaimer](#-disclaimer)

---

## 🧩 Features

- **Spacebar quick-order mode** -- hold spacebar, left-click to buy, right-click to sell at the pointed price
- **Auto order type** -- automatically picks limit or stop based on price relative to market
- **Configurable contract size slots** with bindable hotkeys for instant switching
- **Break-even hotkey** -- move stop loss to average entry with a single keypress
- **Price levels overlay** -- configure horizontal price lines per instrument (e.g. NQ, MNQ) with custom labels and colors (including alpha). Lines are drawn directly over the chart, always visible, with a right-aligned label tag
- **Visual overlay** -- magenta crosshair with buy/sell labels rendered across all charts showing the same symbol
- **Account nicknames** -- assign custom display names to trading accounts

## 🎬 Demo video

https://youtu.be/-D2Mv_recOc

![Screenshot 1](https://github.com/sanderd/tradesea-spacebar/raw/master/Screenshot%202026-05-07%20150743.png)

![Screenshot 2](https://github.com/sanderd/tradesea-spacebar/raw/master/Screenshot%202026-05-07%20150752.png)

## 📦 Installation

Requires [Tampermonkey](https://www.tampermonkey.net/) browser extension.

### Option 1: Install latest release (recommended)

Click the link below (or paste it into Tampermonkey's **Utilities → Install from URL**):

```
https://github.com/sanderd/tradesea-spacebar/releases/latest/download/tradesea-spacebar.user.js
```

Tampermonkey should detect the `.user.js` extension and offer to install it automatically.

### Option 2: Install a specific version

1. Go to [Releases](https://github.com/sanderd/tradesea-spacebar/releases)
2. Pick the version you want
3. Download `tradesea-spacebar.user.js` from the release assets
4. Open Tampermonkey dashboard → **Utilities** tab → **Import from file**, or create a new script and paste the contents

### Updating

This script **does not auto-update**. To update, repeat the installation steps above with the newer version.

## ⚠️ Important Notes

- TradeSea platform updates **may break this script** without warning, since it hooks into internal APIs and DOM structures.
- The script works on `https://app.tradesea.ai/trade*` and `https://app.tradesea.ai/account-center*` pages.

## 🔧 Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for build instructions, dev workflow, and release process.

## 🔒 Security

Running userscripts from the internet means executing someone else's code in your browser. Trust, but verify.

**What you can check:**
- **Source code** — the full source is available in this repository.
- **Reproducible builds** — every release is built by a [public GitHub Actions workflow](.github/workflows/release.yml) (`npm ci` → `npx rollup -c`), so the release artifact matches the committed source.
- **No network calls** — this script makes zero external requests. It only interacts with the TradeSea page DOM and TradingView iframe already loaded in your browser.

**Verify it yourself** — paste this prompt into your AI of choice:

> Fetch the userscript from
> `https://github.com/sanderd/tradesea-spacebar/releases/latest/download/tradesea-spacebar.user.js`
> and audit the code for security risks. Specifically check for:
> - Outbound network requests (fetch, XMLHttpRequest, WebSocket, sendBeacon, image pings)
> - Credential or cookie access / exfiltration
> - Accessing localStorage/sessionStorage of other origins
> - Dynamic code execution (eval, Function constructor, script injection)
> - Any data leaving the page to an external server
>
> Summarise your findings and assign an overall risk level.

## 📄 Disclaimer

This software is provided as-is, with no warranty of any kind. Use at your own risk. The author assumes no liability for financial losses, incorrect order placement, or any other damages arising from the use of this script. This is an unsupported personal tool -- not affiliated with or endorsed by TradeSea.
