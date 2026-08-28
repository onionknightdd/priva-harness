export type ComposerAttachment = {
  id: string
  file: File
  previewUrl: string | null
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
  }))
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
