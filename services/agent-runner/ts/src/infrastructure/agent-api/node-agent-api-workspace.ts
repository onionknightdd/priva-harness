import { mkdir, mkdtemp, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { lookup as lookupMimeType } from 'mime-types'

import { AgentApiError } from '../../core/agent-api/errors.js'
import type { AgentApiWorkspace } from '../../core/contract/agent-api-workspace.js'
import type { UserFileSystem } from '../../core/contract/user-file-system.js'
import type { UserAttachment } from '../../core/run/user-turn.js'

const ATTACHMENTS_DIRECTORY = '.priva-attachments'

export class NodeAgentApiWorkspace implements AgentApiWorkspace {
  readonly root: string
  readonly maxUploadBytes: number

  constructor(private readonly files: UserFileSystem) {
    this.root = files.initialDirectory
    this.maxUploadBytes = files.maxUploadBytes
  }

  async resolveWorkdir(workdir: string): Promise<{ absolute: string; relative: string }> {
    const root = await realpath(this.root)
    const absolute = await this.contained(root, workdir, 'workdir')
    if (!(await stat(absolute)).isDirectory()) {
      throw new AgentApiError('validation_failed', `workdir is not a directory: ${workdir}`, { param: 'workdir' })
    }
    return { absolute, relative: toPosix(relative(root, absolute)) }
  }

  async workdirOf(cwd: string): Promise<string | undefined> {
    const root = await realpath(this.root)
    let absolute: string
    try {
      absolute = await realpath(cwd)
    } catch {
      return undefined
    }
    if (!within(root, absolute)) return undefined
    return toPosix(relative(root, absolute))
  }

  async resolveFile(cwd: string, path: string, param: string): Promise<UserAttachment> {
    const absolute = await this.contained(await realpath(cwd), path, param)
    const stats = await stat(absolute)
    if (!stats.isFile()) throw new AgentApiError('validation_failed', `Not a file: ${path}`, { param })
    return { path: absolute, name: basename(absolute), mimeType: mimeTypeOf(absolute), size: stats.size }
  }

  async writeAttachment(cwd: string, fileName: string, content: Uint8Array): Promise<UserAttachment> {
    const name = safeFileName(fileName)
    const parent = join(await realpath(cwd), ATTACHMENTS_DIRECTORY)
    await mkdir(parent, { recursive: true })
    const path = join(await mkdtemp(join(parent, 'file-')), name)
    await writeFile(path, content, { flag: 'wx', mode: 0o600 })
    return { path, name, mimeType: mimeTypeOf(path), size: content.byteLength }
  }

  async upload(cwd: string, fileName: string, content: AsyncIterable<Uint8Array>): Promise<UserAttachment> {
    const pending = await this.files.beginUpload(fileName)
    try {
      await pending.write(content)
      const uploaded = await pending.commit(await realpath(cwd), 'attachment')
      return { path: uploaded.path, name: uploaded.name, mimeType: mimeTypeOf(uploaded.path), size: uploaded.size }
    } finally {
      await pending.abort()
    }
  }

  relativePath(cwd: string, absolute: string): string {
    return toPosix(relative(cwd, absolute))
  }

  /** Checked before and after resolving symlinks, so `..` and links pointing outside are both rejected. */
  private async contained(base: string, requested: string, param: string): Promise<string> {
    const outside = new AgentApiError('path_outside_workspace', `${requested} resolves outside the session directory`, { param })
    if (isAbsolute(requested)) {
      throw new AgentApiError('path_outside_workspace', `${param} must be relative to the session directory`, { param })
    }
    const lexical = resolve(base, requested)
    if (!within(base, lexical)) throw outside
    let absolute: string
    try {
      absolute = await realpath(lexical)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new AgentApiError('validation_failed', `No such file or directory: ${requested}`, { param })
      }
      throw error
    }
    if (!within(base, absolute)) throw outside
    return absolute
  }
}

function within(base: string, path: string): boolean {
  return path === base || path.startsWith(`${base}${sep}`)
}

function safeFileName(fileName: string): string {
  const name = basename(fileName).trim()
  if (name === '' || name === '.' || name === '..' || name.includes('\0')) {
    throw new AgentApiError('validation_failed', `Invalid file name: ${fileName}`, { param: 'filename' })
  }
  return name
}

function mimeTypeOf(path: string): string {
  const type = lookupMimeType(path)
  return type === false ? 'application/octet-stream' : type
}

function toPosix(path: string): string {
  return path.split(sep).join('/')
}
