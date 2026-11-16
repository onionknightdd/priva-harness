/** Fail a control request the CLI never answers instead of waiting on it forever. */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

/** Consume a query that is only used for control requests until it closes. */
export async function drainQuery(active: AsyncIterable<unknown>): Promise<void> {
  try {
    for await (const _message of active) {
      void _message
    }
  } catch {
    return
  }
}
