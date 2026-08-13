# Orchestration settles all in-flight tasks before rejecting

When cancellation or a whole-graph total deadline fires, `all`, `allSettled`, and `flow` do not reject immediately — they abort every task's `$signal` and wait for all in-flight tasks to settle first (#59, #60). The obvious alternative, rejecting immediately like `Promise.all`, surfaces failure sooner but leaves task code still running after the orchestration returns; we chose the structured guarantee that no task outlives its orchestration, which also makes it safe for callers to retry after a `TimeoutError`.

## Consequences

- A task that ignores its `$signal` delays the `TimeoutError` or `CancellationError` — the deadline bounds wall-clock time only when tasks observe cancellation.
- Documentation and tests must preserve the guarantee uniformly across all three orchestration APIs; `allSettled` was aligned last in #60.
