const VISUAL_TOOL_NAME = /^(?:mcp__[a-z0-9_-]+__)?(static_visualize|interactive_visualize)$/

export function generatedVisualKind(name: string): "static" | "interactive" | null {
  const match = VISUAL_TOOL_NAME.exec(name.trim().toLowerCase())
  if (match?.[1] === "static_visualize") return "static"
  if (match?.[1] === "interactive_visualize") return "interactive"
  return null
}

export function isGeneratedVisualTool(name: string): boolean {
  return generatedVisualKind(name) !== null
}

export function renderUiLangFromTool(
  output: string | undefined,
  input: unknown,
  ok: boolean | undefined,
): string {
  const fromInput = unwrapOpenUiFence(langFromInput(input))
  if (ok === false) return fromInput
  const fromOutput = unwrapOpenUiFence(output ?? "")
  return fromOutput !== "" ? fromOutput : fromInput
}

function langFromInput(input: unknown): string {
  if (typeof input === "string") return input
  if (typeof input !== "object" || input === null) return ""
  const value = (input as Record<string, unknown>).lang
  return typeof value === "string" ? value : ""
}

export function unwrapOpenUiFence(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === "") return ""
  const fenced = /^```(?:openui|text)?\s*\n?([\s\S]*?)\n?```$/i.exec(trimmed)
  const inner = fenced?.[1]
  return inner === undefined ? trimmed : inner.trim()
}
