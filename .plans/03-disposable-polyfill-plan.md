# DisposableStack Polyfill Plan

Goal: bundle the `disposablestack` polyfill so the library works in environments
without native `DisposableStack`/`AsyncDisposableStack` support (e.g. Firefox,
Safari), while remaining a no-op on runtimes that already ship the feature
(Node 20+, Chrome 127+).

## Context

The library uses `DisposableStack`, `AsyncDisposableStack`, `using`, and
`await using` throughout the executor layer (`base.ts`, `flow.ts`, `shared.ts`,
`utils.ts`). These are constructed unconditionally — even if a consumer never
touches `$disposer` in their task functions, the library will fail at runtime in
environments without native support.

The `disposablestack` package (es-shims, by Jordan Harband) is spec-compliant,
works down to ES3, has 60K+ weekly downloads, and its `/auto` entrypoint
patches globals only when missing.

## Progress Checklist

- [ ] Step 1 - Add `disposablestack` as a dependency
- [ ] Step 2 - Import polyfill in entry point
- [ ] Step 3 - Verify with analyze, format, check, typecheck, and test
- [ ] Step 4 - Create changeset

## Step 1 - Add `disposablestack` as a dependency

- Run `bun add disposablestack`.
- This adds it as a `dependency` (not `devDependency`) so consumers get it
  transitively.

## Step 2 - Import polyfill in entry point

- Add `import "disposablestack/auto"` as the **first import** in
  `src/index.ts`, before all other imports.
- The `/auto` entrypoint installs the polyfill only when the globals are
  missing. On runtimes with native support it is a no-op.

## Step 3 - Verify

- `bun run analyze` — confirm the new dependency is tracked and no unused deps.
- `bun run format` — ensure formatting is clean.
- `bun run check` — ensure linting passes.
- `bun run typecheck` — ensure types are sound.
- `bun run test` — ensure all tests pass (264 tests across 15 files).

## Step 4 - Create changeset

- Run `bun changeset` to create a changeset entry describing the addition
  of the polyfill for broader runtime compatibility.
