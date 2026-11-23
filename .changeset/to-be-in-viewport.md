---
'e2e': patch
---

Added `expect(locator).toBeInViewport({ ratio?, timeout? })`. It waits for the one match to be shown with part of its box inside the viewport. `ratio` is the share of the box that has to be inside, from 0 to 1 (the default 0 means any part). The viewport size comes from a screen observation, so the check is the same on the web, iOS, and Android. `.not.toBeInViewport()` passes for a hidden, absent, or off-screen match (such as a pager page off to the side).
