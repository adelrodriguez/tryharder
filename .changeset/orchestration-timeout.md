---
"tryharder": minor
---

Support `timeout(...)` for orchestration (`all`, `allSettled`, `flow`) as a whole-graph deadline: when it fires, every task's `$signal` aborts and the orchestration rejects with `TimeoutError` (cancellation still wins when both fire). The `ORCHESTRATION_UNSUPPORTED_POLICY` panic now applies to `retry(...)` only. Internal simplifications: task-graph settlement now rides on native promises instead of hand-rolled resolver queues, `all`/`allSettled` execution split into dedicated classes, the wrap context dropped its outer proxy, and control-failure priority (cancellation over timeout) is decided in a single `resolveOutcome` boundary.
