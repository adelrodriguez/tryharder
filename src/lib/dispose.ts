import { createAsyncDisposer, type AsyncDisposer } from "../shims/disposer"

/**
 * Creates an {@link AsyncDisposer}: register cleanup with `defer(fn)` or `use(resource)`, then run
 * teardown with `await d.dispose()` or by declaring the disposer with `await using`.
 */
export function disposer(): AsyncDisposer {
  return createAsyncDisposer()
}
