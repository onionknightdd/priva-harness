import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { type Whiteboard, type WhiteboardClaim, type WhiteboardContext, type WhiteboardOperation,
  type WhiteboardWrite, WhiteboardError, validateWhiteboard, whiteboardSchema, whiteboardWriteSchema, whiteboardSessionIdSchema } from '../../core/resource/whiteboard.js'

const MAX_BOARD_BYTES = 4 * 1024 * 1024
export type WhiteboardEvent =
  | { type: 'change'; path: string; revision: number; title: string; order: string[]; ops: WhiteboardOperation[]; source: 'agent' | 'user' }
  | { type: 'presence'; contexts: (WhiteboardContext & { id: string })[]; claims: WhiteboardClaim[] }
type Listener = (event: WhiteboardEvent) => void

/** All processes submit to this Runner-owned service; it is the sole writer. */
export class WhiteboardService {
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly listeners = new Map<string, Set<Listener>>()
  private readonly contexts = new Map<string, Map<string, WhiteboardContext>>()
  private readonly claims = new Map<string, Map<string, { claim: WhiteboardClaim; expires: number }>>()

  /** Tool paths are scoped to the current native session, independently of viewers. */
  async resolveSessionPath(raw: string, cwd: string, sessionId: string, create = false): Promise<string> {
    const parsedSession = whiteboardSessionIdSchema.safeParse(sessionId)
    if (!parsedSession.success) throw new WhiteboardError(400, 'A safe native session id is required')
    if (!cwd.trim()) throw new WhiteboardError(400, 'A workspace cwd is required')
    const requested = raw.trim()
    if (/[\\<>]/u.test(raw) || hasControlCharacters(raw) || requested.split('/').includes('..')) throw new WhiteboardError(400, 'Whiteboard paths cannot contain parent segments, backslashes, control characters or angle brackets')
    if (!requested.endsWith('.board.json')) throw new WhiteboardError(400, 'An explicit lowercase .board.json filename is required')
    const requestedWorkspace = path.resolve(cwd)
    const workspace = await realpath(requestedWorkspace)
    const root = path.join(workspace, '.whiteboard', parsedSession.data)
    const normalized = path.normalize(requested)
    if (normalized === '.canvas' || normalized.startsWith(`.canvas${path.sep}`)) throw new WhiteboardError(403, 'Whiteboards belong in the current session .whiteboard directory; .canvas paths are not accepted')
    let target: string
    if (path.isAbsolute(normalized)) {
      target = isInside(requestedWorkspace, normalized)
        ? path.resolve(workspace, path.relative(requestedWorkspace, normalized))
        : normalized
    } else {
      target = normalized.startsWith(`.whiteboard${path.sep}`)
        ? path.resolve(workspace, normalized)
        : path.resolve(root, normalized)
    }
    if (!isInside(root, target)) throw new WhiteboardError(403, 'Whiteboard path must stay inside .whiteboard/<current-session-id>')
    // Reject symlinks below .whiteboard before mkdir can write through one,
    // including links to another session within the same workspace.
    let directory = workspace
    for (const segment of path.relative(workspace, path.dirname(target)).split(path.sep)) {
      directory = path.join(directory, segment)
      try {
        const info = await lstat(directory)
        if (info.isSymbolicLink() || !info.isDirectory()) throw new WhiteboardError(403, 'Whiteboard session directories must be real directories, not symbolic links')
      } catch (error) { if (missing(error)) break; throw error }
    }
    const resolved = await this.resolvePath(target, workspace, create)
    assertInside(root, resolved)
    return resolved
  }

  async resolvePath(raw: string, cwd?: string, create = false, allowMissing = false): Promise<string> {
    if (!raw || !raw.endsWith('.board.json') || raw.includes('\0')) throw new WhiteboardError(400, 'A .board.json path is required')
    if (!cwd && !path.isAbsolute(raw)) throw new WhiteboardError(400, 'Relative board paths require cwd')
    const requestedRoot = path.resolve(cwd ?? (allowMissing ? await existingAncestor(path.dirname(raw)) : path.dirname(raw)))
    const root = await realpath(requestedRoot)
    let target = path.resolve(requestedRoot, raw)
    if (path.isAbsolute(raw) && isInside(root, target)) target = path.join(requestedRoot, path.relative(root, target))
    assertInside(requestedRoot, target)
    const directory = path.dirname(target)
    // Check each existing ancestor before creating directories; never write
    // through a symlink escaping the selected workspace.
    assertInside(root, await existingDirectory(directory), true)
    if (create) await mkdir(directory, { recursive: true })
    let canonicalDirectory: string
    try { canonicalDirectory = await realpath(directory) } catch (error) {
      if (!missing(error)) throw error
      if (!allowMissing) throw new WhiteboardError(404, `Whiteboard not found: ${raw}`)
      const ancestor = await existingAncestor(directory)
      canonicalDirectory = path.resolve(await realpath(ancestor), path.relative(ancestor, directory))
    }
    assertInside(root, canonicalDirectory, true)
    const resolved = path.join(canonicalDirectory, path.basename(target))
    try {
      const info = await lstat(resolved)
      if (info.isSymbolicLink() || !info.isFile()) throw new WhiteboardError(400, 'The whiteboard path must be a regular file, not a symbolic link')
    } catch (error) { if (!missing(error)) throw error }
    return resolved
  }

  async read(file: string): Promise<Whiteboard> {
    return this.serial(file, () => this.readFile(file))
  }

  async write(file: string, value: unknown, source: 'agent' | 'user', owner: string): Promise<Whiteboard> {
    const parsed = whiteboardWriteSchema.safeParse(value)
    if (!parsed.success) throw new WhiteboardError(400, parsed.error.message)
    return this.serial(file, async () => {
      const input = parsed.data
      let previous: Whiteboard
      let exists = true
      try { previous = await this.readFile(file) } catch (error) {
        if (!(error instanceof WhiteboardError && error.statusCode === 404)) throw error
        exists = false
        previous = { v: 1, title: path.basename(file, '.board.json'), revision: 0, order: [], elements: {} }
      }
      const next = applyOperations(previous, input)
      const changed = !exists || input.title !== undefined && input.title !== previous.title || JSON.stringify(next.elements) !== JSON.stringify(previous.elements) || JSON.stringify(next.order) !== JSON.stringify(previous.order)
      if (changed) {
        next.revision = previous.revision + 1
        const content = JSON.stringify(next, null, 2) + '\n'
        if (Buffer.byteLength(content) > MAX_BOARD_BYTES) throw new WhiteboardError(413, 'Whiteboard exceeds 4 MiB')
        const temporary = `${file}.${randomUUID()}.tmp`
        try {
          const handle = await open(temporary, 'wx', 0o600)
          try { await handle.writeFile(content, 'utf8'); await handle.sync() } finally { await handle.close() }
          await rename(temporary, file)
        } finally { await rm(temporary, { force: true }) }
        this.broadcast(file, { type: 'change', path: file, revision: next.revision, title: next.title, order: next.order, ops: diff(previous, next), source })
      }
      if (input.claim !== undefined) {
        const claims = this.claims.get(file) ?? new Map<string, { claim: WhiteboardClaim; expires: number }>()
        if (input.claim === null) claims.delete(owner)
        else claims.set(owner, { claim: input.claim, expires: Date.now() + 60_000 })
        if (claims.size) this.claims.set(file, claims)
        else this.claims.delete(file)
        this.broadcast(file, this.presence(file))
      }
      return next
    })
  }

  /** Subscribe before reading: snapshot and queued changes remain revision-ordered. */
  subscribe(file: string, listener: Listener): () => void {
    const listeners = this.listeners.get(file) ?? new Set<Listener>()
    listeners.add(listener); this.listeners.set(file, listeners)
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(file) }
  }

  updateContext(file: string, id: string, context: WhiteboardContext | null): void {
    const contexts = this.contexts.get(file) ?? new Map<string, WhiteboardContext>()
    if (context === null) contexts.delete(id)
    else contexts.set(id, context)
    if (contexts.size) this.contexts.set(file, contexts)
    else this.contexts.delete(file)
    this.broadcast(file, this.presence(file))
  }

  presence(file: string): Extract<WhiteboardEvent, { type: 'presence' }> {
    const claims = this.claims.get(file)
    if (claims) {
      for (const [owner, entry] of claims) if (entry.expires <= Date.now()) claims.delete(owner)
      if (!claims.size) this.claims.delete(file)
    }
    return { type: 'presence', contexts: Array.from(this.contexts.get(file) ?? [], ([id, context]) => ({ id, ...context })), claims: Array.from(claims?.values() ?? [], (entry) => entry.claim) }
  }

  private broadcast(file: string, event: WhiteboardEvent): void {
    for (const listener of this.listeners.get(file) ?? []) listener(event)
  }

  private async readFile(file: string): Promise<Whiteboard> {
    let content: string
    try {
      const info = await lstat(file)
      if (!info.isFile() || info.isSymbolicLink()) throw new WhiteboardError(400, 'Whiteboard must be a regular file')
      if (info.size > MAX_BOARD_BYTES) throw new WhiteboardError(413, 'Whiteboard exceeds 4 MiB')
      content = await readFile(file, 'utf8')
    } catch (error) {
      if (missing(error)) throw new WhiteboardError(404, `Whiteboard not found: ${file}`)
      throw error
    }
    try {
      const board = whiteboardSchema.parse(JSON.parse(content) as unknown)
      validateWhiteboard(board)
      return board
    } catch (error) { throw new WhiteboardError(400, `Invalid whiteboard file: ${error instanceof Error ? error.message : String(error)}`) }
  }

  private async serial<T>(file: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(file) ?? Promise.resolve()
    const pending = previous.then(operation, operation)
    this.queues.set(file, pending)
    try { return await pending } finally { if (this.queues.get(file) === pending) this.queues.delete(file) }
  }
}

function applyOperations(previous: Whiteboard, input: WhiteboardWrite): Whiteboard {
  const board = structuredClone(previous)
  if (input.title !== undefined) board.title = input.title
  for (const operation of input.ops) {
    const current = board.elements[operation.id]
    if (operation.op === 'set') {
      if (!current) board.order.push(operation.id)
      board.elements[operation.id] = operation.element
    } else if (operation.op === 'update') {
      if (!current) throw new WhiteboardError(400, `Cannot update missing element ${operation.id}`)
      // Parsing after the complete batch permits forward arrow and parent refs.
      board.elements[operation.id] = { ...current, ...operation.patch }
    } else {
      if (!current) continue
      for (const [id, child] of Object.entries(board.elements)) {
        if (child.type === 'arrow' && (child.from === operation.id || child.to === operation.id)) {
          Reflect.deleteProperty(board.elements, id); board.order = board.order.filter((key) => key !== id)
        } else if (child.type !== 'arrow' && child.parentId === operation.id && current.type !== 'arrow') {
          child.x += current.x; child.y += current.y
          if (current.parentId) child.parentId = current.parentId
          else delete child.parentId
        }
      }
      Reflect.deleteProperty(board.elements, operation.id)
      board.order = board.order.filter((key) => key !== operation.id)
    }
  }
  const parsed = whiteboardSchema.safeParse(board)
  if (!parsed.success) throw new WhiteboardError(400, parsed.error.message)
  validateWhiteboard(parsed.data)
  return parsed.data
}

function diff(previous: Whiteboard, next: Whiteboard): WhiteboardOperation[] {
  const ops: WhiteboardOperation[] = previous.order.filter((id) => !Object.hasOwn(next.elements, id)).map((id) => ({ op: 'delete', id }))
  for (const id of next.order) {
    const element = next.elements[id]
    if (element && JSON.stringify(element) !== JSON.stringify(previous.elements[id])) ops.push({ op: 'set', id, element })
  }
  return ops
}

function isInside(root: string, target: string, allowRoot = false): boolean {
  const relative = path.relative(root, target)
  return (allowRoot || relative !== '') && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
function assertInside(root: string, target: string, allowRoot = false): void {
  if (!isInside(root, target, allowRoot)) throw new WhiteboardError(403, 'Whiteboard path must stay inside the workspace')
}
function missing(error: unknown): boolean { return error instanceof Error && 'code' in error && error.code === 'ENOENT' }

async function existingDirectory(directory: string): Promise<string> {
  try { return await realpath(directory) } catch (error) {
    if (!missing(error)) throw error
    const parent = path.dirname(directory)
    if (parent === directory) throw error
    return existingDirectory(parent)
  }
}

async function existingAncestor(directory: string): Promise<string> {
  try { await realpath(directory); return directory } catch (error) {
    if (!missing(error)) throw error
    const parent = path.dirname(directory)
    if (parent === directory) throw error
    return existingAncestor(parent)
  }
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code < 32 || code === 127) return true
  }
  return false
}
