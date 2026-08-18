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
import { createTestModelProfileService } from '../../../support/model-profile.js'

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
    server = buildHttpServer({
      userFileSystem: new NodeUserFileSystem({
        initialDirectory: workspace,
        temporaryDirectory: staging,
        maxUploadBytes: 16,
      }),
      modelProfileService: createTestModelProfileService(join(testRoot, 'runtime')),
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
})

interface MultipartRequest {
  readonly headers: Readonly<Record<string, string>>
  readonly payload: Buffer
}

function multipartUpload(
  fileName: string,
  content: string,
  directory: string,
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
