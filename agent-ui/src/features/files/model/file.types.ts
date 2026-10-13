export type FilePreviewMode = "source" | "render" | "edit"

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
  previewError?: "too-large"
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

export function canShowAgentAssist(file: PreviewFile | null) {
  return Boolean(file && /\.(pptx|docx|html|htm|xhtml|pdf)$/i.test(file.name))
}

export function canEditHtmlFile(file: PreviewFile | null) {
  return (
    file?.renderKind === "html" &&
    /\.(html|htm|xhtml)$/i.test(file.name) &&
    typeof file.content === "string" &&
    file.status !== "loading" &&
    file.status !== "error"
  )
}
