export type FilePreviewMode = "source" | "render"

export type FileRenderKind = "image" | "json" | "markdown"

export type PreviewFile = {
  id: string
  name: string
  path: string
  mediaType: string
  content?: string
  renderKind?: FileRenderKind
  renderSource?: string
}

export function canShowFileSource(file: PreviewFile | null) {
  return typeof file?.content === "string"
}

export function canRenderFile(file: PreviewFile | null) {
  return Boolean(file?.renderKind)
}
