import { createHash } from 'node:crypto'
import { extname } from 'node:path'

import type { OnlyOfficeExampleClient } from '../../core/contract/office-preview-client.js'
import { OnlyOfficePreviewError } from '../../core/resource/office-preview.js'

export const DEFAULT_ONLYOFFICE_URL = 'http://127.0.0.1:8080'
export const EXCEL_PREVIEW_EXTENSIONS = new Set(['xlsx', 'xlsm', 'xltx', 'xltm'])

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

      await assertHealthy(baseUrl, fetchImpl, timeoutMs)

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
        `${baseUrl}/example/upload`,
        { method: 'POST', body: form },
        timeoutMs,
      )

      if (!upload.ok) {
        throw new OnlyOfficePreviewError(
          upload.status >= 500 || upload.status === 0 ? 'unavailable' : 'upload-failed',
          `OnlyOffice upload failed (${upload.status === 0 ? 'network' : upload.status})`,
        )
      }

      const payload = await readJson(upload)
      const storedName = storedFileName(payload, input.fileName)
      if (storedName === null || storedName.trim() === '') {
        throw new OnlyOfficePreviewError(
          'upload-failed',
          'OnlyOffice upload did not return a file name',
        )
      }

      return {
        documentServerUrl: baseUrl,
        document: {
          fileType,
          key: documentKey(input.path, input.size, input.modified),
          title: input.fileName,
          url: `${baseUrl}/example/download?fileName=${encodeURIComponent(storedName)}`,
        },
      }
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

function storedFileName(payload: unknown, fallback: string): string | null {
  if (!isRecord(payload)) {
    return fallback
  }

  if (typeof payload['error'] === 'string' && payload['error'].trim() !== '') {
    throw new OnlyOfficePreviewError('upload-failed', payload['error'])
  }

  if (typeof payload['filename'] === 'string' && payload['filename'].trim() !== '') {
    return payload['filename']
  }

  return fallback
}

async function assertHealthy(
  baseUrl: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<void> {
  try {
    const response = await request(
      fetchImpl,
      `${baseUrl}/healthcheck`,
      { method: 'GET' },
      timeoutMs,
    )
    if (!response.ok) {
      throw new OnlyOfficePreviewError(
        'unavailable',
        `OnlyOffice healthcheck failed (${response.status})`,
      )
    }
  } catch (error) {
    if (error instanceof OnlyOfficePreviewError) {
      throw error
    }

    throw new OnlyOfficePreviewError(
      'unavailable',
      'OnlyOffice service is not reachable',
      { cause: error },
    )
  }
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
