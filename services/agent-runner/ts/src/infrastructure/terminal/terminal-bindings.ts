import { createHash, randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

/** Native /clear changes the session key, while sockets and hook paths stay put. */
export class TerminalBindings {
  private bindings: Record<string, string> | undefined
  private pending = Promise.resolve()
  constructor(private readonly root: string) {}

  async directory(key: string, create = false): Promise<string | undefined> {
    await this.pending
    const entries = await this.read()
    const existing = entries[key]
    if (existing || !create) return existing
    return this.update((current) => {
      if (current[key]) return current[key]
      let directory = hash(key)
      if (Object.values(current).includes(directory)) directory = hash(randomUUID())
      current[key] = directory
      return directory
    })
  }

  async keyFor(directory: string): Promise<string | undefined> {
    await this.pending
    return Object.entries(await this.read()).find(([, value]) => value === directory)?.[0]
  }

  async rebind(from: string, to: string): Promise<void> {
    await this.update((entries) => {
      if (from === to) return
      if (!entries[from]) throw new Error('Terminal binding is missing')
      if (entries[to]) throw new Error('The target session already has a terminal')
      entries[to] = entries[from]
      Reflect.deleteProperty(entries, from)
    })
  }

  async remove(directory: string): Promise<void> {
    await this.update((entries) => {
      for (const [key, value] of Object.entries(entries)) if (value === directory) Reflect.deleteProperty(entries, key)
    })
  }

  private async read(): Promise<Record<string, string>> {
    if (this.bindings) return this.bindings
    try {
      const parsed = z.record(z.string(), z.string().regex(/^[a-f0-9]{24}$/u)).parse(JSON.parse(await readFile(join(this.root, 'bindings.json'), 'utf8')) as unknown)
      return this.bindings ??= parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return this.bindings ??= {}
    }
  }

  private update<T>(change: (entries: Record<string, string>) => T): Promise<T> {
    const operation = this.pending.then(async () => {
      const entries = { ...await this.read() }
      const result = change(entries)
      await mkdir(this.root, { recursive: true, mode: 0o700 })
      const path = join(this.root, 'bindings.json'), temp = `${path}.${randomUUID()}.tmp`
      try {
        await writeFile(temp, JSON.stringify(entries), { mode: 0o600 })
        await rename(temp, path)
        this.bindings = entries
      } finally { await rm(temp, { force: true }) }
      return result
    })
    // Failed callers retain their error; later binding changes may retry.
    this.pending = operation.then(() => undefined, () => undefined)
    return operation
  }
}

function hash(key: string): string { return createHash('sha256').update(key).digest('hex').slice(0, 24) }
