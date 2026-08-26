export const LOCAL_ONLYOFFICE_ORIGIN = "http://127.0.0.1:8080"

const UPLOAD_PATHS = [
  "/example/upload",
  "/onlyoffice/example/upload",
  `${LOCAL_ONLYOFFICE_ORIGIN}/example/upload`,
] as const

const REQUEST_TIMEOUT_MS = 8_000

export class OnlyOfficeExampleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "OnlyOfficeExampleError"
  }
}

export async function uploadWorkbookForExamplePreview(input: {
  fileName: string
  mediaType: string
  bytes: ArrayBuffer
  signal?: AbortSignal
}) {
  if (workbookFileType(input.fileName) === null) {
    throw new OnlyOfficeExampleError(
      "OnlyOffice preview is available for Excel workbooks"
    )
  }

  let lastError: Error = new OnlyOfficeExampleError(
    "OnlyOffice service is not reachable"
  )

  for (const uploadPath of UPLOAD_PATHS) {
    try {
      const storedName = await uploadWorkbook(uploadPath, input)
      return storedName
    } catch (error) {
      if (input.signal?.aborted) {
        throw error
      }

      lastError = error instanceof Error ? error : lastError
    }
  }

  throw lastError
}

export function exampleEditorUrl(fileName: string, language: string) {
  const params = new URLSearchParams({
    type: "embedded",
    mode: "view",
    fileName,
    lang: language.startsWith("zh") ? "zh-CN" : "en",
  })

  return `/example/editor?${params.toString()}`
}

async function uploadWorkbook(
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

  const response = await fetch(uploadPath, {
    method: "POST",
    body: form,
    cache: "no-store",
    signal: withTimeout(input.signal, REQUEST_TIMEOUT_MS),
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

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs)
  if (signal === undefined) {
    return timeout
  }

  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([signal, timeout])
  }

  return timeout
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
