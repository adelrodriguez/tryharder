# Contributing to hardtry

Thank you for your interest in contributing to hardtry. This document provides the development workflow and contribution expectations for the project.

## Development Setup

### Prerequisites

- [Bun](https://bun.sh) 1.3.1 or higher
- TypeScript knowledge

### Installation

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/your-username/hardtry.git
   cd hardtry
   ```
3. Install dependencies:
   ```bash
   bun install
   ```

## Project Structure

```text
src/
├── index.ts              # Main public entry point
├── errors.ts             # Public error exports
├── types.ts              # Public types
├── __tests__/            # Public API and integration-style tests
└── lib/
    ├── builder.ts        # Fluent builder implementation
    ├── dispose.ts        # Resource cleanup helpers
    ├── errors.ts         # Internal error helpers
    ├── gen.ts            # Generator composition utilities
    ├── utils.ts          # Internal utilities
    ├── executors/        # run, runSync, all, allSettled, flow
    ├── modifiers/        # retry, timeout, signal
    └── __tests__/        # Internal-focused tests
```

## Development Workflow

### Running Tests

```bash
# Run all tests
bun run test

# Watch mode for development
bun run test:watch

# With coverage
bun run test:coverage
```

### Code Quality

```bash
# Format the codebase
bun run format

# Check linting and formatting
bun run check

# Auto-fix linting and formatting issues
bun run fix

# Type checking
bun run typecheck

# Analyze dependency usage
bun run analyze
```

Run `bun run format` after editing files. Before submitting a PR, run:

```bash
bun run check
bun run typecheck
bun run test
bun run build
```

Run `bun run analyze` after installing or removing dependencies.

### Building

```bash
# Build the package
bun run build

# Watch mode
bun run dev
```

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
- Public API type changes must be covered in `src/__tests__/types.test.ts`
- Test files live in `src/__tests__/` and `src/lib/__tests__/`

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
bunx changeset
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
- [ ] Code is formatted (`bun run format`)
- [ ] Linting and checks pass (`bun run check`)
- [ ] Type checking passes (`bun run typecheck`)
- [ ] Tests pass (`bun run test`)
- [ ] Build succeeds (`bun run build`)
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

- Open an [issue](https://github.com/adelrodriguez/hardtry/issues) for bug reports or feature requests
- Check existing issues before creating a new one
- Include enough context and a minimal reproduction when possible

## Code of Conduct

Be respectful, constructive, and precise in review and discussion.

## License

By contributing to hardtry, you agree that your contributions will be licensed under the MIT License.
