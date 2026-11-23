---
'e2e': patch
'@e2e-dev/core': patch
---

A run with no model key now says so once and stops, instead of failing every agent test with the provider's `Unauthenticated request` text and a hint about a rejected credential. When a provider package finds no API key, or the Vercel AI Gateway neither a key nor an OIDC token, the first model call raises one run-level `MODEL_UNAVAILABLE` (exit 2) that names the variable, such as `the model has no credential: AI_GATEWAY_API_KEY is not set`, and says that tests with no agent call and recorded `agent.act` steps need no model. A key the provider rejects is still `MODEL_PROVIDER_FAILED`. `e2e doctor` warns when a Vercel AI Gateway or OpenRouter model has none of the variables it reads set.
