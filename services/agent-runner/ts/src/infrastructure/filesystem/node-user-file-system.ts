import { createReadStream, createWriteStream, type Stats } from 'node:fs'
import {
  type FileHandle,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rm,
  rmdir,
  stat,
  unlink,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  parse,
  resolve,
} from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { lookup as lookupMimeType } from 'mime-types'

import type {
  PendingUserFileUpload,
  UserFileSystem,
} from '../../core/contract/user-file-system.js'
import {
  DEFAULT_USER_FILE_UPLOAD_LIMIT_BYTES,
  USER_FILE_PREVIEW_LIMIT_BYTES,
  UserFileError,
  type CreatedUserDirectory,
  type DeletedUserPath,
  type UserFileDirectory,
  type UserFileDownload,
  type UserFileEntry,
  type UserFilePreview,
  type UserFileUploadResult,
} from '../../core/resource/user-file.js'

const DIRECTORY_STAT_CONCURRENCY = 32
const TEXT_SNIFF_BYTES = 8192
const MEBIBYTE = 1024 * 1024

const TEXT_EXTENSIONS = new Set([
  '.py', '.js', '.ts', '.tsx', '.jsx', '.json', '.yaml', '.yml',
  '.md', '.rst', '.txt', '.sh', '.bash', '.zsh', '.fish',
  '.toml', '.cfg', '.ini', '.xml', '.html', '.css', '.scss',
  '.csv', '.log', '.env', '.conf', '.properties', '.sql',
  '.rb', '.go', '.rs', '.java', '.kt', '.c', '.cpp', '.h',
  '.hpp', '.swift', '.r', '.lua', '.pl', '.makefile', '.dockerfile',
  '.gitignore', '.editorconfig',
])

const TEXT_FILENAMES = new Set([
  '.zshrc', '.bashrc', '.bash_profile', '.bash_logout', '.profile',
  '.zprofile', '.zshenv', '.zlogin', '.zlogout',
  '.gitignore', '.gitconfig', '.gitattributes', '.gitmodules',
  '.editorconfig', '.npmrc', '.yarnrc', '.prettierrc',
  '.eslintrc', '.babelrc', '.dockerignore', '.env',
  '.flake8', '.pylintrc', '.pydocstyle', '.inputrc',
  '.wgetrc', '.curlrc', '.screenrc', '.tmux.conf',
  '.vimrc', '.nanorc', '.htaccess', '.mailmap',
  'Makefile', 'Dockerfile', 'Vagrantfile', 'Procfile',
  'Gemfile', 'Rakefile', 'Brewfile', 'Justfile',
  'LICENSE', 'README', 'CHANGELOG', 'AUTHORS', 'CONTRIBUTORS',
  'CODEOWNERS',
])

export interface NodeUserFileSystemOptions {
  readonly initialDirectory: string
  readonly maxUploadBytes?: number
  readonly temporaryDirectory?: string
}

type UploadState = 'empty' | 'writing' | 'staged' | 'committing' | 'completed' | 'aborted'

interface OpenUserFile {
  readonly path: string
  readonly handle: FileHandle
  readonly stats: Stats
}

export class NodeUserFileSystem implements UserFileSystem {
  readonly initialDirectory: string
  readonly maxUploadBytes: number

  private readonly temporaryDirectory: string

  constructor(options: NodeUserFileSystemOptions) {
    if (options.initialDirectory.trim() === '') {
      throw new TypeError('initialDirectory must not be empty')
    }

    const maxUploadBytes = options.maxUploadBytes ?? DEFAULT_USER_FILE_UPLOAD_LIMIT_BYTES
    if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes <= 0) {
      throw new TypeError('maxUploadBytes must be a positive safe integer')
    }

    this.initialDirectory = resolve(expandHome(options.initialDirectory))
    this.temporaryDirectory = resolve(
      expandHome(options.temporaryDirectory ?? tmpdir()),
    )
    this.maxUploadBytes = maxUploadBytes
  }

  async listDirectory(requestedPath: string): Promise<UserFileDirectory> {
    const candidate = this.resolveCandidate(requestedPath)
    const directoryPath = await this.requireDirectory(candidate)

    let names: string[]
    try {
      names = await readdir(directoryPath)
    } catch (error) {
      throw mapDirectoryError(error, directoryPath)
    }

    const entries: UserFileEntry[] = []
    for (let offset = 0; offset < names.length; offset += DIRECTORY_STAT_CONCURRENCY) {
      const batch = names.slice(offset, offset + DIRECTORY_STAT_CONCURRENCY)
      entries.push(...await Promise.all(
        batch.map((name) => describeEntry(directoryPath, name)),
      ))
    }

    entries.sort(compareEntries)
    const root = parse(directoryPath).root

    return {
      path: directoryPath,
      parent: directoryPath === root ? null : dirname(directoryPath),
      entries,
    }
  }

  async createDirectory(
    requestedDirectory: string,
    requestedName: string,
  ): Promise<CreatedUserDirectory> {
    const name = requestedName.trim()
    if (!isSinglePathSegment(name)) {
      throw new UserFileError(
        'invalid-path-segment',
        'Directory name must be a single path segment',
      )
    }

    const directoryPath = await this.requireDirectory(
      this.resolveCandidate(requestedDirectory),
    )
    const targetPath = join(directoryPath, name)

    try {
      await mkdir(targetPath)
    } catch (error) {
      if (hasErrorCode(error, 'EEXIST')) {
        throw new UserFileError('already-exists', `Path already exists: ${name}`, {
          cause: error,
        })
      }
      if (isAccessError(error)) {
        throw new UserFileError('access-denied', `Access denied: ${directoryPath}`, {
          cause: error,
        })
      }
      throw new UserFileError(
        'io-failure',
        `Could not create directory: ${errorMessage(error)}`,
        { cause: error },
      )
    }

    return { path: targetPath, name }
  }

  async deletePath(requestedPath: string): Promise<DeletedUserPath> {
    const targetPath = this.resolveCandidate(requestedPath)
    if (targetPath === parse(targetPath).root) {
      throw new UserFileError(
        'invalid-request',
        'The filesystem root cannot be deleted',
      )
    }

    try {
      await rm(targetPath, { recursive: true })
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) {
        throw new UserFileError(
          'file-not-found',
          `Path not found: ${targetPath}`,
          { cause: error },
        )
      }
      if (isAccessError(error)) {
        throw new UserFileError(
          'access-denied',
          `Access denied: ${targetPath}`,
          { cause: error },
        )
      }
      throw new UserFileError(
        'io-failure',
        `Could not delete path: ${errorMessage(error)}`,
        { cause: error },
      )
    }

    return { status: 'ok', path: targetPath }
  }

  async openDownload(requestedPath: string): Promise<UserFileDownload> {
    const opened = await this.openUserFile(requestedPath)
    const content = opened.handle.createReadStream({ autoClose: true })

    return {
      path: opened.path,
      name: basename(opened.path),
      mimeType: detectMimeType(opened.path),
      size: opened.stats.size,
      modified: opened.stats.mtimeMs / 1000,
      content,
    }
  }

  async previewFile(requestedPath: string): Promise<UserFilePreview> {
    const opened = await this.openUserFile(requestedPath)

    try {
      const name = basename(opened.path)
      const extension = extname(name).toLowerCase()
      const mimeType = detectMimeType(opened.path)
      const isKnownText = mimeType.startsWith('text/')
        || TEXT_EXTENSIONS.has(extension)
        || TEXT_FILENAMES.has(name)
      const isImage = mimeType.startsWith('image/')
      const isPdf = mimeType === 'application/pdf' || extension === '.pdf'

      let content: string | null = null
      let isBinary = false
      let previewUrl: string | null = null

      if (isKnownText) {
        if (opened.stats.size > USER_FILE_PREVIEW_LIMIT_BYTES) {
          isBinary = true
        } else {
          content = await readUtf8(opened.handle)
        }
      } else if (isImage || isPdf) {
        previewUrl = `/api/sandbox/files/download?path=${encodePathQueryValue(opened.path)}`
      } else if (
        opened.stats.size <= USER_FILE_PREVIEW_LIMIT_BYTES
        && await looksLikeText(opened.handle, opened.stats.size)
      ) {
        content = await readUtf8(opened.handle)
      } else {
        isBinary = true
      }

      return {
        path: opened.path,
        name,
        mimeType,
        size: opened.stats.size,
        content,
        isBinary,
        previewUrl,
      }
    } catch (error) {
      if (isAccessError(error)) {
        throw new UserFileError('access-denied', `Access denied: ${opened.path}`, {
          cause: error,
        })
      }
      throw error
    } finally {
      await opened.handle.close()
    }
  }

  async beginUpload(requestedFileName: string): Promise<PendingUserFileUpload> {
    const fileName = basename(requestedFileName || 'upload')
    if (!isValidUploadFileName(fileName)) {
      throw new UserFileError('invalid-request', 'Invalid filename')
    }

    let stagingDirectory: string
    try {
      stagingDirectory = await mkdtemp(join(this.temporaryDirectory, 'priva-user-upload-'))
    } catch (error) {
      if (isAccessError(error)) {
        throw new UserFileError(
          'access-denied',
          `Access denied: ${this.temporaryDirectory}`,
          { cause: error },
        )
      }
      throw new UserFileError(
        'io-failure',
        `Could not stage upload: ${errorMessage(error)}`,
        { cause: error },
      )
    }

    const stagingPath = join(stagingDirectory, 'content')
    let state: UploadState = 'empty'
    let uploadedSize = 0

    const cleanup = async (): Promise<void> => {
      await ignoreMissing(() => unlink(stagingPath))
      await ignoreMissing(() => rmdir(stagingDirectory))
    }

    return {
      fileName,
      write: async (content) => {
        if (state !== 'empty') {
          throw new UserFileError('invalid-request', 'Upload content was already consumed')
        }
        state = 'writing'

        try {
          const limitedContent = limitBytes(
            content,
            this.maxUploadBytes,
            (size) => { uploadedSize = size },
          )
          await pipeline(
            Readable.from(limitedContent, { objectMode: false }),
            createWriteStream(stagingPath, { flags: 'wx', mode: 0o600 }),
          )
          state = 'staged'
        } catch (error) {
          state = 'aborted'
          await cleanup()
          if (error instanceof UserFileError) {
            throw error
          }
          if (isAccessError(error)) {
            throw new UserFileError(
              'access-denied',
              `Access denied: ${this.temporaryDirectory}`,
              { cause: error },
            )
          }
          throw new UserFileError(
            'io-failure',
            `Could not receive upload: ${errorMessage(error)}`,
            { cause: error },
          )
        }
      },
      commit: async (requestedDirectory) => {
        if (state !== 'staged') {
          throw new UserFileError('invalid-request', 'Upload content is not ready')
        }
        state = 'committing'

        try {
          const directoryPath = await this.requireDirectory(
            this.resolveCandidate(requestedDirectory),
          )
          const targetPath = join(directoryPath, fileName)
          await copyStagedFileExclusively(stagingPath, targetPath, directoryPath)
          state = 'completed'
          await cleanup()

          return {
            status: 'ok',
            path: targetPath,
            name: fileName,
            size: uploadedSize,
          } satisfies UserFileUploadResult
        } catch (error) {
          state = 'aborted'
          await cleanup()
          throw error
        }
      },
      abort: async () => {
        if (state === 'completed' || state === 'aborted') {
          return
        }
        state = 'aborted'
        await cleanup()
      },
    }
  }

  private resolveCandidate(requestedPath: string): string {
    const expandedPath = expandHome(requestedPath)
    return isAbsolute(expandedPath)
      ? resolve(expandedPath)
      : resolve(this.initialDirectory, expandedPath)
  }

  private async requireDirectory(candidatePath: string): Promise<string> {
    let canonicalPath: string
    try {
      canonicalPath = await realpath(candidatePath)
      const stats = await stat(canonicalPath)
      if (!stats.isDirectory()) {
        throw new UserFileError('not-directory', `Not a directory: ${canonicalPath}`)
      }
    } catch (error) {
      if (error instanceof UserFileError) {
        throw error
      }
      throw mapDirectoryError(error, candidatePath)
    }
    return canonicalPath
  }

  private async openUserFile(requestedPath: string): Promise<OpenUserFile> {
    const candidatePath = this.resolveCandidate(requestedPath)
    let canonicalPath: string
    try {
      canonicalPath = await realpath(candidatePath)
    } catch (error) {
      throw mapFileOpenError(error, candidatePath)
    }

    let handle: FileHandle
    try {
      handle = await open(canonicalPath, 'r')
    } catch (error) {
      throw mapFileOpenError(error, canonicalPath)
    }

    try {
      const stats = await handle.stat()
      if (!stats.isFile()) {
        throw new UserFileError('file-not-found', `File not found: ${canonicalPath}`)
      }
      return { path: canonicalPath, handle, stats }
    } catch (error) {
      await handle.close()
      if (error instanceof UserFileError) {
        throw error
      }
      throw mapFileOpenError(error, canonicalPath)
    }
  }
}

async function describeEntry(directoryPath: string, name: string): Promise<UserFileEntry> {
  const path = join(directoryPath, name)
  try {
    const stats = await stat(path)
    const type = stats.isDirectory() ? 'directory' : 'file'
    return {
      path,
      name,
      type,
      size: type === 'file' ? stats.size : null,
      modified: stats.mtimeMs / 1000,
      permissions: permissionString(stats.mode),
    }
  } catch {
    return {
      path,
      name,
      type: 'file',
      size: null,
      modified: null,
      permissions: null,
    }
  }
}

function compareEntries(left: UserFileEntry, right: UserFileEntry): number {
  if (left.type !== right.type) {
    return left.type === 'directory' ? -1 : 1
  }

  const leftName = left.name.toLowerCase()
  const rightName = right.name.toLowerCase()
  if (leftName < rightName) return -1
  if (leftName > rightName) return 1
  return 0
}

function permissionString(mode: number): string {
  const bits = [
    0o400, 0o200, 0o100,
    0o040, 0o020, 0o010,
    0o004, 0o002, 0o001,
  ]
  const characters = 'rwxrwxrwx'
  return bits.map((bit, index) => (mode & bit) === 0 ? '-' : characters[index]).join('')
}

function expandHome(inputPath: string): string {
  if (inputPath === '~') return homedir()
  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    return join(homedir(), inputPath.slice(2))
  }
  return inputPath
}

function isSinglePathSegment(name: string): boolean {
  return name !== ''
    && name !== '.'
    && name !== '..'
    && !name.includes('/')
    && !name.includes('\\')
    && !name.includes('\0')
}

function isValidUploadFileName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !name.includes('\0')
}

function detectMimeType(filePath: string): string {
  return lookupMimeType(filePath) || 'application/octet-stream'
}

async function looksLikeText(handle: FileHandle, size: number): Promise<boolean> {
  const length = Math.min(TEXT_SNIFF_BYTES, size)
  if (length === 0) return true

  const buffer = Buffer.allocUnsafe(length)
  const { bytesRead } = await handle.read(buffer, 0, length, 0)
  return !buffer.subarray(0, bytesRead).includes(0)
}

async function readUtf8(handle: FileHandle): Promise<string> {
  return await handle.readFile({ encoding: 'utf8' })
}

function encodePathQueryValue(filePath: string): string {
  return encodeURIComponent(filePath).replaceAll('%2F', '/')
}

async function* limitBytes(
  content: AsyncIterable<Uint8Array>,
  maxBytes: number,
  updateSize: (size: number) => void,
): AsyncGenerator<Uint8Array> {
  let size = 0
  for await (const chunk of content) {
    size += chunk.byteLength
    if (size > maxBytes) {
      throw new UserFileError(
        'upload-too-large',
        `File exceeds the ${formatByteLimit(maxBytes)} upload limit`,
      )
    }
    updateSize(size)
    yield chunk
  }
}

function formatByteLimit(bytes: number): string {
  if (bytes % MEBIBYTE === 0) {
    return `${bytes / MEBIBYTE}MB`
  }
  return `${bytes} byte${bytes === 1 ? '' : 's'}`
}

async function copyStagedFileExclusively(
  sourcePath: string,
  targetPath: string,
  directoryPath: string,
): Promise<void> {
  let targetHandle: FileHandle | undefined
  let targetCreated = false

  try {
    targetHandle = await open(targetPath, 'wx', 0o666)
    targetCreated = true
    const output = targetHandle.createWriteStream({ autoClose: true })
    await pipeline(createReadStream(sourcePath), output)
    targetHandle = undefined
  } catch (error) {
    if (targetHandle !== undefined) {
      await targetHandle.close().catch(() => undefined)
    }
    if (targetCreated) {
      await ignoreMissing(() => unlink(targetPath))
    }

    if (hasErrorCode(error, 'EEXIST')) {
      throw new UserFileError(
        'already-exists',
        `File already exists: ${basename(targetPath)}`,
        { cause: error },
      )
    }
    if (isAccessError(error)) {
      throw new UserFileError('access-denied', `Access denied: ${directoryPath}`, {
        cause: error,
      })
    }
    throw new UserFileError(
      'io-failure',
      `Could not save upload: ${errorMessage(error)}`,
      { cause: error },
    )
  }
}

function mapDirectoryError(error: unknown, directoryPath: string): UserFileError {
  if (isAccessError(error)) {
    return new UserFileError('access-denied', `Access denied: ${directoryPath}`, {
      cause: error,
    })
  }
  if (hasErrorCode(error, 'ENOENT') || hasErrorCode(error, 'ENOTDIR')) {
    return new UserFileError('not-directory', `Not a directory: ${directoryPath}`, {
      cause: error,
    })
  }
  return new UserFileError(
    'io-failure',
    `Could not read directory: ${errorMessage(error)}`,
    { cause: error },
  )
}

function mapFileOpenError(error: unknown, filePath: string): UserFileError {
  if (isAccessError(error)) {
    return new UserFileError('access-denied', `Access denied: ${filePath}`, {
      cause: error,
    })
  }
  if (
    hasErrorCode(error, 'ENOENT')
    || hasErrorCode(error, 'ENOTDIR')
    || hasErrorCode(error, 'EISDIR')
  ) {
    return new UserFileError('file-not-found', `File not found: ${filePath}`, {
      cause: error,
    })
  }
  return new UserFileError(
    'io-failure',
    `Could not open file: ${errorMessage(error)}`,
    { cause: error },
  )
}

function isAccessError(error: unknown): boolean {
  return hasErrorCode(error, 'EACCES') || hasErrorCode(error, 'EPERM')
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === code
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function ignoreMissing(operation: () => Promise<void>): Promise<void> {
  try {
    await operation()
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) {
      throw error
    }
  }
}
