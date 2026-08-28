const MCP_CANVAS_NAME = /^mcp__[a-z0-9_-]+__canvas$/
const LABELED_PATH = /^(?:path|file|file_path)\s*[:=]\s*(.+)$/i

export function isCanvasTool(name: string): boolean {
  const id = name.trim().toLowerCase()
  if (id === "canvas") {
    return true
  }
  return MCP_CANVAS_NAME.test(id)
}

export function canvasPathFromTool(
  output: string | undefined,
  input: unknown
): string {
  const fromOutput = parseCanvasArtifactPath(output ?? "")
  if (fromOutput !== "") {
    return fromOutput
  }
  return canvasField(input, "path") || canvasField(input, "file_path")
}

export function canvasTitleFromInput(input: unknown): string {
  return canvasField(input, "title") || canvasField(input, "name")
}

export function parseCanvasArtifactPath(output: string): string {
  const trimmed = output.trim()
  if (trimmed === "") {
    return ""
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const fromJson = pathFromJson(trimmed)
    if (fromJson !== "") {
      return fromJson
    }
  }

  for (const line of trimmed.split(/\r?\n/)) {
    const labeled = LABELED_PATH.exec(line.trim())
    const labeledPath = labeled?.[1]
    if (labeledPath !== undefined) {
      const path = cleanPath(labeledPath)
      if (isHtmlArtifactPath(path)) {
        return path
      }
    }
  }

  const firstLine = cleanPath(trimmed.split(/\r?\n/)[0] ?? "")
  return isHtmlArtifactPath(firstLine) ? firstLine : ""
}

function canvasField(input: unknown, key: string): string {
  if (typeof input !== "object" || input === null) {
    return ""
  }
  const value = (input as Record<string, unknown>)[key]
  return typeof value === "string" ? value.trim() : ""
}

function pathFromJson(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === "string") {
      return isHtmlArtifactPath(parsed) ? cleanPath(parsed) : ""
    }
    if (typeof parsed !== "object" || parsed === null) {
      return ""
    }
    const record = parsed as Record<string, unknown>
    for (const key of ["path", "file", "file_path"]) {
      const value = record[key]
      if (typeof value === "string" && isHtmlArtifactPath(value)) {
        return cleanPath(value)
      }
    }
    return ""
  } catch {
    return ""
  }
}

function cleanPath(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "")
}

function isHtmlArtifactPath(value: string): boolean {
  return /\.html?$/i.test(value) && !value.includes("<") && !value.includes("\n")
}
