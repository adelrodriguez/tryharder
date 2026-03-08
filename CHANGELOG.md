# tryharder

## 0.1.0

### Minor Changes

- b014c61: Launch `tryharder` as the first public minor release.

  `tryharder` is a typed execution layer for TypeScript that makes failure and execution policy explicit in return types and builder chains. This initial release includes:
  - terminal execution APIs with `run()` and `runSync()`
  - execution policies with `retry()`, `timeout()`, and `signal()`
  - observational middleware with `wrap()`
  - orchestration APIs with `all()`, `allSettled()`, and `flow()`
  - generator-style composition with `gen()`
  - cleanup support with `dispose()`
  - dedicated `tryharder/errors` and `tryharder/types` entrypoints

  Migration note: if you were using pre-release or repository-based builds under the old `hardtry` name, update imports from `hardtry` to `tryharder`, `hardtry/errors` to `tryharder/errors`, and `hardtry/types` to `tryharder/types`.
