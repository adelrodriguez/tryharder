---
"tryharder": patch
---

Deduplicate attempt-failure resolution between `run()` and `runSync()`. The shared logic — defect rethrow, control-error passthrough, retry-directive creation, and unmapped-failure wrapping (`RetryExhaustedError`/`UnhandledException`) — now lives in two `BaseExecution` helpers (`resolveControlOrRetry`, `resolveUnmappedFailure`); each executor keeps only its own catch-mapping behavior. No behavior change.
