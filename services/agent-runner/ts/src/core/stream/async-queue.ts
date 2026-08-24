export class AsyncQueue<T> {
  private readonly items: T[] = []
  private readonly waiters: ((item: T | undefined) => void)[] = []
  private closed = false

  push(item: T): void {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter !== undefined) {
      waiter(item)
      return
    }
    this.items.push(item)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const waiter of this.waiters) waiter(undefined)
    this.waiters.length = 0
  }

  async *iterate(): AsyncIterable<T> {
    while (!this.closed || this.items.length > 0) {
      const buffered = this.items.shift()
      if (buffered !== undefined) {
        yield buffered
        continue
      }
      if (this.closed) break
      const next = await new Promise<T | undefined>((resolve) => {
        this.waiters.push(resolve)
      })
      if (next === undefined) break
      yield next
    }
  }
}
