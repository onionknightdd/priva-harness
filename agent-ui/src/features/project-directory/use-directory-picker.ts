import * as React from "react"

import {
  emptyFileBrowserModel,
  getFileBrowserBreadcrumb,
  mergeDirectoryListing,
  type FileBrowserModel,
} from "@/features/file-browser/file-browser-data"
import {
  createDirectory,
  listDirectory,
  type FileSystemDirectory,
} from "@/lib/api/sandbox-files"

type RequestScope = {
  controller: AbortController
  cache: Map<string, FileSystemDirectory>
  requests: Map<string, Promise<FileSystemDirectory>>
  navigation: number
}

type DirectoryError = { path: string | undefined; message: string }

// A verified absolute path gives us its ancestors even when a parent cannot be
// listed. Keep that path reachable while loading the rest of the directory tree.
function revealPath(model: FileBrowserModel, path: string): FileBrowserModel {
  const items = { ...model.items }
  const childrenByPath = { ...model.childrenByPath }
  const chain = getFileBrowserBreadcrumb(path)
  chain.forEach((entry, index) => {
    const parentPath = chain[index - 1]?.path ?? null
    items[entry.path] ??= {
      path: entry.path, name: entry.name, type: "folder", parentPath,
      size: null, modifiedAt: null, permissions: null,
    }
    if (parentPath && !childrenByPath[parentPath]?.includes(entry.path)) {
      childrenByPath[parentPath] = [...(childrenByPath[parentPath] ?? []), entry.path]
    }
  })
  return { items, childrenByPath }
}

export function useDirectoryPicker(open: boolean, initialPath: string) {
  const scopeRef = React.useRef<RequestScope | null>(null)
  const [model, setModel] = React.useState(emptyFileBrowserModel)
  const [rootPath, setRootPath] = React.useState<string | null>(null)
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null)
  const [loadingDirectories, setLoadingDirectories] = React.useState(new Set<string>())
  const [navigating, setNavigating] = React.useState(false)
  const [confirming, setConfirming] = React.useState(false)
  const [error, setError] = React.useState<DirectoryError | null>(null)

  const loadDirectory = React.useCallback((scope: RequestScope, path?: string, fresh = false) => {
    const key = path ?? ""
    const pending = scope.requests.get(key)
    if (pending) return pending
    const cached = scope.cache.get(key)
    if (cached && !fresh) return Promise.resolve(cached)

    setLoadingDirectories((current) => new Set(current).add(key))
    const request = listDirectory(path, scope.controller.signal)
      .then((directory) => {
        if (scopeRef.current !== scope) return directory
        scope.cache.set(key, directory)
        scope.cache.set(directory.path, directory)
        setModel((current) => mergeDirectoryListing(current, {
          ...directory,
          entries: directory.entries.filter((entry) => entry.type === "directory"),
        }))
        setError((current) => current?.path === path ? null : current)
        return directory
      })
      .catch((caught: unknown) => {
        if (scopeRef.current === scope && !scope.controller.signal.aborted) {
          setError({ path, message: caught instanceof Error ? caught.message : String(caught) })
        }
        throw caught
      })
      .finally(() => {
        scope.requests.delete(key)
        if (scopeRef.current !== scope) return
        setLoadingDirectories((current) => {
          const next = new Set(current)
          next.delete(key)
          return next
        })
      })
    scope.requests.set(key, request)
    return request
  }, [])

  const navigateTo = React.useCallback(async (path?: string) => {
    const scope = scopeRef.current
    if (!scope) return false
    const navigation = ++scope.navigation
    setNavigating(true)
    setError(null)
    try {
      const directory = await loadDirectory(scope, path?.trim() || undefined, true)
      if (scopeRef.current !== scope || scope.navigation !== navigation) return false
      setModel((current) => revealPath(current, directory.path))
      const chain = getFileBrowserBreadcrumb(directory.path)
      setRootPath(chain[0]?.path ?? directory.path)
      setSelectedPath(directory.path)
      // Parent listing failures are reported by loadDirectory; they do not make
      // the already verified destination unusable.
      await Promise.allSettled(chain.slice(0, -1).map((entry) => loadDirectory(scope, entry.path)))
      return scopeRef.current === scope && scope.navigation === navigation
    } catch {
      return false
    } finally {
      if (scopeRef.current === scope && scope.navigation === navigation) setNavigating(false)
    }
  }, [loadDirectory])

  React.useEffect(() => {
    if (!open) return
    const scope: RequestScope = {
      controller: new AbortController(), cache: new Map(), requests: new Map(), navigation: 0,
    }
    scopeRef.current = scope
    setModel(emptyFileBrowserModel)
    setRootPath(null)
    setSelectedPath(null)
    setLoadingDirectories(new Set())
    setConfirming(false)
    void navigateTo(initialPath)
    return () => {
      scopeRef.current = null
      scope.controller.abort()
    }
  }, [open, initialPath, navigateTo])

  const expandDirectory = React.useCallback((path: string) => {
    const scope = scopeRef.current
    if (scope) void loadDirectory(scope, path).catch(() => { /* displayed in the dialog */ })
  }, [loadDirectory])

  const selectDirectory = React.useCallback(async (path: string) => {
    const scope = scopeRef.current
    if (!scope) return
    ++scope.navigation
    setNavigating(false)
    setError(null)
    setSelectedPath(path)
    try {
      await loadDirectory(scope, path)
    } catch { /* displayed in the dialog; Use revalidates the selected directory */ }
  }, [loadDirectory])

  const makeDirectory = React.useCallback(async (parent: string, name: string) => {
    const scope = scopeRef.current
    if (!scope) return
    const created = await createDirectory(parent, name)
    if (scopeRef.current !== scope) return
    setModel((current) => revealPath(current, created.path))
    setSelectedPath(created.path)
    // Creation is complete even if refreshing fails. Surface the read error
    // outside the create dialog so retry cannot accidentally repeat mkdir.
    await Promise.allSettled([
      loadDirectory(scope, parent, true),
      loadDirectory(scope, created.path, true),
    ])
  }, [loadDirectory])

  const confirmSelection = React.useCallback(async () => {
    const scope = scopeRef.current
    if (!scope || !selectedPath) return null
    setConfirming(true)
    try {
      const directory = await loadDirectory(scope, selectedPath, true)
      return scopeRef.current === scope ? directory.path : null
    } catch {
      return null
    } finally {
      if (scopeRef.current === scope) setConfirming(false)
    }
  }, [loadDirectory, selectedPath])

  const retry = React.useCallback(async () => {
    const scope = scopeRef.current
    if (!scope) return
    if (!rootPath) {
      await navigateTo(initialPath)
    } else if (error) {
      try { await loadDirectory(scope, error.path, true) } catch { /* displayed in the dialog */ }
    }
  }, [error, initialPath, loadDirectory, navigateTo, rootPath])

  return {
    model, rootPath, selectedPath, loadingDirectories, navigating, confirming, error,
    navigateTo, expandDirectory, selectDirectory, makeDirectory, confirmSelection, retry,
  }
}
