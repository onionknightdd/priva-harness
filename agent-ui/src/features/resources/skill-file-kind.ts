export function skillFileKind(path: string): "markdown" | "image" | "pdf" | "text" | "binary" {
  const extension = path.split(".").at(-1)?.toLowerCase()
  if (extension && ["md", "markdown", "mdown", "mkd"].includes(extension)) return "markdown"
  if (extension && ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "svg", "apng"].includes(extension)) return "image"
  if (extension === "pdf") return "pdf"
  if (extension && ["zip", "skill", "tar", "gz", "tgz", "7z", "rar", "exe", "dll", "so", "dylib", "wasm", "woff", "woff2", "ttf", "otf", "mp3", "mp4", "wav", "mov", "webm", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "sqlite", "db", "pyc"].includes(extension)) return "binary"
  return "text"
}
