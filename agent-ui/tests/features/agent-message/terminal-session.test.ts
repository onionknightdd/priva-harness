import assert from "node:assert/strict"
import { test } from "node:test"

import {
  connectTerminalSession,
  parseControlFrame,
  terminalSocketUrl,
  type TerminalSessionStatus,
} from "../../../src/features/agent-message/terminal-session.ts"

class Socket extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 3
  static instances: Socket[] = []
  readyState = 0
  binaryType = "blob"
  sent: (ArrayBuffer | string)[] = []
  constructor(readonly url: string) {
    super()
    Socket.instances.push(this)
  }
  open() {
    this.readyState = 1
    this.dispatchEvent(new Event("open"))
  }
  send(data: ArrayBuffer | string) {
    this.sent.push(data)
  }
  text(frame: Record<string, unknown>) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(frame) }))
  }
  binary(bytes: number[]) {
    this.dispatchEvent(new MessageEvent("message", { data: Uint8Array.from(bytes).buffer }))
  }
  close() {
    this.readyState = 3
    this.dispatchEvent(new Event("close"))
  }
}

function withFakeSocket<T>(run: () => T): T {
  const originals = ["window", "WebSocket"].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
  )
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { protocol: "https:", host: "ui.example" } },
  })
  Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: Socket })
  try {
    return run()
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
}

test("builds the terminal socket URL from the run parameters", () => {
  withFakeSocket(() => {
    const url = new URL(
      terminalSocketUrl({ harness: "claude", cwd: "/work/repo", model: "p:m", sessionId: "s1", effort: "high", cols: 100, rows: 30, theme: "light" })
    )
    assert.equal(url.protocol, "wss:")
    assert.equal(url.host, "ui.example")
    assert.equal(url.pathname, "/api/sandbox/agent/ws/terminal")
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      harness: "claude", cwd: "/work/repo", model: "p:m", cols: "100", rows: "30", sessionId: "s1", effort: "high", theme: "light",
    })
    const fresh = new URL(terminalSocketUrl({ harness: "claude", cwd: "/w", model: "m", sessionId: null, cols: 80, rows: 24 }))
    assert.equal(fresh.searchParams.has("sessionId"), false)
    assert.equal(fresh.searchParams.has("effort"), false)
    assert.equal(fresh.searchParams.has("theme"), false)
  })
})

test("parses control frames and ignores anything else", () => {
  assert.deepEqual(parseControlFrame('{"type":"ready","sessionId":"s","adopted":true,"cols":90,"rows":20}'), {
    type: "ready", sessionId: "s", adopted: true, cols: 90, rows: 20,
  })
  assert.deepEqual(parseControlFrame('{"type":"exit","reason":"done"}'), { type: "exit", reason: "done" })
  assert.deepEqual(parseControlFrame('{"type":"error","kind":"unsupported","message":"no"}'), {
    type: "error", kind: "unsupported", message: "no",
  })
  assert.equal(parseControlFrame('{"type":"ready"}'), null)
  assert.equal(parseControlFrame("not json"), null)
  assert.equal(parseControlFrame('{"type":"resize"}'), null)
})

test("streams output, reports lifecycle and encodes input as binary frames", () => {
  withFakeSocket(() => {
    const statuses: TerminalSessionStatus[] = []
    const output: number[] = []
    const session = connectTerminalSession(
      { harness: "claude", cwd: "/w", model: "m", sessionId: null, cols: 80, rows: 24 },
      { onOutput: (chunk) => output.push(...chunk), onStatus: (status) => statuses.push(status) }
    )
    const socket = Socket.instances.at(-1)!
    assert.equal(socket.binaryType, "arraybuffer")
    assert.deepEqual(statuses, [{ phase: "connecting" }])

    session.send("dropped before open")
    assert.equal(socket.sent.length, 0)
    socket.open()
    socket.text({ type: "ready", sessionId: "new-id", adopted: false, cols: 80, rows: 24 })
    assert.deepEqual(statuses.at(-1), { phase: "ready", sessionId: "new-id", adopted: false, cols: 80, rows: 24 })
    socket.binary([0x68, 0x69, 0x1b, 0x5b, 0x4b])
    assert.deepEqual(output, [0x68, 0x69, 0x1b, 0x5b, 0x4b])

    session.send("é\r")
    session.send(Uint8Array.from([0x03]))
    session.resize(120, 40)
    assert.equal(socket.sent.length, 3)
    assert.deepEqual([...new Uint8Array(socket.sent[0] as ArrayBuffer)], [0xc3, 0xa9, 0x0d])
    assert.deepEqual([...new Uint8Array(socket.sent[1] as ArrayBuffer)], [0x03])
    assert.deepEqual(JSON.parse(socket.sent[2] as string), { type: "resize", cols: 120, rows: 40 })

    socket.text({ type: "exit", reason: "tmux session ended" })
    socket.close()
    assert.deepEqual(statuses.at(-1), { phase: "exited", reason: "tmux session ended" })
    assert.equal(statuses.filter((status) => status.phase === "closed").length, 0)
  })
})

test("an unexpected drop becomes closed, and a local close reports nothing further", () => {
  withFakeSocket(() => {
    const statuses: TerminalSessionStatus[] = []
    connectTerminalSession(
      { harness: "claude", cwd: "/w", model: "m", sessionId: "s", cols: 80, rows: 24 },
      { onOutput: () => {}, onStatus: (status) => statuses.push(status) }
    )
    const dropped = Socket.instances.at(-1)!
    dropped.open()
    dropped.close()
    assert.deepEqual(statuses.at(-1), { phase: "closed" })

    const local: TerminalSessionStatus[] = []
    const session = connectTerminalSession(
      { harness: "claude", cwd: "/w", model: "m", sessionId: "s", cols: 80, rows: 24 },
      { onOutput: () => {}, onStatus: (status) => local.push(status) }
    )
    const socket = Socket.instances.at(-1)!
    socket.open()
    session.close()
    assert.equal(socket.readyState, Socket.CLOSED)
    assert.deepEqual(local, [{ phase: "connecting" }])
  })
})
