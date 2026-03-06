type ExecutionErrorOptions = {
  cause?: unknown
  message?: string
}

export class CancellationError extends Error {
  constructor(options: ExecutionErrorOptions = {}) {
    const { cause, message } = options

    super(message ?? "Execution was cancelled", cause === undefined ? undefined : { cause })
    this.name = "CancellationError"
  }
}

export class TimeoutError extends Error {
  constructor(options: ExecutionErrorOptions = {}) {
    const { cause, message } = options

    super(message ?? "Execution timed out", cause === undefined ? undefined : { cause })
    this.name = "TimeoutError"
  }
}

export class RetryExhaustedError extends Error {
  constructor(options: ExecutionErrorOptions = {}) {
    const { cause, message } = options

    super(message ?? "Retry attempts exhausted", cause === undefined ? undefined : { cause })
    this.name = "RetryExhaustedError"
  }
}

export class ConfigurationError extends Error {
  constructor(options: ExecutionErrorOptions = {}) {
    const { cause, message } = options

    super(message ?? "Invalid execution configuration", cause === undefined ? undefined : { cause })
    this.name = "ConfigurationError"
  }
}

export class UnhandledException extends Error {
  constructor(options: ExecutionErrorOptions = {}) {
    const { cause, message } = options

    super(message ?? "Unhandled exception", cause === undefined ? undefined : { cause })
    this.name = "UnhandledException"
  }
}

export class Panic extends Error {
  constructor(options: ExecutionErrorOptions = {}) {
    const { cause, message } = options

    super(message ?? "Panic: catch handler failed", cause === undefined ? undefined : { cause })
    this.name = "Panic"
  }
}
