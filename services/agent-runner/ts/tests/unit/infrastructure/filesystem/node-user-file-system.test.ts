import { Buffer } from 'node:buffer'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
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
      initialDirectory: workspace,
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

    const listing = await fileSystem.listDirectory('.')

    expect(listing.path).toBe(await realpath(workspace))
    expect(listing.root).toBe(canonicalWorkspace)
    expect(listing.parent).toBeNull()
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

  it('rejects directory listings outside the workspace, including traversal and symlinks', async () => {
    const outside = join(testRoot, 'outside')
    const sibling = join(testRoot, 'workspace-extra')
    await Promise.all([mkdir(outside), mkdir(sibling)])
    await writeFile(join(outside, 'outside.txt'), 'outside')
    await symlink(outside, join(workspace, 'outside-link'), 'dir')
    await symlink(join(outside, 'outside.txt'), join(workspace, 'outside-file'))

    for (const path of [outside, sibling, '..', '../outside', 'outside-link']) {
      await expect(fileSystem.listDirectory(path)).rejects.toMatchObject({ kind: 'access-denied' })
    }
    expect((await fileSystem.listDirectory('.')).entries).toEqual([])
  })

  it('browses nested directories and internal symlinks within a canonical workspace root', async () => {
    const nested = join(workspace, 'project', 'src')
    await mkdir(nested, { recursive: true })
    await writeFile(join(nested, 'index.ts'), 'export {}')
    await symlink(nested, join(workspace, 'src-link'), 'dir')
    const alias = join(testRoot, 'workspace-link')
    await symlink(workspace, alias, 'dir')
    const aliasedFileSystem = new NodeUserFileSystem({ initialDirectory: alias })

    for (const path of [nested, 'project/src', 'src-link']) {
      await expect(aliasedFileSystem.listDirectory(path)).resolves.toMatchObject({
        root: canonicalWorkspace,
        path: join(canonicalWorkspace, 'project', 'src'),
        parent: join(canonicalWorkspace, 'project'),
        entries: [{ name: 'index.ts' }],
      })
    }
    expect((await fileSystem.listDirectory('.')).entries.map((entry) => entry.name)).toEqual(['project', 'src-link'])
  })

  it('recursively deletes paths but refuses to delete a filesystem root', async () => {
    const directory = join(workspace, 'delete-me')
    await mkdir(join(directory, 'nested'), { recursive: true })
    await writeFile(join(directory, 'nested', 'note.txt'), 'note')

    await expect(fileSystem.deletePath(directory)).resolves.toEqual({
      status: 'ok',
      path: directory,
    })
    await expect(readdir(directory)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fileSystem.deletePath(parse(directory).root)).rejects.toMatchObject({
      kind: 'invalid-request',
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

  it.each(['large.txt', 'extensionless'])('previews %s through the 3 MiB boundary', async (name) => {
    const path = join(workspace, name)
    for (const size of [1024 * 1024 + 1, 3 * 1024 * 1024 - 1, 3 * 1024 * 1024]) {
      await writeFile(path, Buffer.alloc(size, 97))
      const preview = await fileSystem.previewFile(path)
      expect(Buffer.byteLength(preview.content ?? '')).toBe(size)
      expect(preview).toMatchObject({ size, isBinary: false, previewError: null })
    }
  })

  it.each(['large.txt', 'extensionless'])('reports oversized %s as text with a preview error', async (name) => {
    const size = 3 * 1024 * 1024 + 1
    const path = join(workspace, name)
    await writeFile(path, Buffer.alloc(size, 97))
    await expect(fileSystem.previewFile(path)).resolves.toMatchObject({
      size,
      content: null,
      isBinary: false,
      previewUrl: null,
      previewError: 'too-large',
    })
  })

  it('measures the text preview limit in UTF-8 bytes', async () => {
    const path = join(workspace, 'unicode.txt')
    const content = '中'.repeat(1024 * 1024)
    await writeFile(path, content)
    const preview = await fileSystem.previewFile(path)
    expect(preview.content).toBe(content)
    expect(preview.previewError).toBeNull()

    await writeFile(path, `${content}a`)
    await expect(fileSystem.previewFile(path)).resolves.toMatchObject({ content: null, previewError: 'too-large' })
  })

  it('keeps large binary files distinct from oversized text', async () => {
    const path = join(workspace, 'payload.bin')
    await writeFile(path, Buffer.alloc(3 * 1024 * 1024 + 1))
    await expect(fileSystem.previewFile(path)).resolves.toMatchObject({
      content: null,
      isBinary: true,
      previewUrl: null,
      previewError: null,
    })
  })

  it.each(['image.png', 'document.pdf'])('retains download-backed previews for large %s', async (name) => {
    const path = join(workspace, name)
    await writeFile(path, Buffer.alloc(3 * 1024 * 1024 + 1))
    const preview = await fileSystem.previewFile(path)
    expect(preview).toMatchObject({ content: null, isBinary: false, previewError: null })
    expect(preview.previewUrl).toContain('/api/sandbox/files/download?path=')
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
