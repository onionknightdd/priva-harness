type ErrorResponse = {
  detail?: string
}

export type OfficePreviewDocument = {
  fileType: string
  key: string
  title: string
  url: string
}

export type OfficePreviewSession = {
  documentServerUrl: string
  document: OfficePreviewDocument
}

export class OfficePreviewApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "OfficePreviewApiError"
    this.status = status
  }
}

export async function createOfficePreviewSession(
  path: string,
  signal?: AbortSignal
): Promise<OfficePreviewSession> {
  const response = await fetch("/api/sandbox/office/preview-session", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
    signal,
  })

  if (!response.ok) {
    let detail = response.statusText || `HTTP ${response.status}`

    try {
      const error = (await response.json()) as ErrorResponse
      if (error.detail) {
        detail = error.detail
      }
    } catch {
      // Keep the HTTP status text when the response has no JSON body.
    }

    throw new OfficePreviewApiError(response.status, detail)
  }

  const payload = (await response.json()) as {
    document_server_url: string
    document: OfficePreviewDocument
  }

  return {
    documentServerUrl: payload.document_server_url,
    document: payload.document,
  }
}
