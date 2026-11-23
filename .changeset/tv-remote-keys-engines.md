---
'@e2e-dev/web': patch
'@e2e-dev/desktop': patch
---

Released with the engine contract's TV remote keys. Neither engine declares `remoteKeys`, so a remote key is refused with `UNSUPPORTED_CAPABILITY` before it reaches them.
