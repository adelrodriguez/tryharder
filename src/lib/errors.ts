import type { ErrorCode } from "./types"

export interface ExecutionErrorOptions {
  cause?: unknown
  message?: string
}

interface ExecutionErrorInit extends ExecutionErrorOptions {
  code: ErrorCode
  defaultMessage: string
  name: string
}

abstract class ExecutionError extends Error {
  readonly code: ErrorCode

  protected constructor(options: ExecutionErrorInit) {
    const { cause, code, defaultMessage, message, name } = options

    super(message ?? defaultMessage, cause === undefined ? undefined : { cause })
    this.code = code
    this.name = name
  }
}

export class CancellationError extends ExecutionError {
  constructor(options: ExecutionErrorOptions = {}) {
    const { cause, message } = options

    super({
      cause,
      code: "EXEC_CANCELLED",
      defaultMessage: "Execution was cancelled",
      message,
      name: "CancellationError",
    })
  }
}

export class TimeoutError extends ExecutionError {
  constructor(options: ExecutionErrorOptions = {}) {
    const { cause, message } = options

    super({
      cause,
      code: "EXEC_TIMEOUT",
      defaultMessage: "Execution timed out",
      message,
      name: "TimeoutError",
    })
  }
}

export class RetryExhaustedError extends ExecutionError {
  constructor(options: ExecutionErrorOptions = {}) {
    const { cause, message } = options

    super({
      cause,
      code: "EXEC_RETRY_EXHAUSTED",
      defaultMessage: "Retry attempts exhausted",
      message,
      name: "RetryExhaustedError",
    })
  }
}

export class UnhandledException extends ExecutionError {
  constructor(options: ExecutionErrorOptions = {}) {
    const { cause, message } = options

    super({
      cause,
      code: "EXEC_UNHANDLED_EXCEPTION",
      defaultMessage: "Unhandled exception",
      message,
      name: "UnhandledException",
    })
  }
}

export class Panic extends ExecutionError {
  constructor(options: ExecutionErrorOptions = {}) {
    const { cause, message } = options

    super({
      cause,
      code: "EXEC_PANIC",
      defaultMessage: "Panic: catch handler failed",
      message,
      name: "Panic",
    })
  }
}
