---
'@e2e-dev/web': patch
---

`web({ deviceScaleFactor })` sets the device pixels per CSS pixel on every attempt's page, as `window.devicePixelRatio` reads it. At 2, every saved screenshot (`app.screenshot()`, a failure's, an `agent.assert`'s) is twice the viewport's size on each side. The pixels the model reads and `toHaveScreenshot` stay at one image pixel per CSS pixel. It needs a viewport size, and a persistent context (`connect.reconnectEndpoint`, or a provider with `scope: 'attempt'`) refuses it.
