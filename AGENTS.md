# AGENTS.md

This project was built with [`pastry`](https://github.com/adelrodriguez/pastry) template.

## Quality Control

- We use `adamantite` for linting, formatting and type checking.
- Always run `bun run format` after editing files.
- After making changes, run `bun run check`, `bun run typecheck` and `bun run test` to ensure the code is still valid.
- After installing or removing dependencies, run `bun run analyze` to ensure we are not using any dependencies that are not needed.

## Changesets

- We use `changesets` for versioning and changelog management.
- Run `bun changeset --empty` to create a new empty changeset file.
- Never make a major version bump unless the user requests it.
- If a breaking change is being made, and we are on v1.0.0 or higher, alert the user.

## Version Policy

- We are currently in v0.
- Backwards compatibility is not required right now.
- Breaking changes are acceptable when they simplify or improve the API.

## TypeScript Style

- Prefer type inference whenever possible.
- Do not add explicit return types unless required by tooling, declaration emit, or a public API contract.
