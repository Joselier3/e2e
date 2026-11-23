---
"@e2e-dev/core": patch
"e2e": patch
---

A replay no longer acts on a same-named twin when the control the step recorded is gone: one of two "Set up" buttons left, or a button whose unique test id disappeared while another with its role and name is on screen. This covers taps and drags on the control, a recorded screen point inside it, and a scroll on a list (not `scrollUntil`, which records no count for its list). The step hands off to the agent, or fails with `REPLAY_STALE` under `--strict-cache`, where it used to complete on the wrong control, and the report now says the target "cannot be told from its look-alikes". A step whose twin really did go away, such as a second "Close" or one of two controls sharing a test id, now hands off too (a control recorded by its own test id after up to about 15 seconds of looking for that id), and is recorded again the next time it passes with a cache it may write. Two kinds of step keep replaying as before: one recorded by a unique test id before this change, until it is recorded again, and an action an executor took from the same look as an earlier action of the step.
