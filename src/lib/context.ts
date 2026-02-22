import type { BuilderConfig, TryCtx } from "./types"

export function createContext(config: BuilderConfig): TryCtx {
  return {
    retry: {
      attempt: 1,
      limit: config.retry?.limit ?? 1,
    },
    signal: config.signal,
  }
}
