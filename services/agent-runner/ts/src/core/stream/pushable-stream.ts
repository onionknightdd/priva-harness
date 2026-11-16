export class PushableStream<T> implements AsyncIterable<T> {
  private readonly items: T[] = []
  private readonly waiters: ((result: IteratorResult<T>) => void)[] = []
  private closed = false
  private iterating = false

  push(value: T): void {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter !== undefined) {
      waiter({ value, done: false })
      return
    }
    this.items.push(value)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const waiter of this.waiters) {
      waiter({ value: undefined, done: true })
    }
    this.waiters.length = 0
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    if (this.iterating) {
      throw new Error('PushableStream can only be iterated once')
    }
    this.iterating = true
    return {
      next: async (): Promise<IteratorResult<T>> => {
        const buffered = this.items.shift()
        if (buffered !== undefined) return { value: buffered, done: false }
        if (this.closed) return { value: undefined, done: true }
        return await new Promise((resolve) => {
          this.waiters.push(resolve)
        })
      },
      // A consumer that stops reading ends the stream, so later pushes are
      // dropped instead of buffering for a reader that will never return.
      return: (): Promise<IteratorResult<T>> => {
        this.close()
        this.items.length = 0
        return Promise.resolve({ value: undefined, done: true })
      },
    }
  }
}
