---
"@e2e-dev/core": minor
"e2e": minor
"@e2e-dev/web": patch
"@e2e-dev/mobile": patch
---

**Breaking:** Tests get a built-in `request` fixture for HTTP calls. `await request.post('/api/orders', { json: { sku: 'A1' } })` sends a request to a path on the app URL or to an absolute URL, shows in the report as a step, and stops at the action timeout. `expect(response).toBeOK()` checks for a 2xx status. It does not send the browser's cookies. A project fixture already named `request` now extends the built-in one: a worker-scoped one fails at collection, and one typed through `test.extend<{ request: ... }>()` no longer compiles, so rename it. An engine can no longer contribute a fixture named `request`.
