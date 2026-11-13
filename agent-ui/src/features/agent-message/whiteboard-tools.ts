import { isAbsoluteFilePath, normalizeFilePath, resolveAgainstCwd } from "@/lib/file-path"

export function whiteboardToolKind(name: string): "read" | "write" | null {
  const match = /^(?:mcp__[a-z0-9_-]+__)?whiteboard_(read|write)$/.exec(name.trim().toLowerCase())
  return match ? match[1] as "read" | "write" : null
}

function validSessionId(sessionId: string | null | undefined): sessionId is string {
  return typeof sessionId === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(sessionId)
}

function boardPath(value: unknown): string {
  if (typeof value !== "string" || !/\.board\.json$/.test(value.trim()) || /[<>\\]/.test(value) || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return ""
  return normalizeFilePath(value.trim())
}

/** Tool inputs are scoped to one session; the server remains the filesystem authority. */
export function resolveWhiteboardPath(value: unknown, cwd: string, sessionId: string | null | undefined): string {
  if (!validSessionId(sessionId) || !isAbsoluteFilePath(cwd)) return ""
  const path = boardPath(value)
  if (!path || path.split("/").includes("..")) return ""
  const root = resolveAgainstCwd(`.whiteboard/${sessionId}`, cwd)
  const relative = path.replace(/^(?:\.\/)+/, "")
  if (relative === ".canvas" || relative.startsWith(".canvas/")) return ""
  const resolved = isAbsoluteFilePath(path)
    ? path.split("/").filter(segment => segment !== ".").join("/")
    : resolveAgainstCwd(relative, relative.startsWith(".whiteboard/") ? cwd : root)
  return resolved.startsWith(`${root}/`) ? resolved : ""
}

export function whiteboardPathFromTool(output: string | undefined, input: unknown, cwd: string, sessionId: string | null | undefined): string {
  if (!validSessionId(sessionId)) return ""
  let result: unknown
  try { result = JSON.parse(output ?? "") } catch { /* A running tool has no JSON result yet. */ }
  if (typeof result === "object" && result !== null && "path" in result) {
    const path = boardPath(result.path)
    // A canonical result may use the workspace's realpath alias (/private/tmp
    // instead of /tmp). Its session directory must still match this event.
    const marker = `/.whiteboard/${sessionId}/`
    return path && isAbsoluteFilePath(path) && path.includes(marker) &&
      !path.split("/").some(segment => segment === "." || segment === "..") ? path : ""
  }
  const path = typeof input === "object" && input !== null && "path" in input ? input.path : undefined
  return resolveWhiteboardPath(path, cwd, sessionId)
}
