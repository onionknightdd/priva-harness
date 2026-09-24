import type { MessageAttachment } from "./message-attachment"

export type ComposerAttachment = {
  id: string
  file: File
  previewUrl: string | null
  status: "uploading" | "done" | "error"
  progress: number
  uploaded?: MessageAttachment
  error?: string
}

export function isImageAttachment(file: File) {
  return file.type.startsWith("image/")
}

export function createComposerAttachments(
  files: Iterable<File>
): ComposerAttachment[] {
  return Array.from(files, (file) => ({
    id: createAttachmentId(),
    file,
    previewUrl: createPreviewUrl(file),
    status: "uploading",
    progress: 0,
  }))
}

const VISION_IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp)$/i

export function partitionComposerUploads(
  files: readonly MessageAttachment[],
  acceptsImages: boolean,
): { files: MessageAttachment[]; imagePaths: string[] } {
  if (!acceptsImages) return { files: [...files], imagePaths: [] }
  const imagePaths: string[] = []
  const rest: MessageAttachment[] = []
  for (const file of files) {
    if (file.mimeType.startsWith("image/") && VISION_IMAGE_EXTENSION.test(file.path)) imagePaths.push(file.path)
    else rest.push(file)
  }
  return { files: rest, imagePaths }
}

export function readyComposerAttachments(attachments: readonly ComposerAttachment[]): MessageAttachment[] | null {
  if (attachments.some((attachment) => attachment.status !== "done" || !attachment.uploaded)) return null
  return attachments.map((attachment) => attachment.uploaded!)
}

export function revokeComposerAttachment(attachment: ComposerAttachment) {
  if (attachment.previewUrl) {
    URL.revokeObjectURL(attachment.previewUrl)
  }
}

export function formatComposerAttachmentSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function createAttachmentId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function createPreviewUrl(file: File) {
  if (!isImageAttachment(file)) {
    return null
  }

  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return null
  }

  return URL.createObjectURL(file)
}
