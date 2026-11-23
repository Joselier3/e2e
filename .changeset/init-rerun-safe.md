---
'e2e': patch
---

`e2e init` is safe to run again on an initialized project. It reads the existing config's imports and adds the packages `package.json` lacks, at the ranges a new project gets: `@e2e-dev/web` and `@e2e-dev/mobile` with `@e2e-dev/core`, `ai` with `zod`, and a gateway's provider packages. Before, a re-run added `e2e` alone. Any other package the config imports is yours to add. It also writes no example test beside an existing config: a re-run used to restore a deleted `tests/example.e2e.ts` as the engine-less `fetch` example.
