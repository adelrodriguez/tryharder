---
"tryharder": patch
---

Internal cleanup: timeout validation now has a single source of truth (`assertValidTimeout` in the timeout modifier, used eagerly by the builder and defensively by `TimeoutController`), and the task-graph observation hooks (`onTaskResult`/`onTaskError`) are optional methods instead of no-op bodies filled with lint-appeasing `void` statements. No behavior change.
