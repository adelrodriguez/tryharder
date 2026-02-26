<div align="center">
  <h1 align="center">🔁 <code>hardtry</code></h1>

  <p align="center">
    <strong>A better try-catch</strong>
  </p>
</div>

Made with [🥐 `pastry`](https://github.com/adelrodriguez/pastry)

## API Notes

- `run(...)` is the sync entrypoint.
- `runAsync(...)` is the async entrypoint and always returns a `Promise`.
- `retry(number)` keeps `run(...)` available.
- `retry({ ...policy })` requires `runAsync(...)`.

### Context narrowing

The `ctx` type passed to `try` functions is feature-aware:

- Without `.retry(...)`, `ctx.retry` is not available.
- After `.retry(...)`, `ctx.retry` is available.

```ts
import { retry, run } from "hardtry"

run((ctx) => {
  // ctx.retry is not available here
  return 1
})

retry(3).run((ctx) => {
  // ctx.retry is available here
  return ctx.retry.attempt
})
```
