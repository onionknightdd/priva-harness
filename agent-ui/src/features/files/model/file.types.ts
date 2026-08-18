export type FilePreviewMode = "source" | "render"

export type FileRenderKind = "html" | "image" | "json" | "markdown"

export type PreviewFile = {
  id: string
  name: string
  path: string
  mediaType: string
  content?: string
  error?: string
  renderKind?: FileRenderKind
  renderSource?: string
  status?: "loading" | "ready" | "error"
}

export function canShowFileSource(file: PreviewFile | null) {
  return typeof file?.content === "string"
}

export function canRenderFile(file: PreviewFile | null) {
  return Boolean(file?.renderKind)
}
