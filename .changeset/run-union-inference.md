---
"tryharder": patch
---

Fix `run()` rejecting a `try` or `catch` that returns a union of plain values

`run({ try: () => (flag ? "a" : 1), catch: (error) => (error instanceof TypeError ? new NotFound() : new Invalid()) })` now compiles without type arguments and returns `Promise<"a" | 1 | NotFound | Invalid>`.
