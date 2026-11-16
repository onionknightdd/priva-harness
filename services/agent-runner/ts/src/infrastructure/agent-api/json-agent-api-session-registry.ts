import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import { hasPrefix } from '../../core/agent-api/ids.js'
import { sessionSettingsSchema } from '../../core/agent-api/objects.js'
import { RUN_MODES } from '../../core/resource/session.js'
import type {
  AgentApiSessionPatch,
  AgentApiSessionRecord,
  AgentApiSessionRegistry,
} from '../../core/contract/agent-api-session-registry.js'

const SESSION_FILE = 'session.json'

const storedSessionSchema = z.strictObject({
  version: z.literal(1),
  id: z.string().refine((id) => hasPrefix(id, 'ses')),
  harness: z.enum(['claude', 'pi']),
  workdir: z.string(),
  runMode: z.enum(RUN_MODES).optional(),
  nativeId: z.string().min(1).nullable(),
  settings: sessionSettingsSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

/** One directory per platform session; the event log and run index live beside it. */
export class JsonAgentApiSessionRegistry implements AgentApiSessionRegistry {
  private readonly records = new Map<string, AgentApiSessionRecord>()
  private loaded: Promise<void> | undefined
  private writes = Promise.resolve()

  constructor(private readonly root: string) {}

  sessionDirectory(id: string): string {
    if (!hasPrefix(id, 'ses') || !/^[0-9A-Za-z_]+$/u.test(id)) throw new Error(`Invalid session ID: ${id}`)
    return join(this.root, id)
  }

  async create(record: AgentApiSessionRecord): Promise<void> {
    await this.load()
    if (this.records.has(record.id)) throw new Error(`Session ${record.id} already exists`)
    this.records.set(record.id, record)
    await this.persist(record)
  }

  async get(id: string): Promise<AgentApiSessionRecord | undefined> {
    await this.load()
    return this.records.get(id)
  }

  async list(): Promise<readonly AgentApiSessionRecord[]> {
    await this.load()
    return [...this.records.values()]
  }

  async update(id: string, patch: AgentApiSessionPatch): Promise<AgentApiSessionRecord> {
    await this.load()
    const current = this.records.get(id)
    if (current === undefined) throw new Error(`Session ${id} does not exist`)
    const next = { ...current, ...patch }
    this.records.set(id, next)
    await this.persist(next)
    return next
  }

  async delete(id: string): Promise<void> {
    await this.load()
    this.records.delete(id)
    await this.enqueue(() => rm(this.sessionDirectory(id), { recursive: true, force: true }))
  }

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      await mkdir(this.root, { recursive: true, mode: 0o700 })
      for (const entry of await readdir(this.root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !hasPrefix(entry.name, 'ses')) continue
        let raw: string
        try {
          raw = await readFile(join(this.root, entry.name, SESSION_FILE), 'utf8')
        } catch (error) {
          // A directory without a record is an interrupted create; it has no session to restore.
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
          throw error
        }
        const stored = storedSessionSchema.parse(JSON.parse(raw))
        this.records.set(stored.id, {
          id: stored.id, harness: stored.harness, workdir: stored.workdir, nativeId: stored.nativeId,
          ...(stored.runMode === undefined ? {} : { runMode: stored.runMode }),
          settings: stored.settings, createdAt: stored.createdAt, updatedAt: stored.updatedAt,
        })
      }
    })()
    return this.loaded
  }

  private persist(record: AgentApiSessionRecord): Promise<void> {
    return this.enqueue(async () => {
      const directory = this.sessionDirectory(record.id)
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const target = join(directory, SESSION_FILE)
      const temporary = `${target}.tmp`
      await writeFile(temporary, `${JSON.stringify({ version: 1, ...record }, null, 2)}\n`, { mode: 0o600 })
      await rename(temporary, target)
    })
  }

  private enqueue(write: () => Promise<void>): Promise<void> {
    const next = this.writes.then(write)
    this.writes = next.catch(() => undefined)
    return next
  }
}
