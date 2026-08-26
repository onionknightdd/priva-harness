const WINDOWS_DRIVE = /^[A-Za-z]:\//
const FILE_EXTENSION = /\.[A-Za-z0-9]{1,12}$/
const URL_PREFIX = /^[a-z][a-z0-9+.-]*:/i

export function normalizeFilePath(path: string) {
  const normalized = path.replaceAll("\\", "/").replace(/\/{2,}/g, "/")

  if (
    normalized === "/" ||
    /^[A-Za-z]:\/$/.test(normalized) ||
    /^[A-Za-z]:$/.test(normalized)
  ) {
    return normalized.endsWith("/") ? normalized : `${normalized}/`
  }

  return normalized.replace(/\/$/, "")
}

export function isAbsoluteFilePath(path: string) {
  const normalized = normalizeFilePath(path.trim())
  return normalized.startsWith("/") || WINDOWS_DRIVE.test(normalized)
}

export function fileNameFromPath(path: string) {
  const normalized = normalizeFilePath(path.trim())
  if (normalized === "/" || /^[A-Za-z]:\/$/.test(normalized)) {
    return normalized
  }

  return normalized.split("/").at(-1) || normalized
}

export function parentDirectory(path: string) {
  const normalized = normalizeFilePath(path.trim())

  if (normalized === "/" || /^[A-Za-z]:\/$/.test(normalized)) {
    return null
  }

  const separatorIndex = normalized.lastIndexOf("/")
  if (separatorIndex < 0) {
    return null
  }
  if (separatorIndex === 0) {
    return "/"
  }
  if (separatorIndex === 2 && /^[A-Za-z]:/.test(normalized)) {
    return `${normalized.slice(0, 2)}/`
  }

  return normalized.slice(0, separatorIndex)
}

export function resolveAgainstCwd(path: string, cwd: string) {
  const trimmed = path.trim()
  if (trimmed === "") {
    return ""
  }

  if (isAbsoluteFilePath(trimmed)) {
    return normalizeFilePath(trimmed)
  }

  const base = cwd.trim()
  if (base === "") {
    return normalizeFilePath(trimmed)
  }

  const windows = WINDOWS_DRIVE.test(normalizeFilePath(base))
  const root = windows
    ? normalizeFilePath(base).slice(0, 3)
    : base.startsWith("/")
      ? "/"
      : ""
  const baseSegments = normalizeFilePath(base)
    .slice(root === "/" ? 1 : root.length)
    .split("/")
    .filter(Boolean)
  const relativeSegments = normalizeFilePath(trimmed).split("/").filter(Boolean)
  const segments = [...baseSegments]

  for (const segment of relativeSegments) {
    if (segment === ".") {
      continue
    }
    if (segment === "..") {
      if (segments.length > 0) {
        segments.pop()
      }
      continue
    }
    segments.push(segment)
  }

  if (root === "/") {
    return `/${segments.join("/")}`
  }
  if (windows) {
    return normalizeFilePath(`${root}${segments.join("/")}`)
  }
  return segments.join("/")
}

export function looksLikeFilePath(value: string) {
  const text = value.trim()
  if (text === "" || text.length > 256 || text.includes("\n")) {
    return false
  }
  if (URL_PREFIX.test(text) || text.includes("://")) {
    return false
  }
  if (text.includes(" ") && !text.includes("/") && !text.includes("\\")) {
    return false
  }

  const normalized = normalizeFilePath(text)
  const name = fileNameFromPath(normalized)
  const hasSeparator = normalized.includes("/")
  const isDotfile = name.startsWith(".") && name.length > 1 && !name.includes(" ")

  return hasSeparator || FILE_EXTENSION.test(name) || isDotfile
}
