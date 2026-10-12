import assert from "node:assert/strict"
import { after, beforeEach, test } from "node:test"
import { JSDOM } from "jsdom"
import { computerStreamUrl, connectComputer, type ComputerConnectionState } from "../../../src/features/workspace/computer-connection.ts"

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost:15173", pretendToBeVisual: true })
Object.assign(globalThis, { window: dom.window, document: dom.window.document })
const originalFetch = globalThis.fetch
type Pending = { signal: AbortSignal; resolve: (response: Response) => void; reject: (error: Error) => void }
const requests: Pending[] = []
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/sandbox/computer")
  assert.equal(options?.cache, "no-store")
  return new Promise<Response>((resolve, reject) => requests.push({ signal: options?.signal as AbortSignal, resolve, reject }))
}
after(() => { globalThis.fetch = originalFetch; dom.window.close() })
beforeEach(() => { requests.length = 0; FakeClient.instances.length = 0 })

class FakeClient extends EventTarget {
  static instances: FakeClient[] = []
  scaleViewport = false
  resizeSession = true
  focusOnClick = false
  background = ""
  viewOnly = false
  events: string[] = []
  constructor(readonly target: HTMLElement, readonly url: string) {
    super()
    FakeClient.instances.push(this)
    target.append(document.createElement("canvas"))
  }
  blur() { this.events.push("blur") }
  disconnect() { this.events.push("disconnect"); this.dispatchEvent(new Event("disconnect")) }
}

const settle = async () => { await new Promise((resolve) => setImmediate(resolve)) }
const latest = () => requests.at(-1)!
function start(loadClient = async () => FakeClient) {
  const target = document.body.appendChild(document.createElement("div"))
  const states: ComputerConnectionState[] = []
  const stop = connectComputer(target, (state) => states.push(state), loadClient)
  return { target, states, stop, close: () => { stop(); target.remove() } }
}

test("uses same-origin WS and upgrades to WSS with HTTPS", () => {
  assert.equal(computerStreamUrl({ href: "http://localhost:15173/chat?id=a" }), "ws://localhost:15173/api/sandbox/computer/stream")
  assert.equal(computerStreamUrl({ href: "https://runner.example/chat" }), "wss://runner.example/api/sandbox/computer/stream")
})

test("available desktop connects with scaling, becomes keyboard focusable and cleans up", async () => {
  const view = start()
  try {
    assert.deepEqual(view.states, ["connecting"])
    latest().resolve(Response.json({ available: true }))
    await settle()
    const client = FakeClient.instances[0]
    assert.equal(client.url, "ws://localhost:15173/api/sandbox/computer/stream")
    assert.equal(client.scaleViewport, true)
    assert.equal(client.resizeSession, false)
    assert.equal(client.focusOnClick, true)
    client.dispatchEvent(new Event("connect"))
    assert.deepEqual(view.states, ["connecting", "connected"])
    assert.equal(view.target.querySelector("canvas")?.tabIndex, 0)
    view.stop()
    assert.deepEqual(client.events, ["blur", "disconnect"])
    assert.equal(client.viewOnly, true)
    assert.equal(view.target.childElementCount, 0)
    assert.equal(latest().signal.aborted, true)
    client.dispatchEvent(new Event("connect"))
    assert.deepEqual(view.states, ["connecting", "connected"], "late events after cleanup must not update the view")
  } finally { view.close() }
})

test("unavailable desktops never download or initialize noVNC", async () => {
  let loaded = false
  const view = start(async () => { loaded = true; return FakeClient })
  try {
    latest().resolve(Response.json({ available: false }))
    await settle()
    assert.deepEqual(view.states, ["connecting", "unavailable"])
    assert.equal(loaded, false)
    assert.equal(view.target.childElementCount, 0)
  } finally { view.close() }
})

test("HTTP errors and invalid status payloads produce a retryable failure", async () => {
  for (const response of [Response.json({ detail: "offline" }, { status: 503 }), Response.json({ available: "true" })]) {
    const view = start()
    try {
      latest().resolve(response)
      await settle()
      assert.deepEqual(view.states, ["connecting", "failed"])
      assert.equal(FakeClient.instances.length, 0)
    } finally { view.close() }
  }
})

test("unmount cancels status requests and ignores late responses", async () => {
  const view = start()
  try {
    const pending = latest()
    view.stop()
    assert.equal(pending.signal.aborted, true)
    pending.resolve(Response.json({ available: true }))
    await settle()
    assert.equal(FakeClient.instances.length, 0)
    assert.deepEqual(view.states, ["connecting"])
  } finally { view.close() }
})

test("closing while the lazy client loads cannot create an orphan connection", async () => {
  let resolveClient!: (client: typeof FakeClient) => void
  const view = start(() => new Promise((resolve) => { resolveClient = resolve }))
  try {
    latest().resolve(Response.json({ available: true }))
    await settle()
    view.stop()
    resolveClient(FakeClient)
    await settle()
    assert.equal(FakeClient.instances.length, 0)
    assert.equal(view.target.childElementCount, 0)
  } finally { view.close() }
})

test("unexpected disconnect and unsupported security handshakes close input", async () => {
  for (const event of ["disconnect", "credentialsrequired", "securityfailure", "serververification"]) {
    const view = start()
    try {
      latest().resolve(Response.json({ available: true }))
      await settle()
      const client = FakeClient.instances.at(-1)!
      client.dispatchEvent(new Event("connect"))
      client.dispatchEvent(new Event(event))
      assert.equal(view.states.at(-1), event === "disconnect" ? "disconnected" : "failed")
      assert.equal(client.viewOnly, true)
      assert.deepEqual(client.events, ["blur", "disconnect"])
      assert.equal(view.target.childElementCount, 0)
    } finally { view.close() }
  }
})

test("a failed lazy import is retryable without leaving a canvas", async () => {
  const view = start(async () => { throw new Error("chunk unavailable") })
  try {
    latest().resolve(Response.json({ available: true }))
    await settle()
    assert.deepEqual(view.states, ["connecting", "failed"])
    assert.equal(view.target.childElementCount, 0)
  } finally { view.close() }
})

test("a stalled connection times out and cannot revive from a late status response", async () => {
  const originalSetTimeout = window.setTimeout
  let expire!: () => void
  window.setTimeout = ((handler: () => void, delay: number) => {
    assert.equal(delay, 15_000)
    expire = handler
    return originalSetTimeout.call(window, handler, delay)
  }) as typeof window.setTimeout
  const view = start()
  try {
    const pending = latest()
    expire()
    assert.equal(pending.signal.aborted, true)
    assert.deepEqual(view.states, ["connecting", "failed"])
    pending.resolve(Response.json({ available: true }))
    await settle()
    assert.equal(FakeClient.instances.length, 0)
  } finally { view.close(); window.setTimeout = originalSetTimeout }
})
