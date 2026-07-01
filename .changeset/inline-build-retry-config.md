---
"tryharder": patch
---

Inline `buildRetryConfig` into `retry` and add clarifying comments to the execution logic. No behavior change; this simplifies the builder internals and documents the timeout/cancellation race, flow first-rejection handling, and the intentionally no-op `SignalController.dispose`.
