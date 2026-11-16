/**
 * A map that keeps only its most recently written keys. Writing a key makes
 * it the newest; once the limit is exceeded the oldest key is dropped. Use it
 * for per-item bookkeeping that is only consulted while the item is current.
 */
export class RecentMap<K, V> {
  private readonly entries = new Map<K, V>()

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('limit must be a positive integer')
  }

  get size(): number {
    return this.entries.size
  }

  get(key: K): V | undefined {
    return this.entries.get(key)
  }

  has(key: K): boolean {
    return this.entries.has(key)
  }

  set(key: K, value: V): void {
    this.entries.delete(key)
    this.entries.set(key, value)
    if (this.entries.size <= this.limit) return
    const oldest = this.entries.keys().next()
    if (!oldest.done) this.entries.delete(oldest.value)
  }
}
