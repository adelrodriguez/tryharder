---
"tryharder": minor
---

Add `this.$race(promise)` to orchestration task contexts (`all`, `allSettled`, `flow`): races a promise against the task's `$signal` and rejects with the abort reason when the signal fires first. Wrap awaits on signal-unaware work so graph deadlines and cancellation bound wall-clock time without giving up the settle-before-return guarantee.

Behavior change: fail-fast aborts in `all` and `flow` now set the task signal's abort reason to the mapped failure, so a sibling reading `this.$signal.reason` (or awaiting `$race`) observes the same normalized error that settlement waiters receive — non-Error throws (a string, an object, `null`, `undefined`) surface as an `UnhandledException` wrapper carrying the raw value as `cause`, instead of the raw thrown value.
