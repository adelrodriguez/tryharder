import { describe, expect, it } from "bun:test"
import type { TryCtx } from "../../types/core"
import { CancellationError, Panic, UnhandledException } from "../../errors"
import { executeRunSync, runSync } from "../run-sync"

describe("executeRunSync", () => {
  describe("function form", () => {
    it("returns success value in function form", () => {
      const result = executeRunSync({}, () => "ok" as const)

      expect(result).toBe("ok")
    })

    it("returns UnhandledException when function form throws", () => {
      const result = executeRunSync({}, () => {
        throw new Error("boom")
      })

      expect(result).toBeInstanceOf(UnhandledException)
    })

    it("throws Panic when sync runner returns a promise via unsafe cast", () => {
      const unsafeSyncFn = (() => Promise.resolve("ok")) as unknown as () => string

      try {
        executeRunSync({}, unsafeSyncFn)
        expect.unreachable("should have thrown")
      } catch (error) {
        expect(error).toBeInstanceOf(Panic)
        expect((error as Panic).code).toBe("RUN_SYNC_TRY_PROMISE")
      }
    })

    it("rethrows user-thrown Panic in function form", () => {
      const panic = new Panic("FLOW_NO_EXIT")

      try {
        executeRunSync({}, () => {
          throw panic
        })
        expect.unreachable("should have thrown")
      } catch (error) {
        expect(error).toBe(panic)
      }
    })
  })

  describe("object form", () => {
    it("maps errors in object form with try and catch", () => {
      const result = executeRunSync(
        {},
        {
          catch: () => "mapped" as const,
          try: () => {
            throw new Error("boom")
          },
        }
      )

      expect(result).toBe("mapped")
    })

    it("throws Panic when catch throws", () => {
      try {
        executeRunSync(
          {},
          {
            catch: () => {
              throw new Error("catch failed")
            },
            try: () => {
              throw new Error("boom")
            },
          }
        )
        expect.unreachable("should have thrown")
      } catch (error) {
        expect(error).toBeInstanceOf(Panic)
        expect((error as Panic).code).toBe("RUN_SYNC_CATCH_HANDLER_THROW")
      }
    })

    it("rethrows RUN_SYNC_CATCH_PROMISE unchanged when catch returns a promise", () => {
      const unsafeCatch = (() => Promise.resolve("mapped")) as unknown as (error: unknown) => string

      try {
        runSync({
          catch: unsafeCatch,
          try: () => {
            throw new Error("boom")
          },
        })
        expect.unreachable("should have thrown")
      } catch (error) {
        expect(error).toBeInstanceOf(Panic)
        expect((error as Panic).code).toBe("RUN_SYNC_CATCH_PROMISE")
      }
    })
  })

  describe("context", () => {
    it("passes normalized context to try", () => {
      const result = executeRunSync(
        {
          retry: { backoff: "constant", limit: 3 },
        },
        (ctx: TryCtx) => ({
          attempt: ctx.retry.attempt,
          hasSignal: Boolean(ctx.signal),
          limit: ctx.retry.limit,
        })
      )

      expect(result).toEqual({
        attempt: 1,
        hasSignal: false,
        limit: 3,
      })
    })
  })

  describe("cancellation", () => {
    it("returns CancellationError when signal is already aborted", () => {
      const ac = new AbortController()
      ac.abort(new Error("stop"))

      const result = executeRunSync({ signals: [ac.signal] }, () => "ok")

      expect(result).toBeInstanceOf(CancellationError)
    })

    it("prefers CancellationError over TimeoutError when both are already true", () => {
      const ac = new AbortController()
      ac.abort(new Error("stop"))

      const result = executeRunSync(
        {
          signals: [ac.signal],
          timeout: 0,
        },
        () => "ok"
      )

      expect(result).toBeInstanceOf(CancellationError)
    })

    it("returns CancellationError when any configured signal is already aborted", () => {
      const first = new AbortController()
      const second = new AbortController()
      second.abort(new Error("stop"))

      const result = executeRunSync({ signals: [first.signal, second.signal] }, () => "ok")

      expect(result).toBeInstanceOf(CancellationError)
    })
  })

  describe("wrap behavior", () => {
    it("applies wraps in registration order around full run", () => {
      const events: string[] = []
      let attempts = 0

      const result = executeRunSync(
        {
          retry: { backoff: "constant", limit: 3 },
          wraps: [
            (ctx, next) => {
              events.push(`outer:before:${ctx.retry.attempt}`)
              const value = next()
              events.push(`outer:after:${ctx.retry.attempt}`)
              return value
            },
            (ctx, next) => {
              events.push(`inner:before:${ctx.retry.attempt}`)
              const value = next()
              events.push(`inner:after:${ctx.retry.attempt}`)
              return value
            },
          ],
        },
        (ctx: TryCtx) => {
          attempts += 1
          events.push(`try:${ctx.retry.attempt}`)

          if (attempts < 3) {
            throw new Error("boom")
          }

          return "ok"
        }
      )

      expect(result).toBe("ok")
      expect(attempts).toBe(3)
      expect(events).toEqual([
        "outer:before:1",
        "inner:before:1",
        "try:1",
        "try:2",
        "try:3",
        "inner:after:3",
        "outer:after:3",
      ])
    })
  })
})

describe("runSync", () => {
  it("rethrows RUN_SYNC_CATCH_PROMISE unchanged when catch returns a promise", () => {
    const unsafeCatch = (() => Promise.resolve("mapped")) as unknown as (error: unknown) => string

    try {
      runSync({
        catch: unsafeCatch,
        try: () => {
          throw new Error("boom")
        },
      })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(Panic)
      expect((error as Panic).code).toBe("RUN_SYNC_CATCH_PROMISE")
    }
  })
})
