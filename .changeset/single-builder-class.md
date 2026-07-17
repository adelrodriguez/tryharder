---
"tryharder": patch
---

Collapse the builder to a single runtime class. The internal `ExecutionBuilder` subclass and its runtime method-hiding (defining `all`/`allSettled`/`flow`/`wrap` as `undefined` after `retry()`/`timeout()`) are removed — the narrowed type surfaces already prevent misuse in TypeScript, orchestration-after-policy from untyped code now fails at execution with a clear `Panic("ORCHESTRATION_UNSUPPORTED_POLICY")` instead of a bare `TypeError: undefined is not a function`, and wrap ordering is behavior-invariant (wraps always cover the full retry scope). This also removes the `instanceof` branching inside `signal()`.
