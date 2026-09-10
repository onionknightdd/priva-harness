import type { FileSystemDirectory } from "../../../src/lib/api/sandbox-files"

export function installProjectDirectoryFixtures() {
  const originalFetch = window.fetch
  const originalSocket = window.WebSocket
  const originalUpload = window.XMLHttpRequest
  const scrollFolders = Array.from({ length: 48 }, (_, index) => `folder-${String(index + 1).padStart(2, "0")}`)
  const directories = new Map<string, string[]>([
    ["/workspace", ["work"]], ["/workspace/work", ["existing", "other", "denied", "lazy"]],
    ["/workspace/work/existing", scrollFolders], ["/workspace/work/other", []], ["/workspace/work/lazy", ["child"]],
    ["/workspace/work/lazy/child", []],
  ])
  scrollFolders.forEach((name) => directories.set(`/workspace/work/existing/${name}`, []))
  const failures = new Map([["/workspace/work/denied", "Permission denied"]])
  const requests: string[] = []
  const unexpected: string[] = []
  const held = new Map<string, { resolve: (response: Response) => void; signal?: AbortSignal | null }>()
  const holdPaths = new Set<string>()
  const sessions = [{
    session_id: "existing-session", summary: "Existing conversation", first_prompt: "Existing conversation",
    cwd: "/workspace/work/existing", last_modified: Date.now(), custom_title: null, tag: null,
    tags: [], tag_colors: {}, pinned: false, archived: false, run_mode: "agent",
  }]

  function listing(path: string): FileSystemDirectory {
    return {
      root: "/workspace", path, parent: path === "/workspace" ? null : path.slice(0, path.lastIndexOf("/")) || "/",
      entries: [...(directories.get(path) ?? []).map((name) => ({
        path: `${path === "/" ? "" : path}/${name}`, name, type: "directory" as const,
        size: null, modified: null, permissions: null,
      })), { path: `${path}/notes.txt`, name: "notes.txt", type: "file", size: 12, modified: null, permissions: null }],
    }
  }

  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href)
    if (!url.pathname.startsWith("/api/")) return originalFetch(input, init)
    requests.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`)
    if (url.pathname === "/api/sandbox/files/list") {
      const raw = url.searchParams.get("path") || "/workspace"
      const path = raw === "~/other" ? "/workspace/work/other" : raw
      if (path !== "/workspace" && !path.startsWith("/workspace/")) return Response.json({ detail: "Directory is outside WORKSPACE_DIR" }, { status: 403 })
      if (holdPaths.has(path)) return new Promise((resolve) => held.set(path, { resolve, signal: init?.signal }))
      if (failures.has(path)) return Response.json({ detail: failures.get(path) }, { status: 403 })
      return directories.has(path) ? Response.json(listing(path)) : Response.json({ detail: "Directory not found" }, { status: 404 })
    }
    if (url.pathname === "/api/sandbox/files/mkdir") {
      const { directory, name } = JSON.parse(String(init?.body)) as { directory: string; name: string }
      const path = `${directory}/${name}`
      if (directories.has(path)) return Response.json({ detail: "Folder already exists" }, { status: 409 })
      directories.set(path, [])
      directories.get(directory)!.push(name)
      return Response.json({ path, name })
    }
    if (url.pathname === "/api/sandbox/files" && init?.method === "DELETE") {
      const path = url.searchParams.get("path")!
      for (const directory of directories.keys()) {
        if (directory === path || directory.startsWith(`${path}/`)) directories.delete(directory)
      }
      return Response.json({ status: "ok", path })
    }
    if (url.pathname === "/api/sandbox/files/preview") {
      const path = url.searchParams.get("path")!
      return Response.json({ path, name: path.split("/").at(-1), mime_type: "text/plain", size: 12, content: "Attachment fixture", is_binary: false, preview_url: null })
    }
    if (url.pathname === "/api/sandbox/agent/profile") return Response.json({ queue_behavior: "follow-up" })
    if (/^\/api\/sandbox\/agent\/sessions\/new-session-\d+\/context-usage$/.test(url.pathname)) return Response.json(null)
    if (url.pathname === "/api/sandbox/agent/sessions/running") return Response.json({ running: [], warm: [] })
    if (url.pathname === "/api/sandbox/agent/sessions") return Response.json({
      active_cwd: "/workspace/work/existing", groups: [...new Set(sessions.map((session) => session.cwd))].map((cwd) => ({
        cwd, pinned: false, has_more: false, sessions: sessions.filter((session) => session.cwd === cwd),
      })),
    })
    if (url.pathname === "/api/sandbox/credentials/profiles") return Response.json({ default_profile_id: "test", profiles: [{
      id: "test", label: "Test profile", base_url: "https://example.invalid", auth_token_set: true,
      default_model: "test-model", model_count: 1, model_capabilities: { image_understanding: [], image_generation: [], image_edit: [] },
    }] })
    if (url.pathname === "/api/sandbox/credentials/profiles/test/models") return Response.json({ models: [{ id: "test-model" }] })
    if (url.pathname === "/api/sandbox/agent/slash-commands") return Response.json({ commands: [] })
    unexpected.push(url.pathname)
    return Response.json({ detail: `Unmocked API: ${url.pathname}` }, { status: 500 })
  }

  const sockets: MockSocket[] = []
  class MockSocket extends EventTarget {
    static OPEN = 1
    static CONNECTING = 0
    readyState = 0
    sent: Record<string, unknown>[] = []
    constructor(readonly url: string) {
      super()
      sockets.push(this)
      queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event("open")) })
    }
    send(data: string) { this.sent.push(JSON.parse(data)) }
    close() { this.readyState = 3; this.dispatchEvent(new Event("close")) }
    reply(frame: Record<string, unknown>) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(frame) })) }
    bindSession() {
      const init = this.sent[0]
      const id = `new-session-${sockets.indexOf(this)}`
      sessions.push({ ...sessions[0], session_id: id, cwd: String(init.cwd), summary: "New conversation", first_prompt: String(init.text) })
      this.reply({ type: "session.started", sessionId: id, runId: `run-${id}` })
      return id
    }
  }
  window.WebSocket = MockSocket as unknown as typeof WebSocket

  const uploads: MockUpload[] = []
  class MockUpload extends EventTarget {
    upload = new EventTarget()
    body!: FormData
    status = 200
    responseText = ""
    aborted = false
    open() {}
    send(body: FormData) { this.body = body; uploads.push(this) }
    abort() { this.aborted = true; this.dispatchEvent(new Event("abort")) }
    complete() {
      const file = this.body.get("file") as File
      this.responseText = JSON.stringify({ status: "ok", path: `${this.body.get("directory")}/.priva-attachments/${file.name}`, name: file.name, size: file.size })
      this.dispatchEvent(new Event("load"))
    }
  }
  window.XMLHttpRequest = MockUpload as unknown as typeof XMLHttpRequest

  return {
    directories, failures, requests, unexpected, held, holdPaths, listing, sockets, uploads,
    restore() { window.fetch = originalFetch; window.WebSocket = originalSocket; window.XMLHttpRequest = originalUpload },
  }
}
