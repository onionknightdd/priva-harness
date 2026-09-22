export type GitStatus = {
  cwd: string
  root: string | null
  branch: string | null
  commit: string | null
}

export async function readGitStatus(cwd: string, signal: AbortSignal): Promise<GitStatus> {
  const response = await fetch(`/api/sandbox/git/status?${new URLSearchParams({ cwd })}`, {
    cache: "no-store",
    signal,
  })
  if (!response.ok) {
    let detail = response.statusText || `HTTP ${response.status}`
    try {
      const payload: { detail?: string } = await response.json()
      if (payload.detail) detail = payload.detail
    } catch {
      // A proxy may return HTML instead of the runner's JSON error response.
    }
    throw new Error(detail)
  }
  return response.json()
}
