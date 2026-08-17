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
import { Readable } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { UserFileError } from '../../../../src/core/resource/user-file.js'
import { NodeUserFileSystem } from '../../../../src/infrastructure/filesystem/node-user-file-system.js'

describe('NodeUserFileSystem', () => {
  let testRoot: string
  let workspace: string
  let canonicalWorkspace: string
  let staging: string
  let fileSystem: NodeUserFileSystem

  beforeEach(async () => {
    testRoot = await mkdtemp(join(tmpdir(), 'priva-user-files-test-'))
    workspace = join(testRoot, 'workspace')
    staging = join(testRoot, 'staging')
    await Promise.all([mkdir(workspace), mkdir(staging)])
    canonicalWorkspace = await realpath(workspace)
    fileSystem = new NodeUserFileSystem({
      workspaceDirectory: workspace,
      temporaryDirectory: staging,
      maxUploadBytes: 16,
    })
  })

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true })
  })

  it('anchors relative paths and sorts directories before files', async () => {
    await Promise.all([
      mkdir(join(workspace, 'z-directory')),
      mkdir(join(workspace, 'A-directory')),
      writeFile(join(workspace, 'a-file.txt'), 'alpha'),
      writeFile(join(workspace, 'Z-file.txt'), 'zulu'),
    ])

    const listing = await fileSystem.listDirectory('~')

    expect(listing.path).toBe(await realpath(workspace))
    expect(listing.entries.map(({ name }) => name)).toEqual([
      'A-directory',
      'z-directory',
      'a-file.txt',
      'Z-file.txt',
    ])
    expect(listing.entries[2]).toMatchObject({
      type: 'file',
      size: 5,
    })
    expect(listing.entries[2]?.permissions).toMatch(/^[rwx-]{9}$/u)
  })

  it('creates a directory without allowing traversal or overwrite', async () => {
    await mkdir(join(workspace, 'projects'))

    await expect(fileSystem.createDirectory('projects', ' reports ')).resolves.toEqual({
      path: join(canonicalWorkspace, 'projects', 'reports'),
      name: 'reports',
    })
    await expect(fileSystem.createDirectory('projects', 'reports')).rejects.toMatchObject({
      kind: 'already-exists',
    })
    await expect(fileSystem.createDirectory('projects', '../outside')).rejects.toMatchObject({
      kind: 'invalid-path-segment',
    })
  })

  it('previews text and classifies images and binary files', async () => {
    const textPath = join(workspace, 'README')
    const imagePath = join(workspace, 'image.png')
    const binaryPath = join(workspace, 'payload.bin')
    await Promise.all([
      writeFile(textPath, 'hello, 世界'),
      writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47])),
      writeFile(binaryPath, Buffer.from([0x01, 0x00, 0x02])),
    ])

    await expect(fileSystem.previewFile(textPath)).resolves.toMatchObject({
      content: 'hello, 世界',
      isBinary: false,
      previewUrl: null,
    })
    await expect(fileSystem.previewFile(imagePath)).resolves.toMatchObject({
      content: null,
      isBinary: false,
      previewUrl: `/api/sandbox/files/download?path=${join(canonicalWorkspace, 'image.png')}`,
    })
    await expect(fileSystem.previewFile(binaryPath)).resolves.toMatchObject({
      content: null,
      isBinary: true,
      previewUrl: null,
    })
  })

  it('streams an upload through staging and does not overwrite an existing file', async () => {
    const firstUpload = await fileSystem.beginUpload('../note.txt')
    await firstUpload.write(chunks('hello', ' world'))
    await expect(firstUpload.commit(workspace)).resolves.toEqual({
      status: 'ok',
      path: join(canonicalWorkspace, 'note.txt'),
      name: 'note.txt',
      size: 11,
    })
    expect(await readFile(join(workspace, 'note.txt'), 'utf8')).toBe('hello world')

    const duplicate = await fileSystem.beginUpload('note.txt')
    await duplicate.write(chunks('replacement'))
    await expect(duplicate.commit(workspace)).rejects.toMatchObject({
      kind: 'already-exists',
    })
    expect(await readFile(join(workspace, 'note.txt'), 'utf8')).toBe('hello world')
    expect(await readdir(staging)).toEqual([])
  })

  it('rejects an oversized upload and removes its staging data', async () => {
    const upload = await fileSystem.beginUpload('large.txt')

    await expect(upload.write(chunks('123456789', '12345678'))).rejects.toSatisfy(
      (error: unknown) => error instanceof UserFileError
        && error.kind === 'upload-too-large',
    )
    expect(await readdir(staging)).toEqual([])
    await expect(readFile(join(workspace, 'large.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

function chunks(...values: string[]): AsyncIterable<Uint8Array> {
  return Readable.from(values.map((value) => Buffer.from(value)), { objectMode: false })
}
