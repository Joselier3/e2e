---
'e2e': patch
---

The e2e skill and the MCP server's `test_lines` now steer coding agents to test one behavior per test with every check at the end, name a locator the test repeats, keep test data on the app's server in fixtures, and, when a test acts on one item of a list, add two, act on the second item shown, never the first, and check the first is unchanged.
