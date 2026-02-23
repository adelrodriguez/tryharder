import type { TimeoutPolicy } from "./types/builder"
import { TimeoutError } from "./errors"

function createTimeoutCause(timeoutMs: number): Error {
  return new Error(`Execution exceeded timeout of ${timeoutMs}ms`)
}

export class TimeoutController {
  readonly signal?: AbortSignal
  readonly #controller?: AbortController
  readonly #startedAt = Date.now()
  readonly #timeoutMs: number
  #timeoutId: ReturnType<typeof setTimeout> | undefined

  constructor(timeoutPolicy?: TimeoutPolicy) {
    this.#timeoutMs = timeoutPolicy?.ms ?? -1

    if (!timeoutPolicy) {
      return
    }

    this.#controller = new AbortController()
    this.signal = this.#controller.signal

    if (this.#timeoutMs <= 0) {
      this.#abort()
      return
    }

    this.#timeoutId = setTimeout(() => {
      this.#abort()
    }, this.#timeoutMs)
  }

  #createTimeoutError(cause?: unknown): TimeoutError {
    return new TimeoutError({ cause: cause ?? createTimeoutCause(this.#timeoutMs) })
  }

  #abort(cause?: unknown): TimeoutError {
    const timeoutError = this.#createTimeoutError(cause)

    if (!this.signal?.aborted) {
      this.#controller?.abort(timeoutError)
    }

    return timeoutError
  }

  #getRemaining(): number {
    const elapsed = Date.now() - this.#startedAt

    return this.#timeoutMs - elapsed
  }

  checkDidTimeout(cause?: unknown): TimeoutError | undefined {
    if (!this.signal) {
      return undefined
    }

    if (this.signal.aborted) {
      const reason = this.signal.reason

      if (reason instanceof TimeoutError) {
        return reason
      }

      return this.#createTimeoutError(cause ?? reason)
    }

    const remaining = this.#getRemaining()

    if (remaining > 0) {
      return undefined
    }

    return this.#abort(cause)
  }

  async race<V>(promise: PromiseLike<V>, cause?: unknown): Promise<V | TimeoutError> {
    if (!this.signal) {
      return promise
    }

    const remaining = this.#getRemaining()

    if (remaining <= 0) {
      return this.#abort(cause)
    }

    const timedOut = this.checkDidTimeout(cause)

    if (timedOut) {
      return timedOut
    }

    const signal = this.signal
    using disposer = new DisposableStack()

    const timeoutPromise = new Promise<TimeoutError>((resolve) => {
      const onAbort = () => {
        resolve(this.checkDidTimeout(cause) ?? this.#createTimeoutError(cause))
      }

      signal.addEventListener("abort", onAbort, { once: true })
      disposer.defer(() => {
        signal.removeEventListener("abort", onAbort)
      })
    })

    return await Promise.race([Promise.resolve(promise), timeoutPromise])
  }

  [Symbol.dispose](): void {
    if (this.#timeoutId !== undefined) {
      clearTimeout(this.#timeoutId)
    }
  }
}
