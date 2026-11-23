---
'e2e': patch
---

Add the `ctrf` reporter: `--reporter ctrf` or `reporters: ['ctrf']` writes `<output>/ctrf.json` in the Common Test Report Format 0.3.0, so CTRF tools read flaky tests, earlier attempts, steps, attachments, and run errors that `junit.xml` cannot carry. Run-level errors go in `results.errors` and never count as tests, so a check built on failed tests alone stays green for them: keep e2e's exit code as the CI gate.
