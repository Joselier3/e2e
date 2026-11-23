---
'e2e': patch
---

`expect(locator).toBeInViewport({ ratio?, timeout? })` waits for the one match to be shown with part of its box inside the viewport, like Playwright's. `ratio`, from 0 to 1, is the share of the box that must be inside; the default 0 means any part. It reads the viewport from a screen observation, so it works on the web, iOS, and Android. Negated, it passes for a hidden, absent, or off-screen match, such as a pager page off to the side.
