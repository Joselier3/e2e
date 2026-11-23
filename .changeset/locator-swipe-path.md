---
"@e2e-dev/core": patch
---

`locator.swipe()` now accepts a path, `{ from, to, duration? }`, like `screen.swipe()`. Both points are on the node instead of the screen.

- On a device, a path swipe is a finger swipe.
- On the web, a path swipe is a pointer drag. A direction swipe is sent as a wheel event, so pagers built on pointer events don't move. They can now be turned with a path swipe.

Pixels and percentages are both measured from the node's top-left corner (the same corner as `tap({ position })`). A percentage is a share of the node's width or height. The direction form hasn't changed.
