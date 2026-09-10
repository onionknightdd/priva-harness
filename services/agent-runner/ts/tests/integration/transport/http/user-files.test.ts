import { Buffer } from 'node:buffer'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { NodeUserFileSystem } from '../../../../src/infrastructure/filesystem/node-user-file-system.js'
import { buildHttpServer } from '../../../../src/transport/http/server.js'
import { createTestAgentServices } from '../../../support/model-profile.js'

describe('/api/sandbox/files', () => {
  let testRoot: string
  let workspace: string
  let canonicalWorkspace: string
  let staging: string
  let server: FastifyInstance

  beforeEach(async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'priva-user-files-http-test-'))
    workspace = join(testRoot, 'workspace')
    staging = join(testRoot, 'staging')
    await Promise.all([mkdir(workspace), mkdir(staging)])
    canonicalWorkspace = await realpath(workspace)
    const services = createTestAgentServices(join(testRoot, 'runtime'))
    server = buildHttpServer({
      userFileSystem: new NodeUserFileSystem({
        initialDirectory: workspace,
        temporaryDirectory: staging,
        maxUploadBytes: 16,
      }),
      modelProfileService: services.modelProfileService,
      agentProfileService: services.agentProfileService,
    })
    await server.ready()
  })

  afterEach(async () => {
    await server.close()
    await rm(testRoot, { recursive: true, force: true })
  })

  it('lists, creates, previews, and downloads files without authentication', async () => {
    await writeFile(join(workspace, 'hello world.txt'), 'hello')

    const listResponse = await server.inject({
      method: 'GET',
      url: '/api/sandbox/files/list',
    })
    expect(listResponse.statusCode).toBe(200)
    expect(parseJson(listResponse.body)).toMatchObject({
      path: canonicalWorkspace,
      entries: [{
        path: join(canonicalWorkspace, 'hello world.txt'),
        name: 'hello world.txt',
        type: 'file',
        size: 5,
      }],
    })

    const mkdirResponse = await server.inject({
      method: 'POST',
      url: '/api/sandbox/files/mkdir',
      payload: { directory: '.', name: 'reports' },
    })
    expect(mkdirResponse.statusCode).toBe(201)
    expect(parseJson(mkdirResponse.body)).toEqual({
      path: join(canonicalWorkspace, 'reports'),
      name: 'reports',
    })

    const fileQuery = new URLSearchParams({ path: 'hello world.txt' })
    fileQuery.set('_priva_refresh', '1')
    const previewResponse = await server.inject({
      method: 'GET',
      url: `/api/sandbox/files/preview?${fileQuery.toString()}`,
    })
    expect(previewResponse.statusCode).toBe(200)
    expect(parseJson(previewResponse.body)).toMatchObject({
      name: 'hello world.txt',
      mime_type: 'text/plain',
      content: 'hello',
      is_binary: false,
      preview_url: null,
      preview_error: null,
    })

    const downloadResponse = await server.inject({
      method: 'GET',
      url: `/api/sandbox/files/download?${new URLSearchParams({ path: 'hello world.txt' }).toString()}`,
    })
    expect(downloadResponse.statusCode).toBe(200)
    expect(downloadResponse.headers['content-disposition']).toBe(
      "attachment; filename*=UTF-8''hello%20world.txt",
    )
    expect(downloadResponse.body).toBe('hello')

    await writeFile(join(canonicalWorkspace, 'reports', 'report.txt'), 'report')
    const deleteResponse = await server.inject({
      method: 'DELETE',
      url: `/api/sandbox/files?${new URLSearchParams({
        path: join(canonicalWorkspace, 'reports'),
      }).toString()}`,
    })
    expect(deleteResponse.statusCode).toBe(200)
    expect(parseJson(deleteResponse.body)).toEqual({
      status: 'ok',
      path: join(canonicalWorkspace, 'reports'),
    })
    await expect(readdir(join(canonicalWorkspace, 'reports'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('returns text content at the 3 MiB preview limit', async () => {
    const size = 3 * 1024 * 1024
    await writeFile(join(workspace, 'large.txt'), Buffer.alloc(size, 97))
    const response = await server.inject({ method: 'GET', url: '/api/sandbox/files/preview?path=large.txt' })
    expect(response.statusCode).toBe(200)
    const body = response.json<{ content: string }>()
    expect(body).toMatchObject({ size, is_binary: false, preview_error: null })
    expect(typeof body.content).toBe('string')
    expect(Buffer.byteLength(body.content)).toBe(size)
  })

  it('returns an explicit preview error above 3 MiB and still allows downloading', async () => {
    const size = 3 * 1024 * 1024 + 1
    await writeFile(join(workspace, 'large.txt'), Buffer.alloc(size, 97))
    const response = await server.inject({ method: 'GET', url: '/api/sandbox/files/preview?path=large.txt' })
    expect(response.statusCode).toBe(200)
    expect(parseJson(response.body)).toMatchObject({
      name: 'large.txt',
      size,
      content: null,
      is_binary: false,
      preview_url: null,
      preview_error: 'too-large',
    })

    const download = await server.inject({ method: 'GET', url: '/api/sandbox/files/download?path=large.txt' })
    expect(download.statusCode).toBe(200)
    expect(Buffer.byteLength(download.body)).toBe(size)
  })

  it('accepts the existing file-first multipart field order and prevents overwrite', async () => {
    const upload = multipartUpload('note.txt', 'streamed upload', workspace)
    const uploadResponse = await server.inject({
      method: 'POST',
      url: '/api/sandbox/files/upload',
      headers: upload.headers,
      payload: upload.payload,
    })
    expect(uploadResponse.statusCode).toBe(200)
    expect(parseJson(uploadResponse.body)).toEqual({
      status: 'ok',
      path: join(canonicalWorkspace, 'note.txt'),
      name: 'note.txt',
      size: 15,
    })
    expect(await readFile(join(workspace, 'note.txt'), 'utf8')).toBe('streamed upload')

    const duplicate = multipartUpload('note.txt', 'replacement', workspace)
    const duplicateResponse = await server.inject({
      method: 'POST',
      url: '/api/sandbox/files/upload',
      headers: duplicate.headers,
      payload: duplicate.payload,
    })
    expect(duplicateResponse.statusCode).toBe(409)
    expect(await readFile(join(workspace, 'note.txt'), 'utf8')).toBe('streamed upload')
  })

  it('returns 413 and cleans staging when a multipart upload exceeds the limit', async () => {
    const upload = multipartUpload('large.txt', '12345678901234567', workspace)
    const response = await server.inject({
      method: 'POST',
      url: '/api/sandbox/files/upload',
      headers: upload.headers,
      payload: upload.payload,
    })

    expect(response.statusCode).toBe(413)
    expect(parseJson(response.body)).toEqual({
      detail: 'File exceeds the 16 bytes upload limit',
    })
    expect(await readdir(staging)).toEqual([])
    await expect(readFile(join(workspace, 'large.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('stores same-name chat attachments at distinct paths and serves them for preview', async () => {
    const paths: string[] = []
    for (const content of ['first', 'second']) {
      const upload = multipartUpload('report.txt', content, workspace, 'attachment')
      const response = await server.inject({ method: 'POST', url: '/api/sandbox/files/upload', headers: upload.headers, payload: upload.payload })
      expect(response.statusCode).toBe(200)
      const file = JSON.parse(response.body) as { path: string; name: string; size: number }
      expect(file.name).toBe('report.txt')
      expect(file.path.startsWith(join(canonicalWorkspace, '.priva-attachments') + '/')).toBe(true)
      expect(await readFile(file.path, 'utf8')).toBe(content)
      paths.push(file.path)
      const preview = await server.inject({ method: 'GET', url: `/api/sandbox/files/preview?${new URLSearchParams({ path: file.path }).toString()}` })
      expect(preview.statusCode).toBe(200)
      expect(parseJson(preview.body)).toMatchObject({ content })
    }
    expect(paths[0]).not.toBe(paths[1])
    expect(await readdir(staging)).toEqual([])
  })
})

interface MultipartRequest {
  readonly headers: Readonly<Record<string, string>>
  readonly payload: Buffer
}

function multipartUpload(
  fileName: string,
  content: string,
  directory: string,
  purpose?: string,
): MultipartRequest {
  const boundary = 'priva-file-api-test-boundary'
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n`
      + `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`
      + 'Content-Type: application/octet-stream\r\n\r\n',
    ),
    Buffer.from(content),
    Buffer.from(
      `\r\n--${boundary}\r\n`
      + 'Content-Disposition: form-data; name="directory"\r\n\r\n'
      + `${directory}\r\n`
      + (purpose === undefined ? '' : `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\n${purpose}\r\n`)
      + `--${boundary}--\r\n`,
    ),
  ])

  return {
    headers: {
      'content-length': String(payload.byteLength),
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  }
}

function parseJson(body: string): unknown {
  return JSON.parse(body) as unknown
}
