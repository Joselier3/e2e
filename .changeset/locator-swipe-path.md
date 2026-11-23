---
"@e2e-dev/core": patch
---

`locator.swipe({ from, to, duration? })` drags along a path on the node's box: a pointer drag on the web, a touch swipe on a device. So a pager that follows pointer drags turns on the web, where `swipe({ direction })` sends a wheel event it ignores, and a pager follows the finger on a device. Both pixels and percentages measure from the node's top-left corner, as `tap({ position })` does: a pixel point is an offset from it, and a percentage is that share of the node's width or height. The direction form is unchanged.
