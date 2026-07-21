import { defineDisposeAlias } from "../../shims/disposer"
import { Panic, TimeoutError } from "../errors"
import { invariant, resolveWithAbort } from "../utils"

/**
 * Single source of truth for timeout validation: used eagerly by the builder at `.timeout()` call
 * time and defensively by {@link TimeoutController}.
 */
export function assertValidTimeout(ms: number): void {
  invariant(Number.isFinite(ms), new Panic("TIMEOUT_INVALID_MS"))
  invariant(ms >= 0, new Panic("TIMEOUT_INVALID_MS"))
}

export class TimeoutController {
  readonly signal?: AbortSignal
  readonly #controller?: AbortController
  readonly #startedAt = Date.now()
  readonly #timeoutMs: number
  #timeoutId: ReturnType<typeof setTimeout> | undefined
  declare [Symbol.dispose]: () => void

  constructor(timeoutMs?: number) {
    this.#timeoutMs = timeoutMs ?? -1

    if (timeoutMs === undefined) {
      return
    }

    assertValidTimeout(timeoutMs)

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

  #abort(cause?: unknown) {
    const timeoutError = new TimeoutError(`Execution exceeded timeout of ${this.#timeoutMs}ms`, {
      cause,
    })

    if (!this.signal?.aborted) {
      this.#controller?.abort(timeoutError)
    }

    return timeoutError
  }

  get #remaining() {
    const elapsed = Date.now() - this.#startedAt

    return this.#timeoutMs - elapsed
  }

  checkDidTimeout(cause?: unknown): TimeoutError | undefined {
    if (!this.signal) {
      return
    }

    if (this.signal.aborted) {
      const reason = this.signal.reason

      if (reason instanceof TimeoutError) {
        return reason
      }

      return new TimeoutError(`Execution exceeded timeout of ${this.#timeoutMs}ms`, {
        cause: cause ?? reason,
      })
    }

    if (this.#remaining > 0) {
      return
    }

    return this.#abort(cause)
  }

  race<V>(promise: PromiseLike<V>, cause?: unknown): PromiseLike<V | TimeoutError> {
    if (!this.signal) {
      return promise
    }

    if (this.#remaining <= 0) {
      return Promise.resolve(this.#abort(cause))
    }

    const timedOut = this.checkDidTimeout(cause)

    if (timedOut) {
      return Promise.resolve(timedOut)
    }

    return resolveWithAbort(
      this.signal,
      promise,
      () =>
        this.checkDidTimeout(cause) ??
        new TimeoutError(`Execution exceeded timeout of ${this.#timeoutMs}ms`, { cause })
    )
  }

  dispose(): void {
    if (this.#timeoutId !== undefined) {
      clearTimeout(this.#timeoutId)
    }
  }
}
defineDisposeAlias(TimeoutController.prototype)
