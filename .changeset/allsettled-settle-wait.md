---
"tryharder": minor
---

`allSettled(...)` now waits for in-flight tasks to settle before rejecting on cancellation or a graph deadline, matching `all(...)` and `flow(...)`. Previously it rejected promptly, which let `$disposer` teardown run while abandoned tasks were still executing and made retry-after-rejection unsafe. All three orchestration APIs now share the structured guarantee that no task code is still running once the orchestration returns.
