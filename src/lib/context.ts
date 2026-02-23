import type { BuilderConfig } from "./types/builder"
import type { TryCtx } from "./types/core"

export function createContext(config: BuilderConfig, signal = config.signal): TryCtx {
  return {
    retry: {
      attempt: 1,
      limit: config.retry?.limit ?? 1,
    },
    signal,
  }
}
