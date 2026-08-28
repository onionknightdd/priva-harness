import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NodeUserFileSystem } from '../../../../src/infrastructure/filesystem/node-user-file-system.js'
import type { OnlyOfficePreviewInput } from '../../../../src/core/contract/office-preview-client.js'
import { OnlyOfficePreviewError } from '../../../../src/core/resource/office-preview.js'
import { buildHttpServer } from '../../../../src/transport/http/server.js'
import { createTestAgentServices } from '../../../support/model-profile.js'

describe('/api/sandbox/office/preview-session', () => {
  let testRoot: string
  let workspace: string
  let staging: string
  let server: FastifyInstance
  const createSpreadsheetPreview = vi.fn<(input: OnlyOfficePreviewInput) => Promise<{
    documentServerUrl: string
    document: {
      fileType: string
      key: string
      title: string
      url: string
    }
  }>>()

  beforeEach(async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'priva-office-preview-http-test-'))
    workspace = join(testRoot, 'workspace')
    staging = join(testRoot, 'staging')
    await Promise.all([mkdir(workspace), mkdir(staging)])
    const canonicalWorkspace = await realpath(workspace)
    await writeFile(join(canonicalWorkspace, 'report.xlsx'), 'xlsx')
    const services = createTestAgentServices(join(testRoot, 'runtime'))
    createSpreadsheetPreview.mockReset()
    createSpreadsheetPreview.mockResolvedValue({
      documentServerUrl: 'http://127.0.0.1:8080',
      document: {
        fileType: 'xlsx',
        key: 'abc123abc123abc123ab',
        title: 'report.xlsx',
        url: 'http://127.0.0.1:8080/example/download?fileName=report.xlsx',
      },
    })
    server = buildHttpServer({
      userFileSystem: new NodeUserFileSystem({
        initialDirectory: workspace,
        temporaryDirectory: staging,
      }),
      modelProfileService: services.modelProfileService,
      agentProfileService: services.agentProfileService,
      officeClient: { createSpreadsheetPreview },
    })
    await server.ready()
  })

  afterEach(async () => {
    await server.close()
    await rm(testRoot, { recursive: true, force: true })
  })

  it('returns a DocsAPI session for an Excel workbook', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/sandbox/office/preview-session',
      payload: { path: 'report.xlsx' },
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      document_server_url: 'http://127.0.0.1:8080',
      document: {
        fileType: 'xlsx',
        key: 'abc123abc123abc123ab',
        title: 'report.xlsx',
        url: 'http://127.0.0.1:8080/example/download?fileName=report.xlsx',
      },
    })
    expect(createSpreadsheetPreview).toHaveBeenCalledTimes(1)
    const [previewInput] = createSpreadsheetPreview.mock.calls[0] ?? []
    expect(previewInput?.fileName).toBe('report.xlsx')
    expect(previewInput?.bytes).toBeInstanceOf(Uint8Array)
  })

  it('maps OnlyOffice unavailability to HTTP 502', async () => {
    createSpreadsheetPreview.mockRejectedValue(
      new OnlyOfficePreviewError('unavailable', 'OnlyOffice service is not reachable'),
    )

    const response = await server.inject({
      method: 'POST',
      url: '/api/sandbox/office/preview-session',
      payload: { path: 'report.xlsx' },
    })

    expect(response.statusCode).toBe(502)
    expect(JSON.parse(response.body)).toEqual({
      detail: 'OnlyOffice service is not reachable',
    })
  })
})
