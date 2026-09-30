---
"tryharder": patch
---

Fix three bugs:

- `gen` now runs the generator's `finally` blocks when it short-circuits on a yielded `Error`, on both the sync and async paths. Before, the generator stayed suspended and its cleanup code never ran.
- `all`, `allSettled`, and `flow` no longer cause an unhandled rejection when a task aborts the external signal synchronously and then throws. The orchestration still rejects with `CancellationError`.
- `allSettled` now throws a `Panic` from a task instead of recording it as `{ status: "rejected", reason: Panic }`. It aborts the other tasks' `$signal` and waits for them to settle before it throws.
