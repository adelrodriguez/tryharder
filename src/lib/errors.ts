export type PanicCode =
  | "ALL_CATCH_HANDLER_REJECT"
  | "ALL_CATCH_HANDLER_THROW"
  | "FLOW_NO_EXIT"
  | "ORCHESTRATION_UNSUPPORTED_POLICY"
  | "RETRY_INVALID_LIMIT"
  | "RUN_CATCH_HANDLER_REJECT"
  | "RUN_CATCH_HANDLER_THROW"
  | "RUN_SYNC_ASYNC_RETRY_POLICY"
  | "RUN_SYNC_CATCH_HANDLER_THROW"
  | "RUN_SYNC_CATCH_PROMISE"
  | "RUN_SYNC_TRY_PROMISE"
  | "RUN_SYNC_WRAPPED_RESULT_PROMISE"
  | "TASK_INVALID_HANDLER"
  | "TASK_SELF_REFERENCE"
  | "TIMEOUT_INVALID_MS"
  | "TASK_UNKNOWN_REFERENCE"
  | "UNREACHABLE_RETRY_POLICY_BACKOFF"

export const PanicMessages = {
  ALL_CATCH_HANDLER_REJECT: "Panic: all() catch handler rejected",
  ALL_CATCH_HANDLER_THROW: "Panic: all() catch handler threw",
  FLOW_NO_EXIT: "flow() requires at least one task to call $exit().",
  ORCHESTRATION_UNSUPPORTED_POLICY: "Orchestration does not support retry() policies.",
  RETRY_INVALID_LIMIT: "retry() requires a positive integer retry limit.",
  RUN_CATCH_HANDLER_REJECT: "Panic: run() catch handler rejected",
  RUN_CATCH_HANDLER_THROW: "Panic: run() catch handler threw",
  RUN_SYNC_ASYNC_RETRY_POLICY: "This retry policy may run asynchronously. Use run() instead.",
  RUN_SYNC_CATCH_HANDLER_THROW: "Panic: runSync() catch handler threw",
  RUN_SYNC_CATCH_PROMISE: "runSync() catch cannot return a Promise. Use run() instead.",
  RUN_SYNC_TRY_PROMISE: "runSync() cannot handle Promise values. Use run() instead.",
  RUN_SYNC_WRAPPED_RESULT_PROMISE:
    "Wrapped runSync() execution returned a Promise. Use run() instead.",
  TASK_INVALID_HANDLER: "Task runner expected a function handler.",
  TASK_SELF_REFERENCE: "Task cannot await its own result.",
  TASK_UNKNOWN_REFERENCE: "Task attempted to read an unknown task result.",
  TIMEOUT_INVALID_MS: "timeout() requires a non-negative finite millisecond value.",
  UNREACHABLE_RETRY_POLICY_BACKOFF: "Panic: unreachable retry policy backoff",
} as const satisfies Record<PanicCode, string>

/**
 * @internal
 */
export class ControlError extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "ControlError"
  }
}

export class CancellationError extends ControlError {
  constructor(message = "Execution was cancelled", options?: ErrorOptions) {
    super(message, options)
    this.name = "CancellationError"
  }
}

export class TimeoutError extends ControlError {
  constructor(message = "Execution timed out", options?: ErrorOptions) {
    super(message, options)
    this.name = "TimeoutError"
  }
}

export class RetryExhaustedError extends Error {
  constructor(message = "Retry attempts exhausted", options?: ErrorOptions) {
    super(message, options)
    this.name = "RetryExhaustedError"
  }
}

// oxlint-disable-next-line unicorn/custom-error-definition -- Public error name is intentional.
export class UnhandledException extends Error {
  constructor(message = "Unhandled exception", options?: ErrorOptions) {
    super(message, options)
    this.name = "UnhandledException"
  }
}

// oxlint-disable-next-line unicorn/custom-error-definition -- Public error name is intentional.
export class Panic extends Error {
  readonly code: PanicCode

  constructor(code: PanicCode, options: ErrorOptions & { message?: string } = {}) {
    const { message, ...errorOptions } = options

    super(message ?? PanicMessages[code], errorOptions)
    this.code = code
    this.name = "Panic"
  }
}

// Type guards below match by `error.name` in addition to instanceof, so they
// keep working when two copies of tryharder end up in one dependency graph
// (or across realms), where instanceof silently fails. They are the
// recommended way to identify tryharder errors.
//
// Caveat: name matching means a foreign Error that happens to use the same
// `name` also passes. Within the unions returned by tryharder APIs this cannot
// occur.

export function isCancellationError(error: unknown): error is CancellationError {
  return (
    error instanceof CancellationError ||
    (Error.isError(error) && error.name === "CancellationError")
  )
}

export function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError || (Error.isError(error) && error.name === "TimeoutError")
}

export function isRetryExhaustedError(error: unknown): error is RetryExhaustedError {
  return (
    error instanceof RetryExhaustedError ||
    (Error.isError(error) && error.name === "RetryExhaustedError")
  )
}

export function isUnhandledException(error: unknown): error is UnhandledException {
  return (
    error instanceof UnhandledException ||
    (Error.isError(error) && error.name === "UnhandledException")
  )
}

export function isPanic(error: unknown): error is Panic {
  return (
    error instanceof Panic ||
    (Error.isError(error) &&
      error.name === "Panic" &&
      "code" in error &&
      typeof error.code === "string")
  )
}
