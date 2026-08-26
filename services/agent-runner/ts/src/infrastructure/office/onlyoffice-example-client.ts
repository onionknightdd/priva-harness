import { createHash } from 'node:crypto'
import { extname } from 'node:path'

import type { OnlyOfficeExampleClient } from '../../core/contract/office-preview-client.js'
import { OnlyOfficePreviewError } from '../../core/resource/office-preview.js'

export const DEFAULT_ONLYOFFICE_URL = 'http://127.0.0.1:8080'
export const EXCEL_PREVIEW_EXTENSIONS = new Set(['xlsx', 'xlsm', 'xltx', 'xltm'])

const UPLOAD_ENDPOINTS = [
  { upload: '/example/upload', download: '/example/download' },
  { upload: '/upload', download: '/download' },
] as const

export interface OnlyOfficeExampleClientOptions {
  readonly baseUrl?: string
  readonly fetchImpl?: typeof fetch
  readonly timeoutMs?: number
}

export function excelFileType(fileName: string): string | null {
  const extension = extname(fileName).slice(1).toLowerCase()
  return EXCEL_PREVIEW_EXTENSIONS.has(extension) ? extension : null
}

export function resolveOnlyOfficeBaseUrl(value = process.env['ONLYOFFICE_URL']): string {
  const trimmed = value?.trim()
  const base = trimmed === undefined || trimmed === ''
    ? DEFAULT_ONLYOFFICE_URL
    : trimmed
  return base.endsWith('/') ? base.slice(0, -1) : base
}

export function createOnlyOfficeExampleClient(
  options: OnlyOfficeExampleClientOptions = {},
): OnlyOfficeExampleClient {
  const baseUrl = resolveOnlyOfficeBaseUrl(options.baseUrl)
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 8_000

  return {
    async createSpreadsheetPreview(input) {
      const fileType = excelFileType(input.fileName)
      if (fileType === null) {
        throw new OnlyOfficePreviewError(
          'invalid-file',
          'OnlyOffice preview is available for Excel workbooks',
        )
      }

      let lastError: OnlyOfficePreviewError | null = null

      for (const endpoint of UPLOAD_ENDPOINTS) {
        try {
          const form = new FormData()
          form.append(
            'uploadedFile',
            new Blob([input.bytes], {
              type: input.mimeType === '' ? excelMimeType(fileType) : input.mimeType,
            }),
            input.fileName,
          )

          const upload = await request(
            fetchImpl,
            `${baseUrl}${endpoint.upload}`,
            { method: 'POST', body: form },
            timeoutMs,
          )

          if (!upload.ok) {
            lastError = new OnlyOfficePreviewError(
              upload.status >= 500 || upload.status === 0 ? 'unavailable' : 'upload-failed',
              `OnlyOffice upload failed (${upload.status === 0 ? 'network' : upload.status})`,
            )
            continue
          }

          const payload = await readJson(upload)
          const storedName = storedFileName(payload)
          if (storedName === null) {
            lastError = new OnlyOfficePreviewError(
              'upload-failed',
              'OnlyOffice upload did not return a file name',
            )
            continue
          }

          return {
            documentServerUrl: baseUrl,
            document: {
              fileType,
              key: documentKey(input.path, input.size, input.modified),
              title: input.fileName,
              url: `${baseUrl}${endpoint.download}?fileName=${encodeURIComponent(storedName)}`,
            },
          }
        } catch (error) {
          lastError = error instanceof OnlyOfficePreviewError
            ? error
            : new OnlyOfficePreviewError(
              'unavailable',
              'OnlyOffice service is not reachable',
              { cause: error },
            )
        }
      }

      throw lastError ?? new OnlyOfficePreviewError(
        'unavailable',
        'OnlyOffice service is not reachable',
      )
    },
  }
}

function excelMimeType(fileType: string): string {
  if (fileType === 'xlsm') {
    return 'application/vnd.ms-excel.sheet.macroEnabled.12'
  }

  return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

function documentKey(path: string, size: number, modified: number): string {
  return createHash('sha256')
    .update(`${path}:${size}:${modified}`)
    .digest('hex')
    .slice(0, 20)
}

function storedFileName(payload: unknown): string | null {
  if (isRecord(payload)) {
    const error = payload['error']
    if (error !== undefined && error !== null && error !== '' && error !== 0) {
      throw new OnlyOfficePreviewError(
        'upload-failed',
        formatPayloadError(error),
      )
    }

    if (typeof payload['filename'] === 'string' && payload['filename'].trim() !== '') {
      return payload['filename']
    }
  }

  return null
}

function formatPayloadError(error: unknown): string {
  if (typeof error === 'string' && error.trim() !== '') {
    return error
  }

  if (typeof error === 'number' || typeof error === 'boolean') {
    return `OnlyOffice upload failed (${error})`
  }

  return 'OnlyOffice upload failed'
}

async function request(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } catch (error) {
    throw new OnlyOfficePreviewError(
      'unavailable',
      'OnlyOffice service is not reachable',
      { cause: error },
    )
  } finally {
    clearTimeout(timer)
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.trim() === '') {
    return null
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
