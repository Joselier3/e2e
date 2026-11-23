---
"@e2e-dev/core": patch
---

`locator.swipe()` now takes `{ from, to, duration? }`, like `screen.swipe()`, with both points on the node instead of the screen. A path swipe is a pointer drag on the web and a finger swipe on a device. So pagers built on pointer events now turn on the web, where a direction swipe is sent as a wheel event they ignore. Pixels and percentages are both measured from the node's top-left corner, the corner `tap({ position })` uses, and a percentage is a share of the node's width or height. The direction form hasn't changed.
