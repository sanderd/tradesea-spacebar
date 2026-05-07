# TradeSea Spacebar Trading

A Tampermonkey userscript that adds keyboard-driven order placement to TradeSea. Hold spacebar, point at a price on the chart, and click to place orders instantly.

## Features

- **Spacebar quick-order mode** -- hold spacebar, left-click to buy, right-click to sell at the pointed price
- **Auto order type** -- automatically picks limit or stop based on price relative to market
- **Configurable contract size slots** with bindable hotkeys for instant switching
- **Break-even hotkey** -- move stop loss to average entry with a single keypress
- **Visual overlay** -- magenta crosshair with buy/sell labels rendered across all charts showing the same symbol

## Demo video

https://youtu.be/-D2Mv_recOc

## Requirements

Requires [Tampermonkey](https://www.tampermonkey.net/) browser extension.

**To install:** open Tampermonkey dashboard, go to the Utilities tab, paste the URL below into "Install from URL", and click Install. Alternatively, create a new script and paste the contents directly.

```
https://raw.githubusercontent.com/sanderd/tradesea-spacebar/master/tradesea-spacebar.user.js
```

## Important Notes

- This script **does not auto-update**. You must manually reinstall or paste new versions.
- TradeSea platform updates **will likely break this script** without warning, since it hooks into internal APIs and DOM structures.

## Disclaimer

This software is provided as-is, with no warranty of any kind. Use at your own risk. The author assumes no liability for financial losses, incorrect order placement, or any other damages arising from the use of this script. This is an unsupported personal tool -- not affiliated with or endorsed by TradeSea.
