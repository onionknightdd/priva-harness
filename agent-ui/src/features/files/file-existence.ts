import { FILES_EXIST_MAX_PATHS, filesExist } from "@/lib/api/sandbox-files"

const existenceCache = new Map<string, boolean>()
const existenceInflight = new Map<string, Promise<boolean>>()

// A transcript mounts every file link in one commit, so their checks arrive
// within the same microtask. Collect them and ask the server once.
let pendingPaths: string[] = []
// Resolving hundreds of links in one task re-renders them in one long frame;
// hand the answers out in slices so the browser can paint in between.
const RESOLVE_SLICE = 40
let pendingResolvers = new Map<string, (exists: boolean) => void>()
let flushQueued = false

export function peekFileExists(path: string) {
  return existenceCache.get(path)
}

export function rememberFileExists(path: string, exists: boolean) {
  existenceCache.set(path, exists)
}

export function invalidateFileExists(path: string) {
  existenceCache.delete(path)
}

export function checkFileExists(path: string) {
  if (path.trim() === "") {
    return Promise.resolve(false)
  }

  const cached = existenceCache.get(path)
  if (cached !== undefined) {
    return Promise.resolve(cached)
  }

  const pending = existenceInflight.get(path)
  if (pending) {
    return pending
  }

  const request = new Promise<boolean>((resolve) => {
    pendingPaths.push(path)
    pendingResolvers.set(path, resolve)
  }).then((exists) => {
    existenceCache.set(path, exists)
    existenceInflight.delete(path)
    return exists
  })

  existenceInflight.set(path, request)
  scheduleFlush()
  return request
}

function scheduleFlush() {
  if (flushQueued) return
  flushQueued = true
  queueMicrotask(() => {
    flushQueued = false
    const paths = pendingPaths
    const resolvers = pendingResolvers
    pendingPaths = []
    pendingResolvers = new Map()
    for (let start = 0; start < paths.length; start += FILES_EXIST_MAX_PATHS) {
      void sendBatch(paths.slice(start, start + FILES_EXIST_MAX_PATHS), resolvers)
    }
  })
}

async function sendBatch(
  paths: readonly string[],
  resolvers: ReadonlyMap<string, (exists: boolean) => void>
) {
  let result: Record<string, boolean> = {}
  try {
    result = await filesExist(paths)
  } catch {
    // An unreachable server means no link can be confirmed; the caller shows
    // plain text, exactly as a failed preview request did before.
  }
  for (let start = 0; start < paths.length; start += RESOLVE_SLICE) {
    if (start > 0) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    for (const path of paths.slice(start, start + RESOLVE_SLICE)) {
      resolvers.get(path)?.(result[path] === true)
    }
  }
}
