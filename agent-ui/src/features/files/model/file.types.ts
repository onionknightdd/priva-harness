export type FilePreviewMode = "source" | "render" | "edit"

export type FileRenderKind =
  | "document"
  | "html"
  | "image"
  | "json"
  | "markdown"
  | "model"
  | "pdf"
  | "presentation"
  | "spreadsheet"
  | "whiteboard"

export type PreviewFile = {
  id: string
  name: string
  path: string
  mediaType: string
  content?: string
  error?: string
  previewError?: "too-large"
  renderKind?: FileRenderKind
  renderSource?: string
  size?: number
  revision?: string
  /** Explicit refresh also invalidates external model resources. */
  previewGeneration?: number
  status?: "loading" | "ready" | "error"
}

export function canShowFileSource(file: PreviewFile | null) {
  return typeof file?.content === "string"
}

export function canRenderFile(file: PreviewFile | null) {
  return Boolean(file?.renderKind)
}

export function canShowAgentAssist(file: PreviewFile | null) {
  return Boolean(file && /\.(pptx|docx|html|htm|xhtml|pdf)$/i.test(file.name))
}

export function canUseHtmlAssist(file: PreviewFile | null) {
  return (
    file?.renderKind === "html" &&
    /\.(html|htm|xhtml)$/i.test(file.name) &&
    typeof file.content === "string" &&
    file.status !== "loading" &&
    file.status !== "error"
  )
}

export function canUseAgentAssist(file: PreviewFile | null) {
  return canUseHtmlAssist(file) || Boolean(
    file && ["document", "presentation"].includes(file.renderKind ?? "") &&
    file.renderSource && file.status !== "loading" && file.status !== "error"
  )
}
