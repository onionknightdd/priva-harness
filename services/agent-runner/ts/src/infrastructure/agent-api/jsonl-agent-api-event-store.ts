import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { durableEventSchema, type DurableEvent, type DurableEventDraft } from '../../core/agent-api/events.js'
import { hasPrefix } from '../../core/agent-api/ids.js'
import type {
  AgentApiEventLog,
  AgentApiEventStore,
  AgentApiProjectionState,
} from '../../core/contract/agent-api-event-store.js'

const EVENTS_FILE = 'events.jsonl'
const STATE_FILE = 'projection.json'

export interface EventRetention {
  readonly maxEvents: number
  readonly maxAgeMs: number
}

export const DEFAULT_EVENT_RETENTION: EventRetention = { maxEvents: 10_000, maxAgeMs: 7 * 24 * 60 * 60 * 1000 }

/** Files live in the session directory shared with the registry record. */
export class JsonlAgentApiEventStore implements AgentApiEventStore {
  private readonly logs = new Map<string, Promise<JsonlEventLog>>()

  constructor(private readonly root: string, private readonly retention: EventRetention = DEFAULT_EVENT_RETENTION) {}

  openLog(sessionId: string): Promise<AgentApiEventLog> {
    let log = this.logs.get(sessionId)
    if (log === undefined) {
      log = JsonlEventLog.open(this.directory(sessionId), this.retention)
      this.logs.set(sessionId, log)
      log.catch(() => this.logs.delete(sessionId))
    }
    return log
  }

  async loadState(sessionId: string): Promise<AgentApiProjectionState> {
    try {
      return JSON.parse(await readFile(join(this.directory(sessionId), STATE_FILE), 'utf8')) as AgentApiProjectionState
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { runs: [], memory: null }
      throw error
    }
  }

  async saveState(sessionId: string, state: AgentApiProjectionState): Promise<void> {
    const directory = this.directory(sessionId)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const target = join(directory, STATE_FILE)
    await writeFile(`${target}.tmp`, JSON.stringify(state), { mode: 0o600 })
    await rename(`${target}.tmp`, target)
  }

  private directory(sessionId: string): string {
    if (!hasPrefix(sessionId, 'ses') || !/^[0-9A-Za-z_]+$/u.test(sessionId)) throw new Error(`Invalid session ID: ${sessionId}`)
    return join(this.root, sessionId)
  }
}

class JsonlEventLog implements AgentApiEventLog {
  private writes = Promise.resolve()
  // A lost append would leave a gap in seq; every later use reports it instead.
  private failure: unknown

  private constructor(
    private readonly path: string,
    private readonly retention: EventRetention,
    private last: number,
    private first: number,
    /** Lines currently in the file; pruning compares against what was actually written. */
    private stored: number,
  ) {}

  static async open(directory: string, retention: EventRetention): Promise<JsonlEventLog> {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const path = join(directory, EVENTS_FILE)
    const events = await readEvents(path)
    const last = events.at(-1)?.seq ?? 0
    return new JsonlEventLog(path, retention, last, events[0]?.seq ?? last + 1, events.length)
  }

  get lastSeq(): number { return this.last }
  get firstSeq(): number { return this.first }

  append(drafts: readonly DurableEventDraft[]): DurableEvent[] {
    this.throwIfFailed()
    if (drafts.length === 0) return []
    const createdAt = new Date().toISOString()
    const empty = this.first > this.last
    const events: DurableEvent[] = drafts.map((draft) => ({ seq: ++this.last, created_at: createdAt, ...draft }))
    if (empty) this.first = events[0]?.seq ?? this.first
    const lines = events.map((event) => `${JSON.stringify(event)}\n`).join('')
    this.enqueue(async () => {
      await appendFile(this.path, lines, { mode: 0o600 })
      this.stored += events.length
      // Prune in batches rather than on every append once the limit is reached.
      if (this.stored > this.retention.maxEvents * 1.2) await this.prune()
    })
    return events
  }

  async read(afterSeq: number): Promise<readonly DurableEvent[]> {
    await this.flush()
    return (await readEvents(this.path)).filter((event) => event.seq > afterSeq)
  }

  async flush(): Promise<void> {
    await this.writes
    this.throwIfFailed()
  }

  private async prune(): Promise<void> {
    const oldest = new Date(Date.now() - this.retention.maxAgeMs).toISOString()
    const kept = (await readEvents(this.path)).slice(-this.retention.maxEvents).filter((event) => event.created_at >= oldest)
    await writeFile(`${this.path}.tmp`, kept.map((event) => `${JSON.stringify(event)}\n`).join(''), { mode: 0o600 })
    await rename(`${this.path}.tmp`, this.path)
    this.stored = kept.length
    this.first = kept[0]?.seq ?? this.last + 1
  }

  private enqueue(write: () => Promise<void>): void {
    this.writes = this.writes.then(async () => { if (this.failure === undefined) await write() })
      .catch((error: unknown) => { this.failure = error })
  }

  private throwIfFailed(): void {
    if (this.failure !== undefined) throw new Error('The Agent API event log could not be written', { cause: this.failure })
  }
}

async function readEvents(path: string): Promise<DurableEvent[]> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return text.split('\n').filter((line) => line !== '').map((line) => durableEventSchema.parse(JSON.parse(line)))
}
