export const CONTEXT_WINDOWS = [200_000, 1_000_000] as const
export type ContextWindow = (typeof CONTEXT_WINDOWS)[number]
export const DEFAULT_CONTEXT_WINDOW: ContextWindow = 200_000

export function baseModelReference(reference: string): string {
  return reference.replace(/\[1m\]$/i, "")
}
