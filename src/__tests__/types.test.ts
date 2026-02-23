/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters, @typescript-eslint/require-await */
import { describe, it } from "bun:test"
import type {
  CancellationError,
  RetryExhaustedError,
  TimeoutError,
  UnhandledException,
} from "../index"
import { retry, run, signal, timeout } from "../index"

/**
 * Compile-time type equality check. Both sides must match exactly or
 * `bun run typecheck` will report an error.
 */
type Expect<T extends true> = T
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false

// ---------------------------------------------------------------------------
// No config
// ---------------------------------------------------------------------------

describe("type inference", () => {
  describe("no config", () => {
    it("sync function returns T | UnhandledException", () => {
      const result = run(() => 42)
      type _assert = Expect<Equal<typeof result, number | UnhandledException>>
    })

    it("async function returns Promise<T | UnhandledException>", () => {
      const result = run(async () => 42)
      type _assert = Expect<Equal<typeof result, Promise<number | UnhandledException>>>
    })

    it("sync try/catch returns T | E", () => {
      const result = run({ catch: () => "err" as const, try: () => 42 })
      type _assert = Expect<Equal<typeof result, number | "err">>
    })

    it("async try with sync catch returns Promise<T | E>", () => {
      const result = run({ catch: () => "err" as const, try: async () => 42 })
      type _assert = Expect<Equal<typeof result, Promise<number | "err">>>
    })
  })

  // ---------------------------------------------------------------------------
  // With retry
  // ---------------------------------------------------------------------------

  describe("with retry", () => {
    it("sync function returns Promise<T | UnhandledException | RetryExhaustedError>", () => {
      const result = retry(3).run(() => 42)
      type _assert = Expect<
        Equal<typeof result, Promise<number | UnhandledException | RetryExhaustedError>>
      >
    })

    it("async function returns Promise<T | UnhandledException | RetryExhaustedError>", () => {
      const result = retry(3).run(async () => 42)
      type _assert = Expect<
        Equal<typeof result, Promise<number | UnhandledException | RetryExhaustedError>>
      >
    })

    it("sync try/catch returns Promise<T | E | RetryExhaustedError>", () => {
      const result = retry(3).run({ catch: () => "err" as const, try: () => 42 })
      type _assert = Expect<Equal<typeof result, Promise<number | "err" | RetryExhaustedError>>>
    })

    it("async try/catch returns Promise<T | E | RetryExhaustedError>", () => {
      const result = retry(3).run({ catch: () => "err" as const, try: async () => 42 })
      type _assert = Expect<Equal<typeof result, Promise<number | "err" | RetryExhaustedError>>>
    })
  })

  // ---------------------------------------------------------------------------
  // With timeout
  // ---------------------------------------------------------------------------

  describe("with timeout", () => {
    it("sync function returns T | UnhandledException | TimeoutError", () => {
      const result = timeout(5000).run(() => 42)
      type _assert = Expect<Equal<typeof result, number | UnhandledException | TimeoutError>>
    })

    it("async function returns Promise<T | UnhandledException | TimeoutError>", () => {
      const result = timeout(5000).run(async () => 42)
      type _assert = Expect<
        Equal<typeof result, Promise<number | UnhandledException | TimeoutError>>
      >
    })

    it("sync try/catch returns T | E | TimeoutError", () => {
      const result = timeout(5000).run({ catch: () => "err" as const, try: () => 42 })
      type _assert = Expect<Equal<typeof result, number | "err" | TimeoutError>>
    })
  })

  // ---------------------------------------------------------------------------
  // With signal
  // ---------------------------------------------------------------------------

  describe("with signal", () => {
    it("sync function returns T | UnhandledException | CancellationError", () => {
      const ac = new AbortController()
      const result = signal(ac.signal).run(() => 42)
      type _assert = Expect<Equal<typeof result, number | UnhandledException | CancellationError>>
    })

    it("async function returns Promise<T | UnhandledException | CancellationError>", () => {
      const ac = new AbortController()
      const result = signal(ac.signal).run(async () => 42)
      type _assert = Expect<
        Equal<typeof result, Promise<number | UnhandledException | CancellationError>>
      >
    })

    it("sync try/catch returns T | E | CancellationError", () => {
      const ac = new AbortController()
      const result = signal(ac.signal).run({ catch: () => "err" as const, try: () => 42 })
      type _assert = Expect<Equal<typeof result, number | "err" | CancellationError>>
    })
  })

  // ---------------------------------------------------------------------------
  // Combined configs
  // ---------------------------------------------------------------------------

  describe("combined configs", () => {
    it("retry + timeout returns Promise<T | UnhandledException | RetryExhaustedError | TimeoutError>", () => {
      const result = retry(3)
        .timeout(5000)
        .run(() => 42)
      type _assert = Expect<
        Equal<
          typeof result,
          Promise<number | UnhandledException | RetryExhaustedError | TimeoutError>
        >
      >
    })

    it("retry + timeout does NOT include CancellationError", () => {
      const result = retry(3)
        .timeout(5000)
        .run(() => 42)
      type _assert = Expect<
        Equal<
          Equal<
            typeof result,
            Promise<
              number | UnhandledException | RetryExhaustedError | TimeoutError | CancellationError
            >
          >,
          false
        >
      >
    })

    it("retry + timeout async returns Promise<T | UnhandledException | RetryExhaustedError | TimeoutError>", () => {
      const result = retry(3)
        .timeout(5000)
        .run(async () => 42)
      type _assert = Expect<
        Equal<
          typeof result,
          Promise<number | UnhandledException | RetryExhaustedError | TimeoutError>
        >
      >
    })

    it("all three returns Promise<T | UnhandledException | RetryExhaustedError | TimeoutError | CancellationError>", () => {
      const ac = new AbortController()
      const result = retry(3)
        .timeout(5000)
        .signal(ac.signal)
        .run(() => 42)
      type _assert = Expect<
        Equal<
          typeof result,
          Promise<
            number | UnhandledException | RetryExhaustedError | TimeoutError | CancellationError
          >
        >
      >
    })

    it("all three with catch returns Promise<T | E | RetryExhaustedError | TimeoutError | CancellationError>", () => {
      const ac = new AbortController()
      const result = retry(3)
        .timeout(5000)
        .signal(ac.signal)
        .run({ catch: () => "err" as const, try: () => 42 })
      type _assert = Expect<
        Equal<
          typeof result,
          Promise<number | "err" | RetryExhaustedError | TimeoutError | CancellationError>
        >
      >
    })

    it("all three with async catch returns Promise<T | E | RetryExhaustedError | TimeoutError | CancellationError>", () => {
      const ac = new AbortController()
      const result = retry(3)
        .timeout(5000)
        .signal(ac.signal)
        .run({ catch: () => "err" as const, try: async () => 42 })
      type _assert = Expect<
        Equal<
          typeof result,
          Promise<number | "err" | RetryExhaustedError | TimeoutError | CancellationError>
        >
      >
    })
  })
})
