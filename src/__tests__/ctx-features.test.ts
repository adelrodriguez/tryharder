/* oxlint-disable typescript/no-unnecessary-type-parameters */
import { describe, it } from "bun:test"
import { retry, run, signal, timeout, wrap } from "../index"

const typecheckOnly = (): boolean => false

describe("context feature typing", () => {
  it("does not expose ctx.retry without retry()", () => {
    if (typecheckOnly()) {
      run((ctx) => {
        // @ts-expect-error retry metadata is only available after retry()
        void ctx.retry.attempt
        return 1
      })
    }
  })

  it("does not expose ctx.retry for timeout/signal/wrap alone", () => {
    if (typecheckOnly()) {
      timeout(100).run((ctx) => {
        // @ts-expect-error retry metadata is only available after retry()
        void ctx.retry.attempt
        return 1
      })

      signal(new AbortController().signal).run((ctx) => {
        // @ts-expect-error retry metadata is only available after retry()
        void ctx.retry.attempt
        return 1
      })

      wrap(() => null).run((ctx) => {
        // @ts-expect-error retry metadata is only available after retry()
        void ctx.retry.attempt
        return 1
      })
    }
  })

  it("exposes ctx.retry after retry() for run and runAsync", () => {
    retry(3).run((ctx) => ctx.retry.attempt)
    void retry(3).runAsync((ctx) => Promise.resolve(ctx.retry.limit))
  })

  it("preserves retry ctx feature across chained options", () => {
    retry(3)
      .timeout(100)
      .signal(new AbortController().signal)
      .wrap(() => null)
      .run((ctx) => ctx.retry.attempt)
  })
})
