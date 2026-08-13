import { InternalDisposableStack } from "../shims/disposer"
import { Panic, type PanicCode } from "./errors"

export function assertUnreachable(value: never, code: PanicCode): never {
  throw new Panic(code, { message: `Unreachable case: ${String(value)}` })
}

export function invariant(condition: unknown, error: Error): asserts condition {
  if (!condition) {
    throw error
  }
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function checkIsPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  )
}

export async function resolveWithAbort<V, E>(
  signal: AbortSignal,
  promise: PromiseLike<V>,
  createAbortResult: () => E
): Promise<V | E> {
  if (signal.aborted) {
    // We return the abort result immediately, so attach a no-op handler to
    // avoid an unhandled rejection if the original promise rejects later.
    void Promise.resolve(promise).catch((error: unknown) => void error)
    return createAbortResult()
  }

  using disposer = new InternalDisposableStack()

  const abortPromise = new Promise<E>((resolve) => {
    const onAbort = () => {
      resolve(createAbortResult())
    }

    if (signal.aborted) {
      onAbort()
      return
    }

    signal.addEventListener("abort", onAbort, { once: true })
    disposer.defer(() => {
      signal.removeEventListener("abort", onAbort)
    })
  })

  return await Promise.race([Promise.resolve(promise), abortPromise])
}

export type NonPromise<T> = T extends PromiseLike<unknown> ? never : T
