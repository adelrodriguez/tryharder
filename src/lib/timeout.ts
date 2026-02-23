import type { TimeoutPolicy } from "./types/builder"
import { TimeoutError } from "./errors"

export interface TimeoutController {
  signal?: AbortSignal
  checkDidTimeout(cause?: unknown): TimeoutError | undefined
  raceWithTimeout<V>(promise: PromiseLike<V>, cause?: unknown): Promise<V | TimeoutError>
  [Symbol.dispose](): void
  dispose(): void
}

function returnUndefinedTimeout(): TimeoutError | undefined {
  return undefined
}

function disposeNoop(): void {
  void 0
}

function passthroughPromise<V>(promise: PromiseLike<V>): Promise<V> {
  return Promise.resolve(promise)
}

function createTimeoutCause(timeoutMs: number): Error {
  return new Error(`Execution exceeded timeout of ${timeoutMs}ms`)
}

export function createTimeoutController(timeoutPolicy?: TimeoutPolicy): TimeoutController {
  if (!timeoutPolicy) {
    return {
      checkDidTimeout: returnUndefinedTimeout,
      dispose: disposeNoop,
      raceWithTimeout: passthroughPromise,
      [Symbol.dispose]: disposeNoop,
    }
  }

  const timeoutMs = timeoutPolicy.ms
  const startedAt = Date.now()
  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  function abortWithTimeout(cause?: unknown): TimeoutError {
    const timeoutError = new TimeoutError({ cause: cause ?? createTimeoutCause(timeoutMs) })

    if (!controller.signal.aborted) {
      controller.abort(timeoutError)
    }

    return timeoutError
  }

  if (timeoutMs <= 0) {
    abortWithTimeout()
  } else {
    timeoutId = setTimeout(() => {
      abortWithTimeout()
    }, timeoutMs)
  }

  function createTimeoutError(cause?: unknown): TimeoutError {
    return new TimeoutError({ cause: cause ?? createTimeoutCause(timeoutMs) })
  }

  function getRemainingTimeoutMs(): number {
    const elapsed = Date.now() - startedAt

    return timeoutMs - elapsed
  }

  function checkDidTimeout(cause?: unknown): TimeoutError | undefined {
    if (controller.signal.aborted) {
      const reason = controller.signal.reason

      if (reason instanceof TimeoutError) {
        return reason
      }

      return createTimeoutError(cause ?? reason)
    }

    const remaining = getRemainingTimeoutMs()

    if (remaining > 0) {
      return undefined
    }

    return abortWithTimeout(cause)
  }

  async function raceWithTimeout<V>(
    promise: PromiseLike<V>,
    cause?: unknown
  ): Promise<V | TimeoutError> {
    const remaining = getRemainingTimeoutMs()

    if (remaining <= 0) {
      return abortWithTimeout(cause)
    }

    const timedOut = checkDidTimeout(cause)

    if (timedOut) {
      return timedOut
    }

    let removeAbortListener: (() => void) | undefined

    const timeoutPromise = new Promise<TimeoutError>((resolve) => {
      const onAbort = () => {
        resolve(checkDidTimeout(cause) ?? createTimeoutError(cause))
      }

      controller.signal.addEventListener("abort", onAbort, { once: true })
      removeAbortListener = () => {
        controller.signal.removeEventListener("abort", onAbort)
      }
    })

    try {
      return await Promise.race([Promise.resolve(promise), timeoutPromise])
    } finally {
      removeAbortListener?.()
    }
  }

  function dispose(): void {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }
  }

  return {
    checkDidTimeout,
    dispose,
    raceWithTimeout,
    signal: controller.signal,
    [Symbol.dispose]: dispose,
  }
}
