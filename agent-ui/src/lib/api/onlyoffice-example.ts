import type { OfficePreviewSession } from "./sandbox-office"

export const LOCAL_ONLYOFFICE_ORIGIN = "http://127.0.0.1:8080"
const ONLYOFFICE_PROXY_BASE = "/onlyoffice"

const UPLOAD_ENDPOINTS = [
  { upload: "/example/upload", download: "/example/download" },
  { upload: "/upload", download: "/download" },
] as const

export class OnlyOfficeExampleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "OnlyOfficeExampleError"
  }
}

export async function createLocalOnlyOfficePreviewSession(input: {
  fileName: string
  filePath: string
  mediaType: string
  bytes: ArrayBuffer
  signal?: AbortSignal
}): Promise<OfficePreviewSession> {
  const fileType = workbookFileType(input.fileName)
  if (fileType === null) {
    throw new OnlyOfficeExampleError(
      "OnlyOffice preview is available for Excel workbooks"
    )
  }

  const bases = [ONLYOFFICE_PROXY_BASE, LOCAL_ONLYOFFICE_ORIGIN]
  let lastError: Error = new OnlyOfficeExampleError(
    "OnlyOffice service is not reachable"
  )

  for (const base of bases) {
    for (const endpoint of UPLOAD_ENDPOINTS) {
      try {
        const storedName = await uploadWorkbook(base, endpoint.upload, input)
        return {
          documentServerUrl: LOCAL_ONLYOFFICE_ORIGIN,
          document: {
            fileType,
            key: documentKey(input.filePath, input.bytes.byteLength),
            title: input.fileName,
            url: `${LOCAL_ONLYOFFICE_ORIGIN}${endpoint.download}?fileName=${encodeURIComponent(storedName)}`,
          },
        }
      } catch (error) {
        if (input.signal?.aborted) {
          throw error
        }

        lastError = error instanceof Error ? error : lastError
      }
    }
  }

  throw lastError
}

async function uploadWorkbook(
  base: string,
  uploadPath: string,
  input: {
    fileName: string
    mediaType: string
    bytes: ArrayBuffer
    signal?: AbortSignal
  }
) {
  const form = new FormData()
  form.append(
    "uploadedFile",
    new Blob([input.bytes], {
      type:
        input.mediaType === ""
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : input.mediaType,
    }),
    input.fileName
  )

  const response = await fetch(`${base}${uploadPath}`, {
    method: "POST",
    body: form,
    cache: "no-store",
    signal: input.signal,
  })
  const payload = await readJson(response)
  const uploadError = payloadError(payload)

  if (!response.ok || uploadError !== null) {
    throw new OnlyOfficeExampleError(
      uploadError ?? `OnlyOffice upload failed (${response.status})`
    )
  }

  const storedName = storedFileName(payload)
  if (storedName === null) {
    throw new OnlyOfficeExampleError(
      "OnlyOffice upload did not return a file name"
    )
  }

  return storedName
}

function workbookFileType(fileName: string) {
  const extension = fileName.split(".").at(-1)?.toLocaleLowerCase()
  if (
    extension === "xlsx" ||
    extension === "xlsm" ||
    extension === "xltx" ||
    extension === "xltm"
  ) {
    return extension
  }

  return null
}

function documentKey(path: string, size: number) {
  const safePath = path.replace(/[^0-9A-Za-z._-]/g, "_").slice(-48)
  return `${safePath}_${size}_${Date.now().toString(36)}`.slice(0, 128)
}

function storedFileName(payload: unknown) {
  if (isRecord(payload) && typeof payload["filename"] === "string") {
    const filename = payload["filename"].trim()
    if (filename !== "") {
      return filename
    }
  }

  return null
}

function payloadError(payload: unknown) {
  if (!isRecord(payload) || !("error" in payload)) {
    return null
  }

  const error = payload["error"]
  if (error === undefined || error === null || error === "" || error === 0) {
    return null
  }

  return typeof error === "string" ? error : `OnlyOffice upload failed (${error})`
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.trim() === "") {
    return null
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
