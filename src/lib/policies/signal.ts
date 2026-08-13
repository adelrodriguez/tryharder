import { defineDisposeAlias } from "../../shims/disposer"
import { CancellationError, TimeoutError } from "../errors"
import { resolveWithAbort } from "../utils"

export class SignalController {
  readonly signal?: AbortSignal
  /**
   * Cancellation detection reads only the external signals, never the composed execution signal:
   * `AbortSignal.any` latches the first abort reason, so a timeout firing first would otherwise
   * hide a later external cancellation from `checkDidCancel` for as long as execution keeps
   * running.
   */
  readonly #cancelSignal?: AbortSignal
  declare [Symbol.dispose]: () => void

  constructor(signals: readonly AbortSignal[] = [], timeoutSignal?: AbortSignal) {
    if (signals.length > 0) {
      this.#cancelSignal = AbortSignal.any([...signals])
    }

    const composedSignals = [this.#cancelSignal, timeoutSignal].filter(
      (value): value is AbortSignal => value !== undefined
    )

    if (composedSignals.length > 0) {
      this.signal = AbortSignal.any(composedSignals)
    }
  }

  checkDidCancel(cause?: unknown): CancellationError | undefined {
    if (!this.#cancelSignal?.aborted) {
      return
    }

    if (this.#cancelSignal.reason instanceof TimeoutError) {
      return
    }

    return new CancellationError(undefined, { cause: cause ?? this.#cancelSignal.reason })
  }

  race<V>(promise: PromiseLike<V>, cause?: unknown): PromiseLike<V | CancellationError> {
    const cancelled = this.checkDidCancel(cause)

    if (cancelled) {
      return Promise.resolve(cancelled)
    }

    if (!this.signal) {
      return promise
    }

    return resolveWithAbort(
      this.signal,
      promise,
      () => new CancellationError(undefined, { cause: cause ?? this.signal?.reason })
    )
  }

  dispose(): void {
    // Intentionally a no-op: AbortSignal.any() does not create resources that
    // need explicit teardown, so nothing needs to be released here. The method
    // exists to satisfy the Disposable interface shared with TimeoutController.
    void this.signal
  }
}
defineDisposeAlias(SignalController.prototype)
