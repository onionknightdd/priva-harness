import { SandboxFilesApiError, previewFile } from "@/lib/api/sandbox-files"

const existenceCache = new Map<string, boolean>()
const existenceInflight = new Map<string, Promise<boolean>>()

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

  const request = previewFile(path)
    .then(() => true)
    .catch((error: unknown) => {
      if (error instanceof SandboxFilesApiError && error.status === 403) {
        return true
      }
      return false
    })
    .then((exists) => {
      existenceCache.set(path, exists)
      existenceInflight.delete(path)
      return exists
    })

  existenceInflight.set(path, request)
  return request
}
