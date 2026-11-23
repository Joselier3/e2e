---
'@e2e-dev/core': patch
'e2e': patch
---

`locator.screenshot(label?)` captures the one match and returns the file's path, as `app.screenshot()` does for the screen. It scrolls the match into view, waits until its box holds still across the capture, and cuts the screenshot to that box, with the same masking and pixel density. A match larger than the viewport keeps the part inside it. It works on every engine that takes screenshots.
