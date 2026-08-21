import {
  SandboxFilesApiError,
  uploadFile,
  type UploadedFile,
} from "@/lib/api/sandbox-files"

import { createEditedHtmlFileName } from "./edited-html-file-name"

const MAX_SAVE_ATTEMPTS = 8

export async function saveEditedHtmlFile({
  content,
  directory,
  mediaType = "text/html",
  originalName,
}: {
  content: string
  directory: string
  mediaType?: string
  originalName: string
}): Promise<UploadedFile> {
  let lastError: unknown

  for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt += 1) {
    const fileName = createEditedHtmlFileName(originalName)
    const file = new File([content], fileName, {
      type: mediaType || "text/html",
    })

    try {
      return await uploadFile(directory, file)
    } catch (error) {
      lastError = error

      if (error instanceof SandboxFilesApiError && error.status === 409) {
        continue
      }

      throw error
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Unable to save a unique HTML file")
}
