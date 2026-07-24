---
"tryharder": patch
---

Deduplicate the orchestration task-graph lifecycle. The shared skeleton — racing execution against cancellation, waiting for sibling tasks to settle before resolving, and giving cancellation priority over thrown errors — now lives once in `OrchestrationExecution.executeTaskGraph`, used by `all()`, `allSettled()`, and `flow()`. Each executor keeps only its own failure mapping. No behavior change.
