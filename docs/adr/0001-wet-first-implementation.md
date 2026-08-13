# WET-first implementation while the API is evolving

The library is pre-v1 and its execution semantics are still being reshaped, so we deliberately prefer duplicating simple logic over introducing abstractions: duplication keeps intent obvious and local while behavior shifts. We move to DRY only after a pattern has stabilized and the abstraction clearly improves readability, maintenance, or correctness — consolidations like #49, #55, and #59 are this policy paying off, not corrections to it.

## Consequences

- Simple duplication across the execution, orchestration, and policy modules is not a defect; do not "fix" it while the duplicated behavior is still evolving.
- When behavior has stabilized across a few releases, deduplication PRs are welcome.
