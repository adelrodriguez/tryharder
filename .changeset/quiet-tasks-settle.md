---
"tryharder": patch
---

Fix two bugs in orchestration results:

- `all` now keeps the first task failure when that task throws `null` or `undefined`. Before, a later task failure replaced it, so `catch` and the rejection received the wrong error and `ctx.failedTask` did not match it.
- `all` and `allSettled` now keep the result of a task named `__proto__` as an own property of the result object. Before, the result was lost. The `ctx.partial` snapshot that `all` passes to `catch` also keeps it.
