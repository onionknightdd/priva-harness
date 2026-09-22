import type { StreamFrame } from "./run-stream-reducer"

export type PromptSuggestion = { scope: string; text: string; dismissed: boolean }

/** A repeated snapshot must not resurrect a hint the user already dismissed. */
export function updatePromptSuggestion(current: PromptSuggestion | null, scope: string, frame: StreamFrame): PromptSuggestion | null {
  if (frame.type === "run.started" || frame.type === "session.rebound") return null
  if (frame.type !== "suggestion.prompts" && frame.type !== "session.snapshot") return current
  const text = frame.activeRunId ? undefined : frame.prompts?.find((prompt) => typeof prompt === "string" && prompt.trim())
  if (!text) return null
  if (current?.scope === scope && current.text === text) return current
  return { scope, text, dismissed: false }
}
