---
"@e2e-dev/core": patch
---

`locator.swipe({ from, to, duration? })` drags along a path on the node's box: a pointer drag on the web, a touch swipe on a device. So a pager that follows pointer drags turns on the web, where `swipe({ direction })` sends a wheel event it ignores, and a pager follows the finger on a device. A pixel point is an offset from the node's top-left corner, as in `tap({ position })`, and a percentage is that share of the box's width or height. The direction form is unchanged.
