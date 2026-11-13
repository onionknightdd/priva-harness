import assert from "node:assert/strict"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"
import { listWhiteboardFiles, useWhiteboardFiles } from "../../../src/features/whiteboard/use-whiteboard-files"

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost" })
for (const key of ["window", "document", "navigator", "HTMLElement", "Node"]) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const React = await import("react")
const { createRoot } = await import("react-dom/client")
const originalFetch = globalThis.fetch
after(() => { globalThis.fetch = originalFetch; dom.window.close() })

test("session list sends only its scope and surfaces invalid or failed responses", async () => {
  const signal = new AbortController().signal
  globalThis.fetch = async (input, options) => {
    assert.equal(input, "/api/sandbox/whiteboards/list")
    assert.equal(options?.method, "POST")
    assert.deepEqual(JSON.parse(String(options?.body)), { cwd: "/work", sessionId: "session-a" })
    assert.equal(options?.signal, signal)
    return Response.json({ files: [{ name: "flow.board.json", path: "/work/.whiteboard/session-a/flow.board.json" }] })
  }
  assert.deepEqual(await listWhiteboardFiles("/work", "session-a", signal), [{ name: "flow.board.json", path: "/work/.whiteboard/session-a/flow.board.json" }])
  globalThis.fetch = async () => Response.json({ detail: "Cannot read session directory" }, { status: 403 })
  await assert.rejects(listWhiteboardFiles("/work", "session-a", signal), /Cannot read session directory/)
  globalThis.fetch = async () => Response.json({ files: [{ name: "missing path" }] })
  await assert.rejects(listWhiteboardFiles("/work", "session-a", signal), /Invalid whiteboard file list/)
})

function pendingRequests() {
  const requests: { scope: { cwd: string; sessionId: string }; signal: AbortSignal; resolve(response: Response): void }[] = []
  globalThis.fetch = (_input, options) => new Promise<Response>(resolve => {
    requests.push({ scope: JSON.parse(String(options?.body)), signal: options!.signal as AbortSignal, resolve })
  })
  return requests
}
async function fixture() {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  let state: ReturnType<typeof useWhiteboardFiles>
  function Probe({ cwd, sessionId, path }: { cwd: string; sessionId?: string; path?: string }) { state = useWhiteboardFiles(cwd, sessionId, path); return null }
  return {
    state: () => state,
    render: (cwd: string, sessionId?: string, path?: string) => React.act(async () => root.render(React.createElement(Probe, { cwd, sessionId, path }))),
    close: async () => { await React.act(async () => root.unmount()); host.remove() },
  }
}

test("session changes clear old lists and ignore late responses even when fetch ignores abort", async () => {
  const requests = pendingRequests(), view = await fixture()
  try {
    await view.render("/work", "first", "/work/.whiteboard/first/a.board.json")
    await React.act(async () => requests[0].resolve(Response.json({ files: [{ name: "a.board.json", path: "/work/.whiteboard/first/a.board.json" }] })))
    assert.equal(view.state().files[0]?.name, "a.board.json")
    await React.act(async () => { void view.state().refresh() })
    const staleRefresh = view.state().refresh
    await view.render("/other", "second", "/other/.whiteboard/second/b.board.json")
    assert.deepEqual(view.state().files, [])
    assert.equal(requests[1].signal.aborted, true)
    assert.deepEqual(requests[2].scope, { cwd: "/other", sessionId: "second" })
    await React.act(async () => requests[2].resolve(Response.json({ files: [{ name: "b.board.json", path: "/other/.whiteboard/second/b.board.json" }] })))
    await React.act(async () => requests[1].resolve(Response.json({ files: [{ name: "stale.board.json", path: "/work/.whiteboard/first/stale.board.json" }] })))
    await React.act(async () => staleRefresh())
    assert.equal(requests.length, 3)
    assert.deepEqual(view.state().files.map(file => file.name), ["b.board.json"])
    assert.equal(view.state().loading, false)
  } finally { await view.close() }
})

test("path selection, first content and menu refresh discover new files without polling", async () => {
  const requests = pendingRequests(), view = await fixture()
  try {
    await view.render("/work")
    assert.equal(requests.length, 0, "draft sessions never guess a directory")
    await view.render("/work", "session")
    assert.equal(requests.length, 1)
    await React.act(async () => requests[0].resolve(Response.json({ files: [] })))
    await view.render("/work", "session", "/work/.whiteboard/session/new.board.json")
    assert.equal(requests.length, 2)
    await React.act(async () => requests[1].resolve(Response.json({ files: [] })))
    await React.act(async () => { view.state().contentArrived(0) })
    assert.equal(requests.length, 2, "the empty streaming placeholder does not consume the first persisted content refresh")
    await React.act(async () => { view.state().contentArrived(1) })
    assert.equal(requests.length, 3, "first content retries listing after the file exists")
    await React.act(async () => { view.state().contentArrived(2) })
    assert.equal(requests.length, 3, "incremental drawing does not repeatedly list the directory")
    await React.act(async () => requests[2].resolve(Response.json({ files: [{ name: "new.board.json", path: "/work/.whiteboard/session/new.board.json" }] })))
    await React.act(async () => { void view.state().refresh() })
    assert.equal(view.state().files.length, 1, "opening the menu keeps the last valid list while refreshing")
    assert.equal(requests.length, 4)
    await view.close()
    assert.equal(requests[3].signal.aborted, true, "unmount cancels the active request")
  } finally { if (document.body.childElementCount) await view.close() }
})

test("refresh failures retain the current list and expose a retryable error", async () => {
  const requests = pendingRequests(), view = await fixture()
  try {
    await view.render("/work", "session")
    await React.act(async () => requests[0].resolve(Response.json({ files: [{ name: "one.board.json", path: "/work/.whiteboard/session/one.board.json" }] })))
    await React.act(async () => { void view.state().refresh() })
    await React.act(async () => requests[1].resolve(Response.json({ detail: "Permission denied" }, { status: 403 })))
    assert.equal(view.state().files.length, 1)
    assert.equal(view.state().loading, false)
    assert.equal(view.state().error, "Permission denied")
    await React.act(async () => { void view.state().refresh() })
    await React.act(async () => requests[2].resolve(Response.json({ files: [] })))
    assert.equal(view.state().error, null)
    assert.deepEqual(view.state().files, [])
  } finally { await view.close() }
})
