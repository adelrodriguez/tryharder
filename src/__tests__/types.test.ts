/* oxlint-disable typescript/no-unnecessary-type-parameters, typescript/require-await */
import { describe, it } from "bun:test"
import type {
  CancellationError,
  RetryExhaustedError,
  TimeoutError,
  UnhandledException,
} from "../index"
import { retry, run, runAsync, signal, timeout } from "../index"

type Expect<T extends true> = T
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false
const typecheckOnly = (): boolean => false

describe("type inference", () => {
  describe("no config", () => {
    it("run sync function returns T | UnhandledException", () => {
      const result = run(() => 42)
      type _assert = Expect<Equal<typeof result, number | UnhandledException>>
    })

    it("runAsync async function returns Promise<T | UnhandledException>", () => {
      const result = runAsync(async () => 42)
      type _assert = Expect<Equal<typeof result, Promise<number | UnhandledException>>>
    })

    it("run sync try/catch returns T | E", () => {
      const result = run({ catch: () => "err" as const, try: () => 42 })
      type _assert = Expect<Equal<typeof result, number | "err">>
    })

    it("runAsync async try with sync catch returns Promise<T | E>", () => {
      const result = runAsync({ catch: () => "err" as const, try: async () => 42 })
      type _assert = Expect<Equal<typeof result, Promise<number | "err">>>
    })

    it("ctx.retry is not available without retry config", () => {
      if (typecheckOnly()) {
        run((ctx) => {
          // @ts-expect-error retry metadata is only available after calling retry()
          void ctx.retry.attempt
          return 42
        })
      }
    })
  })

  describe("with retry", () => {
    it("constant zero-delay retry allows run and returns sync union", () => {
      const result = retry(3).run(() => 42)
      type _assert = Expect<Equal<typeof result, number | UnhandledException | RetryExhaustedError>>
    })

    it("retry runAsync returns Promise union", () => {
      const result = retry(3).runAsync(async () => 42)
      type _assert = Expect<
        Equal<typeof result, Promise<number | UnhandledException | RetryExhaustedError>>
      >
    })

    it("ctx.retry is available when retry config is present", () => {
      const result = retry(3).run((ctx) => ctx.retry.attempt)
      type _assert = Expect<Equal<typeof result, number | UnhandledException | RetryExhaustedError>>
    })

    it("linear retry requires runAsync", () => {
      if (typecheckOnly()) {
        // @ts-expect-error run is unavailable for async-required retry policies
        retry({ backoff: "linear", delayMs: 1, limit: 3 }).run(() => 42)
      }
    })

    it("constant non-zero delay retry requires runAsync", () => {
      if (typecheckOnly()) {
        // @ts-expect-error run is unavailable for async-required retry policies
        retry({ backoff: "constant", delayMs: 1, limit: 3 }).run(() => 42)
      }
    })

    it("constant zero-delay object retry still requires runAsync", () => {
      if (typecheckOnly()) {
        // @ts-expect-error only numeric retry keeps run() available
        retry({ backoff: "constant", delayMs: 0, limit: 3 }).run(() => 42)
      }
    })

    it("constant retry with jitter requires runAsync", () => {
      if (typecheckOnly()) {
        // @ts-expect-error only numeric retry keeps run() available
        retry({ backoff: "constant", delayMs: 0, jitter: true, limit: 3 }).run(() => 42)
      }
    })
  })

  describe("with timeout", () => {
    it("run sync function returns T | UnhandledException | TimeoutError", () => {
      const result = timeout(5000).run(() => 42)
      type _assert = Expect<Equal<typeof result, number | UnhandledException | TimeoutError>>
    })

    it("runAsync async function returns Promise<T | UnhandledException | TimeoutError>", () => {
      const result = timeout(5000).runAsync(async () => 42)
      type _assert = Expect<
        Equal<typeof result, Promise<number | UnhandledException | TimeoutError>>
      >
    })
  })

  describe("with signal", () => {
    it("run sync function returns T | UnhandledException | CancellationError", () => {
      const ac = new AbortController()
      const result = signal(ac.signal).run(() => 42)
      type _assert = Expect<Equal<typeof result, number | UnhandledException | CancellationError>>
    })

    it("runAsync async function returns Promise<T | UnhandledException | CancellationError>", () => {
      const ac = new AbortController()
      const result = signal(ac.signal).runAsync(async () => 42)
      type _assert = Expect<
        Equal<typeof result, Promise<number | UnhandledException | CancellationError>>
      >
    })
  })

  describe("combined configs", () => {
    it("retry + timeout constant retry still allows run sync", () => {
      const result = retry(3)
        .timeout(5000)
        .run(() => 42)
      type _assert = Expect<
        Equal<typeof result, number | UnhandledException | RetryExhaustedError | TimeoutError>
      >
    })

    it("retry + timeout async returns Promise union via runAsync", () => {
      const result = retry(3)
        .timeout(5000)
        .runAsync(async () => 42)
      type _assert = Expect<
        Equal<
          typeof result,
          Promise<number | UnhandledException | RetryExhaustedError | TimeoutError>
        >
      >
    })

    it("all three with run keeps sync union when retry is sync-safe", () => {
      const ac = new AbortController()
      const result = retry(3)
        .timeout(5000)
        .signal(ac.signal)
        .run({ catch: () => "err" as const, try: () => 42 as const })
      type _assert = Expect<
        Equal<typeof result, 42 | "err" | RetryExhaustedError | TimeoutError | CancellationError>
      >
    })

    it("all three with async catch uses runAsync and returns Promise union", () => {
      const ac = new AbortController()
      const result = retry(3)
        .timeout(5000)
        .signal(ac.signal)
        .runAsync({ catch: () => "err" as const, try: async () => 42 })
      type _assert = Expect<
        Equal<
          typeof result,
          Promise<number | "err" | RetryExhaustedError | TimeoutError | CancellationError>
        >
      >
    })
  })
})
