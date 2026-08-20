function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"))
      return
    }

    const timeoutId = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)

    const onAbort = () => {
      window.clearTimeout(timeoutId)
      reject(new DOMException("Aborted", "AbortError"))
    }

    signal.addEventListener("abort", onAbort, { once: true })
  })
}

export async function streamText({
  text,
  onUpdate,
  signal,
  startDelayMs = 0,
  intervalMs = 22,
  charsPerTick = 2,
}: {
  text: string
  onUpdate: (visibleText: string) => void
  signal: AbortSignal
  startDelayMs?: number
  intervalMs?: number
  charsPerTick?: number
}) {
  if (prefersReducedMotion() || text.length === 0) {
    onUpdate(text)
    return
  }

  if (startDelayMs > 0) {
    await delay(startDelayMs, signal)
  }

  for (let index = 0; index < text.length; index += charsPerTick) {
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError")
    }

    const nextIndex = Math.min(text.length, index + charsPerTick)
    onUpdate(text.slice(0, nextIndex))

    if (nextIndex < text.length) {
      await delay(intervalMs, signal)
    }
  }
}

export { isAbortError }
