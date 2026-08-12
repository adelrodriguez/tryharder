---
"tryharder": minor
---

Add `this.$race(promise)` to orchestration task contexts (`all`, `allSettled`, `flow`): races a promise against the task's `$signal` and rejects with the abort reason when the signal fires first. Wrap awaits on signal-unaware work so graph deadlines and cancellation bound wall-clock time without giving up the settle-before-return guarantee.
