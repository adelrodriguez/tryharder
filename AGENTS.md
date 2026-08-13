Use ASD-STE100 / Simplified Technical English and Google developer documentation style guide as references for all communication.

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

<!-- PACKREF:START -->

## Packref

Packref provides local copies of dependency source code so you can inspect the exact implementation used by this project.

- Source references are stored in `.packref/packages/<registry>/<package>/<version>/` for unscoped packages and `.packref/packages/<registry>/<scope>/<package>/<version>/` for scoped packages — browse these directories to read dependency internals
- `.packref/packref-lock.json` is shared and should be committed; `.packref/packages/` is developer-local and git-ignored
- Run `packref install` after cloning when locked references are missing; install restores locked references exactly and does not install runtime dependencies
- Available commands:
  - `packref add [package]` — select manifest dependencies, fetch a registry package, or fetch a direct repository source (e.g. `packref add react`, `packref add hono@4.2.0`, `packref add metaideas/packref`)
    - Direct repository package specs support GitHub shorthand (`owner/repository[/directory][@ref]`), provider shorthand (`github:`, `gitlab:`, `bitbucket:`, or `sourcehut:`), standard Git URLs, and SCP-style SSH URLs
    - A repository ref can be a tag, branch, or full 40-character commit SHA; without a ref, Packref pins the default branch commit
  - `packref remove [package]` — select or name package references to remove
  - `packref install` — materialize every reference already recorded in the committed lockfile
  - `packref sync` — update dependency-tracked lock entries to match current `package.json` dependency versions
  - `packref list` — show all referenced packages
  - `packref prune` — remove unused entries from the global store
  - `packref clean` — remove all project-local references
  - `packref clean --global` — wipe all global store entries
- Use Packref when you need to understand how a dependency works internally — read the source in `.packref/` instead of guessing or searching the web
- Multiple versions of the same package can coexist; check `.packref/packref-lock.json` for the full list
<!-- PACKREF:END -->
