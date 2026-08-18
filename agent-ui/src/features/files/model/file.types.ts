export type FilePreviewMode = "source" | "render"

export type FileRenderKind =
  | "document"
  | "html"
  | "image"
  | "json"
  | "markdown"
  | "pdf"
  | "presentation"
  | "spreadsheet"

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
