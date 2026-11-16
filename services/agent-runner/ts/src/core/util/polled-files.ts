import { readFile, stat } from 'node:fs/promises'

import { RecentMap } from './recent-map.js'

// File timestamps can be coarser than the gap between two writes, so a file
// modified this recently is read again even when it looks unchanged.
const SETTLE_MS = 1000

interface PolledFile {
  readonly stamp: string
  readonly value: unknown
}

/**
 * Parsed contents of small files that are polled far more often than they
 * change. An unchanged file costs one stat; it is read and parsed again only
 * after it was replaced or rewritten. Callers share the parsed value, so it
 * must be treated as read-only.
 */
export class PolledFiles {
  private readonly files: RecentMap<string, PolledFile>

  constructor(limit = 1024) {
    this.files = new RecentMap(limit)
  }

  /** Rejects as `stat` and `readFile` do, including when the file is missing. */
  async read<T>(path: string, parse: (text: string) => T): Promise<T> {
    const stats = await stat(path)
    const stamp = `${String(stats.ino)}:${String(stats.size)}:${String(stats.mtimeMs)}:${String(stats.ctimeMs)}`
    const known = this.files.get(path)
    if (known?.stamp === stamp && Date.now() - stats.mtimeMs > SETTLE_MS) return known.value as T
    // A write between the stat and this read is stored under the older stamp,
    // so the next poll sees a different stamp and reads the file again.
    const value = parse(await readFile(path, 'utf8'))
    this.files.set(path, { stamp, value })
    return value
  }
}
