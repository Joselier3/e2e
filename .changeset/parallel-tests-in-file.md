---
'e2e': patch
'@e2e-dev/core': patch
---

Tests of one file can run at the same time on separate workers. `describe(title, { parallel: true }, fn)` does it for a group, `describe.configure({ parallel: true })` at the top of a file for the file, and `fullyParallel: true` in the config, on a target, or `--fully-parallel` for every file. A serial group still runs as one unit, and `{ parallel: false }` keeps a group or a file in order. Each worker imports the file again, and `beforeAll` and `afterAll` run one time on each worker that runs tests of their scope. Without any of these, a file's tests run in order on one worker, as before.
