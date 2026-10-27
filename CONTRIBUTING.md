# Contributing to tryharder

Thank you for your interest in contributing to tryharder. This document provides the development workflow and contribution expectations for the project.

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org) 24 or higher
- [pnpm](https://pnpm.io) 12 or higher
- TypeScript knowledge

### Installation

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/your-username/tryharder.git
   cd tryharder
   ```
3. Install dependencies:
   ```bash
   pnpm install
   ```

Use the pnpm version pinned in `package.json`. pnpm 12 writes two YAML documents in
`pnpm-lock.yaml`: one for the package manager and one for project dependencies.
Keep both documents. Older pnpm versions can reject this format.

## Project Structure

```text
src/
├── index.ts              # Main public entry point
├── errors.ts             # Public error exports
├── types.ts              # Public types
├── __tests__/            # Public API tests and benchmarks (*.bench.ts)
├── shims/                # Runtime shims (e.g. disposer support)
└── lib/
    ├── builder.ts        # Fluent builder implementation
    ├── dispose.ts        # Resource cleanup helpers
    ├── errors.ts         # Internal error helpers
    ├── gen.ts            # Generator composition utilities
    ├── utils.ts          # Internal utilities
    ├── execution/        # Terminal execution: run, runSync, and the shared engine
    ├── orchestration/    # Task graphs: all, allSettled, flow
    ├── policies/         # retry, timeout, signal
    └── __tests__/        # Internal-focused tests
```

## Development Workflow

### Running Tests

```bash
# Run all tests
pnpm run test

# Watch mode for development
pnpm run test:watch

# With coverage
pnpm run test:coverage

# Build, then run the bundle on the minimum supported runtime
pnpm run test:compat
```

CI runs the compatibility check on the exact `engines.node` floor (Node.js 22.0.0).

### Code Quality

```bash
# Check formatting, linting, and types
pnpm run check

# Auto-fix linting and formatting issues
pnpm run fix

# Analyze dependency usage
pnpm run analyze
```

Run `pnpm run fix` after editing files. Before submitting a PR, run:

```bash
pnpm run check
pnpm run test
pnpm run build:verify
```

Run `pnpm run analyze` after installing or removing dependencies.

### Building

```bash
# Build the package
pnpm run build

# Watch mode
pnpm run dev
```

### Benchmarks

```bash
# Print a comparison table for each benchmark group
pnpm run bench

# Also write bench-results/vitest.json, latest.json, and summary.md
pnpm run bench:ci
```

Benchmarks track relative performance trends. They are not a required PR gate, because microbenchmarks are noisy. The `benchmarks` workflow runs `bench:ci` every Monday and publishes the summary.

Each public API has a `*.bench.ts` file next to its tests in `src/__tests__/`. Each `test()` in that file is one benchmark group. It uses the `bench` fixture and `bench.compare()`, so Vitest interleaves the cases in a group and prints one table for the group. Give every `bench()` a unique name across the suite.

Follow these rules when you write a benchmark:

- Import from the typed `src` entrypoint, so `check` does not depend on a prior `build`. Vite's module runner adds a small getter overhead to each import. The overhead is constant across runs, so trends stay valid.
- Keep cases deterministic and timer-free. Do not use `sleep`, real timeout expiry, or cancellation races.
- Set up task graphs and builders outside the measured function.
- Pass each result to `consume()` from `test-utils.ts`, so the runtime cannot optimize the work away.
- When you change cases or tooling so that old results are no longer comparable, increment `BENCHMARK_SUITE_VERSION` in `scripts/bench-report.ts`.

Read the results like this:

- Treat the suite as an overhead tracker, not as an end-to-end latency test. Compare like-for-like cases over time. The most useful regressions are usually `run/function/sync-success`, `runSync/function/success`, `run/object/mapped-error`, `all/two-independent-sync-tasks`, `allSettled/two-successful-tasks`, and `flow/immediate-exit`.
- Prefer absolute changes in ns/iter. A +200 ns regression on a hot path means more than a percentage without context.
- Use the direct baselines for scale only. Vitest times each iteration, which adds tens of nanoseconds. Cases under about 1 µs read higher than their real cost.
- Read policy cases (`builder/sync`, `builder/async`) as the incremental cost of a policy that does not fire. The async cases are the ones to watch when you change `resolveWithAbort()`.
- Read orchestration cases (`all`, `allSettled`, `flow`) as fixed framework cost for very small graphs. They are expected to be much slower than `Promise.all`. Compare the `-with-signal`, `-with-disposer`, and dependency cases with the plain cases to see where the setup cost goes.
- Only compare runs that use the same Node.js version (see `.node-version`), machine class, and suite version.

## Making Changes

### Branch Naming

- `feat/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation changes
- `refactor/description` - Refactors and internal cleanup

### Commit Messages

Write clear, concise commit messages that describe what changed and why:

```text
feat: add signal support to flow execution

Allows flow tasks to observe external cancellation consistently.
```

### Code Style

- Use the vocabulary defined in [GLOSSARY.md](GLOSSARY.md) when naming things in code, tests, issues, and docs; design decisions are recorded in [docs/adr/](docs/adr/) — read the ones touching the area you're changing
- Follow the existing TypeScript style in the repository
- Prefer type inference when it already produces the correct type
- Avoid explicit return types unless required for tooling or public API contracts
- Keep implementation straightforward and local; prefer obvious duplication over premature abstraction while behavior is still evolving
- Use meaningful names and keep public APIs well documented through readable code and tests
- Avoid `any` unless there is a strong justification

### Testing

- Add tests for new behavior
- Update tests when modifying existing behavior
- Ensure all tests pass before submitting
- Public API type changes must be covered in `src/__tests__/types.test-d.ts`
- Type assertions are checked by `pnpm run check`, not Vitest
- Write type assertions with `expectTypeOf` from `vitest`
- Test files live in `src/__tests__/` and `src/lib/__tests__/`. Tests for repository scripts live in `scripts/__tests__/`.
- Use `fast-check` for invariants that must hold across many inputs. Keep fixed examples for named cases and exact contracts.
- To replay a property failure, pass the reported `seed` and `path` to `fc.assert`.
- After you fix a property failure, add the minimized counterexample as a fixed regression test beside the property.

## Changesets Workflow

This project uses [Changesets](https://github.com/changesets/changesets) for version management and changelog generation.

### When to Add a Changeset

Add a changeset for user-facing changes:

- New features
- Bug fixes
- Breaking changes
- Deprecations

Skip changesets for:

- Documentation updates
- Internal refactors without behavior changes
- Test-only updates

### Creating a Changeset

```bash
pnpm exec changeset
```

Follow the prompts to:

1. Select the type of change
2. Write a summary of the change

The generated file in `.changeset/` should be committed with your PR.

#### Change Types

- **Major** - Breaking changes
- **Minor** - New features
- **Patch** - Bug fixes

This project is currently in `v0`, so breaking changes are acceptable when they simplify or improve the API. Do not create a major version bump unless it is explicitly intended.

## Submitting a Pull Request

### Before Submitting

Ensure your PR meets these requirements:

- [ ] Code follows the project's style guidelines
- [ ] Formatting, linting, and checks pass (`pnpm run check`)
- [ ] Tests pass (`pnpm run test`)
- [ ] Build verification succeeds (`pnpm run build:verify`)
- [ ] Changeset added, if applicable
- [ ] Documentation updated, if needed

### PR Process

1. Push your changes to your fork
2. Create a pull request against the `main` branch
3. Include:
   - A short description of the change
   - The motivation or problem being solved
   - Any breaking changes or migration notes
   - Related issues, if any
4. Wait for CI checks to pass
5. Address review feedback

### CI Checks

Pull requests should pass:

- **Format/Check** - Linting and formatting validation
- **Typecheck** - TypeScript validation
- **Test** - Automated test suite
- **Build** - Package build verification

## Getting Help

- Open an [issue](https://github.com/adelrodriguez/tryharder/issues) for bug reports or feature requests
- Check existing issues before creating a new one
- Include enough context and a minimal reproduction when possible

## Code of Conduct

Be respectful, constructive, and precise in review and discussion.

## License

By contributing to tryharder, you agree that your contributions will be licensed under the MIT License.
