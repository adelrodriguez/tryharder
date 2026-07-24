---
"tryharder": minor
---

Add error type guards to `tryharder/errors`: `isCancellationError`, `isTimeoutError`, `isRetryExhaustedError`, `isUnhandledException`, and `isPanic`. The guards match by `error.name` (plus a `code` check for `Panic`) in addition to `instanceof`, so they keep working when duplicate copies of `tryharder` exist in one dependency graph or when errors cross realm boundaries — situations where `instanceof` silently fails. They are the recommended way to identify tryharder errors.
