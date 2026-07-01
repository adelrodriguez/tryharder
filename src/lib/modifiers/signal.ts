import { defineDisposeAlias } from "../../shims/disposer"
import { CancellationError, TimeoutError } from "../errors"
import { resolveWithAbort } from "../utils"

export class SignalController {
  readonly signal?: AbortSignal
  declare [Symbol.dispose]: () => void

  constructor(signals: readonly AbortSignal[] = []) {
    if (signals.length > 0) {
      this.signal = AbortSignal.any([...signals])
    }
  }

  checkDidCancel(cause?: unknown): CancellationError | undefined {
    if (!this.signal?.aborted) {
      return
    }

    if (this.signal.reason instanceof TimeoutError) {
      return
    }

    return new CancellationError(undefined, { cause: cause ?? this.signal.reason })
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
