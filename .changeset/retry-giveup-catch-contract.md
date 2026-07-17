---
"tryharder": minor
---

Align retry give-up semantics with the `catch` contract (modeled on Effect's `retry`/`retryOrElse`): when a retry policy gives up — whether the attempt limit was exhausted or `shouldRetry` declined — the last attempt's error now takes the normal domain-error path instead of short-circuiting.

**Breaking changes:**

- `run({ try, catch })` / `runSync({ try, catch })` with retry configured: when retries exhaust, `catch` is now invoked with the last attempt's error and its mapped value is returned. Previously `catch` was bypassed and `RetryExhaustedError` was returned. `RetryExhaustedError` no longer appears in the return type union for the object form.
- `run(fn)` / `runSync(fn)` with retry configured: when `shouldRetry` declines before the limit, the failure is now reported as `RetryExhaustedError` (with the last error as `cause`) instead of `UnhandledException`. Both give-up reasons are now indistinguishable, matching Effect.
- Function-form return types with retry configured now infer `T | RetryExhaustedError | ...` instead of `T | UnhandledException | RetryExhaustedError | ...` (`UnhandledException` was unreachable in that configuration).

**The `catch` contract, now explicit in JSDoc and README:** `catch` maps errors that originated inside `try` — thrown directly, or carried out of the retry loop as the last attempt's error once the retry policy gives up. Policy outcomes (`TimeoutError`, `CancellationError`) and defects (`Panic`) never pass through `catch`.

Decision table:

| retry | catch | persistent failure resolves to                   |
| ----- | ----- | ------------------------------------------------ |
| no    | no    | `UnhandledException` (cause: error)              |
| no    | yes   | `catch(error)`                                   |
| yes   | no    | `RetryExhaustedError` (cause: last error)        |
| yes   | yes   | `catch(lastError)`                               |
| any   | any   | timeout/cancel: typed in union, bypasses `catch` |
