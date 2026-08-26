import { describe, expect, it, vi } from 'vitest'

import { OnlyOfficePreviewError } from '../../../../src/core/resource/office-preview.js'
import { createOnlyOfficeExampleClient } from '../../../../src/infrastructure/office/onlyoffice-example-client.js'

describe('createOnlyOfficeExampleClient', () => {
  it('uploads an Excel workbook to the local example service', async () => {
    const fetchImpl = vi.fn((input: Parameters<typeof fetch>[0]) => {
      const url = urlString(input)
      if (url.endsWith('/healthcheck')) {
        return Promise.resolve(new Response('true', { status: 200 }))
      }

      if (url.endsWith('/example/upload')) {
        return Promise.resolve(Response.json({ filename: 'stored-report.xlsx' }))
      }

      return Promise.reject(new Error(`unexpected fetch ${url}`))
    })

    const client = createOnlyOfficeExampleClient({
      baseUrl: 'http://127.0.0.1:8080',
      fetchImpl,
    })

    const session = await client.createSpreadsheetPreview({
      fileName: 'report.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: 4,
      modified: 1_700_000_000,
      path: '/tmp/report.xlsx',
      bytes: new Uint8Array([1, 2, 3, 4]),
    })

    expect(session).toEqual({
      documentServerUrl: 'http://127.0.0.1:8080',
      document: {
        fileType: 'xlsx',
        key: session.document.key,
        title: 'report.xlsx',
        url: 'http://127.0.0.1:8080/example/download?fileName=stored-report.xlsx',
      },
    })
    expect(session.document.key).toMatch(/^[0-9a-f]{20}$/)
  })

  it('rejects CSV files before contacting OnlyOffice', async () => {
    const fetchImpl = vi.fn()
    const client = createOnlyOfficeExampleClient({ fetchImpl })

    await expect(client.createSpreadsheetPreview({
      fileName: 'table.csv',
      mimeType: 'text/csv',
      size: 3,
      modified: 1,
      path: '/tmp/table.csv',
      bytes: new Uint8Array([1, 2, 3]),
    })).rejects.toMatchObject({
      name: 'OnlyOfficePreviewError',
      kind: 'invalid-file',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('marks the service unavailable when healthcheck fails', async () => {
    const client = createOnlyOfficeExampleClient({
      fetchImpl: vi.fn(() => Promise.resolve(new Response('no', { status: 503 }))),
    })

    await expect(client.createSpreadsheetPreview({
      fileName: 'report.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: 1,
      modified: 1,
      path: '/tmp/report.xlsx',
      bytes: new Uint8Array([1]),
    })).rejects.toBeInstanceOf(OnlyOfficePreviewError)

    await expect(client.createSpreadsheetPreview({
      fileName: 'report.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: 1,
      modified: 1,
      path: '/tmp/report.xlsx',
      bytes: new Uint8Array([1]),
    })).rejects.toMatchObject({ kind: 'unavailable' })
  })
})

function urlString(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') {
    return input
  }

  if (input instanceof URL) {
    return input.toString()
  }

  return input.url
}
