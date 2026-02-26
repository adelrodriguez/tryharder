import { describe, expect, it } from "bun:test"
import type { TryCtx } from "../types/core"
import { Panic, UnhandledException } from "../errors"
import { executeRunAsync, executeRunSync } from "../runner"

describe("executeRunSync / executeRunAsync", () => {
  describe("sync", () => {
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
      expect(() =>
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
      ).toThrow(Panic)
    })

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

    it("throws when sync runner returns a promise via unsafe cast", () => {
      const unsafeSyncFn = (() => Promise.resolve("ok")) as unknown as () => string

      expect(() => executeRunSync({}, unsafeSyncFn)).toThrow(
        "The try function returned a Promise. Use runAsync() instead of run()."
      )
    })
  })

  describe("async", () => {
    it("returns resolved value when function form is async", async () => {
      const result = executeRunAsync({}, async () => {
        await Promise.resolve()

        return "ok" as const
      })

      expect(await result).toBe("ok")
    })

    it("maps rejected value to UnhandledException in async function form", async () => {
      const result = executeRunAsync({}, async () => {
        await Promise.resolve()
        throw new Error("boom")
      })

      expect(await result).toBeInstanceOf(UnhandledException)
    })

    it("maps async try rejection through catch in object form", async () => {
      const result = executeRunAsync(
        {},
        {
          catch: () => "mapped",
          try: async () => {
            await Promise.resolve()
            throw new Error("boom")
          },
        }
      )

      expect(await result).toBe("mapped")
    })

    it("throws Panic when async catch rejects", async () => {
      const result = executeRunAsync(
        {},
        {
          catch: async () => {
            await Promise.resolve()
            throw new Error("catch failed")
          },
          try: async () => {
            await Promise.resolve()
            throw new Error("boom")
          },
        }
      )

      try {
        await result
        throw new Error("Expected Panic rejection")
      } catch (error) {
        expect(error).toBeInstanceOf(Panic)
      }
    })
  })
})
