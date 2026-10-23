import type { SessionInfo } from "../../../../src/lib/api/sandbox-sessions"

export const fixtureCwd = "/session-pin-fixtures/alpha"
export const longTitle = "A long session title that must stay clear of the tag, pin, and more actions"

function session(sessionId: string, lastModified: number, customTitle: string, pinned = false): SessionInfo {
  return { sessionId, lastModified, customTitle, pinned, summary: "", firstPrompt: null,
    cwd: fixtureCwd, tag: null, tags: [], tagColors: {}, archived: false, runMode: "agent" }
}

function initialSessions(): SessionInfo[] {
  return [
    session("old-pinned", 10, "Old pinned session", true),
    session("recent-1", 700, "Recent session 1"),
    session("recent-2", 600, longTitle),
    session("recent-3", 500, "Recent session 3"),
    session("recent-4", 400, "Recent session 4"),
    session("recent-5", 300, "Recent session 5"),
    session("recent-6", 200, "Recent session 6"),
  ]
}

function responseSession(value: SessionInfo) {
  return { session_id: value.sessionId, last_modified: value.lastModified,
    custom_title: value.customTitle, pinned: value.pinned, summary: value.summary,
    first_prompt: value.firstPrompt, cwd: value.cwd, tag: value.tag, tags: value.tags,
    tag_colors: value.tagColors, archived: value.archived, run_mode: value.runMode }
}

/** Every API call in this page stays in memory, including unexpected calls. */
export function installSessionPinFixtures() {
  const originalFetch = window.fetch
  let sessions = initialSessions()
  const requests: { method: string; path: string; pinned?: boolean }[] = []
  const unexpected: string[] = []
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href)
    if (!url.pathname.startsWith("/api/")) return originalFetch(input, init)
    const method = init?.method ?? (input instanceof Request ? input.method : "GET")
    const request: typeof requests[number] = { method, path: url.pathname }
    requests.push(request)
    if (url.pathname === "/api/sandbox/agent/profile" && method === "GET") {
      return Response.json({ queue_behavior: "follow-up" })
    }
    if (url.pathname === "/api/sandbox/agent/sessions/running" && method === "GET") {
      return Response.json({ running: [], warm: [], background: [] })
    }
    if (url.pathname === "/api/sandbox/agent/sessions" && method === "GET") {
      return Response.json({ active_cwd: fixtureCwd, groups: [
        { cwd: fixtureCwd, pinned: false, has_more: false, sessions: sessions.map(responseSession) },
        { cwd: "/session-pin-fixtures/beta", pinned: false, has_more: false,
          sessions: [responseSession({ ...session("other-project", 50, "Other project session"), cwd: "/session-pin-fixtures/beta" })] },
      ] })
    }
    const match = url.pathname.match(/^\/api\/sandbox\/agent\/sessions\/([^/]+)\/pin$/)
    if (match && method === "PUT") {
      const { pinned } = JSON.parse(String(init?.body)) as { pinned: boolean }
      request.pinned = pinned
      sessions = sessions.map((value) => value.sessionId === match[1] ? { ...value, pinned } : value)
      await new Promise((resolve) => setTimeout(resolve, 80))
      return Response.json({ status: "ok", pinned, archived: false })
    }
    unexpected.push(`${method} ${url.pathname}`)
    return Response.json({ detail: "Unexpected isolated session fixture request" }, { status: 404 })
  }
  return {
    requests,
    unexpected,
    reset(pinnedIds?: readonly string[]) {
      sessions = initialSessions().map((value) => pinnedIds === undefined
        ? value : { ...value, pinned: pinnedIds.includes(value.sessionId) })
      requests.length = 0
      unexpected.length = 0
    },
    restore() { window.fetch = originalFetch },
  }
}
