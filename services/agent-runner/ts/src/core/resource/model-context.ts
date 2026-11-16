export const CONTEXT_WINDOWS = [200_000, 1_000_000] as const
export type ContextWindow = (typeof CONTEXT_WINDOWS)[number]
export const DEFAULT_CONTEXT_WINDOW: ContextWindow = 200_000
export const EXTENDED_CONTEXT_WINDOW: ContextWindow = 1_000_000

/** Capability tag a model profile stores for the extended window. */
export type ModelContextTag = '1m' | null

export function isContextWindow(value: unknown): value is ContextWindow {
  return value === DEFAULT_CONTEXT_WINDOW || value === EXTENDED_CONTEXT_WINDOW
}

export function contextWindowForTag(tag: ModelContextTag): ContextWindow {
  return tag === '1m' ? EXTENDED_CONTEXT_WINDOW : DEFAULT_CONTEXT_WINDOW
}

export function contextTagForWindow(window: ContextWindow | undefined): ModelContextTag {
  return window === EXTENDED_CONTEXT_WINDOW ? '1m' : null
}
