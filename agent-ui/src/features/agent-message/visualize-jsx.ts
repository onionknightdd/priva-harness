export function visualizeJsxFromTool(output: string | undefined, input: unknown): string {
  const fromOutput = unwrapJsxFence(output ?? "")
  if (fromOutput !== "") {
    return fromOutput
  }
  return unwrapJsxFence(jsxFromInput(input))
}

export function jsxFromInput(input: unknown): string {
  if (typeof input === "string") {
    return input
  }
  if (typeof input !== "object" || input === null) {
    return ""
  }
  const value = (input as Record<string, unknown>).jsx
  return typeof value === "string" ? value : ""
}

export function unwrapJsxFence(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === "") {
    return ""
  }
  const fenced = /^```(?:jsx|tsx|javascript|js)?\s*\n?([\s\S]*?)\n?```$/i.exec(
    trimmed
  )
  const inner = fenced?.[1]
  return inner === undefined ? trimmed : inner.trim()
}

export function isVisualizeTool(name: string): boolean {
  const id = name.trim().toLowerCase()
  if (id === "visualize") {
    return true
  }
  return /^mcp__[a-z0-9_-]+__visualize$/.test(id)
}
