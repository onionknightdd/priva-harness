import type { OnlyOfficeExampleClient } from '../contract/office-preview-client.js'

export type OnlyOfficePreviewErrorKind = 'invalid-file' | 'unavailable' | 'upload-failed'

export class OnlyOfficePreviewError extends Error {
  readonly kind: OnlyOfficePreviewErrorKind

  constructor(
    kind: OnlyOfficePreviewErrorKind,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'OnlyOfficePreviewError'
    this.kind = kind
  }
}

export interface OnlyOfficePreviewDocument {
  readonly fileType: string
  readonly key: string
  readonly title: string
  readonly url: string
}

export interface OnlyOfficePreviewSession {
  readonly documentServerUrl: string
  readonly document: OnlyOfficePreviewDocument
}

export function unavailableOnlyOfficeClient(): OnlyOfficeExampleClient {
  return {
    createSpreadsheetPreview() {
      return Promise.reject(
        new OnlyOfficePreviewError(
          'unavailable',
          'OnlyOffice client is not configured',
        ),
      )
    },
  }
}
