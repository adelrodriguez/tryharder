export type PanicCode =
  | "ALL_CATCH_HANDLER_REJECT"
  | "ALL_CATCH_HANDLER_THROW"
  | "FLOW_NO_EXIT"
  | "GEN_INVALID_FACTORY"
  | "GEN_UNAVAILABLE"
  | "RUN_CATCH_HANDLER_REJECT"
  | "RUN_CATCH_HANDLER_THROW"
  | "RUN_SYNC_ASYNC_RETRY_POLICY"
  | "RUN_SYNC_CATCH_HANDLER_THROW"
  | "RUN_SYNC_CATCH_PROMISE"
  | "RUN_SYNC_INVALID_INPUT"
  | "RUN_SYNC_TRY_PROMISE"
  | "RUN_SYNC_UNAVAILABLE"
  | "RUN_SYNC_WRAPPED_RESULT_PROMISE"
  | "TASK_INVALID_HANDLER"
  | "TASK_SELF_REFERENCE"
  | "TASK_UNKNOWN_REFERENCE"
  | "UNREACHABLE_RETRY_POLICY_BACKOFF"
  | "WRAP_INVALID_HANDLER"
  | "WRAP_UNAVAILABLE"

export const PanicMessages = {
  ALL_CATCH_HANDLER_REJECT: "Panic: all() catch handler rejected",
  ALL_CATCH_HANDLER_THROW: "Panic: all() catch handler threw",
  FLOW_NO_EXIT: "flow() requires at least one task to call $exit().",
  GEN_INVALID_FACTORY: "gen() expects a generator factory function.",
  GEN_UNAVAILABLE:
    "gen() is unavailable after retry(), timeout(), or signal(). Start a new builder chain or use top-level gen().",
  RUN_CATCH_HANDLER_REJECT: "Panic: run() catch handler rejected",
  RUN_CATCH_HANDLER_THROW: "Panic: run() catch handler threw",
  RUN_SYNC_ASYNC_RETRY_POLICY: "This retry policy may run asynchronously. Use run() instead.",
  RUN_SYNC_CATCH_HANDLER_THROW: "Panic: runSync() catch handler threw",
  RUN_SYNC_CATCH_PROMISE: "runSync() catch cannot return a Promise. Use run() instead.",
  RUN_SYNC_INVALID_INPUT: "runSync() expects a function or { try, catch } input.",
  RUN_SYNC_TRY_PROMISE: "runSync() cannot handle Promise values. Use run() instead.",
  RUN_SYNC_UNAVAILABLE:
    "runSync() is unavailable after retry(), timeout(), or signal(). Use run() or start a new builder chain.",
  RUN_SYNC_WRAPPED_RESULT_PROMISE:
    "Wrapped runSync() execution returned a Promise. Use run() instead.",
  TASK_INVALID_HANDLER: "Task runner expected a function handler.",
  TASK_SELF_REFERENCE: "Task cannot await its own result.",
  TASK_UNKNOWN_REFERENCE: "Task attempted to read an unknown task result.",
  UNREACHABLE_RETRY_POLICY_BACKOFF: "Panic: unreachable retry policy backoff",
  WRAP_INVALID_HANDLER: "wrap() expects a function.",
  WRAP_UNAVAILABLE: "wrap() is unavailable after retry(), timeout(), or signal().",
} as const satisfies Record<PanicCode, string>
export type PanicMessages = typeof PanicMessages

export class CancellationError extends Error {
  constructor(message = "Execution was cancelled", options?: ErrorOptions) {
    super(message, options)
    this.name = "CancellationError"
  }
}

export class TimeoutError extends Error {
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

export class UnhandledException extends Error {
  constructor(message = "Unhandled exception", options?: ErrorOptions) {
    super(message, options)
    this.name = "UnhandledException"
  }
}

export class Panic extends Error {
  readonly code: PanicCode

  constructor(code: PanicCode, options: ErrorOptions & { message?: string } = {}) {
    const { message, ...errorOptions } = options

    super(message ?? PanicMessages[code], errorOptions)
    this.code = code
    this.name = "Panic"
  }
}
