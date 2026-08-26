import type { OnlyOfficePreviewSession } from '../resource/office-preview.js'

export interface OnlyOfficePreviewInput {
  readonly fileName: string
  readonly mimeType: string
  readonly size: number
  readonly modified: number
  readonly path: string
  readonly bytes: Uint8Array
}

export interface OnlyOfficeExampleClient {
  createSpreadsheetPreview(input: OnlyOfficePreviewInput): Promise<OnlyOfficePreviewSession>
}
