---
"tryharder": minor
---

Align the `all(...)` `catch` option with the `run(...)` catch contract:

- A `Panic` from a task is thrown and never passes through `catch`.
- When `catch` rejects with a `CancellationError`, `all` now throws a `Panic` with code `ALL_CATCH_HANDLER_REJECT`, the same as for any other rejection. Before, the `CancellationError` passed through unchanged. Real cancellation still rejects with `CancellationError`, because `all` checks the signal after `catch` runs.
- `ctx.partial` is now a snapshot taken when `catch` is called. Before, it was a live object, so results from tasks that settled while an async `catch` ran could appear in it.
