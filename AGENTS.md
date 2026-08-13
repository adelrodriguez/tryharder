# AGENTS.md

`tryharder` is a small execution layer for TypeScript that makes failure and execution policy explicit in the returned type. `README.md` documents the public API.

## Documentation map

- `CONTEXT.md` — the domain glossary. Use its vocabulary in code, tests, issues, and docs.
- `docs/adr/` — recorded design decisions. Read the ones touching the area you're changing; record a new one when a decision is hard to reverse, surprising without context, and the result of a real trade-off.
- `CONTRIBUTING.md` — development workflow, code style, testing expectations, and the changesets workflow. Follow it for all changes.

## Rules for agents

- Never make a major version bump unless the user requests it. We are in v0, so breaking changes are acceptable when they simplify or improve the API — but if we are on v1.0.0 or higher, alert the user before making one.
- Public API type changes must be covered in `src/__tests__/types.test.ts`.

## Agent skills

### Issue tracker

Issues are tracked in this repo's GitHub Issues (`adelrodriguez/tryharder`), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels are used as-is: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

<!-- ADAMANTITE:START -->

## Adamantite

This project uses Adamantite for its managed formatting, linting, type checking, and dependency-analysis setup.

- Prefer the package scripts Adamantite added for this workspace.
- Run `bun run format` after editing files. Direct command: `adamantite format`.
- Run `bun run check` to catch lint and type issues. Direct command: `adamantite check`.
- Run `bun run fix` to apply safe lint fixes. Direct command: `adamantite fix`.
- Run `bun run analyze` after changing dependencies, imports, or exports. Direct command: `adamantite analyze`.
- Use `adamantite doctor` to inspect managed setup and `adamantite doctor --fix` for safe local fixes.

<!-- ADAMANTITE:END -->
