# Spacebar Trading

A Tampermonkey userscript that adds keyboard-driven order placement to **TradeSea** and **ProjectX** (TopstepX). Hold spacebar, point at a price on the chart, and click to place orders instantly.

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

- **Spacebar quick-order mode** — hold spacebar, left-click to buy, right-click to sell at the pointed price
  - Auto order type — automatically picks limit or stop based on price relative to market
  - Multi-chart support — click a chart pane to make it active; the crosshair and orders follow that instrument
- **Hotkeys**
  - Configurable contract size slots with bindable keys for instant switching
  - Break-even — move stop loss to average entry with a single keypress *(TradeSea only — ProjectX has this built in)*
- **Visual overlay** — crosshair with buy/sell labels rendered across all charts showing the same symbol
- **Price levels** — configure horizontal lines per instrument (e.g. NQ, MNQ) with custom labels and colors. Always visible, with right-aligned label tags
- **Account nicknames** — assign custom display names to trading accounts *(TradeSea only — ProjectX has this built in)*
- **Version compatibility warning** — alerts you at startup if the platform has updated beyond the last verified version, with an option to silence future warnings for that version range

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

- Platform updates **may break this script** without warning — it hooks into internal APIs that can change at any time. A startup warning will appear if the detected version differs from the last verified one.
- Supports **TradeSea** and **ProjectX / TopstepX**

## 🔧 Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for build instructions, dev workflow, and release process.

## 🔒 Security

Running userscripts from the internet means executing someone else's code in your browser. Trust, but verify.

**What you can check:**
- **Source code** — the full source is available in this repository.
- **Reproducible builds** — every release is built by a [public GitHub Actions workflow](.github/workflows/release.yml) (`npm ci` → `npx rollup -c`), so the release artifact matches the committed source.
- **No network calls** — this script makes zero external requests. It only interacts with the platform page DOM and TradingView iframe already loaded in your browser.

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

This software is provided as-is, with no warranty of any kind. Use at your own risk. The author assumes no liability for financial losses, incorrect order placement, or any other damages arising from the use of this script.

**Independent tool — no vendor affiliation.**
This is an unsupported, independently developed personal tool. It is not affiliated with, endorsed by, sponsored by, or in any way officially connected to TradeSea, ProjectX, TopstepX, or any of their parent companies, subsidiaries, or affiliates. No vendor has reviewed, approved, or authorised this script.

**Trademarks.**
TradeSea, ProjectX, TopstepX, and TradingView are trademarks or registered trademarks of their respective owners. All brand names, product names, and logos mentioned in this project are the property of their respective owners and are used here solely for identification purposes.

