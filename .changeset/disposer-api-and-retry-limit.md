---
"tryharder": minor
---

Simplify the disposal API to one name per operation, and require positive integer retry limits.

**Breaking changes:**

- The `dispose()` factory export is renamed to `disposer()`.
- `AsyncDisposer` now exposes exactly three operations: `defer(fn)` (register a cleanup callback, was `add`), `use(resource)` (unchanged), and `dispose()` (run teardown, was `cleanup`/`disposeAsync`). The `add()`, `cleanup()`, and `disposeAsync()` aliases are removed. `await using` support via `Symbol.asyncDispose` is unchanged.

```ts
const d = try$.disposer()
d.defer(async () => connection.close())
// ...
await d.dispose()
```

- `retry()` now requires a positive integer limit. `retry(0)` previously behaved identically to `retry(1)` while contradicting the documented "limit includes the first attempt" semantics, and fractional limits like `retry(2.5)` silently behaved as their ceiling. Both now throw `Panic("RETRY_INVALID_LIMIT")` at `.retry()` call time — and are rejected at compile time when passed as literals (`retry(0)`, `retry(-1)`, `retry(2.5)`, and the object-form `limit` equivalents are now type errors). Non-literal `number` values remain runtime-validated.
