import * as React from "react"

import { errorMessage, resourceRequest, type ResourceQuery } from "./resource-api"

type ResourceState<T> = { data: T | null; loading: boolean; error: string | null }
export type ResourceCache<T> = Map<string, { promise: Promise<T>; state: ResourceState<T> }>

export function createResourceCache<T>(): ResourceCache<T> {
  return new Map()
}

export function useResource<T>(
  path: string | null,
  query: ResourceQuery,
  revision: number,
  cache?: ResourceCache<T>,
) {
  const [result, setResult] = React.useState<{
    path: string; query: ResourceQuery; revision: number; cache: ResourceCache<T> | undefined; state: ResourceState<T>
  } | null>(null)
  React.useEffect(() => {
    if (!path) return
    const controller = new AbortController()
    let entry = cache?.get(path)
    if (!entry) {
      // Expanded trees and the detail pane share the request. Unmounting one
      // consumer must not abort the response for the others.
      entry = {
        promise: resourceRequest<T>(path, query, cache ? undefined : { signal: controller.signal }),
        state: { data: null, loading: true, error: null },
      }
      cache?.set(path, entry)
    }
    const request = entry
    if (request.state.loading) void request.promise.then(
      (data) => {
        request.state = { data, loading: false, error: null }
        if (!controller.signal.aborted) React.startTransition(() => setResult({ path, query, revision, cache, state: request.state }))
      },
      (error: unknown) => {
        request.state = { data: null, loading: false, error: errorMessage(error) }
        if (cache?.get(path) === request) cache.delete(path)
        if (!controller.signal.aborted) React.startTransition(() => setResult({ path, query, revision, cache, state: request.state }))
      },
    )
    return () => controller.abort()
  }, [path, query, revision, cache])
  if (!path) return { data: null, loading: false, error: null }
  // Read settled cache entries during render. A cache hit must never replace
  // the preview with loading or briefly display the previous resource.
  const cached = cache?.get(path)
  if (cached) return cached.state
  if (result?.path === path && result.query === query && result.revision === revision && result.cache === cache) return result.state
  return { data: null, loading: true, error: null }
}
